"""Tautulli's webhook: it calls this when playback starts, and the stream limits are checked straight away."""
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .. import enforcement, settings_store
from ..db import get_db
from ..services import tautulli

log = logging.getLogger("ptm.tautulli")
router = APIRouter(prefix="/api/tautulli", tags=["tautulli"])


@router.post("/webhook/{secret}")
async def webhook(secret: str, db: AsyncSession = Depends(get_db)):
    """The body is ignored: what's playing is read back from Tautulli, so a forged call can't make up a stream.
    Always 200 for a valid secret (Tautulli doesn't retry, and errors here are logged)."""
    settings = await settings_store.load(db)
    expected = settings["tautulli_webhook_secret"]
    if not expected or not hmac.compare_digest(secret, expected):
        raise HTTPException(404, "Not found")
    try:
        found = await enforcement.run(db)
    except tautulli.TautulliError as e:
        log.warning("Webhook check failed: %s", e)
        return {"ok": False}
    return {"ok": True, "over_limit": found}
