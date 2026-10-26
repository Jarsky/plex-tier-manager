import os
import zlib

import pytest

os.environ.update(SECRET_KEY="test-secret-key-" + "x" * 32, PUBLIC_URL="http://testserver",
                  BOOTSTRAP_ADMINS="admin", STATIC_DIR="/nonexistent", BACKGROUND_JOBS="false")

import httpx  # noqa: E402
import respx  # noqa: E402

from app import db as app_db  # noqa: E402
from app import enforcement, mailer, membership, ratelimit  # noqa: E402
from app.config import get_config  # noqa: E402
from app.db import Base  # noqa: E402
from app.services import plex  # noqa: E402

OWNER_ID = "1"


@pytest.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path}/test.db")
    get_config.cache_clear()
    app_db.reset_engine_for_tests()
    ratelimit.reset_for_tests()
    enforcement.reset_for_tests()
    async with app_db.engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    from app.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver",
                                 headers={"X-Requested-With": "ptm"}) as c:
        yield c
    await app_db.engine().dispose()


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def fake_send(settings, to, subject, text, html):
        sent.append({"to": to, "subject": subject, "text": text})

    monkeypatch.setattr(mailer, "send", fake_send)
    return sent


# ── a fake Plex server ───────────────────────────────────────────────────────
class FakeOwner:
    """Stands in for plex.Owner: an in-memory server with libraries and friends, recording every change."""

    def __init__(self):
        self.libraries = [{"key": "1", "id": "101", "title": "Movies", "type": "movie"},
                          {"key": "2", "id": "102", "title": "TV Shows", "type": "show"},
                          {"key": "3", "id": "103", "title": "4K Movies", "type": "movie"}]
        self.people: dict[str, plex.Friend] = {}
        self.shared: dict[str, set[str]] = {}       # plex id -> section keys
        self.calls: list[tuple] = []
        self.accept_invites = False                 # True: invites show as shared straight away
        self.downloads_fail = False                 # True: like plex.tv's 404 on changing an existing friend's downloads

    def servers(self):
        return [{"id": "machine-1", "name": "Home Server"}]

    def sections(self):
        return self.libraries

    def friends(self):
        return dict(self.people)

    def shared_section_keys(self, friend):
        return set(self.shared.get(friend.plex_id, set()))

    def share(self, username, friend, section_keys, allow_sync):
        self.calls.append(("share", username, tuple(section_keys), allow_sync))
        plex_id = friend.plex_id if friend else next((p for p, f in self.people.items() if f.username == username), None)
        plex_id = plex_id or str(zlib.crc32(username.encode()))
        status = "shared" if (friend and friend.status == "shared") or self.accept_invites else "invited"
        keep_sync = self.downloads_fail and friend is not None and friend.allow_sync != allow_sync
        self.people[plex_id] = plex.Friend(plex_id, username, None, username, None, status, share_id=int(plex_id) % 10_000,
                                           allow_sync=friend.allow_sync if keep_sync else allow_sync)
        self.shared[plex_id] = set(section_keys)
        if keep_sync:
            raise plex.DownloadsNotChanged("Warning: libraries shared, but Plex wouldn't change downloads (404)", status)
        return status

    def unshare(self, friend):
        self.calls.append(("unshare", friend.username))
        self.people.pop(friend.plex_id, None)
        self.shared.pop(friend.plex_id, None)

    def add_friend(self, plex_id, username, status="shared", keys=("1", "2")):
        self.people[plex_id] = plex.Friend(plex_id, username, f"{username}@example.com", username, None, status, share_id=1)
        self.shared[plex_id] = set(keys)


@pytest.fixture(autouse=True)
def plex_server(monkeypatch):
    """Every test talks to this fake instead of plex.tv. Use connect_plex() to make the site 'connected'."""
    fake = FakeOwner()
    monkeypatch.setattr(membership, "owner", lambda settings: fake)
    from app.routers import billing, discover
    billing._library_cache.clear()
    discover.clear_cache()
    return fake


async def connect_plex() -> None:
    from app import settings_store
    async with app_db.sessionmaker()() as db:
        await settings_store.save(db, {"plex_owner_token": "owner-token", "plex_owner_id": OWNER_ID, "plex_owner_username": "owner",
                                       "plex_server_id": "machine-1", "plex_server_name": "Home Server"})


# ── signing in ───────────────────────────────────────────────────────────────
def plex_id_for(username: str) -> str:
    return str(zlib.crc32(username.encode()))


async def plex_sign_in(client, username: str, plex_id: str | None = None, email: str | None = None, mode: str = "login"):
    """The whole Plex PIN flow against a mocked plex.tv. Returns the callback response."""
    plex_id = plex_id or plex_id_for(username)
    with respx.mock(assert_all_called=False) as mock:
        mock.post("https://plex.tv/api/v2/pins").mock(return_value=httpx.Response(201, json={"id": 77, "code": "abcd"}))
        mock.get("https://plex.tv/api/v2/pins/77").mock(return_value=httpx.Response(200, json={"id": 77, "authToken": f"tok-{plex_id}"}))
        mock.get("https://plex.tv/api/v2/user").mock(return_value=httpx.Response(200, json={
            "id": int(plex_id), "uuid": f"uuid-{plex_id}", "username": username, "title": username.title(),
            "email": email or f"{username}@example.com", "thumb": f"https://plex.tv/users/{plex_id}/avatar"}))
        r = await client.get(f"/api/auth/plex/start?mode={mode}")
        assert r.status_code == 303, r.text
        assert r.headers["location"].startswith("https://app.plex.tv/auth#?")
        return await client.get("/api/auth/plex/callback")


async def sign_up(client, outbox=None, email: str = "member@example.com"):
    """Sign in with Plex as the username before the @ (so admin@example.com is the bootstrap admin "admin")."""
    username = email.split("@")[0]
    r = await plex_sign_in(client, username, email=email)
    assert r.status_code == 303 and "error" not in r.headers["location"], r.headers.get("location")
    return r
