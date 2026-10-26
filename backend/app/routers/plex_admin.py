"""Admin: the Plex server (connect, choose server, libraries, existing friends) and Tautulli (connection, live streams,
enforcement log)."""
import asyncio
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, enforcement, jobs, membership, security, settings_store
from ..config import get_config
from ..db import get_db
from ..entitlements import RESOLUTIONS
from ..models import EnforcementEvent, Plan, PlexMember, User
from ..services import seerr, tautulli
from .admin import _event_view
from .discover import clear_cache as clear_discover_cache

router = APIRouter(prefix="/api/admin", tags=["admin"],
                   dependencies=[Depends(security.csrf_guard), Depends(security.admin_user)])


async def _plex(fn, *args):
    try:
        return await asyncio.to_thread(fn, *args)
    except Exception as e:
        raise HTTPException(424, f"Plex: {e}") from e


# ── Plex server ──────────────────────────────────────────────────────────────
@router.get("/plex")
async def plex_status(db: AsyncSession = Depends(get_db)):
    s = await settings_store.load(db)
    out = {"connected": bool(s["plex_owner_token"]), "owner_username": s["plex_owner_username"],
           "server_id": s["plex_server_id"], "server_name": s["plex_server_name"], "servers": [], "libraries": [],
           "callback_url": f"{get_config().public_url}/api/auth/plex/callback"}
    if not s["plex_owner_token"]:
        return out
    o = membership.owner(s)
    out["servers"] = await _plex(o.servers)
    if s["plex_server_id"]:
        out["libraries"] = await _plex(o.sections)
    counts = dict((await db.execute(select(PlexMember.share_status, func.count()).group_by(PlexMember.share_status))).all())
    out["members"] = {"shared": counts.get("shared", 0), "invited": counts.get("invited", 0), "none": counts.get("none", 0)}
    return out


class ServerIn(BaseModel):
    server_id: str


@router.put("/plex/server")
async def choose_server(body: ServerIn, request: Request, me: User = Depends(security.admin_user), db: AsyncSession = Depends(get_db)):
    s = await settings_store.load(db)
    if not s["plex_owner_token"]:
        raise HTTPException(400, "Connect your Plex account first.")
    server = next((x for x in await _plex(membership.owner(s).servers) if x["id"] == body.server_id), None)
    if server is None:
        raise HTTPException(400, "That server isn't one you own.")
    audit.record(db, "admin.plex.server", request=request, actor=me, target_type="settings", server=server["name"])
    await settings_store.save(db, {"plex_server_id": server["id"], "plex_server_name": server["name"]})
    jobs.kick_plex_check()
    return {"ok": True}


@router.post("/plex/disconnect")
async def disconnect(request: Request, me: User = Depends(security.admin_user), db: AsyncSession = Depends(get_db)):
    """Forget the owner token. Members keep their access; nothing is managed until it's connected again."""
    audit.record(db, "admin.plex.disconnect", request=request, actor=me, target_type="settings")
    await settings_store.save(db, {"plex_owner_token": "", "plex_server_id": "", "plex_server_name": ""})
    return {"ok": True}


@router.post("/plex/check")
async def check_now(db: AsyncSession = Depends(get_db)):
    """Run the Plex access check now (it also runs every 15 minutes)."""
    if not settings_store.plex_ready(await settings_store.load(db)):
        raise HTTPException(400, "Connect your Plex server first.")
    try:
        return {"results": await membership.reconcile(db)}
    except Exception as e:
        raise HTTPException(424, f"Plex: {e}") from e


@router.get("/plex/friends")
async def friends(db: AsyncSession = Depends(get_db)):
    """Everyone with access to the server, and whether they've joined this site."""
    s = await settings_store.load(db)
    if not settings_store.plex_ready(s):
        raise HTTPException(400, "Connect your Plex server first.")
    found = await _plex(membership.owner(s).friends)
    linked = {m.plex_id: (m, u) for m, u in (await db.execute(select(PlexMember, User).join(User))).all()}
    plans = {p.id: p.name for p in (await db.execute(select(Plan))).scalars()}
    out = []
    for f in sorted(found.values(), key=lambda f: f.username.lower()):
        m, u = linked.get(f.plex_id, (None, None))
        out.append({"plex_id": f.plex_id, "username": f.username, "email": f.email, "thumb": f.thumb, "status": f.status,
                    "user_id": u.id if u else None, "plan": plans.get(u.plan_id or "") if u else None,
                    "managed": bool(m and m.managed)})
    return out


class ImportIn(BaseModel):
    plan_id: str
    plex_ids: list[str] | None = None   # None = everyone on the server without a plan


@router.post("/plex/import")
async def import_friends(body: ImportIn, request: Request, me: User = Depends(security.admin_user), db: AsyncSession = Depends(get_db)):
    """Give people already on the server a plan (e.g. a free "Founding" plan). Makes accounts for those who haven't
    signed in yet; they get this account when they sign in with Plex."""
    s = await settings_store.load(db)
    plan = await db.get(Plan, body.plan_id)
    if plan is None:
        raise HTTPException(400, "Unknown plan.")
    found = await _plex(membership.owner(s).friends)
    linked = {m.plex_id: m for m in (await db.execute(select(PlexMember))).scalars()}
    added = assigned = 0
    for f in found.values():
        if body.plex_ids is not None and f.plex_id not in body.plex_ids:
            continue
        if f.plex_id == s["plex_owner_id"]:
            continue
        m = linked.get(f.plex_id)
        if m is None:
            user = User(display_name=f.title or f.username, email=f.email, avatar_url=f.thumb)
            db.add(user)
            await db.flush()
            m = PlexMember(user_id=user.id, plex_id=f.plex_id, username=f.username, email=f.email, thumb=f.thumb,
                           share_status=f.status, existing_friend=True)
            db.add(m)
            added += 1
        else:
            user = await db.get(User, m.user_id)
        if user.plan_id is None:
            user.plan_id, user.plan_source = plan.id, "admin"
            assigned += 1
    audit.record(db, "admin.plex.import", request=request, actor=me, target_type="plan", target_id=plan.id,
                 target_label=plan.name, accounts_created=added, plans_assigned=assigned)
    await db.commit()
    jobs.kick_plex_check()   # takes over their access under the plan
    return {"created": added, "assigned": assigned}


