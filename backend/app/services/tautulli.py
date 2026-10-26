"""Tautulli's API: what's playing now, and stopping a stream."""
import httpx


class TautulliError(Exception):
    pass


async def _call(url: str, api_key: str, cmd: str, **params) -> dict:
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.get(f"{url.rstrip('/')}/api/v2", params={"apikey": api_key, "cmd": cmd, **params})
    except httpx.HTTPError as e:
        raise TautulliError(f"Couldn't reach Tautulli: {e}") from e
    try:
        body = r.json()["response"]
    except (ValueError, KeyError) as e:
        raise TautulliError(f"Tautulli returned HTTP {r.status_code}") from e
    if body.get("result") != "success":
        raise TautulliError(body.get("message") or "Tautulli refused the request")
    return body.get("data") or {}


async def activity(url: str, api_key: str) -> list[dict]:
    return (await _call(url, api_key, "get_activity")).get("sessions") or []


async def terminate(url: str, api_key: str, session_id: str, message: str) -> None:
    await _call(url, api_key, "terminate_session", session_id=session_id, message=message)


async def server_info(url: str, api_key: str) -> dict:
    """For the admin panel's connection test."""
    return await _call(url, api_key, "get_server_info")
