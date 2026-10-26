from sqlalchemy import func, select

from app import db as app_db
from app.models import PlexMember, Session, User

from .conftest import plex_sign_in, sign_up


async def test_config(client):
    body = (await client.get("/api/config")).json()
    assert body["site_name"] == "Plex Tier Manager" and body["plex_ready"] is False
    assert body["plex_callback_url"] == "http://testserver/api/auth/plex/callback" and body["signed_in"] is False


async def test_csrf_header_required(client):
    r = await client.post("/api/auth/logout", headers={"X-Requested-With": ""})
    assert r.status_code == 403


async def test_admin_requires_admin(client, outbox):
    await sign_up(client, outbox, "user@example.com")
    assert (await client.get("/api/admin/settings")).status_code == 403


async def test_bootstrap_admin_and_settings(client, outbox):
    await sign_up(client, outbox, "admin@example.com")
    r = await client.get("/api/admin/settings")
    assert r.status_code == 200
    assert r.json()["smtp_password"] is False and r.json()["tautulli_api_key"] is False
    r = await client.put("/api/admin/settings", json={"site_name": "Jarsky Plex", "smtp_password": "hunter2", "tautulli_api_key": "abc"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["site_name"] == "Jarsky Plex" and body["smtp_password"] is True and body["tautulli_api_key"] is True
    r = await client.put("/api/admin/settings", json={"smtp_password": True})   # "true" placeholder keeps the stored secret
    assert r.json()["smtp_password"] is True
    assert (await client.put("/api/admin/settings", json={"nope": 1})).status_code == 400


async def test_admin_user_management_and_cascade_delete(client, outbox):
    await sign_up(client, outbox, "victim@example.com")
    await client.post("/api/auth/logout")
    await sign_up(client, outbox, "admin@example.com")
    users = (await client.get("/api/admin/users", params={"q": "victim"})).json()
    assert users["total"] == 1
    victim = users["users"][0]
    assert victim["plex"]["username"] == "victim" and victim["plex"]["server_access"] == "none"
    assert (await client.patch(f"/api/admin/users/{victim['id']}", json={"is_disabled": True})).status_code == 200
    assert (await client.delete(f"/api/admin/users/{victim['id']}")).status_code == 200
    async with app_db.sessionmaker()() as db:
        assert await db.get(User, victim["id"]) is None
        assert (await db.execute(select(func.count()).select_from(PlexMember).where(PlexMember.user_id == victim["id"]))).scalar_one() == 0
        assert (await db.execute(select(func.count()).select_from(Session).where(Session.user_id == victim["id"]))).scalar_one() == 0
    me_id = (await client.get("/api/me")).json()["id"]
    assert (await client.patch(f"/api/admin/users/{me_id}", json={"is_admin": False})).status_code == 400
    stats = (await client.get("/api/admin/stats")).json()
    assert stats["users"] == 1 and stats["access"]["none"] == 1


async def test_disabled_member_cannot_sign_in(client, outbox):
    await sign_up(client, outbox, "bad@example.com")
    async with app_db.sessionmaker()() as db:
        u = (await db.execute(select(User).where(User.email == "bad@example.com"))).scalar_one()
        u.is_disabled = True
        await db.commit()
    assert (await client.get("/api/me")).status_code == 401
    r = await plex_sign_in(client, "bad")
    assert r.headers["location"] == "/signin?error=disabled"
