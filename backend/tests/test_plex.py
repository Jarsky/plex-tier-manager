"""Plex sign-in, connecting the server, and keeping server access in line with plans."""
import json
import time
from datetime import datetime, timedelta, timezone

import httpx
import respx
from sqlalchemy import select

from app import db as app_db
from app import membership, settings_store
from app.models import Plan, PlexMember, User
from app.services.stripe import sign_for_tests

from .conftest import OWNER_ID, connect_plex, plex_id_for, plex_sign_in, sign_up
from .test_billing import WEBHOOK_SECRET, configure_stripe


async def add_plan(**fields) -> str:
    async with app_db.sessionmaker()() as db:
        p = Plan(**{"name": "Standard", "price_cents": 900, "currency": "nzd", "stripe_price_id": "price_std",
                    "section_keys": ["1", "2"], "max_streams": 2, "max_resolution": "1080", **fields})
        db.add(p)
        await db.commit()
        return p.id


async def member(username: str) -> tuple[User, PlexMember]:
    async with app_db.sessionmaker()() as db:
        m = (await db.execute(select(PlexMember).where(PlexMember.username == username))).scalar_one()
        return await db.get(User, m.user_id), m


async def set_plan(user_id: str, plan_id: str | None, **fields) -> None:
    async with app_db.sessionmaker()() as db:
        u = await db.get(User, user_id)
        u.plan_id, u.plan_source = plan_id, fields.pop("plan_source", "admin" if plan_id else None)
        for k, v in fields.items():
            setattr(u, k, v)
        await db.commit()


async def check() -> dict:
    async with app_db.sessionmaker()() as db:
        return await membership.reconcile(db)


async def test_sign_in_creates_one_account_per_plex_account(client):
    r = await plex_sign_in(client, "alice")
    assert r.headers["location"] == "/"
    me = (await client.get("/api/me")).json()
    assert me["display_name"] == "Alice" and me["plex"]["username"] == "alice" and me["plex"]["server_access"] == "none"
    assert me["membership"]["plan"] is None and not me["is_admin"]
    await client.post("/api/auth/logout")
    await plex_sign_in(client, "alice", email="new@example.com")   # same Plex account again: same member, details refreshed
    again = (await client.get("/api/me")).json()
    assert again["id"] == me["id"] and again["email"] == "new@example.com"


async def test_bootstrap_admin_is_by_plex_username_not_email(client):
    await plex_sign_in(client, "admin")
    assert (await client.get("/api/me")).json()["is_admin"]
    await client.post("/api/auth/logout")
    await plex_sign_in(client, "someone", email="admin@example.com")
    assert not (await client.get("/api/me")).json()["is_admin"]


async def test_sign_ups_closed_and_cancelled(client):
    async with app_db.sessionmaker()() as db:
        await settings_store.save(db, {"signup_open": False})
    r = await plex_sign_in(client, "late")
    assert r.headers["location"] == "/signin?error=signups_closed"
    with respx.mock:
        respx.post("https://plex.tv/api/v2/pins").mock(return_value=httpx.Response(201, json={"id": 5, "code": "x"}))
        respx.get("https://plex.tv/api/v2/pins/5").mock(return_value=httpx.Response(200, json={"id": 5, "authToken": None}))
        await client.get("/api/auth/plex/start")
        import app.routers.auth as auth_router
        orig, auth_router.asyncio.sleep = auth_router.asyncio.sleep, (lambda s: orig(0))   # don't really wait
        try:
            r = await client.get("/api/auth/plex/callback")
        finally:
            auth_router.asyncio.sleep = orig
    assert r.headers["location"] == "/signin?error=cancelled"
    assert (await client.get("/api/auth/plex/callback")).headers["location"] == "/signin?error=expired"   # no state cookie


async def test_owner_connect_needs_admin_and_keeps_token_secret(client):
    await plex_sign_in(client, "someone")
    assert (await client.get("/api/auth/plex/start?mode=owner")).status_code == 403
    await client.post("/api/auth/logout")
    await plex_sign_in(client, "admin")
    r = await plex_sign_in(client, "owner", plex_id=OWNER_ID, mode="owner")
    assert r.headers["location"] == "/admin/plex"
    settings = (await client.get("/api/admin/settings")).json()
    assert settings["plex_owner_token"] is True and settings["plex_owner_id"] == OWNER_ID   # secret: only "is set"
    status = (await client.get("/api/admin/plex")).json()
    assert status["connected"] and status["owner_username"] == "owner" and status["servers"][0]["name"] == "Home Server"
    assert (await client.put("/api/admin/plex/server", json={"server_id": "machine-1"})).status_code == 200
    assert [x["title"] for x in (await client.get("/api/admin/plex")).json()["libraries"]] == ["Movies", "TV Shows", "4K Movies"]


