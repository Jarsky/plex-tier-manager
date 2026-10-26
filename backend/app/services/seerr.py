"""Seerr (Overseerr / Jellyseerr API v1): what's trending, what's upcoming, what's been requested, and what's on Plex.

Seerr knows availability because it syncs with the Plex libraries, so "available" here means "on the server".
"""
import httpx

POSTER = "https://image.tmdb.org/t/p/w342"
# Seerr's MediaStatus
UNKNOWN, PENDING, PROCESSING, PARTIALLY_AVAILABLE, AVAILABLE = 1, 2, 3, 4, 5
DECLINED = 3   # Seerr's MediaRequestStatus


class SeerrError(Exception):
    pass


class Seerr:
    def __init__(self, url: str, api_key: str):
        self.url, self.key = url.rstrip("/"), api_key

    async def get(self, path: str, **params) -> dict:
        try:
            async with httpx.AsyncClient(timeout=15) as http:
                r = await http.get(f"{self.url}/api/v1{path}", params=params, headers={"X-Api-Key": self.key})
        except httpx.HTTPError as e:
            raise SeerrError(f"Couldn't reach Seerr: {e}") from e
        if r.status_code in (401, 403):
            raise SeerrError("Seerr refused the API key.")
        if r.status_code != 200:
            raise SeerrError(f"Seerr returned HTTP {r.status_code} for {path}")
        return r.json()

    async def results(self, path: str, pages: int) -> list[dict]:
        out: list[dict] = []
        for page in range(1, pages + 1):
            data = await self.get(path, page=page)
            out += data.get("results") or []
            if page >= (data.get("totalPages") or 1):
                break
        return out

    async def requests(self, take: int = 100) -> list[dict]:
        return (await self.get("/request", take=take, skip=0, filter="all", sort="added")).get("results") or []

    async def details(self, media_type: str, tmdb_id: int) -> dict:
        return await self.get(f"/{'movie' if media_type == 'movie' else 'tv'}/{tmdb_id}")


def item(r: dict, media_type: str | None = None) -> dict | None:
    """A movie or show from Seerr in the shape the home page uses (None for people and other results)."""
    kind = media_type or r.get("mediaType")
    if kind not in ("movie", "tv"):
        return None
    info = r.get("mediaInfo") or {}
    released = r.get("releaseDate") if kind == "movie" else r.get("firstAirDate")
    nxt = (r.get("nextEpisodeToAir") or {}).get("airDate") if kind == "tv" else None
    return {"tmdb_id": r.get("id"), "type": kind, "title": r.get("title") or r.get("name") or "",
            "poster": f"{POSTER}{r['posterPath']}" if r.get("posterPath") else None, "release_date": released or None,
            "next_air_date": nxt, "status": info.get("status") or UNKNOWN, "requested": bool(info.get("requests")),
            "rating_key": info.get("ratingKey") or info.get("ratingKey4k")}   # the title's key in the Plex library
