# NP Intelligence

A local-first React-style dashboard for Neptune's Pride 4 scan intelligence.

## What it does now

- Accepts a Neptune's Pride `game_number` and per-player API key.
- Fetches scan data from `https://np.ironhelmet.com/api?game_number=X&code=Y`.
- Stores every scan as an immutable snapshot in browser IndexedDB.
- Provides a Postman / paste-JSON fallback if the browser blocks the direct API request with CORS.
- Shows player growth stats, visible war metadata, snapshot history, and derived change events between the latest two snapshots.
- Runs without npm-installed dependencies in this sandbox by using a tiny local React-compatible shim; swap to real React/Vite once registry access is available.

## Why IndexedDB first?

No separate database or server is required for the first version. API keys and snapshots stay in the user's browser. When the tab is opened later, the user can fetch again and the app stores a new snapshot to compare against older ones.

A backend can be added later if we want scheduled polling while the browser is closed, cross-device sync, or shared alliance intelligence.

## Run locally

```bash
npm run dev
```

Open <http://localhost:5173>.

## Check syntax

```bash
npm run check
```

## Notes

This project intentionally does not automate game actions. It only reads the official NP4 scanning API and transforms the scan response into local intelligence views.
