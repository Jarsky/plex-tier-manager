"""Site settings edited in the admin panel. Defaults live here; the database stores overrides.

Secret settings are encrypted at rest and never returned to the browser (only whether they are set).
"""
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import crypto
from .models import Setting

DEFAULTS: dict[str, Any] = {
    "site_name": "Plex Tier Manager",
    "site_tagline": "Pick a plan. Press play.",
    "signup_open": True,
    # Plex: the client id identifies this site to plex.tv; the owner token manages sharing on the server
    "plex_client_id": "",
    "plex_owner_token": "",
    "plex_owner_id": "",
    "plex_owner_username": "",
    "plex_server_id": "",               # machineIdentifier of the shared server
    "plex_server_name": "",
    # Tautulli
    "tautulli_url": "",
    "tautulli_api_key": "",
    "tautulli_webhook_secret": "",      # in the webhook URL Tautulli calls
    "enforcement_mode": "monitor",      # off | monitor (log only) | enforce (stop streams)
    "stream_limit_message": "Your {plan} plan allows {limit} stream(s) at a time. Stop another stream to watch this one.",
    "quality_limit_message": "Your {plan} plan streams up to {quality}. Pick a lower quality in your player to keep watching.",
    # Seerr: home page rows (new on the server, coming soon)
    "seerr_url": "",                    # as this site reaches it, e.g. http://seerr:5055
    "seerr_api_key": "",
    "seerr_public_url": "",             # for "seerr" title links
    "title_links": "seerr",             # where members' posters link: seerr | plex | none
    "plex_web_url": "",                 # the Plex server's external URL, for "plex" title links; blank = app.plex.tv
    "home_rows_public": False,          # also show the rows to visitors, without links
    # email
    "smtp_host": "",
    "smtp_port": 587,
    "smtp_username": "",
    "smtp_password": "",
    "smtp_from": "",
    "smtp_security": "starttls",        # starttls | ssl | none
    # records
    "audit_retention_days": 365,        # 0 = keep forever
    # support
    "support_enabled": True,
    "support_email": "",                # new requests are emailed here (needs SMTP); blank = admin panel only
    # memberships (Stripe)
    "billing_enabled": False,
    "billing_currency": "usd",
    "stripe_secret_key": "",
    "stripe_webhook_secret": "",
}
SECRET_KEYS = {"plex_owner_token", "tautulli_api_key", "seerr_api_key", "tautulli_webhook_secret", "smtp_password", "stripe_secret_key",
               "stripe_webhook_secret"}


async def load(db: AsyncSession) -> dict[str, Any]:
    values = dict(DEFAULTS)
    for row in (await db.execute(select(Setting))).scalars():
        if row.key not in DEFAULTS:
            continue
        if row.key in SECRET_KEYS:
            values[row.key] = crypto.decrypt((row.value or {}).get("enc")) or ""
        else:
            values[row.key] = row.value
    return values


async def save(db: AsyncSession, updates: dict[str, Any]) -> None:
    for key, value in updates.items():
        if key not in DEFAULTS:
            raise ValueError(f"unknown setting {key}")
        stored = {"enc": crypto.encrypt(value)} if key in SECRET_KEYS and value else ({} if key in SECRET_KEYS else value)
        row = await db.get(Setting, key)
        if row:
            row.value = stored
        else:
            db.add(Setting(key=key, value=stored))
    await db.commit()


def public_view(values: dict[str, Any]) -> dict[str, Any]:
    """Settings safe for the admin UI: secrets replaced by whether they're set."""
    return {k: (bool(v) if k in SECRET_KEYS else v) for k, v in values.items()}


def email_ready(values: dict[str, Any]) -> bool:
    return bool(values["smtp_host"] and values["smtp_from"])



def plex_ready(values: dict[str, Any]) -> bool:
    return bool(values["plex_owner_token"] and values["plex_server_id"])


def tautulli_ready(values: dict[str, Any]) -> bool:
    return bool(values["tautulli_url"] and values["tautulli_api_key"])


def seerr_ready(values: dict[str, Any]) -> bool:
    return bool(values["seerr_url"] and values["seerr_api_key"])
