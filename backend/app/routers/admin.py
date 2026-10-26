"""Admin panel API: site settings, members, audit log, payments log."""
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import case, func, or_, select
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, entitlements, mailer, membership, security, settings_store
from ..config import get_config
from ..db import get_db
from ..models import AuditLog, BillingEvent, EnforcementEvent, Plan, PlexMember, Session, SupportTicket, User
from ..services import plex
from . import billing

router = APIRouter(prefix="/api/admin", tags=["admin"],
                   dependencies=[Depends(security.csrf_guard), Depends(security.admin_user)])


# ── settings ─────────────────────────────────────────────────────────────────
@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db)):
    return settings_store.public_view(await settings_store.load(db))


@router.put("/settings")
async def put_settings(body: dict[str, Any], request: Request, me: User = Depends(security.admin_user),
                       db: AsyncSession = Depends(get_db)):
    before = await settings_store.load(db)
    updates = {}
    for key, value in body.items():
        if key not in settings_store.DEFAULTS:
            raise HTTPException(400, f"Unknown setting {key}")
        default = settings_store.DEFAULTS[key]
        if key in settings_store.SECRET_KEYS:
            if value is True or value is None:   # "unchanged" placeholder from the UI
                continue
            value = str(value)
        elif isinstance(default, bool):
            value = bool(value)
        elif isinstance(default, int):
            try:
                value = int(value)
            except (TypeError, ValueError) as e:
                raise HTTPException(400, f"{key} must be a number") from e
        else:
            value = str(value).strip()
        if key == "enforcement_mode" and value not in ("off", "monitor", "enforce"):
            raise HTTPException(400, "enforcement_mode must be off, monitor or enforce")
        if key == "title_links" and value not in ("seerr", "plex", "none"):
            raise HTTPException(400, "title_links must be seerr, plex or none")
        if key in ("tautulli_url", "seerr_url", "seerr_public_url", "plex_web_url") and value and not value.startswith(("http://", "https://")):
            raise HTTPException(400, "URLs must start with http:// or https://")
        updates[key] = value
    changed = {k: ("(secret changed)" if k in settings_store.SECRET_KEYS else [before[k], v])
               for k, v in updates.items() if before[k] != v}
    if changed:
        audit.record(db, "admin.settings.update", request=request, actor=me, target_type="settings", changes=changed)
    await settings_store.save(db, updates)   # commits the audit entry too
    return settings_store.public_view(await settings_store.load(db))


class TestEmailIn(BaseModel):
    to: str


@router.post("/settings/test-email")
async def test_email(body: TestEmailIn, db: AsyncSession = Depends(get_db)):
    settings = await settings_store.load(db)
    if not settings_store.email_ready(settings):
        raise HTTPException(400, "Set the SMTP host and From address first.")
    text, html = mailer.link_email(settings, heading="Email works", body="This is a test message from the admin panel.",
                                   button="Open the site", url=get_config().public_url)
    try:
        await mailer.send(settings, body.to, f"{settings['site_name']} test email", text, html)
    except Exception as e:   # surface the SMTP error to the admin
        raise HTTPException(400, f"Sending failed: {e}") from e
    return {"ok": True}


