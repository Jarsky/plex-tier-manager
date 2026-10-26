import json

import httpx
import respx
from sqlalchemy import func, select

from app import db as app_db
from app.models import AuditLog, BillingEvent, Session, User
from app.services.stripe import sign_for_tests

from .conftest import plex_sign_in, sign_up
from .test_billing import WEBHOOK_SECRET, configure_stripe


async def actions(**where) -> list[str]:
    async with app_db.sessionmaker()() as db:
        stmt = select(AuditLog.action).order_by(AuditLog.id)
        for k, v in where.items():
            stmt = stmt.where(getattr(AuditLog, k) == v)
        return list((await db.execute(stmt)).scalars())


async def user_id(email: str) -> str:
    async with app_db.sessionmaker()() as db:
        return (await db.execute(select(User.id).where(User.email == email))).scalar_one()


async def send(client, event: dict):
    payload = json.dumps(event).encode()
    return await client.post("/api/billing/webhook", content=payload,
                             headers={"stripe-signature": sign_for_tests(payload, WEBHOOK_SECRET)})


async def test_sign_up_and_sign_in_are_recorded(client, outbox):
    await sign_up(client, outbox, "fan@example.com")
    uid = await user_id("fan@example.com")
    assert await actions(target_id=uid) == ["account.create", "auth.login"]
    await client.post("/api/auth/logout")
    await sign_up(client, outbox, "fan@example.com")
    assert await actions(target_id=uid) == ["account.create", "auth.login", "auth.login"]


async def test_admin_changes_are_audited_with_diffs(client, outbox):
    await sign_up(client, outbox, "victim@example.com")
    await client.post("/api/auth/logout")
    await sign_up(client, outbox, "admin@example.com")
    victim = await user_id("victim@example.com")
    r = await client.patch(f"/api/admin/users/{victim}", json={"is_disabled": True})
    assert r.status_code == 200
    async with app_db.sessionmaker()() as db:   # disabling ends their sessions immediately
        assert (await db.execute(select(func.count()).select_from(Session).where(Session.user_id == victim))).scalar_one() == 0
    await client.put("/api/admin/settings", json={"site_name": "Plexify", "stripe_secret_key": "sk_test_secret"})
    log = (await client.get("/api/admin/audit", params={"category": "admin"})).json()
    by_action = {e["action"]: e for e in log["entries"]}
    assert by_action["admin.user.update"]["details"]["changes"] == {"is_disabled": [False, True]}
    assert by_action["admin.user.update"]["actor_label"] == "admin@example.com"
    changes = by_action["admin.settings.update"]["details"]["changes"]
    assert changes["site_name"] == ["Plex Tier Manager", "Plexify"] and changes["stripe_secret_key"] == "(secret changed)"
    assert "sk_test_secret" not in json.dumps(log)
    found = (await client.get("/api/admin/audit", params={"q": "victim@"})).json()
    assert {e["action"] for e in found["entries"]} >= {"account.create", "admin.user.update"}

    detail = (await client.get(f"/api/admin/users/{victim}")).json()
    assert detail["email"] == "victim@example.com" and detail["is_disabled"] and detail["sessions"] == []
    assert [a["action"] for a in detail["activity"]][0] == "admin.user.update"
    assert (await client.post(f"/api/admin/users/{victim}/sign-out")).json()["ok"]


@respx.mock
async def test_webhook_events_logged_once(client, outbox):
    await sign_up(client, outbox, "payer@example.com")
    await configure_stripe()
    uid = await user_id("payer@example.com")
    async with app_db.sessionmaker()() as db:
        (await db.get(User, uid)).stripe_customer_id = "cus_9"
        await db.commit()
    event = {"id": "evt_1", "type": "invoice.payment_failed", "created": 1760000000,
             "data": {"object": {"customer": "cus_9", "amount_due": 500, "currency": "nzd", "attempt_count": 2}}}
    assert (await send(client, event)).json() == {"received": True}
    assert (await send(client, event)).json() == {"received": True, "duplicate": True}
    async with app_db.sessionmaker()() as db:
        rows = (await db.execute(select(BillingEvent))).scalars().all()
    assert len(rows) == 1 and rows[0].user_id == uid and rows[0].summary == "Payment failed: NZD 5.00 (attempt 2)"
    assert (await actions(target_id=uid))[-1] == "billing.payment_failed"


@respx.mock
async def test_deleting_account_cancels_subscription_first(client, outbox):
    await sign_up(client, outbox, "leaver@example.com")
    await configure_stripe()
    uid = await user_id("leaver@example.com")
    async with app_db.sessionmaker()() as db:
        u = await db.get(User, uid)
        u.stripe_customer_id, u.stripe_subscription_id, u.subscription_status = "cus_2", "sub_2", "active"
        await db.commit()
    cancel = respx.delete("https://api.stripe.com/v1/subscriptions/sub_2")
    cancel.mock(return_value=httpx.Response(500, json={"error": {"message": "Stripe is down"}}))
    r = await client.delete("/api/me")
    assert r.status_code == 424
    async with app_db.sessionmaker()() as db:
        assert await db.get(User, uid) is not None   # still there: nobody pays for a deleted account
    cancel.mock(return_value=httpx.Response(200, json={"id": "sub_2", "status": "canceled"}))
    assert (await client.delete("/api/me")).status_code == 200
    async with app_db.sessionmaker()() as db:
        assert await db.get(User, uid) is None
    entry = [a for a in await actions(target_id=uid)][-1]
    assert entry == "account.delete"   # the audit entry outlives the account


async def test_export_and_sessions(client, outbox):
    await sign_up(client, outbox, "me@example.com")
    r = await client.get("/api/me/export")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["account"]["email"] == "me@example.com" and data["plex"]["username"] == "me"
    assert "tok-" not in r.text   # the Plex token used to sign in is never stored
    assert [a["action"] for a in data["account_activity"]][:2] == ["account.create", "auth.login"]
    sessions = (await client.get("/api/me/sessions")).json()
    assert len(sessions) == 1 and sessions[0]["current"]
    assert (await client.post("/api/me/sessions/sign-out-others")).json()["sessions"] == 0
    assert (await client.get("/api/me")).status_code == 200


async def test_client_ip_prefers_cloudflare(client):
    client.headers.update({"cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6, 203.0.113.9"})
    await plex_sign_in(client, "ipcheck")
    async with app_db.sessionmaker()() as db:
        assert (await db.execute(select(AuditLog.ip).where(AuditLog.action == "auth.login"))).scalar_one() == "203.0.113.9"
