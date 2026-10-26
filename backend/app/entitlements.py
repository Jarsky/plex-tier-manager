"""Which plan a member is on right now. No plan means no server access."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from .models import Plan, User

# A paid plan outlives its billing period by this much at most, even if Stripe's "subscription ended" webhook never arrives
EXPIRY_GRACE = timedelta(days=3)

RESOLUTIONS = {"480": "480p (SD)", "720": "720p", "1080": "1080p", "4k": "4K"}
# Tautulli reports these for the resolution being streamed
RESOLUTION_RANK = {"sd": 1, "480": 1, "576": 1, "720": 2, "1080": 3, "1440": 4, "2k": 4, "4k": 5}


def subscription_lapsed(user: User, now: datetime | None = None) -> bool:
    if user.plan_source != "stripe" or user.subscription_period_end is None:
        return False
    end = user.subscription_period_end.replace(tzinfo=user.subscription_period_end.tzinfo or timezone.utc)
    return end + EXPIRY_GRACE < (now or datetime.now(timezone.utc))


async def user_plan(db: AsyncSession, user: User) -> Plan | None:
    if not user.plan_id or user.is_disabled or subscription_lapsed(user):
        return None
    return await db.get(Plan, user.plan_id)


def over_resolution(plan: Plan, streamed: str | None) -> bool:
    if not plan.max_resolution or not streamed:
        return False
    return RESOLUTION_RANK.get(streamed.lower(), 0) > RESOLUTION_RANK.get(plan.max_resolution, 99)
