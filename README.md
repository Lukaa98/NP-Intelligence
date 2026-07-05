# NP Intelligence

Neptune's Pride scan intelligence, now moving from a browser-only React dashboard toward a Chrome extension plus Cloudflare Worker/D1 backend.

## Current layout

- `src/` and `back/`
  The existing React-style dashboard and FastAPI backend from this branch.
- `extension/`
  New Chrome extension UI for saving games, triggering scans, and reading backend intel.
- `backend/`
  New Cloudflare Worker + D1 backend patterned after the `carsandbids-labs` Wrangler setup.

## Why this refactor

The old local-first flow worked, but it kept the important polling tied to an open browser tab or a separate Render deployment. The new direction is:

1. Save Neptune's Pride game number + API code from a Chrome extension.
2. Store those tracked games in D1.
3. Let a Worker cron poll every 12 hours even when your browser is closed.
4. Surface derived intel like captures, ship losses, tech changes, and visible war pressure back inside the extension popup.

## Extension setup

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select [extension](C:/Users/13477/Desktop/DevProjects/NP-Intelligence/extension)
5. Open a Neptune's Pride tab
6. Use **Try page capture** if the game number or code is available in page storage, or paste them manually
7. Point the extension at your deployed Worker URL

## Worker + D1 setup

1. Copy [backend/wrangler.toml.example](C:/Users/13477/Desktop/DevProjects/NP-Intelligence/backend/wrangler.toml.example) to `backend/wrangler.toml`
2. Create a new D1 database:

```bash
npx wrangler d1 create np-intelligence
```

3. Put the returned `database_id` into `backend/wrangler.toml`
4. Apply migrations:

```bash
cd backend
npx wrangler d1 migrations apply DB --remote
```

5. Deploy the Worker:

```bash
cd backend
npx wrangler deploy
```

6. Paste the deployed Worker URL into the extension popup

## What the Worker does

- validates a saved NP game/code by running a live scan
- stores tracked games and immutable snapshots in D1
- exposes routes for games, scans, snapshots, and derived intel
- runs a `0 */12 * * *` cron schedule for closed-browser polling

## Notes

- `back/` is still here as the previous FastAPI path, but `backend/` is now the Wrangler-targeted direction.
- The strategic intel logic used by the new Worker is ported from the current branch so we keep the same captures, pressure, combat-loss, and tech-shift reasoning.
- The extension currently uses lightweight page-hint capture for convenience, but the most reliable path is still a real game number plus valid NP code.
