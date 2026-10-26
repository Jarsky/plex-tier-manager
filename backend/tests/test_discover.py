"""Home page rows from Seerr: new releases on the server, and requested titles coming soon."""
from datetime import date, timedelta

import httpx
import respx

from app import db as app_db
from app import settings_store

from .conftest import plex_sign_in

SEERR = "http://seerr.local:5055"
TODAY = date.today()


def d(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def movie(i, released, status=None, title=None, requests=()):
    info = {"status": status, "requests": list(requests), "ratingKey": str(1000 + i) if status in (4, 5) else None} if status else None
    return {"id": i, "mediaType": "movie", "title": title or f"Movie {i}", "posterPath": f"/p{i}.jpg", "releaseDate": released, "mediaInfo": info}


def show(i, first_aired, status=None, next_ep=None):
    return {"id": i, "mediaType": "tv", "name": f"Show {i}", "posterPath": None, "firstAirDate": first_aired,
            "nextEpisodeToAir": {"airDate": next_ep} if next_ep else None, "mediaInfo": {"status": status} if status else None}


async def configure(public=""):
    async with app_db.sessionmaker()() as db:
        await settings_store.save(db, {"seerr_url": SEERR, "seerr_api_key": "sk", "seerr_public_url": public})


def mock_seerr(trending, upcoming_movies, upcoming_tv, requests, details):
    def page(results):
        return httpx.Response(200, json={"page": 1, "totalPages": 1, "results": results})
    calls = respx.get(f"{SEERR}/api/v1/discover/trending").mock(return_value=page(trending))
    respx.get(f"{SEERR}/api/v1/discover/movies/upcoming").mock(return_value=page(upcoming_movies))
    respx.get(f"{SEERR}/api/v1/discover/tv/upcoming").mock(return_value=page(upcoming_tv))
    respx.get(f"{SEERR}/api/v1/request").mock(return_value=httpx.Response(200, json={"results": requests}))
    for (kind, tmdb), body in details.items():
        respx.get(f"{SEERR}/api/v1/{kind}/{tmdb}").mock(return_value=httpx.Response(200, json=body))
    return calls


@respx.mock
async def test_new_on_server_and_coming_soon(client):
    await configure(public="https://seerr.example.com/")
    await plex_sign_in(client, "viewer")
    calls = mock_seerr(
        trending=[movie(1, d(-20), status=5), movie(2, d(-10), status=1), show(3, d(-700), status=5), movie(4, d(-3), status=4),
                  {"id": 9, "mediaType": "person", "name": "An Actor"}],
        upcoming_movies=[movie(10, d(30), status=3), movie(11, d(5), status=1), movie(12, d(60), status=2)],
        upcoming_tv=[show(20, d(14), status=2)],
        requests=[{"status": 2, "media": {"mediaType": "movie", "tmdbId": 30, "status": 3}},      # requested, out later: looked up
                  {"status": 2, "media": {"mediaType": "movie", "tmdbId": 10, "status": 3}},      # already in the upcoming list
                  {"status": 3, "media": {"mediaType": "movie", "tmdbId": 31, "status": 1}},      # declined
                  {"status": 2, "media": {"mediaType": "movie", "tmdbId": 32, "status": 5}},      # already on the server
                  {"status": 2, "media": {"mediaType": "tv", "tmdbId": 33, "status": 4}}],        # show with a new episode coming
        details={("movie", 30): movie(30, d(3)), ("tv", 33): show(33, d(-400), next_ep=d(7))},
    )
    r = (await client.get("/api/discover/home")).json()
    assert r["enabled"] and r["errors"] == {}
    # on Plex only; this year's releases first (1, 4 in trending order), then older ones (3)
    assert [(i["title"], i["status"]) for i in r["new"]] == [("Movie 1", 5), ("Movie 4", 4), ("Show 3", 5)]
    assert r["new"][0]["poster"] == "https://image.tmdb.org/t/p/w342/p1.jpg"
    assert r["new"][0]["url"] == "https://seerr.example.com/movie/1"
    # requested and not out yet, soonest first; unrequested upcoming (11) left out
    assert [(i["title"], i["date"]) for i in r["upcoming"]] == [("Movie 30", d(3)), ("Show 33", d(7)), ("Show 20", d(14)),
                                                                ("Movie 10", d(30)), ("Movie 12", d(60))]
    await client.get("/api/discover/home")
    assert calls.call_count == 1                       # cached


@respx.mock
async def test_seerr_down_or_not_set_up(client):
    await plex_sign_in(client, "viewer")
    assert (await client.get("/api/discover/home")).json() == {"enabled": False, "new": [], "upcoming": [], "errors": {}}
    await configure()
    respx.get(url__startswith=SEERR).mock(return_value=httpx.Response(401))
    r = (await client.get("/api/discover/home")).json()
    assert r["new"] == [] and "API key" in r["errors"]["new"] and r["new"] == []
    await client.post("/api/auth/logout")
    assert (await client.get("/api/discover/home")).status_code == 401


@respx.mock
async def test_admin_seerr_test(client):
    await plex_sign_in(client, "admin")
    assert (await client.post("/api/admin/seerr/test")).status_code == 400
    await configure()
    respx.get(f"{SEERR}/api/v1/status").mock(return_value=httpx.Response(200, json={"version": "3.5.1"}))
    respx.get(f"{SEERR}/api/v1/discover/trending").mock(return_value=httpx.Response(200, json={"results": [movie(1, d(-1))]}))
    assert (await client.post("/api/admin/seerr/test")).json() == {"ok": True, "version": "3.5.1", "trending": 1}
    assert (await client.put("/api/admin/settings", json={"seerr_url": "mediabox:5055"})).status_code == 400


@respx.mock
async def test_links_to_plex_or_seerr_and_public_rows(client):
    await configure(public="https://seerr.example.com")
    async with app_db.sessionmaker()() as db:
        await settings_store.save(db, {"title_links": "plex", "plex_server_id": "machine-1"})
    mock_seerr(trending=[movie(1, d(-20), status=5)], upcoming_movies=[movie(10, d(30), status=3)], upcoming_tv=[], requests=[], details={})
    assert (await client.get("/api/discover/public")).json()["enabled"] is False      # off by default
    await plex_sign_in(client, "viewer")
    r = (await client.get("/api/discover/home")).json()
    assert r["new"][0]["url"] == "https://app.plex.tv/desktop#!/server/machine-1/details?key=%2Flibrary%2Fmetadata%2F1001"
    assert r["upcoming"][0]["url"] == "https://seerr.example.com/movie/10"            # not on Plex yet
    assert "rating_key" not in r["new"][0]
    async with app_db.sessionmaker()() as db:
        await settings_store.save(db, {"plex_web_url": "https://plex.example.com/", "home_rows_public": True})
    r = (await client.get("/api/discover/home")).json()
    assert r["new"][0]["url"].startswith("https://plex.example.com/web/index.html#!/server/machine-1/")
    await client.post("/api/auth/logout")
    pub = (await client.get("/api/discover/public")).json()
    assert pub["enabled"] and [i["title"] for i in pub["new"]] == ["Movie 1"] and pub["new"][0]["url"] is None
    assert pub["upcoming"][0]["url"] is None
    async with app_db.sessionmaker()() as db:
        await settings_store.save(db, {"title_links": "none"})
    await plex_sign_in(client, "viewer")
    assert (await client.get("/api/discover/home")).json()["new"][0]["url"] is None
