"""Tautulli stream limits: streams per plan, quality per plan, monitor vs enforce, and the webhook."""
from urllib.parse import parse_qs, urlparse

import httpx
import respx

from app import db as app_db
from app import settings_store
from app.models import EnforcementEvent, Plan, PlexMember, User
from sqlalchemy import select

from .conftest import OWNER_ID, plex_id_for, plex_sign_in

TAUTULLI = "http://tautulli.local:8181"


async def setup(mode="enforce") -> dict:
    async with app_db.sessionmaker()() as db:
        await settings_store.save(db, {"tautulli_url": TAUTULLI, "tautulli_api_key": "tk", "enforcement_mode": mode,
                                       "tautulli_webhook_secret": "hook-secret", "plex_owner_id": OWNER_ID})
        std = Plan(name="Standard", price_cents=900, max_streams=2, max_resolution="1080")
        db.add(std)
        await db.commit()
        return {"std": std.id}


async def give_plan(username: str, plan_id: str) -> None:
    async with app_db.sessionmaker()() as db:
        m = (await db.execute(select(PlexMember).where(PlexMember.username == username))).scalar_one()
        u = await db.get(User, m.user_id)
        u.plan_id, u.plan_source = plan_id, "admin"
        await db.commit()


def session(n: int, username: str, resolution="1080", media="episode", plex_id=None) -> dict:
    return {"session_key": str(n), "session_id": f"s{n}", "user_id": int(plex_id or plex_id_for(username)), "username": username,
            "full_title": f"Show - Episode {n}", "media_type": media, "stream_video_resolution": resolution, "state": "playing"}


def mock_tautulli(sessions: list[dict]):
    stopped = []

    def handler(request):
        q = {k: v[0] for k, v in parse_qs(urlparse(str(request.url)).query).items()}
        if q["cmd"] == "get_activity":
            return httpx.Response(200, json={"response": {"result": "success", "data": {"sessions": sessions}}})
        if q["cmd"] == "terminate_session":
            stopped.append((q["session_id"], q["message"]))
            return httpx.Response(200, json={"response": {"result": "success", "data": {}}})
        return httpx.Response(200, json={"response": {"result": "error", "message": "unknown"}})

    respx.get(f"{TAUTULLI}/api/v2").mock(side_effect=handler)
    return stopped


async def events() -> list[tuple]:
    async with app_db.sessionmaker()() as db:
        return [(e.plex_username, e.rule, e.session_key, e.action) for e in
                (await db.execute(select(EnforcementEvent).order_by(EnforcementEvent.id))).scalars()]


async def hook(client):
    return await client.post("/api/tautulli/webhook/hook-secret", json={"event": "play"})


@respx.mock
async def test_extra_streams_stop_newest_first(client):
    ids = await setup()
    await plex_sign_in(client, "kim")
    await give_plan("kim", ids["std"])
    stopped = mock_tautulli([session(10, "kim"), session(12, "kim"), session(11, "kim")])
    r = await hook(client)
    assert r.json() == {"ok": True, "over_limit": 1}
    assert stopped == [("s12", "Your Standard plan allows 2 stream(s) at a time. Stop another stream to watch this one.")]
    assert await events() == [("kim", "streams", "12", "stopped")]
    await hook(client)                                   # Tautulli fires again before the stream is gone: not stopped twice
    assert len(stopped) == 1


@respx.mock
async def test_quality_over_plan_is_stopped_and_music_ignored(client):
    ids = await setup()
    await plex_sign_in(client, "lee")
    await give_plan("lee", ids["std"])
    stopped = mock_tautulli([session(20, "lee", "4k", "movie"), session(21, "lee", "4k", "track"), session(22, "lee", "720")])
    await hook(client)
    assert [s[0] for s in stopped] == ["s20"] and "streams up to 1080p" in stopped[0][1]
    assert await events() == [("lee", "quality", "20", "stopped")]


@respx.mock
async def test_monitor_mode_only_logs(client):
    ids = await setup(mode="monitor")
    await plex_sign_in(client, "max")
    await give_plan("max", ids["std"])
    stopped = mock_tautulli([session(n, "max") for n in (1, 2, 3, 4)])
    await hook(client)
    assert stopped == [] and [e[3] for e in await events()] == ["logged", "logged"]


@respx.mock
async def test_owner_admins_unknown_and_unplanned_are_left_alone(client):
    ids = await setup()
    await plex_sign_in(client, "admin")
    await give_plan("admin", ids["std"])
    await plex_sign_in(client, "noplan")
    stopped = mock_tautulli([*(session(n, "owner", "4k", plex_id=OWNER_ID) for n in (1, 2, 3)),
                             *(session(n, "admin", "4k") for n in (4, 5, 6)),
                             *(session(n, "stranger", "4k") for n in (7, 8, 9)),
                             *(session(n, "noplan", "4k") for n in (10, 11, 12))])
    assert (await hook(client)).json()["over_limit"] == 0 and stopped == []


@respx.mock
async def test_webhook_needs_the_secret_and_off_mode_does_nothing(client):
    await setup(mode="off")
    assert (await client.post("/api/tautulli/webhook/wrong")).status_code == 404
    assert (await hook(client)).json() == {"ok": True, "over_limit": 0}


@respx.mock
async def test_admin_live_view_and_stop(client):
    ids = await setup(mode="monitor")
    await plex_sign_in(client, "nia")
    await give_plan("nia", ids["std"])
    await client.post("/api/auth/logout")
    await plex_sign_in(client, "admin")
    stopped = mock_tautulli([session(1, "nia", "4k", "movie"), session(2, "nia")])
    live = (await client.get("/api/admin/tautulli/activity")).json()
    assert live["mode"] == "monitor"
    assert [(s["username"], s["plan"], (s["breach"] or {}).get("rule")) for s in live["sessions"]] == [("nia", "Standard", "quality"),
                                                                                                    ("nia", "Standard", None)]
    assert (await client.post("/api/admin/tautulli/stop", json={"session_id": "s2"})).status_code == 200
    assert stopped == [("s2", "An administrator stopped this stream.")]
    status = (await client.get("/api/admin/tautulli")).json()
    assert status["webhook_url"] == "http://testserver/api/tautulli/webhook/hook-secret" and status["api_key_set"]


async def test_settings_validation(client):
    await plex_sign_in(client, "admin")
    assert (await client.put("/api/admin/settings", json={"enforcement_mode": "nuke"})).status_code == 400
    assert (await client.put("/api/admin/settings", json={"tautulli_url": "tautulli:8181"})).status_code == 400
    assert (await client.put("/api/admin/settings", json={"enforcement_mode": "enforce", "tautulli_url": TAUTULLI})).status_code == 200
