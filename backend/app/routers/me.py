"""The signed-in member's account: profile, plan and server access, devices, data export, deleting the account."""
from fastapi import APIRouter, Depends, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, crypto, entitlements, membership, security, settings_store
from ..db import get_db, utcnow
from ..entitlements import RESOLUTIONS
from ..models import AuditLog, EnforcementEvent, PlexMember, Session, SupportTicket, User
from ..services import plex
from . import billing

router = APIRouter(prefix="/api/me", tags=["me"], dependencies=[Depends(security.csrf_guard)])


def plan_limits(plan) -> dict:
    return {"max_streams": plan.max_streams, "max_resolution": plan.max_resolution,
            "max_resolution_label": RESOLUTIONS.get(plan.max_resolution or "", None), "allow_downloads": plan.allow_downloads,
            "all_libraries": plan.section_keys is None, "libraries": len(plan.section_keys or [])}


@router.get("")
async def me(user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    settings = await settings_store.load(db)
    m = await db.get(PlexMember, user.id)
    plan = await entitlements.user_plan(db, user)
    return {
        "id": user.id, "display_name": user.display_name, "email": user.email, "avatar_url": user.avatar_url,
        "is_admin": user.is_admin, "created_at": user.created_at,
        "plex": None if not m else {
            "username": m.username, "email": m.email, "thumb": m.thumb, "server_access": m.share_status, "managed": m.managed,
            "existing_friend": m.existing_friend, "invited_at": m.invited_at, "shared_at": m.shared_at,
            "is_owner": m.plex_id == settings["plex_owner_id"],
        },
        "server_name": settings["plex_server_name"],
        "membership": {
            "plan": None if not plan else {"id": plan.id, "name": plan.name, "price_cents": plan.price_cents,
                                           "currency": plan.currency, "interval": plan.interval, **plan_limits(plan)},
            "status": user.subscription_status, "period_end": user.subscription_period_end,
            "cancel_at_period_end": user.subscription_cancel_at_period_end, "source": user.plan_source,
            "has_billing_account": bool(user.stripe_customer_id),
        },
    }


class ProfileIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


@router.patch("")
async def update_profile(body: ProfileIn, user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    user.display_name = body.display_name.strip()
    await db.commit()
    return {"ok": True}


@router.post("/check-access")
async def check_access(request: Request, user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    """'I accepted the invite': re-check with Plex now instead of waiting for the periodic check."""
    from .. import ratelimit
    ratelimit.limit(f"check-access:{user.id}", 6, 600)
    try:
        await membership.sync_member(db, await settings_store.load(db), user)
    except plex.PlexError:
        pass
    await db.commit()
    m = await db.get(PlexMember, user.id)
    return {"server_access": m.share_status if m else "none"}


@router.delete("")
async def delete_account(request: Request, response: Response, user: User = Depends(security.current_user),
                         db: AsyncSession = Depends(get_db)):
    cancelled = await billing.cancel_for_deletion(db, user)   # before anything else: no charges for a deleted account
    if user.plan_id:   # take away server access the plan gave
        user.plan_id, user.plan_source = None, None
        await membership.sync_user_now(db, user)
    audit.record(db, "account.delete", request=request, actor=user, target=user, subscription_cancelled=cancelled or None,
                 stripe_customer=user.stripe_customer_id)
    await security.end_session(db, response, request)
    await db.delete(await db.get(User, user.id))
    await db.commit()
    return {"ok": True}


# ── sessions (devices) ───────────────────────────────────────────────────────
@router.get("/sessions")
async def sessions(request: Request, user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    current = crypto.sha256(request.cookies.get(security.SESSION_COOKIE) or "")
    rows = (await db.execute(select(Session).where(Session.user_id == user.id, Session.expires_at > utcnow())
                             .order_by(Session.last_seen_at.desc()))).scalars().all()
    return [{"id": s.token_hash[:12], "current": s.token_hash == current, "created_at": s.created_at,
             "last_seen_at": s.last_seen_at, "ip": s.ip, "user_agent": s.user_agent} for s in rows]


@router.post("/sessions/sign-out-others")
async def sign_out_others(request: Request, user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    current = crypto.sha256(request.cookies.get(security.SESSION_COOKIE) or "")
    n = (await db.execute(delete(Session).where(Session.user_id == user.id, Session.token_hash != current))).rowcount
    audit.record(db, "account.sign_out_others", request=request, actor=user, target=user, sessions=n)
    await db.commit()
    return {"ok": True, "sessions": n}


# ── data export (privacy) ────────────────────────────────────────────────────
@router.get("/export")
async def export(request: Request, user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    """Everything stored about the account, as JSON. Secrets (tokens, keys, password hash) are left out."""
    m = await db.get(PlexMember, user.id)
    sess = (await db.execute(select(Session).where(Session.user_id == user.id))).scalars().all()
    streams = (await db.execute(select(EnforcementEvent).where(EnforcementEvent.user_id == user.id)
                                .order_by(EnforcementEvent.created_at))).scalars().all()
    events = (await db.execute(select(AuditLog).where(AuditLog.target_id == user.id).order_by(AuditLog.created_at))).scalars().all()
    tickets = (await db.execute(select(SupportTicket).where(SupportTicket.user_id == user.id).order_by(SupportTicket.created_at))).scalars().all()
    audit.record(db, "account.export", request=request, actor=user, target=user)
    await db.commit()
    data = {
        "exported_at": utcnow().isoformat(),
        "account": {"id": user.id, "display_name": user.display_name, "email": user.email, "avatar_url": user.avatar_url,
                    "created_at": user.created_at, "last_login_at": user.last_login_at, "plan_id": user.plan_id,
                    "subscription_status": user.subscription_status, "subscription_period_end": user.subscription_period_end,
                    "stripe_customer_id": user.stripe_customer_id},
        "plex": None if not m else {"plex_id": m.plex_id, "username": m.username, "email": m.email, "server_access": m.share_status,
                                    "invited_at": m.invited_at, "shared_at": m.shared_at, "removed_at": m.removed_at},
        "streams_over_plan_limits": [{"at": e.created_at, "rule": e.rule, "title": e.title, "detail": e.detail, "action": e.action}
                                     for e in streams],
        "sessions": [{"created_at": s.created_at, "last_seen_at": s.last_seen_at, "ip": s.ip, "user_agent": s.user_agent} for s in sess],
        "support_requests": [{"number": t.number, "category": t.category, "subject": t.subject, "status": t.status,
                              "created_at": t.created_at,
                              "messages": [{**m, "author": "Support" if m["from"] == "admin" else m["author"]} for m in t.messages]}
                             for t in tickets],
        "account_activity": [{"at": a.created_at, "action": a.action, "by": "you" if a.actor_id == user.id else ("a site admin" if a.action.startswith("admin.") else a.actor_label or "system"),
                              "ip": a.ip if a.actor_id == user.id else "", "details": a.details} for a in events],
    }
    return JSONResponse(jsonable_encoder(data), headers={
        "Content-Disposition": f'attachment; filename="account-export-{utcnow():%Y%m%d}.json"'})
