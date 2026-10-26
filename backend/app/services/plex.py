"""Plex: signing people in through plex.tv (PIN flow), and managing who the server is shared with.

Sign-in calls are async (httpx). Sharing uses python-plexapi, which is blocking, so those functions are
synchronous and the callers run them in a worker thread (see membership.py).
"""
import uuid
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from plexapi.myplex import MyPlexAccount, MyPlexUser

PLEX_TV = "https://plex.tv"
AUTH_APP = "https://app.plex.tv/auth#?"


class PlexError(Exception):
    pass


class DownloadsNotChanged(PlexError):
    """The libraries were shared, but plex.tv wouldn't change the download setting. Carries the share status."""

    def __init__(self, message: str, status: str = "shared"):
        super().__init__(message)
        self.status = status


FRIENDS_V1 = "https://plex.tv/api/friends/{userId}"   # the older sharing-settings endpoint


def short_error(e: Exception) -> str:
    """plexapi errors end with plex.tv's whole HTML error page: keep the status and URL."""
    text = str(e)
    for marker in ("<!DOCTYPE", "<!doctype", "<html"):
        text = text.split(marker)[0]
    return text.strip()[:300]


def new_client_id() -> str:
    return uuid.uuid4().hex


def _headers(client_id: str, product: str, token: str | None = None) -> dict:
    h = {"Accept": "application/json", "X-Plex-Client-Identifier": client_id, "X-Plex-Product": product,
         "X-Plex-Version": "1.0", "X-Plex-Device": "Web", "X-Plex-Platform": "Web"}
    if token:
        h["X-Plex-Token"] = token
    return h


# ── sign-in (PIN flow) ───────────────────────────────────────────────────────
async def create_pin(client_id: str, product: str) -> dict:
    """A PIN the person approves on plex.tv. Returns {"id", "code"}."""
    async with httpx.AsyncClient(timeout=20) as http:
        r = await http.post(f"{PLEX_TV}/api/v2/pins", params={"strong": "true"}, headers=_headers(client_id, product))
    if r.status_code not in (200, 201):
        raise PlexError(f"plex.tv returned HTTP {r.status_code} creating a sign-in PIN")
    return r.json()


def auth_url(client_id: str, product: str, code: str, forward_url: str) -> str:
    """plex.tv's sign-in page; it sends the browser to forward_url once the person approves."""
    return AUTH_APP + urlencode({"clientID": client_id, "code": code, "forwardUrl": forward_url,
                                 "context[device][product]": product})


async def pin_token(client_id: str, product: str, pin_id: int | str) -> str | None:
    """The account token once the PIN was approved, else None."""
    async with httpx.AsyncClient(timeout=20) as http:
        r = await http.get(f"{PLEX_TV}/api/v2/pins/{pin_id}", headers=_headers(client_id, product))
    if r.status_code != 200:
        raise PlexError(f"plex.tv returned HTTP {r.status_code} checking the sign-in PIN")
    return r.json().get("authToken") or None


async def account(client_id: str, product: str, token: str) -> dict:
    """The signed-in Plex account: id, uuid, username, title, email, thumb."""
    async with httpx.AsyncClient(timeout=20) as http:
        r = await http.get(f"{PLEX_TV}/api/v2/user", headers=_headers(client_id, product, token))
    if r.status_code != 200:
        raise PlexError(f"plex.tv returned HTTP {r.status_code} reading the account")
    return r.json()


# ── the owner's server (blocking; call from a thread) ────────────────────────
@dataclass
class Friend:
    plex_id: str
    username: str
    email: str | None
    title: str
    thumb: str | None
    status: str                 # shared | invited
    share_id: int | None = None
    allow_sync: bool = False


