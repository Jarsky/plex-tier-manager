"""Deployment configuration from environment variables.

Only things that must exist before the database is reachable, or that a deployer should control
outside the admin panel, live here. Everything else (site name, Plex server, Tautulli, Stripe, SMTP)
is stored in the database and edited in the admin panel.
"""
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Public URL of the site, no trailing slash. OAuth redirect URIs are built from it.
    public_url: str = Field("http://localhost:8000", alias="PUBLIC_URL")
    # Signs session cookies and derives the key that encrypts stored secrets. Changing it logs
    # everyone out and makes stored API keys/tokens unreadable.
    secret_key: str = Field(..., alias="SECRET_KEY", min_length=32)
    database_url: str = Field("sqlite+aiosqlite:///./data/ptm.db", alias="DATABASE_URL")

    # Comma-separated Plex usernames or Plex account ids made admins when they sign in. (Not emails: Plex doesn't
    # guarantee an account's email was confirmed.)
    bootstrap_admins: str = Field("", alias="BOOTSTRAP_ADMINS")

    # Background jobs: Plex access check every 15 min, Tautulli sweep every minute. Off in tests.
    background_jobs: bool = Field(True, alias="BACKGROUND_JOBS")

    # Set when running behind a reverse proxy that terminates TLS (cookies get the Secure flag
    # when PUBLIC_URL is https regardless).
    trust_proxy_headers: bool = Field(True, alias="TRUST_PROXY_HEADERS")
    static_dir: str = Field("static", alias="STATIC_DIR")

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, url: str) -> str:
        """Accept the plain postgres:// URLs hosts hand out (Render, Neon, Heroku); the app needs the asyncpg driver."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                url = "postgresql+asyncpg://" + url[len(prefix):]
        return url.replace("sslmode=", "ssl=") if url.startswith("postgresql+asyncpg://") else url

    @property
    def secure_cookies(self) -> bool:
        return self.public_url.startswith("https://")

    @property
    def admin_bootstrap_set(self) -> set[str]:
        return {x.strip().lower() for x in self.bootstrap_admins.split(",") if x.strip()}


@lru_cache
def get_config() -> Config:
    return Config()
