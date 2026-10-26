"""Keeping Plex sharing in line with plans: invite or update members with a plan, remove members whose plan ended.

Only access this app manages is ever removed. People who were already on the server (existing_friend) keep their
access untouched until an admin gives them a plan; from then on it's managed like anyone else's.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit, entitlements, settings_store
from .db import utcnow
from .models import Plan, PlexMember, User
from .services import plex

log = logging.getLogger("ptm.membership")


def owner(settings: dict) -> plex.Owner:
    """Replaced in tests with a fake server."""
    return plex.Owner(settings["plex_owner_token"], settings["plex_server_id"])


async def _run(fn, *args):
    return await asyncio.to_thread(fn, *args)


async def section_keys(o: plex.Owner, plan: Plan) -> list[str]:
    if plan.section_keys is not None:
        return list(plan.section_keys)
    return [s["key"] for s in await _run(o.sections)]


async def sync_member(db: AsyncSession, settings: dict, user: User, o: plex.Owner | None = None,
                      friends: dict[str, plex.Friend] | None = None) -> str:
    """Bring one member's access in line with their plan. Returns what happened (for logs and the admin panel).
    Errors are stored on the member and re-raised as PlexError."""
    m = await db.get(PlexMember, user.id)
    if m is None or not settings_store.plex_ready(settings) or m.plex_id == settings["plex_owner_id"]:
        return "skipped"
    o = o or owner(settings)
    friends = friends if friends is not None else await _run(o.friends)
    friend = friends.get(m.plex_id)
    m.share_status = friend.status if friend else "none"
    m.checked_at = utcnow()
    plan = await entitlements.user_plan(db, user)
    warning = None
    try:
        if plan is not None:
            keys = await section_keys(o, plan)
            current = set(await _run(o.shared_section_keys, friend)) if friend and friend.status == "shared" else None
            if friend is None or (current is not None and (current != set(keys) or friend.allow_sync != plan.allow_downloads)):
                try:
                    status = await _run(o.share, m.username, friend, keys, plan.allow_downloads)
                except plex.DownloadsNotChanged as e:   # libraries done; keep going and show the warning
                    status, warning = e.status, str(e)
                result = "invited" if friend is None and status == "invited" else "updated"
                audit.record(db, f"plex.{result}", actor_label="system", target=user, plan=plan.name, libraries=len(keys))
                if friend is None:
                    m.invited_at = utcnow()
                m.share_status = status
            else:
                result = "ok"
            if m.share_status == "shared" and not m.shared_at:
                m.shared_at = utcnow()
            m.managed, m.shared_section_keys, m.removed_at = True, keys, None
            m.allow_downloads = plan.allow_downloads if warning is None else bool(friend and friend.allow_sync)
        elif m.managed and friend is not None:
            await _run(o.unshare, friend)
            audit.record(db, "plex.removed", actor_label="system", target=user, reason="no active plan")
            m.share_status, m.managed, m.existing_friend, m.removed_at = "none", False, False, utcnow()
            m.shared_section_keys = None
            result = "removed"
        else:
            result = "unmanaged" if friend is not None and not m.managed else "ok"
        m.last_error = warning
        return result
    except Exception as e:   # plexapi raises many kinds; keep the message for the admin panel
        m.last_error = plex.short_error(e)
        log.warning("Plex sync for %s failed: %s", m.username, e)
        raise plex.PlexError(str(e)) from e


async def sync_user_now(db: AsyncSession, user: User) -> str | None:
    """After a plan change (webhook or admin): try straight away; the periodic check retries if Plex is down."""
    settings = await settings_store.load(db)
    try:
        result = await sync_member(db, settings, user)
    except plex.PlexError:
        result = None
    await db.commit()
    return result


async def reconcile(db: AsyncSession) -> dict:
    """Check every member against Plex and fix differences. Returns counts by result."""
    settings = await settings_store.load(db)
    if not settings_store.plex_ready(settings):
        return {}
    o = owner(settings)
    friends = await _run(o.friends)
    counts: dict[str, int] = {}
    rows = (await db.execute(select(User).join(PlexMember))).scalars().all()
    for user in rows:
        try:
            result = await sync_member(db, settings, user, o, friends)
        except plex.PlexError:
            result = "failed"
        counts[result] = counts.get(result, 0) + 1
    await db.commit()
    log.info("Plex check at %s: %s", datetime.now(timezone.utc).isoformat(timespec="seconds"), counts)
    return counts
