from app import crypto


def test_crypto_roundtrip_and_mask():
    token = crypto.encrypt("secret-value-123456")
    assert crypto.decrypt(token) == "secret-value-123456"
    assert crypto.decrypt("garbage") is None
    assert "secret" not in crypto.mask("secret-value-123456")


def test_resolution_ranking():
    from app.entitlements import over_resolution
    from app.models import Plan
    p = Plan(max_resolution="1080")
    assert over_resolution(p, "4k") and not over_resolution(p, "1080") and not over_resolution(p, "720")
    assert not over_resolution(p, "sd") and not over_resolution(Plan(max_resolution=None), "4k")
    assert not over_resolution(p, None)


def test_database_url_accepts_plain_postgres_urls():
    from app.config import Config
    url = lambda v: Config(SECRET_KEY="k" * 32, DATABASE_URL=v).database_url  # noqa: E731
    assert url("postgresql://u:p@dpg-x-a/ptm") == "postgresql+asyncpg://u:p@dpg-x-a/ptm"
    assert url("postgres://u:p@h:5432/db?sslmode=require") == "postgresql+asyncpg://u:p@h:5432/db?ssl=require"
    assert url("postgresql+asyncpg://u:p@db/x") == "postgresql+asyncpg://u:p@db/x"
    assert url("sqlite+aiosqlite:///./data/x.db") == "sqlite+aiosqlite:///./data/x.db"
