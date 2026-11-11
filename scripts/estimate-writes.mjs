// Estimates D1 rows written per processed scan for each tracked game, by
// running relationship extraction over the newest stored scans (read-only).
import { extractRelations } from "../backend/src/relations.js";

const base = (process.env.BACKEND_URL || "https://np-intelligence-backend.carsandbids-labs.workers.dev").replace(/\/+$/, "");
const get = async (path) => (await fetch(`${base}${path}`)).json();

for (const game of (await get("/api/games")).games) {
  const { snapshots } = await get(`/api/games/${game.gameNumber}/snapshots?limit=8`);
  const ordered = snapshots.slice().reverse();
  if (ordered.length < 2) continue;
  let state = null;
  const perScan = [];
  for (const meta of ordered) {
    if (state && meta.tick <= state.tick) continue;
    const { snapshot } = await get(`/api/snapshots/${encodeURIComponent(meta.id)}`);
    const result = extractRelations(snapshot.data, state);
    if (state) {
      const byKind = {};
      for (const item of result.observations) byKind[item.kind] = (byKind[item.kind] || 0) + 1;
      for (const item of result.events) byKind[`event:${item.kind}`] = (byKind[`event:${item.kind}`] || 0) + 1;
      perScan.push({ tick: result.tick, observations: result.observations.length, events: result.events.length, byKind, players: Object.keys(snapshot.data.players || {}).length });
    }
    state = result.state;
  }
  const avg = (key) => Math.round(perScan.reduce((sum, item) => sum + item[key], 0) / Math.max(perScan.length, 1));
  console.log(`\n${game.gameNumber} ${game.name} (${game.archivedAt ? "deleted" : game.finishedAt ? "finished" : "live"}, ${perScan[0]?.players}p, ${snapshots.length >= 8 ? "8+" : snapshots.length} recent scans)`);
  console.log(`  per scan: ~${avg("observations")} relation upserts + ~${avg("events")} event inserts (+ events again as upserts)`);
  console.log(`  breakdown (last scan): ${JSON.stringify(perScan.at(-1)?.byKind)}`);
}