# ── overview ─────────────────────────────────────────────────────────────────
@router.get("/stats")
async def stats(days: int = 30, db: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))
    one = lambda stmt: db.execute(stmt)   # noqa: E731
    users = (await one(select(func.count(User.id)))).scalar_one()
    new_users = (await one(select(func.count(User.id)).where(User.created_at >= since))).scalar_one()
    access = dict((await one(select(PlexMember.share_status, func.count()).group_by(PlexMember.share_status))).all())
    unmanaged = (await one(select(func.count()).select_from(PlexMember)
                           .where(PlexMember.existing_friend, PlexMember.managed.is_(False)))).scalar_one()
    by_plan = (await one(select(Plan.name, func.count(User.id), func.sum(case((User.plan_source == "stripe", 1), else_=0)))
                         .join(User, User.plan_id == Plan.id).group_by(Plan.id).order_by(Plan.sort_order, Plan.price_cents))).all()
    enforcement = dict((await one(select(EnforcementEvent.rule, func.count()).where(EnforcementEvent.created_at >= since)
                                  .group_by(EnforcementEvent.rule))).all())
    errors = (await one(select(func.count()).select_from(PlexMember).where(PlexMember.last_error.is_not(None),
                                                                         PlexMember.last_error.not_like("Warning%")))).scalar_one()
    per_day = (await one(select(func.date(User.created_at), func.count(User.id)).where(User.created_at >= since)
                         .group_by(func.date(User.created_at)).order_by(func.date(User.created_at)))).all()
    return {
        "days": days, "users": users, "new_users": new_users,
        "access": {"shared": access.get("shared", 0), "invited": access.get("invited", 0), "none": access.get("none", 0),
                   "unmanaged": unmanaged, "errors": errors},
        "plans": [{"name": n, "members": c, "paying": int(p or 0)} for n, c, p in by_plan],
        "enforcement": {"streams": enforcement.get("streams", 0), "quality": enforcement.get("quality", 0)},
        "signups_per_day": [{"date": str(d), "count": n} for d, n in per_day],
    }


# ── members ──────────────────────────────────────────────────────────────────
def _plex_view(m: PlexMember | None) -> dict | None:
    if m is None:
        return None
    return {"plex_id": m.plex_id, "username": m.username, "email": m.email, "thumb": m.thumb, "server_access": m.share_status,
            "managed": m.managed, "existing_friend": m.existing_friend, "allow_downloads": m.allow_downloads,
            "invited_at": m.invited_at, "shared_at": m.shared_at, "removed_at": m.removed_at, "checked_at": m.checked_at,
            "last_error": m.last_error}


@router.get("/users")
async def list_users(q: str = "", page: int = 1, access: str = "", db: AsyncSession = Depends(get_db)):
    """access: shared | invited | none | unmanaged (on the server before joining, no plan yet)"""
    stmt = select(User, PlexMember).outerjoin(PlexMember).order_by(User.created_at.desc())
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.display_name).like(like), func.lower(User.email).like(like),
                              func.lower(PlexMember.username).like(like)))
    if access == "unmanaged":
        stmt = stmt.where(PlexMember.existing_friend, PlexMember.managed.is_(False))
    elif access:
        stmt = stmt.where(PlexMember.share_status == access)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.offset((max(page, 1) - 1) * 50).limit(50))).all()
    plans = {p.id: p.name for p in (await db.execute(select(Plan))).scalars()}
    return {"total": total, "page": page, "users": [{
        "id": u.id, "display_name": u.display_name, "email": u.email, "avatar_url": u.avatar_url, "is_admin": u.is_admin,
        "is_disabled": u.is_disabled, "created_at": u.created_at, "last_login_at": u.last_login_at,
        "plan_id": u.plan_id, "plan": plans.get(u.plan_id or ""), "plan_source": u.plan_source,
        "subscription_status": u.subscription_status, "plex": _plex_view(m),
    } for u, m in rows]}


class UserPatch(BaseModel):
    is_admin: bool | None = None
    is_disabled: bool | None = None
    plan_id: str | None = None           # "" = no plan (server access is removed)


USER_FIELDS = ["is_admin", "is_disabled", "plan_id", "plan_source"]


