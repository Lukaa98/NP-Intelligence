# NP Intelligence Backend

FastAPI backend for closed-tab Neptune's Pride scanning.

The browser UI can still store scans locally, but this backend lets saved games continue scanning while the browser is closed. It stores game API keys and snapshots in SQLite, runs an hourly scheduler, and exposes JSON endpoints for snapshots/intel.

## Setup

```bash
cd back
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn src.main:app --reload --port 8081
```

API base URL:

```txt
http://127.0.0.1:8081
```

## Main endpoints

- `GET /health`
- `POST /api/games` — save/update a game and immediately fetch a validation snapshot
- `GET /api/games`
- `GET /api/games/{game_number}`
- `POST /api/games/{game_number}/scan` — manually scan one saved game
- `GET /api/games/{game_number}/snapshots`
- `GET /api/games/{game_number}/intel`
- `DELETE /api/games/{game_number}`

## Register a game

```bash
curl -X POST http://127.0.0.1:8081/api/games \
  -H 'Content-Type: application/json' \
  -d '{"game_number":"7744","code":"YOUR_CODE","name":"Pi Zavijava"}'
```

## Render notes

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn src.main:app --host 0.0.0.0 --port $PORT`
- Root directory: `back`
- Add a persistent disk and set `DATABASE_PATH` to that disk path if you want snapshots to survive deploys/restarts.
- Set `CORS_ORIGINS` to the deployed frontend origin.

## Security

This backend stores NP API keys because it needs them for closed-tab polling. Do not expose this backend publicly without authentication once multiple real users use it. The current version is a deployable MVP, not a multi-tenant auth system.
