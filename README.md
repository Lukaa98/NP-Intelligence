# NP Intelligence

A local-first React-style dashboard for Neptune's Pride 4 scan intelligence.

## What it does now

- Accepts a Neptune's Pride `game_number` and per-player API key, then keeps that key with the tracked game in local IndexedDB for one-click refreshes.
- Fetches scan data through the same-origin local proxy `/api/np-scan`, which forwards to `https://np.ironhelmet.com/api?game_number=X&code=Y` to avoid browser CORS blocking.
- Stores every scan as an immutable snapshot in browser IndexedDB.
- Provides a Postman / paste-JSON fallback for debugging or if the local proxy cannot reach the upstream API.
- Shows player growth stats, visible war metadata, snapshot history, and a snapshot comparison panel that turns any two saved scans into event-style notifications.
- Adds game tabs so multiple Neptune's Pride games can be tracked and switched independently in the same browser, including saved-key previews and stale-key warnings.
- Runs without npm-installed dependencies in this sandbox by using a tiny local React-compatible shim; swap to real React/Vite once registry access is available.

## Why IndexedDB first?

No separate database is required for the first version. The local dev server only proxies scan requests around browser CORS; snapshots and saved per-game API keys stay in the user's browser. When the tab is opened later, the user can fetch again with the stored key and the app stores a new snapshot to compare against older ones.

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

## Comparing snapshots

The app stores each fetch or pasted scan separately. Use the **Snapshot comparison / notifications** card to choose a **From** snapshot and a **To** snapshot. If both snapshots are from the same tick and no values changed, the app will say that no changes were detected; once the game advances to a later tick, player growth, tech upgrades, star captures, and fleet-route changes can appear as derived events.

## Saved game keys

After a successful API fetch, the game number, raw API key, masked key preview, latest tick, player UID, and key status are stored locally with that tracked game. Select a game tab later to refill the game number/key and fetch again without copying the token from NP. If the NP API returns a credential-looking failure, the game is marked as needing a fresh key so the user knows to regenerate and paste a new code.
