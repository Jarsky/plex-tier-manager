"""The member home page's rows from Seerr: new releases already on the server, and requested titles coming soon."""
import logging
import time
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .. import security, settings_store
from ..db import get_db
from ..models import User
from ..services import seerr

log = logging.getLogger("ptm.discover")
router = APIRouter(prefix="/api/discover", tags=["discover"])
CACHE_SECONDS = 30 * 60
ROW = 18
NEW_WITHIN = timedelta(days=365)
_cache: dict[str, tuple[float, dict]] = {}


async def new_on_server(client: seerr.Seerr, today: date) -> list[dict]:
    """Trending titles that are on Plex, newest releases first, then other trending titles that are on Plex."""
    trending = [i for r in await client.results("/discover/trending", pages=5) if (i := seerr.item(r))]
    on_plex = [i for i in trending if i["status"] in (seerr.AVAILABLE, seerr.PARTIALLY_AVAILABLE)]
    recent = [i for i in on_plex if i["release_date"] and date.fromisoformat(i["release_date"][:10]) >= today - NEW_WITHIN]
    older = [i for i in on_plex if i not in recent]
    return (recent + older)[:ROW]


def _upcoming_date(i: dict, today: date) -> str | None:
    """The date it arrives: a future release, or (for a show already out) its next episode."""
    for d in (i["release_date"], i["next_air_date"]):
        if d and date.fromisoformat(d[:10]) > today:
            return d[:10]
    return None


async def coming_soon(client: seerr.Seerr, today: date) -> list[dict]:
    """Requested titles that aren't out yet: Seerr's upcoming lists first, then anything else that was requested."""
    found: dict[tuple[str, int], dict] = {}
    for path, kind in (("/discover/movies/upcoming", "movie"), ("/discover/tv/upcoming", "tv")):
        for r in await client.results(path, pages=3):
            i = seerr.item(r, kind)
            if i and i["status"] in (seerr.PENDING, seerr.PROCESSING) and (when := _upcoming_date(i, today)):
                found[(kind, i["tmdb_id"])] = {**i, "date": when}
    looked_up = 0
    for req in await client.requests():
        media = req.get("media") or {}
        kind, tmdb_id = media.get("mediaType"), media.get("tmdbId")
        if (req.get("status") == seerr.DECLINED or media.get("status") == seerr.AVAILABLE or kind not in ("movie", "tv")
                or not tmdb_id or (kind, tmdb_id) in found or looked_up >= 30):
            continue
        looked_up += 1
        i = seerr.item(await client.details(kind, tmdb_id), kind)
        if i and (when := _upcoming_date(i, today)):
            found[(kind, tmdb_id)] = {**i, "date": when, "requested": True}
    return sorted(found.values(), key=lambda i: i["date"])[:ROW]


async def rows(settings: dict) -> dict:
    client = seerr.Seerr(settings["seerr_url"], settings["seerr_api_key"])
    today = date.today()
    out: dict = {"enabled": True, "new": [], "upcoming": [], "errors": {}}
    for name, fn in (("new", new_on_server), ("upcoming", coming_soon)):
        try:
            out[name] = await fn(client, today)
        except (seerr.SeerrError, ValueError, KeyError) as e:
            log.warning("Seerr %s row failed: %s", name, e)
            out["errors"][name] = str(e)
    return out


PLEX_WEB = "https://app.plex.tv/desktop"


async def cached_rows(settings: dict) -> dict:
    key = settings["seerr_url"]
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]
    data = await rows(settings)
    if not data["errors"]:   # don't keep a half-failed result for half an hour
        _cache[key] = (time.monotonic(), data)
    return data


def plex_web(external_url: str) -> str:
    """Plex's web app: on the server's own external address (e.g. https://plex.example.com → …/web/index.html), or app.plex.tv."""
    base = (external_url or "").rstrip("/")
    if not base:
        return PLEX_WEB
    return base if "/web" in base else f"{base}/web/index.html"


def linker(settings: dict):
    """How members' posters link: to Seerr, or to the title in Plex (titles not on the server yet fall back to Seerr)."""
    seerr_base = (settings["seerr_public_url"] or "").rstrip("/")
    plex_base = plex_web(settings["plex_web_url"])
    machine = settings["plex_server_id"]

    def link(i: dict) -> str | None:
        if settings["title_links"] == "plex" and machine and i.get("rating_key") and i["status"] in (seerr.AVAILABLE, seerr.PARTIALLY_AVAILABLE):
            return f"{plex_base}#!/server/{machine}/details?key=%2Flibrary%2Fmetadata%2F{i['rating_key']}"
        if settings["title_links"] in ("seerr", "plex") and seerr_base:
            return f"{seerr_base}/{i['type']}/{i['tmdb_id']}"
        return None
    return link


def _shape(data: dict, link) -> dict:
    strip = lambda i: {k: v for k, v in i.items() if k != "rating_key"}   # noqa: E731
    return {**data, "new": [{**strip(i), "url": link(i)} for i in data["new"]],
            "upcoming": [{**strip(i), "url": link(i)} for i in data["upcoming"]]}


OFF = {"enabled": False, "new": [], "upcoming": [], "errors": {}}


@router.get("/home")
async def home(user: User = Depends(security.current_user), db: AsyncSession = Depends(get_db)):
    settings = await settings_store.load(db)
    if not settings_store.seerr_ready(settings):
        return OFF
    return _shape(await cached_rows(settings), linker(settings))


@router.get("/public")
async def public(db: AsyncSession = Depends(get_db)):
    """The same rows for visitors, when the admin allows it: posters and titles only, no links or error details."""
    settings = await settings_store.load(db)
    if not (settings["home_rows_public"] and settings_store.seerr_ready(settings)):
        return OFF
    return {**_shape(await cached_rows(settings), lambda i: None), "errors": {}}


def clear_cache() -> None:
    _cache.clear()