async def test_existing_friend_keeps_access_until_given_a_plan(client, plex_server):
    await connect_plex()
    plex_server.add_friend(plex_id_for("bob"), "bob")
    await plex_sign_in(client, "bob")
    me = (await client.get("/api/me")).json()
    assert me["plex"]["existing_friend"] and me["plex"]["server_access"] == "shared" and not me["plex"]["managed"]
    assert await check() == {"unmanaged": 1}
    assert plex_server.calls == []                                   # no plan, but not ours to remove
    plan = await add_plan(name="Founding", price_cents=0, stripe_price_id=None, active=False)
    user, _ = await member("bob")
    await set_plan(user.id, plan)
    await check()
    assert plex_server.calls == []                                   # already has exactly the plan's libraries: taken over as-is
    _, m = await member("bob")
    assert m.managed and m.shared_section_keys == ["1", "2"]
    await set_plan(user.id, None)                                    # now managed: losing the plan removes access
    await check()
    assert plex_server.calls[-1] == ("unshare", "bob")
    _, m = await member("bob")
    assert m.share_status == "none" and not m.managed and not m.existing_friend


async def test_admin_plan_change_invites_updates_and_removes(client, plex_server):
    await connect_plex()
    await plex_sign_in(client, "admin")
    await plex_sign_in(client, "carol")   # cookie is now carol's
    await client.post("/api/auth/logout")
    await plex_sign_in(client, "admin")
    carol, _ = await member("carol")
    std = await add_plan()
    r = await client.patch(f"/api/admin/users/{carol.id}", json={"plan_id": std})
    assert r.json()["plex"] == "invited"
    assert plex_server.calls == [("share", "carol", ("1", "2"), False)]
    _, m = await member("carol")
    assert m.share_status == "invited" and m.managed and m.invited_at

    plex_server.people[m.plex_id].status = "shared"                 # carol accepts the invite
    premium = await add_plan(name="Premium", section_keys=None, max_resolution="4k", allow_downloads=True)
    r = await client.patch(f"/api/admin/users/{carol.id}", json={"plan_id": premium})
    assert r.json()["plex"] == "updated"
    assert plex_server.calls[-1] == ("share", "carol", ("1", "2", "3"), True)   # every library, downloads on

    r = await client.patch(f"/api/admin/users/{carol.id}", json={"plan_id": ""})
    assert r.json()["plex"] == "removed" and plex_server.calls[-1] == ("unshare", "carol")
    actions = [a["action"] for a in (await client.get("/api/admin/audit?category=plex")).json()["entries"]]
    assert actions == ["plex.removed", "plex.updated", "plex.invited"]


async def test_stripe_subscription_drives_access(client, plex_server):
    await connect_plex()
    await configure_stripe()
    plex_server.accept_invites = True
    await plex_sign_in(client, "dave")
    dave, _ = await member("dave")
    await add_plan()
    sub = {"id": "sub_9", "object": "subscription", "customer": "cus_9", "status": "active", "metadata": {"user_id": dave.id},
           "items": {"data": [{"price": {"id": "price_std"}, "current_period_end": int(time.time()) + 86400 * 30}]}}

    async def send(kind, obj, n):
        payload = json.dumps({"id": f"evt_{n}", "type": kind, "data": {"object": obj}}).encode()
        r = await client.post("/api/billing/webhook", content=payload, headers={"stripe-signature": sign_for_tests(payload, WEBHOOK_SECRET)})
        assert r.status_code == 200, r.text

    await send("customer.subscription.created", sub, 1)
    _, m = await member("dave")
    assert m.share_status == "shared" and m.managed
    me = (await client.get("/api/me")).json()["membership"]["plan"]
    assert (me["name"], me["max_streams"], me["max_resolution_label"]) == ("Standard", 2, "1080p")
    await send("customer.subscription.deleted", {**sub, "status": "canceled"}, 2)
    _, m = await member("dave")
    assert m.share_status == "none" and plex_server.calls[-1] == ("unshare", "dave")


async def test_lapsed_subscription_removed_by_the_periodic_check(client, plex_server):
    """Stripe's 'ended' webhook never arrived: access still goes a few days after the paid period."""
    await connect_plex()
    plex_server.accept_invites = True
    await plex_sign_in(client, "erin")
    erin, _ = await member("erin")
    std = await add_plan()
    await set_plan(erin.id, std, plan_source="stripe", subscription_status="active",
                   subscription_period_end=datetime.now(timezone.utc) + timedelta(days=5))
    await check()
    assert (await member("erin"))[1].share_status == "shared"
    await set_plan(erin.id, std, plan_source="stripe", subscription_status="active",
                   subscription_period_end=datetime.now(timezone.utc) - timedelta(days=4))
    assert (await check()) == {"removed": 1}


