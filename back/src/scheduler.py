import asyncio
import contextlib

from .np_client import NeptuneApiError, fetch_scan
from .settings import get_settings
from .store import enabled_games_with_codes, mark_key_problem, save_snapshot, update_game_after_scan

_scheduler_task = None


async def scan_saved_game(game: dict, source: str = 'backend'):
    try:
        scanning_data = await fetch_scan(game['gameNumber'], game['code'])
        snapshot = save_snapshot(game['gameNumber'], scanning_data, source)
        update_game_after_scan(game['gameNumber'], scanning_data)
        return {'ok': True, 'gameNumber': game['gameNumber'], 'snapshot': snapshot}
    except NeptuneApiError as exc:
        mark_key_problem(game['gameNumber'], str(exc))
        return {'ok': False, 'gameNumber': game['gameNumber'], 'error': str(exc)}


async def run_once():
    results = []
    for game in enabled_games_with_codes():
        results.append(await scan_saved_game(game, source='scheduler'))
    return results


async def scheduler_loop():
    settings = get_settings()
    interval_seconds = settings.scan_interval_minutes * 60
    while True:
        await asyncio.sleep(interval_seconds)
        await run_once()


def start_scheduler():
    global _scheduler_task
    settings = get_settings()
    if not settings.enable_scheduler or _scheduler_task:
        return
    _scheduler_task = asyncio.create_task(scheduler_loop())


async def stop_scheduler():
    global _scheduler_task
    if not _scheduler_task:
        return
    _scheduler_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _scheduler_task
    _scheduler_task = None
