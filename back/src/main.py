from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .intel import diff_snapshots, strategic_intel, summarize
from .np_client import NeptuneApiError, fetch_scan
from .scheduler import run_once, scan_saved_game, start_scheduler, stop_scheduler
from .settings import get_settings
from .store import (
    delete_game,
    game_with_code,
    get_game,
    init_db,
    latest_snapshots_for_compare,
    list_games,
    list_snapshots,
    mark_key_problem,
    save_snapshot,
    update_game_after_scan,
    upsert_game,
)


class GameCreate(BaseModel):
    game_number: str = Field(..., min_length=1)
    code: str = Field(..., min_length=1)
    name: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    yield
    await stop_scheduler()


settings = get_settings()
app = FastAPI(title='NP Intelligence Backend', version='0.1.0', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins if '*' not in settings.cors_origins else ['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/health')
def health():
    return {'ok': True, 'schedulerEnabled': settings.enable_scheduler, 'scanIntervalMinutes': settings.scan_interval_minutes}


@app.post('/api/games')
async def create_game(payload: GameCreate):
    game_number = payload.game_number.strip()
    code = payload.code.strip()
    if not game_number or not code:
        raise HTTPException(status_code=400, detail='game_number and code are required')

    try:
        scanning_data = await fetch_scan(game_number, code)
    except NeptuneApiError as exc:
        raise HTTPException(status_code=400, detail=f'Could not validate NP key: {exc}') from exc

    name = payload.name or scanning_data.get('name') or (scanning_data.get('config') or {}).get('name') or f'Game {game_number}'
    upsert_game(game_number, code, name, scanning_data.get('playerUid'))
    snapshot = save_snapshot(game_number, scanning_data, 'backend-register')
    update_game_after_scan(game_number, scanning_data)
    return {'game': get_game(game_number), 'snapshot': snapshot}


@app.get('/api/games')
def games():
    return {'games': list_games()}


@app.get('/api/games/{game_number}')
def game_detail(game_number: str):
    game = get_game(game_number)
    if not game:
        raise HTTPException(status_code=404, detail='Game not found')
    return {'game': game}


@app.delete('/api/games/{game_number}')
def remove_game(game_number: str):
    delete_game(game_number)
    return {'ok': True}


@app.post('/api/games/{game_number}/scan')
async def scan_game(game_number: str):
    game = game_with_code(game_number)
    if not game:
        raise HTTPException(status_code=404, detail='Game not found')
    result = await scan_saved_game(game, source='backend-manual')
    if not result['ok']:
        raise HTTPException(status_code=400, detail=result['error'])
    return result


@app.post('/api/scans/run')
async def run_all_scans():
    return {'results': await run_once()}


@app.get('/api/games/{game_number}/snapshots')
def snapshots(game_number: str, limit: int = 50):
    if not get_game(game_number):
        raise HTTPException(status_code=404, detail='Game not found')
    return {'snapshots': list_snapshots(game_number, limit=max(1, min(limit, 200)))}


@app.get('/api/games/{game_number}/intel')
def game_intel(game_number: str):
    if not get_game(game_number):
        raise HTTPException(status_code=404, detail='Game not found')
    previous, current = latest_snapshots_for_compare(game_number)
    events = diff_snapshots(previous, current) if previous and current else []
    summary = summarize(current) if current else {}
    return {
        'summary': summary,
        'previous': previous,
        'current': current,
        'events': events,
        'intel': strategic_intel(summary, events) if current else [],
    }