async def test_plan_library_change_is_applied_to_members(client, plex_server):
    await connect_plex()
    plex_server.accept_invites = True
    await plex_sign_in(client, "admin")
    std = await add_plan()
    await plex_sign_in(client, "fay")
    fay, _ = await member("fay")
    await set_plan(fay.id, std)
    await check()
    body = {"name": "Standard", "price_cents": 900, "currency": "nzd", "section_keys": ["1"], "max_streams": 2, "max_resolution": "1080"}
    await client.post("/api/auth/logout")
    await plex_sign_in(client, "admin")
    assert (await client.patch(f"/api/admin/plans/{std}", json=body)).status_code == 200
    await check()
    assert plex_server.calls[-1] == ("share", "fay", ("1",), False)
    assert await check() == {"ok": 2}                                  # fay and the admin: nothing left to change


async def test_import_existing_friends_with_a_founding_plan(client, plex_server):
    await connect_plex()
    await plex_sign_in(client, "admin")
    plex_server.add_friend("500", "gus")
    plex_server.add_friend("501", "hana", status="invited")
    plex_server.add_friend(OWNER_ID, "owner")
    founding = await add_plan(name="Founding", price_cents=0, stripe_price_id=None, active=False, section_keys=None)
    listed = (await client.get("/api/admin/plex/friends")).json()
    assert [(f["username"], f["status"], f["user_id"]) for f in listed] == [("gus", "shared", None), ("hana", "invited", None),
                                                                              ("owner", "shared", None)]
    r = await client.post("/api/admin/plex/import", json={"plan_id": founding})
    assert r.json() == {"created": 2, "assigned": 2}                 # never the owner
    await check()
    assert ("share", "gus", ("1", "2", "3"), False) in plex_server.calls
    # gus signs in later and lands on the imported account with his plan
    await client.post("/api/auth/logout")
    await plex_sign_in(client, "gus", plex_id="500")
    me = (await client.get("/api/me")).json()
    assert me["membership"]["plan"]["name"] == "Founding" and me["plex"]["managed"]


async def test_plan_with_members_cant_be_deleted(client):
    await plex_sign_in(client, "admin")
    std = await add_plan()
    admin, _ = await member("admin")
    await set_plan(admin.id, std)
    r = await client.delete(f"/api/admin/plans/{std}")
    assert r.status_code == 400 and "on this plan" in r.json()["detail"]


async def test_checkout_waits_for_the_server(client):
    await configure_stripe()
    await sign_up(client, None, "payer@example.com")
    std = await add_plan()
    r = await client.post("/api/billing/checkout", json={"plan_id": std})
    assert r.status_code == 503 and "isn't ready" in r.json()["detail"]


async def test_member_check_access_after_accepting(client, plex_server):
    await connect_plex()
    await plex_sign_in(client, "ivy")
    ivy, _ = await member("ivy")
    await set_plan(ivy.id, await add_plan())
    await check()
    assert (await member("ivy"))[1].share_status == "invited"
    plex_server.people[plex_id_for("ivy")].status = "shared"
    assert (await client.post("/api/me/check-access")).json() == {"server_access": "shared"}


async def test_deleting_account_removes_access(client, plex_server):
    await connect_plex()
    plex_server.accept_invites = True
    await plex_sign_in(client, "jo")
    jo, _ = await member("jo")
    await set_plan(jo.id, await add_plan())
    await check()
    assert (await client.delete("/api/me")).status_code == 200
    assert plex_server.calls[-1] == ("unshare", "jo")


async def test_download_setting_refused_is_a_warning_not_a_failure(client, plex_server):
    """plex.tv 404s on changing some existing friends' download setting: the libraries still count as shared."""
    await connect_plex()
    plex_server.downloads_fail = True
    plex_server.add_friend(plex_id_for("kai"), "kai", keys=("1",))
    await plex_sign_in(client, "kai")
    kai, _ = await member("kai")
    await set_plan(kai.id, await add_plan(allow_downloads=True))
    assert await check() == {"updated": 1}
    _, m = await member("kai")
    assert m.managed and m.share_status == "shared" and m.shared_section_keys == ["1", "2"]
    assert m.last_error.startswith("Warning:") and not m.allow_downloads
    plex_server.downloads_fail = False
    await check()                                   # tried again on the next check, and clears once it works
    _, m = await member("kai")
    assert m.last_error is None and m.allow_downloads


def test_short_error_drops_plex_html():
    from app.services.plex import short_error
    e = Exception('(404) not_found; https://plex.tv/api/v2/sharings/1?allowSync=0 <!DOCTYPE html> <html> <head><title>404</title>')
    assert short_error(e) == "(404) not_found; https://plex.tv/api/v2/sharings/1?allowSync=0"
