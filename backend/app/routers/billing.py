"""Memberships: the public plan list, Stripe Checkout and customer portal, and Stripe webhooks."""
import asyncio
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, membership, promotions, security, settings_store
from ..entitlements import RESOLUTIONS
from ..config import get_config
from ..db import get_db
from ..models import BillingEvent, Plan, Promotion, User
from ..services.stripe import Stripe, StripeError, subscription_fields, verify_webhook

log = logging.getLogger("ptm.billing")
router = APIRouter(prefix="/api", tags=["billing"])
LIVE_STATUSES = {"active", "trialing", "past_due"}   # past_due keeps access while Stripe retries the card


def plan_view(p: Plan, settings: dict, promotion: Promotion | None = None) -> dict:
    return {
        "id": p.id, "name": p.name, "description": p.description, "perks": p.perks or [], "price_cents": p.price_cents,
        "currency": p.currency, "interval": p.interval, "highlight": p.highlight,
        "purchasable": bool(settings["billing_enabled"] and p.price_cents > 0 and p.stripe_price_id),
        "limits": {"max_streams": p.max_streams, "max_resolution": p.max_resolution,
                   "max_resolution_label": RESOLUTIONS.get(p.max_resolution or "", None),
                   "allow_downloads": p.allow_downloads, "all_libraries": p.section_keys is None},
        "libraries": [],   # filled in by public_plans from the server's library names
        "promotion": promotions.view(promotion) if promotion else None,
    }


@router.get("/plans")
async def public_plans(db: AsyncSession = Depends(get_db), user: User | None = Depends(security.optional_user)):
    settings = await settings_store.load(db)
    await promotions.reconcile_codes(db, settings)
    rows = (await db.execute(select(Plan).where(Plan.active).order_by(Plan.sort_order, Plan.price_cents))).scalars().all()
    names = await library_names(settings)
    out = []
    for p in rows:
        promo = await promotions.automatic(db, p, user) if settings["billing_enabled"] and p.price_cents > 0 else None
        view = plan_view(p, settings, promo)
        view["libraries"] = [names[k] for k in (p.section_keys if p.section_keys is not None else names) if k in names]
        out.append(view)
    return {"billing_enabled": settings["billing_enabled"], "plans": out, "server_name": settings["plex_server_name"]}


_library_cache: dict[str, tuple[float, dict[str, str]]] = {}


async def library_names(settings: dict) -> dict[str, str]:
    """{section key: title} for the shared server, cached for 10 minutes (empty if Plex isn't connected or is down)."""
    if not settings_store.plex_ready(settings):
        return {}
    cached = _library_cache.get(settings["plex_server_id"])
    if cached and time.monotonic() - cached[0] < 600:
        return cached[1]
    try:
        sections = await asyncio.to_thread(membership.owner(settings).sections)
    except Exception:
        return cached[1] if cached else {}
    names = {s["key"]: s["title"] for s in sections}
    _library_cache[settings["plex_server_id"]] = (time.monotonic(), names)
    return names





def _stripe(settings: dict) -> Stripe:
    if not settings["billing_enabled"]:
        raise HTTPException(503, "Paid plans aren't available on this site.")
    return Stripe(settings["stripe_secret_key"])


class CheckoutIn(BaseModel):
    plan_id: str


@router.post("/billing/checkout", dependencies=[Depends(security.csrf_guard)])
async def checkout(body: CheckoutIn, request: Request, user: User = Depends(security.current_user),
                   db: AsyncSession = Depends(get_db)):
    settings = await settings_store.load(db)
    stripe = _stripe(settings)
    plan = await db.get(Plan, body.plan_id)
    if not plan or not plan.active or plan.price_cents <= 0 or not plan.stripe_price_id:
        raise HTTPException(400, "That plan isn't available.")
    if user.stripe_subscription_id and user.subscription_status in LIVE_STATUSES:
        raise HTTPException(409, "You already have a subscription. Change or cancel it under Manage billing.")
    if not settings_store.plex_ready(settings):
        raise HTTPException(503, "The server isn't ready for new members yet. Please try again later.")
    await promotions.reconcile_codes(db, settings)   # e.g. a code whose start date has just arrived
    promo = await promotions.automatic(db, plan, user)
    if promo and not await promotions.reserve(db, promo):
        raise HTTPException(400, "That promotion has just been fully claimed.")
    base = get_config().public_url
    try:
        for attempt in range(3):
            if not user.stripe_customer_id:
                user.stripe_customer_id = (await stripe.create_customer(user.email, user.display_name, user.id))["id"]
                await db.commit()
            try:
                coupon = await promotions.coupon(stripe, promo) if promo else None
                session = await stripe.checkout(user.stripe_customer_id, plan.stripe_price_id, user.id,
                                                f"{base}/account?billing=success", f"{base}/pricing?billing=cancelled",
                                                coupon=coupon, trial_days=promo.trial_days if promo else None,
                                                promotion_id=promo.id if promo else None,
                                                expires_at=promotions.checkout_expiry(promo) if promo else None)
                break
            except StripeError as e:
                if attempt == 2 or not e.missing:
                    raise
                # saved under other Stripe keys (test vs live): make it again in this account
                if "customer" in str(e).lower():
                    user.stripe_customer_id = None
                elif "coupon" in str(e).lower() and promo:
                    promo.stripe_coupon_id = None
                else:
                    raise
    except StripeError as e:
        if promo:
            await promotions.release(db, promo.id, used=False)
            await db.commit()
        raise HTTPException(424, f"Stripe: {e}") from e
    audit.record(db, "billing.checkout_started", request=request, actor=user, target=user, plan=plan.name,
                 promotion=promo.name if promo else None)
    await db.commit()
    return {"url": session["url"]}


