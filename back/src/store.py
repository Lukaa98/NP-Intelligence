import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .settings import get_settings


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection():
    settings = get_settings()
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.database_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_connection() as db:
        db.execute('''
            CREATE TABLE IF NOT EXISTS games (
                game_number TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                player_uid INTEGER,
                enabled INTEGER NOT NULL DEFAULT 1,
                key_status TEXT NOT NULL DEFAULT 'valid',
                key_status_message TEXT NOT NULL DEFAULT '',
                last_tick INTEGER,
                last_sync_at TEXT,
                last_error_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                game_number TEXT NOT NULL,
                tick INTEGER NOT NULL,
                source TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                production_counter INTEGER NOT NULL DEFAULT 0,
                production_rate INTEGER NOT NULL DEFAULT 0,
                player_uid INTEGER NOT NULL DEFAULT 0,
                game_name TEXT NOT NULL,
                data_json TEXT NOT NULL,
                FOREIGN KEY(game_number) REFERENCES games(game_number) ON DELETE CASCADE
            )
        ''')
        db.execute('CREATE INDEX IF NOT EXISTS snapshots_game_tick_idx ON snapshots(game_number, tick, captured_at)')


def upsert_game(game_number: str, code: str, name: str, player_uid: Optional[int] = None):
    timestamp = now_iso()
    with get_connection() as db:
        existing = db.execute('SELECT created_at FROM games WHERE game_number = ?', (game_number,)).fetchone()
        db.execute('''
            INSERT INTO games (game_number, code, name, player_uid, enabled, key_status, key_status_message, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, 'valid', 'Saved key worked on the last successful scan.', ?, ?)
            ON CONFLICT(game_number) DO UPDATE SET
                code = excluded.code,
                name = excluded.name,
                player_uid = COALESCE(excluded.player_uid, games.player_uid),
                enabled = 1,
                key_status = 'valid',
                key_status_message = 'Saved key worked on the last successful scan.',
                updated_at = excluded.updated_at
        ''', (game_number, code, name, player_uid, existing['created_at'] if existing else timestamp, timestamp))


def update_game_after_scan(game_number: str, scanning_data: dict):
    timestamp = now_iso()
    name = scanning_data.get('name') or (scanning_data.get('config') or {}).get('name') or f'Game {game_number}'
    with get_connection() as db:
        db.execute('''
            UPDATE games
            SET name = ?, player_uid = ?, last_tick = ?, last_sync_at = ?, key_status = 'valid',
                key_status_message = 'Saved key worked on the last successful scan.', updated_at = ?
            WHERE game_number = ?
        ''', (name, scanning_data.get('playerUid'), scanning_data.get('tick'), timestamp, timestamp, game_number))


def mark_key_problem(game_number: str, message: str):
    timestamp = now_iso()
    with get_connection() as db:
        db.execute('''
            UPDATE games
            SET key_status = 'needs_fresh_key', key_status_message = ?, last_error_at = ?, updated_at = ?
            WHERE game_number = ?
        ''', (message, timestamp, timestamp, game_number))


def save_snapshot(game_number: str, scanning_data: dict, source: str):
    timestamp = now_iso()
    tick = int(scanning_data.get('tick') or 0)
    snapshot = {
        'id': f'{game_number}-{tick}-{int(datetime.now(timezone.utc).timestamp() * 1000)}',
        'gameNumber': game_number,
        'source': source,
        'capturedAt': timestamp,
        'tick': tick,
        'productionCounter': int(scanning_data.get('productionCounter') or 0),
        'productionRate': int(scanning_data.get('productionRate') or 0),
        'playerUid': int(scanning_data.get('playerUid') or 0),
        'gameName': scanning_data.get('name') or (scanning_data.get('config') or {}).get('name') or f'Game {game_number}',
        'data': scanning_data,
    }
    with get_connection() as db:
        db.execute('''
            INSERT INTO snapshots (id, game_number, tick, source, captured_at, production_counter, production_rate, player_uid, game_name, data_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            snapshot['id'], game_number, snapshot['tick'], source, timestamp,
            snapshot['productionCounter'], snapshot['productionRate'], snapshot['playerUid'], snapshot['gameName'], json.dumps(scanning_data),
        ))
    return snapshot


def list_games():
    with get_connection() as db:
        rows = db.execute('SELECT * FROM games ORDER BY COALESCE(last_sync_at, created_at) DESC').fetchall()
    return [game_from_row(row) for row in rows]


def get_game(game_number: str):
    with get_connection() as db:
        row = db.execute('SELECT * FROM games WHERE game_number = ?', (game_number,)).fetchone()
    return game_from_row(row) if row else None


def delete_game(game_number: str):
    with get_connection() as db:
        db.execute('DELETE FROM snapshots WHERE game_number = ?', (game_number,))
        db.execute('DELETE FROM games WHERE game_number = ?', (game_number,))


def list_snapshots(game_number: str, limit: int = 50):
    with get_connection() as db:
        rows = db.execute('''
            SELECT * FROM snapshots WHERE game_number = ?
            ORDER BY tick DESC, captured_at DESC
            LIMIT ?
        ''', (game_number, limit)).fetchall()
    return [snapshot_from_row(row) for row in rows]


def latest_snapshots_for_compare(game_number: str):
    snapshots = list_snapshots(game_number, limit=2)
    current = snapshots[0] if snapshots else None
    previous = snapshots[1] if len(snapshots) > 1 else None
    return previous, current


def game_from_row(row):
    return {
        'gameNumber': row['game_number'],
        'name': row['name'],
        'playerUid': row['player_uid'],
        'enabled': bool(row['enabled']),
        'keyStatus': row['key_status'],
        'keyStatusMessage': row['key_status_message'],
        'lastTick': row['last_tick'],
        'lastSyncAt': row['last_sync_at'],
        'lastErrorAt': row['last_error_at'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
        'apiKeyPreview': mask_key(row['code']),
    }


def game_with_code(game_number: str):
    with get_connection() as db:
        row = db.execute('SELECT * FROM games WHERE game_number = ?', (game_number,)).fetchone()
    if not row:
        return None
    game = game_from_row(row)
    game['code'] = row['code']
    return game


def enabled_games_with_codes():
    with get_connection() as db:
        rows = db.execute('SELECT * FROM games WHERE enabled = 1 AND key_status != "needs_fresh_key"').fetchall()
    games = []
    for row in rows:
        game = game_from_row(row)
        game['code'] = row['code']
        games.append(game)
    return games


def snapshot_from_row(row):
    return {
        'id': row['id'],
        'gameNumber': row['game_number'],
        'source': row['source'],
        'capturedAt': row['captured_at'],
        'tick': row['tick'],
        'productionCounter': row['production_counter'],
        'productionRate': row['production_rate'],
        'playerUid': row['player_uid'],
        'gameName': row['game_name'],
        'data': json.loads(row['data_json']),
    }


def mask_key(key: str = ''):
    if not key:
        return ''
    if len(key) <= 6:
        return '••••'
    return f'{key[:3]}••••{key[-3:]}'