class Owner:
    """The server owner's Plex account, for sharing the server. Every method makes plex.tv requests."""

    def __init__(self, token: str, machine_id: str = ""):
        self.account = MyPlexAccount(token=token)
        self.machine_id = machine_id

    def servers(self) -> list[dict]:
        return [{"id": r.clientIdentifier, "name": r.name} for r in self.account.resources()
                if "server" in (r.provides or "") and r.owned]

    def sections(self) -> list[dict]:
        """The server's libraries as plex.tv lists them: key (the server's), id (plex.tv's), title, type."""
        data = self.account.query(self.account.PLEXSERVERS.format(machineId=self.machine_id))
        return [{"key": e.attrib.get("key", ""), "id": e.attrib.get("id", ""), "title": e.attrib.get("title", ""),
                 "type": e.attrib.get("type", "")} for e in data[0]]

    def friends(self) -> dict[str, Friend]:
        """Everyone with access to this server (shared) or invited to it, by Plex account id."""
        out: dict[str, Friend] = {}
        for u in self.account.users():
            share = next((s for s in u.servers if s.machineIdentifier == self.machine_id), None)
            if share is not None:
                out[str(u.id)] = Friend(str(u.id), u.username, u.email, u.title, u.thumb,
                                        "invited" if share.pending else "shared", share.id, bool(u.allowSync))
        for inv in self.account.pendingInvites(includeSent=True, includeReceived=False):
            if any(s.machineIdentifier == self.machine_id for s in inv.servers) and str(inv.id) not in out:
                out[str(inv.id)] = Friend(str(inv.id), inv.username, inv.email, inv.friendlyName or inv.username,
                                          inv.thumb, "invited")
        return out

    def shared_section_keys(self, friend: Friend) -> set[str]:
        user = self._user(friend)
        share = next((s for s in user.servers if s.machineIdentifier == self.machine_id), None) if user else None
        if share is None:
            return set()
        return {str(s.key) for s in share.sections() if s.shared}

    def share(self, username: str, friend: Friend | None, section_keys: list[str], allow_sync: bool) -> str:
        """Give access to these libraries: update an existing friend, or invite. Returns the new status."""
        titles = self._titles(section_keys)
        if not titles:
            raise PlexError("The plan doesn't include any of the server's libraries.")
        user = self._user(friend) if friend else None
        if user is None and friend is None:
            user = next((u for u in self.account.users() if u.username.lower() == username.lower()), None)
        if user is not None:   # already a Plex friend (of this or another server): share without a new invite
            self.account.updateFriend(user, self.machine_id, sections=titles)   # libraries only; downloads below
            pending = next((s.pending for s in self.account.user(user.username).servers
                            if s.machineIdentifier == self.machine_id), False)
            status = "invited" if pending else "shared"
            if bool(user.allowSync) != allow_sync:
                self.set_downloads(user, allow_sync, status)
            return status
        self.account.inviteFriend(username, self.machine_id, sections=titles, allowSync=allow_sync)
        return "invited"

    def set_downloads(self, user: MyPlexUser, allow: bool, status: str) -> None:
        """plex.tv answers 404 on the v2 sharing-settings endpoint for some friends; the older one usually works."""
        errors = []
        for url in (self.account.FRIENDUPDATE.format(userId=user.id), FRIENDS_V1.format(userId=user.id)):
            try:
                self.account.query(f"{url}?allowSync={'1' if allow else '0'}", self.account._session.put)
                return
            except Exception as e:
                errors.append(short_error(e))
        raise DownloadsNotChanged(f"Warning: libraries shared, but Plex wouldn't change downloads to {'on' if allow else 'off'} "
                                  f"({' / '.join(errors)})", status)

    def unshare(self, friend: Friend) -> None:
        """Remove access to this server only (a Plex friendship, and other servers, are left alone)."""
        if friend.status == "invited" and friend.share_id is None:
            invite = next((i for i in self.account.pendingInvites(includeSent=True, includeReceived=False)
                           if str(i.id) == friend.plex_id), None)
            if invite is not None:
                self.account.cancelInvite(invite)
            return
        if friend.share_id is not None:
            url = self.account.FRIENDSERVERS.format(machineId=self.machine_id, serverId=friend.share_id)
            self.account.query(url, self.account._session.delete)

    # helpers
    def _user(self, friend: Friend) -> MyPlexUser | None:
        return next((u for u in self.account.users() if str(u.id) == friend.plex_id), None)

    def _titles(self, section_keys: list[str]) -> list[str]:
        by_key = {s["key"]: s["title"] for s in self.sections()}
        return [by_key[k] for k in section_keys if k in by_key]



