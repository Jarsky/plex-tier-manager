"""Background work in the web process: the Plex access check (every 15 minutes, or sooner when kicked) and the
Tautulli sweep (every minute). One process runs the site, so there's no separate worker."""
import asyncio
import logging

from . import enforcement, membership
from .db import sessionmaker

log = logging.getLogger("ptm.jobs")
PLEX_EVERY = 15 * 60
SWEEP_EVERY = 60
_kick = asyncio.Event()
_tasks: list[asyncio.Task] = []


def kick_plex_check() -> None:
    """Run the Plex access check soon, e.g. after a plan's libraries change."""
    _kick.set()


async def _plex_loop() -> None:
    while True:
        try:
            await asyncio.wait_for(_kick.wait(), timeout=PLEX_EVERY)
        except TimeoutError:
            pass
        _kick.clear()
        try:
            async with sessionmaker()() as db:
                await membership.reconcile(db)
        except Exception:
            log.exception("Plex access check failed")


async def _sweep_loop() -> None:
    while True:
        await asyncio.sleep(SWEEP_EVERY)
        try:
            async with sessionmaker()() as db:
                await enforcement.run(db)
        except Exception as e:
            log.warning("Tautulli sweep failed: %s", e)


def start() -> None:
    _tasks.extend([asyncio.create_task(_plex_loop()), asyncio.create_task(_sweep_loop())])
    _kick.set()   # check Plex once at start-up


async def stop() -> None:
    for t in _tasks:
        t.cancel()
    _tasks.clear()
