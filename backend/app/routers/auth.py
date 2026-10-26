"""Sign-in with Plex (plex.tv PIN flow). Signing in creates an account; server access comes with a plan.

The same flow, started by an admin in "owner" mode, connects the server owner's Plex account so the site can share
the server. Only the owner token is kept (encrypted); members' Plex tokens are used once to read their account.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, membership, security, settings_store
from ..config import get_config
from ..db import get_db
from ..models import PlexMember, User
from ..services import plex

router = APIRouter(prefix="/api/auth", tags=["auth"])


def plex_callback_url() -> str:
    return f"{get_config().public_url}/api/auth/plex/callback"


def _safe_return(path: str | None, default: str = "/") -> str:
    return path if path and path.startswith("/") and not path.startswith("//") else default


def _redirect(path: str) -> RedirectResponse:
    return RedirectResponse(path, status_code=303)


async def client_id(db: AsyncSession, settings: dict) -> str:
    """This site's identifier on plex.tv, made once (plex.tv lists it under the person's authorised devices)."""
    if not settings["plex_client_id"]:
        settings["plex_client_id"] = plex.new_client_id()
        await settings_store.save(db, {"plex_client_id": settings["plex_client_id"]})
    return settings["plex_client_id"]


@router.get("/plex/start")
async def plex_start(mode: str = Query("login", pattern="^(login|owner)$"), return_to: str | None = None,
                     db: AsyncSession = Depends(get_db), user: User | None = Depends(security.optional_user)):
    settings = await settings_store.load(db)
    if mode == "owner" and not (user and user.is_admin):
        raise HTTPException(403, "Only an admin can connect the Plex server.")
    cid = await client_id(db, settings)
    try:
        pin = await plex.create_pin(cid, settings["site_name"])
    except plex.PlexError as e:
        raise HTTPException(424, str(e)) from e
    resp = _redirect(plex.auth_url(cid, settings["site_name"], pin["code"], plex_callback_url()))
    security.set_oauth_state(resp, {"p": "plex", "pin": pin["id"], "mode": mode,
                                    "return_to": _safe_return(return_to, "/admin/plex" if mode == "owner" else "/")})
    return resp


async def _approved_token(cid: str, product: str, pin_id) -> str | None:
    """plex.tv forwards the browser a moment after approval; allow a few seconds for the PIN to show it."""
    for wait in (0, 1, 1, 2):
        await asyncio.sleep(wait)
        if token := await plex.pin_token(cid, product, pin_id):
            return token
    return None


@router.get("/plex/callback")
async def plex_callback(request: Request, db: AsyncSession = Depends(get_db), current: User | None = Depends(security.optional_user)):
    resp = _redirect("/")
    st = security.pop_oauth_state(request, resp)
    if not st or st.get("p") != "plex":
        resp.headers["location"] = "/signin?error=expired"
        return resp
    settings = await settings_store.load(db)
    cid = await client_id(db, settings)
    try:
        token = await _approved_token(cid, settings["site_name"], st["pin"])
        if not token:
            resp.headers["location"] = "/signin?error=cancelled"
            return resp
        acct = await plex.account(cid, settings["site_name"], token)
    except plex.PlexError:
        resp.headers["location"] = "/signin?error=plex"
        return resp

    if st["mode"] == "owner":
        if not (current and current.is_admin):
            resp.headers["location"] = "/signin?error=expired"
            return resp
        await settings_store.save(db, {"plex_owner_token": token, "plex_owner_id": str(acct["id"]),
                                       "plex_owner_username": acct.get("username") or acct.get("title") or ""})
        audit.record(db, "admin.plex.connect", request=request, actor=current, target_type="settings",
                     owner=acct.get("username"))
        await db.commit()
        resp.headers["location"] = st["return_to"]
        return resp

    user = await sign_in_member(db, settings, request, acct)
    if user is None:
        resp.headers["location"] = "/signin?error=signups_closed"
        return resp
    if user.is_disabled:
        resp.headers["location"] = "/signin?error=disabled"
        return resp
    await security.start_session(db, resp, request, user, "plex")
    resp.headers["location"] = st["return_to"]
    return resp


async def sign_in_member(db: AsyncSession, settings: dict, request: Request, acct: dict) -> User | None:
    """Find or create the account for this Plex account (None if sign-ups are closed). Refreshes the Plex details."""
    plex_id = str(acct["id"])
    m = (await db.execute(select(PlexMember).where(PlexMember.plex_id == plex_id))).scalar_one_or_none()
    name = acct.get("title") or acct.get("username") or "Plex user"
    if m is None:
        if not settings["signup_open"]:
            return None
        user = User(display_name=name, email=acct.get("email"), avatar_url=acct.get("thumb"))
        db.add(user)
        await db.flush()
        m = PlexMember(user_id=user.id, plex_id=plex_id)
        db.add(m)
        audit.record(db, "account.create", request=request, actor=user, target=user, method="plex", plex_username=acct.get("username"))
        await _note_existing_access(settings, m)
    else:
        user = await db.get(User, m.user_id)
        user.email = acct.get("email") or user.email
        user.avatar_url = acct.get("thumb") or user.avatar_url
    m.uuid, m.username, m.email, m.thumb = acct.get("uuid") or "", acct.get("username") or "", acct.get("email"), acct.get("thumb")
    if security.user_is_bootstrap_admin(acct.get("username"), plex_id) or (plex_id and plex_id == settings["plex_owner_id"]):
        user.is_admin = True
    await db.commit()
    return user


async def _note_existing_access(settings: dict, m: PlexMember) -> None:
    """A new member who already has access to the server keeps it, unmanaged, until an admin gives them a plan."""
    if not settings_store.plex_ready(settings):
        return
    try:
        friends = await asyncio.to_thread(membership.owner(settings).friends)
    except Exception:   # Plex being slow mustn't block sign-up; the periodic check fills this in
        return
    if f := friends.get(m.plex_id):
        m.share_status, m.existing_friend = f.status, True


@router.post("/logout", dependencies=[Depends(security.csrf_guard)])
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await security.end_session(db, response, request)
    return {"ok": True}

