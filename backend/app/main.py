"""FastAPI application: API routers, the built frontend, and the background jobs."""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from . import audit, jobs, settings_store
from .config import get_config
from .db import sessionmaker
from .routers import admin, admin_billing, auth, billing, discover, me, plex_admin, public, support, tautulli_hook
from .security import cleanup_expired

log = logging.getLogger("ptm")


async def housekeeping() -> None:
    async with sessionmaker()() as db:
        settings = await settings_store.load(db)
        await cleanup_expired(db)
        await audit.prune(db, settings["audit_retention_days"])


@asynccontextmanager
async def lifespan(_: FastAPI):
    await housekeeping()
    if get_config().background_jobs:
        jobs.start()
    yield
    await jobs.stop()


app = FastAPI(title="Plex Tier Manager", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url="/api/openapi.json")
for r in (public.router, auth.router, me.router, billing.router, discover.router, support.router, tautulli_hook.router, admin.router,
          admin_billing.router, plex_admin.router, support.admin_router):
    app.include_router(r)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


# ── built frontend (single-page app) ─────────────────────────────────────────
STATIC = Path(get_config().static_dir).resolve()


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    file = (STATIC / path).resolve()
    if path and file.is_file() and file.is_relative_to(STATIC):
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {}
        return FileResponse(file, headers=headers)
    if path.startswith("assets/") or "." in path.rsplit("/", 1)[-1]:
        return JSONResponse({"detail": "Not found"}, status_code=404, headers={"Cache-Control": "no-store"})
    index = STATIC / "index.html"
    if index.is_file():
        # no-store, not no-cache: Back/Forward reuse a cached page without revalidating, and an index.html from before a
        # deploy points at asset files that no longer exist (a blank page)
        return FileResponse(index, headers={"Cache-Control": "no-store"})
    return JSONResponse({"detail": "Frontend not built"}, status_code=404)