@router.patch("/users/{user_id}")
async def patch_user(user_id: str, body: UserPatch, request: Request, me: User = Depends(security.admin_user),
                     db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    before = audit.snapshot(user, USER_FIELDS)
    if user.id == me.id and (body.is_admin is False or body.is_disabled):
        raise HTTPException(400, "You can't remove your own admin access or disable yourself.")
    if body.plan_id is not None:
        if body.plan_id and not await db.get(Plan, body.plan_id):
            raise HTTPException(400, "Unknown plan.")
        if user.plan_source == "stripe" and user.subscription_status in billing.LIVE_STATUSES and body.plan_id != user.plan_id:
            raise HTTPException(400, "This member pays for their plan through Stripe. Change or cancel it in Stripe instead.")
        user.plan_id, user.plan_source = (body.plan_id, "admin") if body.plan_id else (None, None)
    for field in ("is_admin", "is_disabled"):
        value = getattr(body, field)
        if value is not None:
            setattr(user, field, value)
    if body.is_disabled:   # end their sessions now rather than on the next request
        await db.execute(sa_delete(Session).where(Session.user_id == user.id))
    changes = audit.diff(user, USER_FIELDS, before)
    if changes:
        audit.record(db, "admin.user.update", request=request, actor=me, target=user, changes=changes)
    await db.commit()
    plex_result = None
    if {"plan_id", "is_disabled"} & set(changes):
        plex_result = await membership.sync_user_now(db, user)
    return {"ok": True, "plex": plex_result}


@router.post("/users/{user_id}/plex-sync")
async def sync_user(user_id: str, db: AsyncSession = Depends(get_db)):
    """Check this member with Plex now and fix their access."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    try:
        result = await membership.sync_member(db, await settings_store.load(db), user)
    except plex.PlexError as e:
        await db.commit()
        raise HTTPException(424, f"Plex: {e}") from e
    await db.commit()
    return {"result": result, "plex": _plex_view(await db.get(PlexMember, user.id))}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request, me: User = Depends(security.admin_user), db: AsyncSession = Depends(get_db)):
    if user_id == me.id:
        raise HTTPException(400, "You can't delete your own account here.")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    cancelled = await billing.cancel_for_deletion(db, user)
    if user.plan_id:   # take away the server access their plan gave
        user.plan_id, user.plan_source = None, None
        await membership.sync_user_now(db, user)
    audit.record(db, "admin.user.delete", request=request, actor=me, target=user,
                 subscription_cancelled=cancelled or None, stripe_customer=user.stripe_customer_id)
    await db.delete(user)
    await db.commit()
    return {"ok": True}


@router.get("/users/{user_id}")
async def user_detail(user_id: str, db: AsyncSession = Depends(get_db)):
    """Everything about one member for the admin user page."""
    u = await db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found.")
    settings = await settings_store.load(db)
    m = await db.get(PlexMember, u.id)
    sessions = (await db.execute(select(Session).where(Session.user_id == u.id, Session.expires_at > datetime.now(timezone.utc))
                                 .order_by(Session.last_seen_at.desc()))).scalars().all()
    activity = (await db.execute(select(AuditLog).where(or_(AuditLog.target_id == u.id, AuditLog.actor_id == u.id))
                                 .order_by(AuditLog.created_at.desc()).limit(100))).scalars().all()
    payments = (await db.execute(select(BillingEvent).where(BillingEvent.user_id == u.id)
                                 .order_by(BillingEvent.received_at.desc()).limit(50))).scalars().all()
    tickets = (await db.execute(select(SupportTicket).where(SupportTicket.user_id == u.id)
                                .order_by(SupportTicket.updated_at.desc()).limit(20))).scalars().all()
    streams = (await db.execute(select(EnforcementEvent).where(EnforcementEvent.user_id == u.id)
                                .order_by(EnforcementEvent.created_at.desc()).limit(50))).scalars().all()
    plan = await db.get(Plan, u.plan_id) if u.plan_id else None
    test_mode = settings["stripe_secret_key"].startswith(("sk_test", "rk_test"))
    return {
        "id": u.id, "display_name": u.display_name, "email": u.email, "avatar_url": u.avatar_url, "is_admin": u.is_admin,
        "is_disabled": u.is_disabled, "created_at": u.created_at, "last_login_at": u.last_login_at,
        "plex": _plex_view(m), "is_owner": bool(m and m.plex_id == settings["plex_owner_id"]),
        "membership": {
            "plan": plan.name if plan else None, "plan_id": u.plan_id, "plan_source": u.plan_source, "status": u.subscription_status,
            "period_end": u.subscription_period_end, "cancel_at_period_end": u.subscription_cancel_at_period_end,
            "lapsed": entitlements.subscription_lapsed(u),
            "stripe_customer_id": u.stripe_customer_id, "stripe_subscription_id": u.stripe_subscription_id,
            "stripe_url": f"https://dashboard.stripe.com/{'test/' if test_mode else ''}customers/{u.stripe_customer_id}"
                          if u.stripe_customer_id else None,
        },
        "sessions": [{"created_at": s.created_at, "last_seen_at": s.last_seen_at, "expires_at": s.expires_at,
                      "ip": s.ip, "user_agent": s.user_agent} for s in sessions],
        "enforcement": [_event_view(e) for e in streams],
        "activity": [_audit_view(a) for a in activity],
        "payments": [_billing_view(e) for e in payments],
        "support": [{"id": t.id, "number": t.number, "subject": t.subject, "status": t.status, "updated_at": t.updated_at} for t in tickets],
    }


@router.post("/users/{user_id}/sign-out")
async def sign_out_user(user_id: str, request: Request, me: User = Depends(security.admin_user), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    n = (await db.execute(sa_delete(Session).where(Session.user_id == user.id))).rowcount
    audit.record(db, "admin.user.sign_out", request=request, actor=me, target=user, sessions=n)
    await db.commit()
    return {"ok": True, "sessions": n}


# ── audit log & billing events ─────────────────────────────────────────────
def _audit_view(a: AuditLog) -> dict:
    return {"id": a.id, "created_at": a.created_at, "actor_id": a.actor_id, "actor_label": a.actor_label, "action": a.action,
            "target_type": a.target_type, "target_id": a.target_id, "target_label": a.target_label,
            "details": a.details, "ip": a.ip}


def _event_view(e: EnforcementEvent) -> dict:
    return {"id": e.id, "created_at": e.created_at, "user_id": e.user_id, "plex_username": e.plex_username, "rule": e.rule,
            "title": e.title, "detail": e.detail, "action": e.action}


def _billing_view(e: BillingEvent) -> dict:
    return {"id": e.id, "type": e.type, "user_id": e.user_id, "customer_id": e.customer_id, "summary": e.summary,
            "amount_cents": e.amount_cents, "currency": e.currency, "stripe_created_at": e.stripe_created_at,
            "received_at": e.received_at}


@router.get("/audit")
async def audit_log(q: str = "", category: str = "", page: int = 1, db: AsyncSession = Depends(get_db)):
    """category: the action's first part (admin, auth, account, billing)."""
    settings = await settings_store.load(db)
    if page == 1:
        await audit.prune(db, settings["audit_retention_days"])
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    if category:
        stmt = stmt.where(AuditLog.action.like(f"{category}.%"))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(AuditLog.actor_label).like(like), func.lower(AuditLog.target_label).like(like),
                              func.lower(AuditLog.action).like(like), AuditLog.ip.like(like),
                              AuditLog.target_id == q, AuditLog.actor_id == q))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.offset((max(page, 1) - 1) * 50).limit(50))).scalars().all()
    return {"total": total, "page": page, "entries": [_audit_view(a) for a in rows]}


@router.get("/billing/events")
async def billing_events(page: int = 1, db: AsyncSession = Depends(get_db)):
    stmt = select(BillingEvent).order_by(BillingEvent.received_at.desc())
    total = (await db.execute(select(func.count(BillingEvent.id)))).scalar_one()
    rows = (await db.execute(stmt.offset((max(page, 1) - 1) * 50).limit(50))).scalars().all()
    labels = {u.id: audit.label(u) for u in (await db.execute(
        select(User).where(User.id.in_([e.user_id for e in rows if e.user_id])))).scalars()}
    return {"total": total, "page": page,
            "events": [{**_billing_view(e), "user_label": labels.get(e.user_id or "", "")} for e in rows]}
