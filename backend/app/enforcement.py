"""Stream limits: compare what Tautulli says is playing with each member's plan, and stop what's over.

Runs when Tautulli's webhook reports a playback start, and every minute as a sweep. In "monitor" mode it only logs.
"""
import logging
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import entitlements, settings_store
from .entitlements import RESOLUTIONS
from .models import EnforcementEvent, Plan, PlexMember, User
from .services import tautulli

log = logging.getLogger("ptm.enforcement")
VIDEO = {"movie", "episode", "clip"}
_recent: dict[tuple[str, str], float] = {}   # (session, rule) -> when handled, so a stream isn't logged or stopped twice
REPEAT_AFTER = 120


async def _members(db: AsyncSession, plex_ids: set[str]) -> dict[str, tuple[User, Plan | None]]:
    rows = (await db.execute(select(PlexMember, User).join(User).where(PlexMember.plex_id.in_(plex_ids)))).all()
    return {m.plex_id: (u, await entitlements.user_plan(db, u)) for m, u in rows}


def _message(template: str, **values) -> str:
    try:
        return template.format(**values)
    except (KeyError, IndexError, ValueError):
        return template


async def decide(db: AsyncSession, settings: dict, sessions: list[dict]) -> list[dict]:
    """The streams that break a plan rule: [{session, user, plan, rule, detail, message}]."""
    by_user: dict[str, list[dict]] = {}
    for s in sessions:
        by_user.setdefault(str(s.get("user_id") or ""), []).append(s)
    members = await _members(db, set(by_user) - {""})
    out = []
    for plex_id, streams in by_user.items():
        user, plan = members.get(plex_id, (None, None))
        if user is None or plan is None or user.is_admin or plex_id == settings["plex_owner_id"]:
            continue   # not ours to police: the owner, admins, unknown or unmanaged people
        keep = []
        for s in streams:
            streamed = str(s.get("stream_video_resolution") or s.get("video_resolution") or "")
            if s.get("media_type") in VIDEO and entitlements.over_resolution(plan, streamed):
                quality = RESOLUTIONS.get(plan.max_resolution or "", plan.max_resolution)
                out.append({"session": s, "user": user, "plan": plan, "rule": "quality",
                            "detail": f"{streamed} stream, plan allows {quality}",
                            "message": _message(settings["quality_limit_message"], plan=plan.name, quality=quality)})
            else:
                keep.append(s)
        if plan.max_streams is not None and len(keep) > plan.max_streams:
            newest_first = sorted(keep, key=lambda s: int(s.get("session_key") or 0), reverse=True)
            for s in newest_first[:len(keep) - plan.max_streams]:
                out.append({"session": s, "user": user, "plan": plan, "rule": "streams",
                            "detail": f"{len(keep)} streams, plan allows {plan.max_streams}",
                            "message": _message(settings["stream_limit_message"], plan=plan.name, limit=plan.max_streams)})
    return out


async def run(db: AsyncSession) -> int:
    """Check what's playing now. Returns how many streams broke a rule."""
    settings = await settings_store.load(db)
    mode = settings["enforcement_mode"]
    if mode == "off" or not settings_store.tautulli_ready(settings):
        return 0
    sessions = await tautulli.activity(settings["tautulli_url"], settings["tautulli_api_key"])
    breaches = await decide(db, settings, sessions)
    now = time.monotonic()
    for k in [k for k, t in _recent.items() if now - t > REPEAT_AFTER]:
        del _recent[k]
    for b in breaches:
        s = b["session"]
        key = (str(s.get("session_id") or s.get("session_key")), b["rule"])
        if key in _recent:
            continue
        _recent[key] = now
        action = "logged"
        if mode == "enforce":
            try:
                await tautulli.terminate(settings["tautulli_url"], settings["tautulli_api_key"], str(s.get("session_id")), b["message"])
                action = "stopped"
            except tautulli.TautulliError as e:
                log.warning("Couldn't stop session %s: %s", key[0], e)
                action = "failed"
        db.add(EnforcementEvent(user_id=b["user"].id, plex_username=str(s.get("username") or s.get("user") or ""),
                                rule=b["rule"], session_key=str(s.get("session_key") or ""),
                                title=str(s.get("full_title") or s.get("title") or "")[:500], detail=b["detail"], action=action))
    await db.commit()
    return len(breaches)


def reset_for_tests() -> None:
    _recent.clear()