@router.post("/billing/portal", dependencies=[Depends(security.csrf_guard)])
async def portal(user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    settings = await settings_store.load(db)
    stripe = _stripe(settings)
    if not user.stripe_customer_id:
        raise HTTPException(400, "You don't have a billing account yet.")
    try:
        session = await stripe.portal(user.stripe_customer_id, f"{get_config().public_url}/account")
    except StripeError as e:
        if e.missing:   # saved under other Stripe keys
            user.stripe_customer_id = None
            await db.commit()
            raise HTTPException(400, "You don't have a billing account yet.") from e
        raise HTTPException(424, f"Stripe: {e}") from e
    return {"url": session["url"]}


async def _plan_for_price(db: AsyncSession, price: dict) -> Plan | None:
    plan_id = (price.get("metadata") or {}).get("plan_id")   # survives price changes: old prices keep their plan
    plan = await db.get(Plan, plan_id) if plan_id else None
    if plan is None and price.get("id"):
        plan = (await db.execute(select(Plan).where(Plan.stripe_price_id == price["id"]))).scalar_one_or_none()
    return plan


async def apply_subscription(db: AsyncSession, user: User, sub: dict) -> None:
    before = audit.snapshot(user, SUB_FIELDS)
    f = subscription_fields(sub)
    if user.stripe_subscription_id and f["subscription_id"] != user.stripe_subscription_id \
            and user.subscription_status in LIVE_STATUSES and f["status"] not in LIVE_STATUSES:
        return   # an old subscription ending doesn't affect the current one
    item = ((sub.get("items") or {}).get("data") or [{}])[0] or {}
    plan = await _plan_for_price(db, item.get("price") or {})
    user.stripe_subscription_id = f["subscription_id"]
    user.subscription_status = f["status"]
    user.subscription_period_end = f["period_end"]
    user.subscription_cancel_at_period_end = f["cancel_at_period_end"]
    if f["status"] in LIVE_STATUSES and plan:
        user.plan_id, user.plan_source = plan.id, "stripe"
    elif user.plan_source == "stripe":
        user.plan_id, user.plan_source = None, None   # no plan: server access is removed
    if changes := audit.diff(user, SUB_FIELDS, before):
        audit.record(db, "billing.subscription", actor_label="Stripe", target=user, changes=changes,
                     subscription=f["subscription_id"])
    log.info("user %s subscription %s -> %s (plan %s)", user.id, f["subscription_id"], f["status"], user.plan_id)


SUB_FIELDS = ["plan_id", "plan_source", "subscription_status", "subscription_cancel_at_period_end"]


async def cancel_for_deletion(db: AsyncSession, user: User) -> bool:
    """Stop billing before an account is deleted. Raises 424 if Stripe can't be reached, so nobody keeps paying."""
    if not (user.stripe_subscription_id and user.subscription_status in LIVE_STATUSES):
        return False
    settings = await settings_store.load(db)
    try:
        await Stripe(settings["stripe_secret_key"]).cancel_subscription(user.stripe_subscription_id)
    except StripeError as e:
        if e.status != 404:   # already gone on Stripe's side
            raise HTTPException(424, f"Couldn't cancel the Stripe subscription, so the account wasn't deleted: {e}") from e
    return True


def _money(cents: int | None, currency: str | None) -> str:
    return f"{(currency or '').upper()} {(cents or 0) / 100:,.2f}".strip()


def _summary(kind: str, obj: dict) -> tuple[str, int | None]:
    """A one-line description of an event for the payments log, and the amount if money moved."""
    cur = obj.get("currency")
    if kind == "checkout.session.completed":
        return "Checkout completed", obj.get("amount_total")
    if kind == "checkout.session.expired":
        return "Checkout abandoned", None
    if kind.startswith("customer.subscription."):
        f = subscription_fields(obj)
        end = " (cancels at period end)" if f["cancel_at_period_end"] else ""
        return f"Subscription {kind.rsplit('.', 1)[1]}: {f['status']}{end}", None
    if kind in ("invoice.paid", "invoice.payment_succeeded"):
        return f"Payment received: {_money(obj.get('amount_paid'), cur)}", obj.get("amount_paid")
    if kind == "invoice.payment_failed":
        return f"Payment failed: {_money(obj.get('amount_due'), cur)} (attempt {obj.get('attempt_count') or 1})", obj.get("amount_due")
    if kind == "charge.refunded":
        return f"Refunded: {_money(obj.get('amount_refunded'), cur)}", -(obj.get("amount_refunded") or 0)
    if kind.startswith("charge.dispute."):
        return f"Dispute {kind.rsplit('.', 1)[1]}: {_money(obj.get('amount'), cur)} ({obj.get('reason') or 'no reason'})", obj.get("amount")
    return kind, None


ALERT_EVENTS = {"invoice.payment_failed": "billing.payment_failed", "charge.refunded": "billing.refund",
                "charge.dispute.created": "billing.dispute_opened", "charge.dispute.closed": "billing.dispute_closed"}


async def _user_for(db: AsyncSession, customer: str | None, user_id: str | None) -> User | None:
    if customer:
        user = (await db.execute(select(User).where(User.stripe_customer_id == customer))).scalar_one_or_none()
        if user:
            return user
    return await db.get(User, user_id) if user_id else None


@router.post("/billing/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Stripe calls this (no session, no CSRF header); the signature proves it's Stripe."""
    settings = await settings_store.load(db)
    try:
        event = verify_webhook(await request.body(), request.headers.get("stripe-signature", ""), settings["stripe_webhook_secret"])
    except StripeError as e:
        raise HTTPException(400, str(e)) from e
    kind, obj = event.get("type", ""), (event.get("data") or {}).get("object") or {}
    if event.get("id") and await db.get(BillingEvent, event["id"]):
        return {"received": True, "duplicate": True}   # Stripe retried an event we already applied
    user = None
    if kind == "checkout.session.completed" and obj.get("mode") == "subscription" and obj.get("subscription"):
        user = await _user_for(db, obj.get("customer"), obj.get("client_reference_id"))
        promo_id = (obj.get("metadata") or {}).get("promotion_id")
        promo = await db.get(Promotion, promo_id) if promo_id else None
        if promo:
            await promotions.release(db, promo.id, used=True)
        else:
            promo = await promotions.count_code_redemption(db, obj)
        if promo:
            audit.record(db, "billing.promotion_redeemed", actor_label="Stripe", target=user, promotion=promo.name)
        if user:
            if not user.stripe_customer_id:
                user.stripe_customer_id = obj.get("customer")
            try:
                await apply_subscription(db, user, await Stripe(settings["stripe_secret_key"]).subscription(obj["subscription"]))
            except StripeError as e:
                raise HTTPException(500, f"Stripe: {e}") from e   # 5xx makes Stripe retry
    elif kind == "checkout.session.expired":   # abandoned: give a held promotion use back
        user = await _user_for(db, obj.get("customer"), obj.get("client_reference_id"))
        if promo_id := (obj.get("metadata") or {}).get("promotion_id"):
            await promotions.release(db, promo_id, used=False)
    elif kind.startswith("customer.subscription."):
        user = await _user_for(db, obj.get("customer"), (obj.get("metadata") or {}).get("user_id"))
        if user:
            await apply_subscription(db, user, obj)
    else:   # invoices, refunds, disputes: logged against the customer, nothing to apply
        user = await _user_for(db, obj.get("customer"), None)
    if event.get("id"):
        summary, amount = _summary(kind, obj)
        created = event.get("created")
        db.add(BillingEvent(id=event["id"], type=kind[:80], user_id=user.id if user else None, customer_id=obj.get("customer"),
                            summary=summary[:500], amount_cents=amount, currency=obj.get("currency") or None,
                            stripe_created_at=datetime.fromtimestamp(created, timezone.utc) if created else None))
        if kind in ALERT_EVENTS:
            audit.record(db, ALERT_EVENTS[kind], actor_label="Stripe", target=user,
                         target_type="customer" if not user else None, target_id=obj.get("customer") if not user else None,
                         summary=summary)
    await db.commit()
    if user is not None and (kind.startswith("customer.subscription.") or kind == "checkout.session.completed"):
        await membership.sync_user_now(db, user)   # invite, change libraries, or remove access
    return {"received": True}
