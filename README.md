# NP Intelligence

Neptune's Pride intel dashboard: track your games, keep their history after NP deletes them, replay any snapshot as an interactive galaxy map, and keep a book of players you'd (not) work with again.

**Live:** https://lukaa98.github.io/NP-Intelligence/

## Layout

- `web/`: the dashboard (Vite + React), deployed to GitHub Pages.
- `backend/`: Cloudflare Worker + D1. Scans tracked games hourly by cron and stores snapshots and your player notes.
- `scripts/test-intel.mjs`: tests for the intel diff logic (`npm test`).

## Features

- **Games**: track a game with its number and API code (from Options → API in the game). Each game can be scanned on demand.
- **Deleted games**: "Delete" moves a game into the *Deleted games* section. It stops being scanned, but all its snapshots and captures are kept. You can restore it, or use *Erase forever* to wipe it.
- **Capture state**: scans the game now and pins that snapshot as a capture. If NP no longer serves the game, the newest stored snapshot is pinned instead. When a scan reports the game is over, the final state is pinned automatically and the game stops being polled.
- **Galaxy map**: any snapshot opens as an NP-style map. Drag to pan, scroll or pinch to zoom. You can click stars, fleets and leaderboard players, and the game-over banner names the winner.
- **Download HTML**: saves a single self-contained `.html` file of a snapshot (data and viewer inlined) that opens offline, forever.
- **Player book**: 👍 / 👎 / 📝 any player from a game's intel list or the map. The *Players* page lists everyone you've rated, with the games you met them in. Ratings are keyed by alias, so they follow a player across games.
- **Player intel**: per-player captures, losses, ship and tech changes over latest / 1h / 6h / 32h windows, plus fetch health.

## What gets kept

- Running games are scanned every hour (at :07). A scan on the same tick as the previous one isn't stored again.
- **While a game is live, its full scan history is kept.**
- Once a game stops producing data, its latest state is pinned and the rest of its history is deleted. That happens when:
  - the game ends (pinned as *Final state*),
  - you delete it (pinned as *Last state before delete*), or
  - NP refuses scans for 48 hours, e.g. NP deleted the game or the key expired (pinned as *Last known state*).
- **Kept forever:** pinned captures, those final states, and player notes.

## Deploying

### Dashboard (GitHub Pages)

`.github/workflows/deploy-pages.yml` builds `web/` and publishes it to the `gh-pages` branch on every push that touches `web/`. Same setup as AI-horror-stories.

One-time: **Settings → Pages → Build and deployment → Deploy from a branch → `gh-pages` / `(root)`**.

The dashboard talks to `https://np-intelligence-backend.carsandbids-labs.workers.dev` by default. You can change that per browser in *Settings*, or at build time with an `NP_BACKEND_URL` repository variable.

### Worker (Cloudflare)

The new features need migration `0003`. Either deploy by hand:

```bash
cd backend
npm install
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

Or add a `CLOUDFLARE_API_TOKEN` repo secret (plus `CLOUDFLARE_ACCOUNT_ID` if needed), and `.github/workflows/deploy-worker.yml` will migrate and deploy on pushes that touch `backend/`.

**Protect writes (recommended):** the dashboard is public, so anyone who finds the Worker URL could change data. Set a token:

```bash
cd backend
npx wrangler secret put ADMIN_TOKEN
```

Then enter the same token under *Settings → Write token* in the dashboard. Reads stay open, and API codes are always masked.

## Local development

```bash
cd backend && npm install && npx wrangler d1 migrations apply DB --local && npx wrangler dev
```

```bash
cd web && npm install && VITE_BACKEND_URL=http://localhost:8787 npm run dev
```

## Worker API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/games` | All games, including deleted (`archivedAt`) and finished (`finishedAt`) |
| POST | `/api/games` | Save `{ game_number, code, name }` and run a first scan |
| POST | `/api/games/:n/scan` | Scan now |
| POST | `/api/games/:n/capture` | Scan and pin, falling back to the latest stored snapshot |
| DELETE | `/api/games/:n` | Move to Deleted games (`?purge=1` erases everything) |
| POST | `/api/games/:n/restore` | Undo delete |
| GET | `/api/games/:n/snapshots` | Snapshot list without payloads (`?pinned=1` for captures) |
| GET | `/api/games/:n/intel?window=latest\|1h\|6h\|32h` | Derived intel |
| GET | `/api/snapshots/:id` | One full snapshot |
| POST/DELETE | `/api/snapshots/:id/pin` | Pin or unpin a capture |
| GET / PUT | `/api/players` | List or upsert `{ alias, rating: -1\|0\|1, note, game }` |
| DELETE | `/api/players/:alias` | Forget a player |
