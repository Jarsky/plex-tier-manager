"""Small admin commands:  python -m app.cli make-admin <plex-username|plex-account-id>"""
import asyncio
import sys

from sqlalchemy import func, or_, select

from .db import sessionmaker
from .models import PlexMember, User


async def make_admin(key: str) -> int:
    async with sessionmaker()() as db:
        m = (await db.execute(select(PlexMember).where(or_(func.lower(PlexMember.username) == key.lower(),
                                                           PlexMember.plex_id == key)))).scalar_one_or_none()
        user = await db.get(User, m.user_id) if m else None
        if user is None:
            print(f"No member with Plex username or id {key!r}. They need to sign in once first.")
            return 1
        user.is_admin = True
        await db.commit()
        print(f"{user.display_name} is now an admin.")
        return 0


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "make-admin":
        print(__doc__)
        return 2
    return asyncio.run(make_admin(sys.argv[2]))


if __name__ == "__main__":
    sys.exit(main())
