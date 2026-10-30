// Runs relationship extraction + scoring over each tracked game's stored
// scans (read-only) and prints the resulting teams, wars and trades, to check
// the inference against real games before trusting it.
import { extractRelations } from "../backend/src/relations.js";
import { buildDiplomacy } from "../backend/src/diplomacy.js";

const base = (process.env.BACKEND_URL || "https://np-intelligence-backend.carsandbids-labs.workers.dev").replace(/\/+$/, "");
const get = async (path) => (await fetch(`${base}${path}`)).json();
const maxSnapshots = Number(process.env.MAX_SNAPSHOTS || 80);

for (const game of (await get("/api/games")).games) {
  const { snapshots } = await get(`/api/games/${game.gameNumber}/snapshots?limit=500`);
  const ordered = snapshots.slice(0, maxSnapshots).reverse();
  const rows = new Map();
  const events = [];
  let state = null;
  let latest = null;
  let processed = 0;
  for (const meta of ordered) {
    if (state && meta.tick <= state.tick) continue;
    const { snapshot } = await get(`/api/snapshots/${encodeURIComponent(meta.id)}`);
    const result = extractRelations(snapshot.data, state);
    for (const item of result.observations) fold(rows, item, result.tick, 1, 1);
    const grouped = new Map();
    for (const event of result.events) {
      const key = `${event.kind}:${event.a}:${event.b}`;
      const entry = grouped.get(key) || { ...event, count: 0, weight: 0 };
      entry.count += 1;
      entry.weight += event.weight;
      grouped.set(key, entry);
      events.push({ ...event, tick: result.tick });
    }
    for (const entry of grouped.values()) fold(rows, entry, result.tick, entry.count, entry.weight);
    state = result.state;
    latest = snapshot.data;
    processed += 1;
  }
  if (!latest) continue;

  const players = Object.values(latest.players);
  const alias = (uid) => latest.players[uid]?.alias || `#${uid}`;
  const d = buildDiplomacy({ rows: [...rows.values()], events: events.reverse(), players, viewerUid: latest.playerUid, snapshotsProcessed: processed, latestTick: state.tick });

  console.log(`\n===== ${game.gameNumber} ${latest.name} (${players.length}p), ${processed} scans, ticks ${ordered[0].tick}..${state.tick}, me=${alias(latest.playerUid)}`);
  console.log(`status counts: ${JSON.stringify(d.pairs.reduce((acc, pair) => ({ ...acc, [pair.status]: (acc[pair.status] || 0) + 1 }), {}))}`);
  console.log("TEAMS:");
  for (const team of d.teams.slice(0, 15)) {
    console.log(`  [${team.members.length}] ${team.members.map(alias).join(", ")}  conf=${team.confidence} links=${team.links} stars=${team.stars}${team.confirmed ? " (incl. confirmed)" : ""}`);
  }
  console.log("TOP ALLIED PAIRS:");
  for (const pair of d.pairs.filter((p) => p.allied).slice(0, 12)) {
    console.log(`  ${alias(pair.a)} + ${alias(pair.b)} score=${pair.allyScore} ${JSON.stringify(pair.evidence)}`);
  }
  console.log("WARS:");
  for (const pair of d.pairs.filter((p) => p.status === "war").slice(0, 10)) {
    console.log(`  ${alias(pair.a)} vs ${alias(pair.b)} captures ${pair.evidence.capturesAB}/${pair.evidence.capturesBA} active=${pair.warActive}`);
  }
  console.log("FORMER ALLIES:", d.pairs.filter((p) => p.status === "former_allies").slice(0, 8).map((p) => `${alias(p.a)}/${alias(p.b)}`).join(", ") || "none");
  console.log("CAUGHT IN THE MIDDLE:");
  for (const item of d.middlemen.slice(0, 8)) {
    console.log(`  ${alias(item.middle)} between ${alias(item.sides[0].uid)} and ${alias(item.sides[1].uid)}: ${item.verdict} ${JSON.stringify(item.sides.map(({ uid, ...rest }) => rest))}`);
  }
  console.log("CONFLICTS:");
  for (const conflict of d.conflicts.slice(0, 6)) {
    console.log(`  ${conflict.side.map(alias).join(" & ")} vs ${conflict.enemies.map((enemy) => enemy.members.map(alias).join(" & ")).join(" + ")} took=${conflict.took} lost=${conflict.lost}`);
  }
  const trades = events.filter((event) => event.kind === "tech_trade");
  console.log(`TECH TRADES (${trades.length} candidate links):`);
  for (const trade of trades.slice(0, 12)) console.log(`  t${trade.tick} ${alias(trade.a)} ${trade.detail} <- ${alias(trade.b)}`);
}

function fold(rows, item, tick, count, weight) {
  const key = `${item.kind}:${item.a}:${item.b}`;
  const row = rows.get(key) || { kind: item.kind, a: item.a, b: item.b, count: 0, weight: 0, ships: 0, firstTick: tick, lastTick: tick, samples: [] };
  row.count += count;
  row.weight += weight;
  row.ships = Math.max(row.ships, item.ships || 0);
  row.lastTick = tick;
  if (item.samples?.length) row.samples = item.samples;
  rows.set(key, row);
}