# ── Seerr ────────────────────────────────────────────────────────────────────
@router.post("/seerr/test")
async def seerr_test(db: AsyncSession = Depends(get_db)):
    s = await settings_store.load(db)
    if not settings_store.seerr_ready(s):
        raise HTTPException(400, "Add the Seerr URL and API key first.")
    client = seerr.Seerr(s["seerr_url"], s["seerr_api_key"])
    try:
        status = await client.get("/status")
        trending = await client.get("/discover/trending", page=1)
    except seerr.SeerrError as e:
        raise HTTPException(400, str(e)) from e
    clear_discover_cache()   # show the new settings straight away
    return {"ok": True, "version": status.get("version"), "trending": len(trending.get("results") or [])}


# ── Tautulli ─────────────────────────────────────────────────────────────────
async def webhook_secret(db: AsyncSession, s: dict) -> str:
    if not s["tautulli_webhook_secret"]:
        s["tautulli_webhook_secret"] = secrets.token_urlsafe(24)
        await settings_store.save(db, {"tautulli_webhook_secret": s["tautulli_webhook_secret"]})
    return s["tautulli_webhook_secret"]


@router.get("/tautulli")
async def tautulli_status(db: AsyncSession = Depends(get_db)):
    s = await settings_store.load(db)
    return {"url": s["tautulli_url"], "api_key_set": bool(s["tautulli_api_key"]), "mode": s["enforcement_mode"],
            "stream_limit_message": s["stream_limit_message"], "quality_limit_message": s["quality_limit_message"],
            "webhook_url": f"{get_config().public_url}/api/tautulli/webhook/{await webhook_secret(db, s)}"}


@router.post("/tautulli/test")
async def tautulli_test(db: AsyncSession = Depends(get_db)):
    s = await settings_store.load(db)
    if not settings_store.tautulli_ready(s):
        raise HTTPException(400, "Add the Tautulli URL and API key first.")
    try:
        info = await tautulli.server_info(s["tautulli_url"], s["tautulli_api_key"])
    except tautulli.TautulliError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "server": info.get("pms_name") or "Plex", "version": info.get("pms_version")}


@router.get("/tautulli/activity")
async def live(db: AsyncSession = Depends(get_db)):
    """What's playing now, with each member's plan and whether the stream breaks it."""
    s = await settings_store.load(db)
    if not settings_store.tautulli_ready(s):
        raise HTTPException(400, "Add the Tautulli URL and API key first.")
    try:
        sessions = await tautulli.activity(s["tautulli_url"], s["tautulli_api_key"])
    except tautulli.TautulliError as e:
        raise HTTPException(424, str(e)) from e
    breaches = {str(b["session"].get("session_id")): b for b in await enforcement.decide(db, s, sessions)}
    members = dict((await db.execute(select(PlexMember.plex_id, User).join(User))).all())
    plans = {p.id: p for p in (await db.execute(select(Plan))).scalars()}
    out = []
    for x in sessions:
        u = members.get(str(x.get("user_id")))
        plan = plans.get(u.plan_id or "") if u else None
        b = breaches.get(str(x.get("session_id")))
        out.append({"session_id": x.get("session_id"), "session_key": x.get("session_key"), "title": x.get("full_title") or x.get("title"),
                    "username": x.get("username") or x.get("user"), "user_id": u.id if u else None, "plan": plan.name if plan else None,
                    "max_streams": plan.max_streams if plan else None,
                    "max_resolution": RESOLUTIONS.get(plan.max_resolution or "") if plan else None,
                    "resolution": x.get("stream_video_resolution") or x.get("video_resolution"), "decision": x.get("transcode_decision"),
                    "player": x.get("player"), "platform": x.get("platform"), "state": x.get("state"), "progress": x.get("progress_percent"),
                    "media_type": x.get("media_type"), "owner": str(x.get("user_id")) == s["plex_owner_id"],
                    "breach": {"rule": b["rule"], "detail": b["detail"]} if b else None})
    return {"mode": s["enforcement_mode"], "sessions": out}


class StopIn(BaseModel):
    session_id: str
    message: str = "An administrator stopped this stream."


@router.post("/tautulli/stop")
async def stop(body: StopIn, request: Request, me: User = Depends(security.admin_user), db: AsyncSession = Depends(get_db)):
    s = await settings_store.load(db)
    try:
        await tautulli.terminate(s["tautulli_url"], s["tautulli_api_key"], body.session_id, body.message[:300])
    except tautulli.TautulliError as e:
        raise HTTPException(424, str(e)) from e
    audit.record(db, "admin.stream.stop", request=request, actor=me, target_type="session", target_id=body.session_id)
    await db.commit()
    return {"ok": True}


@router.get("/enforcement/events")
async def events(page: int = 1, db: AsyncSession = Depends(get_db)):
    total = (await db.execute(select(func.count(EnforcementEvent.id)))).scalar_one()
    rows = (await db.execute(select(EnforcementEvent).order_by(EnforcementEvent.created_at.desc())
                             .offset((max(page, 1) - 1) * 50).limit(50))).scalars().all()
    return {"total": total, "page": page, "events": [_event_view(e) for e in rows]}
