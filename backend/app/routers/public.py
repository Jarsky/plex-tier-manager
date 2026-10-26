"""Unauthenticated site info the frontend needs before anyone signs in."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .. import security, settings_store
from ..db import get_db
from ..models import User
from .auth import plex_callback_url

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/config")
async def site_config(user: User | None = Depends(security.optional_user), db: AsyncSession = Depends(get_db)):
    s = await settings_store.load(db)
    return {
        "site_name": s["site_name"],
        "site_tagline": s["site_tagline"],
        "signup_open": s["signup_open"],
        "plex_ready": settings_store.plex_ready(s),
        "server_name": s["plex_server_name"],
        "plex_callback_url": plex_callback_url(),
        "support_enabled": s["support_enabled"],
        "billing_enabled": s["billing_enabled"],
        "signed_in": user is not None,
    }


@router.get("/health")
async def health():
    return {"ok": True}
