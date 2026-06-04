# NP Intelligence

A local-first React-style dashboard for Neptune's Pride 4 scan intelligence.

## What it does now

- Accepts a Neptune's Pride `game_number` and per-player API key, then keeps that key with the tracked game in local IndexedDB for one-click refreshes.
- Fetches scan data through the same-origin local proxy `/api/np-scan`, which forwards to `https://np.ironhelmet.com/api?game_number=X&code=Y` to avoid browser CORS blocking.
- Stores every scan as an immutable snapshot in browser IndexedDB.
- Provides a Postman / paste-JSON fallback for debugging or if the local proxy cannot reach the upstream API.
- Shows strategic intel cards for captures, pressure, combat losses, investment focus, tech shifts, and visible war signals instead of just repeating Neptune's Pride scoreboard totals.
- Provides snapshot history and a snapshot comparison panel that turns any two saved scans into event-style notifications.
- Adds game tabs so multiple Neptune's Pride games can be tracked and switched independently in the same browser, including saved-key previews and stale-key warnings.
- Auto-fetches due tracked games once per hour while the app tab is open, using saved local API keys.
- Includes a GitHub Actions scheduled scanner that can fetch saved game targets hourly while the browser is closed, cache the previous scan for comparison, and upload a summary artifact.
- Generates the `NP_SCAN_TARGETS` JSON in the UI from locally saved games so the same static workflow can scan many games without editing YAML.
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

## Hourly auto scan

Auto scan runs in the browser while the app tab is open. It checks saved games on startup and then once per hour, fetching only games with saved keys that are not marked as needing a fresh key.

## GitHub Actions scheduled scanner

For closed-tab polling, this repo includes `.github/workflows/hourly-scan.yml`. It runs once per hour, calls the official NP API directly from Node.js, caches the previous snapshot, compares it with the new scan, and uploads `summary.md` and `summary.json` artifacts with strategic intel and event notifications.

The workflow file should stay static. It does not need one YAML job per player or per game. Instead, the scheduled worker loops over every target in `NP_SCAN_TARGETS`, so 10 saved games can be scanned independently inside the same hourly workflow run.

In the browser UI, fetch each game once, then use the **GitHub hourly scheduler** card to copy the generated JSON for all saved games. Create a repository secret named `NP_SCAN_TARGETS` with JSON like:

```json
[
  { "game_number": "7744", "code": "YOUR_REGENERATABLE_NP_CODE", "name": "Pi Zavijava" }
]
```

Optional: add `NP_SCAN_WEBHOOK_URL` if you want the action to POST the scan summary JSON to another service.

You can also test the worker locally:

```bash
NP_SCAN_TARGETS='[{"game_number":"7744","code":"YOUR_CODE","name":"Pi Zavijava"}]' npm run scan:scheduled
```

This uses plain Node `fetch`, not Puppeteer. Puppeteer/headless Chrome would be useful for scraping a page, but the NP scan endpoint already returns JSON. A headless browser would add complexity and still would not write into the app's browser IndexedDB. The scheduled worker stores its comparison cache in GitHub Actions cache instead.

A browser-only static UI cannot safely rewrite repository secrets or workflow files by itself. To make scheduler enrollment fully automatic for many unrelated users, the next architecture step would be a backend or GitHub OAuth app that accepts a saved game from the UI and updates that user's repository secret/server-side schedule. For this repo-first version, the UI generates the exact secret JSON and the static workflow reads it.

Security note: in a public repo, GitHub secrets hide the API key from logs. The workflow uploads only summaries by default; the raw snapshot cache is used for comparisons and is not uploaded as an artifact.

## Intel direction

The goal is not to duplicate Neptune's Pride totals. The useful layer is interpretation: who captured from whom, who is losing ships, who is investing, who advanced dangerous tech, and which visible relations suggest active wars or diplomacy pressure.
