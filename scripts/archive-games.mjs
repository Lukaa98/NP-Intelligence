// Exports finished games to the np-archive git branch so Cloudflare can drop
// their hourly history. Run by .github/workflows/archive-games.yml.
//
//   node archive-games.mjs export <archiveDir> <listFile>
//     Writes archive/<game>/game.json (game, diplomacy, frame index) and
//     archive/<game>/ticks/<tick>.json (one full scan per tick) for every game
//     the backend reports as ready, and lists the exported game numbers.
//   node archive-games.mjs mark <listFile>
//     After the push succeeded, tells the backend those games are archived,
//     which allows it to prune their hourly history.
import fs from "node:fs";
import path from "node:path";

const base = (process.env.BACKEND_URL || "https://np-intelligence-backend.carsandbids-labs.workers.dev").replace(/\/+$/, "");
const token = process.env.NP_ADMIN_TOKEN || "";
const [mode, ...args] = process.argv.slice(2);

async function call(pathname, init = {}) {
  const headers = { ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${base}${pathname}`, { ...init, headers });
  if (!response.ok) throw new Error(`${pathname} -> ${response.status} ${await response.text()}`);
  return response.json();
}

if (mode === "export") {
  const [archiveDir, listFile] = args;
  const { games } = await call("/api/archive/pending");
  console.log(`${games.length} game(s) ready to archive`);
  const exported = [];

  for (const game of games) {
    const dir = path.join(archiveDir, String(game.gameNumber));
    fs.mkdirSync(path.join(dir, "ticks"), { recursive: true });
    const { snapshots } = await call(`/api/games/${game.gameNumber}/snapshots?limit=5000`);

    // One frame per tick, keeping the newest scan of each tick.
    const byTick = new Map();
    for (const meta of snapshots) {
      const existing = byTick.get(meta.tick);
      if (!existing || meta.capturedAt > existing.capturedAt) byTick.set(meta.tick, meta);
    }
    const frames = [];
    for (const meta of [...byTick.values()].sort((a, b) => a.tick - b.tick)) {
      const { snapshot } = await call(`/api/snapshots/${encodeURIComponent(meta.id)}`);
      const file = `ticks/${meta.tick}.json`;
      fs.writeFileSync(path.join(dir, file), JSON.stringify(snapshot));
      frames.push({ id: meta.id, tick: meta.tick, capturedAt: meta.capturedAt, label: meta.label, pinned: meta.pinned, file });
    }

    const diplomacy = await call(`/api/games/${game.gameNumber}/diplomacy`).catch(() => null);
    fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify({ game, frames, diplomacy, exportedAt: new Date().toISOString() }, null, 1));
    exported.push({ gameNumber: game.gameNumber, name: game.nickname || game.name, frames: frames.length, firstTick: frames[0]?.tick, lastTick: frames.at(-1)?.tick });
    console.log(`  ${game.gameNumber} ${game.name}: ${frames.length} ticks`);
  }

  // Index of everything in the archive, merged with earlier runs.
  const indexFile = path.join(archiveDir, "index.json");
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : { games: [] };
  for (const entry of exported) {
    index.games = index.games.filter((item) => String(item.gameNumber) !== String(entry.gameNumber));
    index.games.push({ ...entry, archivedAt: new Date().toISOString() });
  }
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
  fs.writeFileSync(listFile, JSON.stringify(exported.map((item) => item.gameNumber)));
} else if (mode === "mark") {
  const [listFile] = args;
  const numbers = JSON.parse(fs.readFileSync(listFile, "utf8"));
  for (const gameNumber of numbers) {
    await call(`/api/games/${gameNumber}/exported`, { method: "POST", body: JSON.stringify({ ref: `np-archive:archive/${gameNumber}` }) });
    console.log(`marked ${gameNumber} as archived`);
  }
} else {
  console.error("usage: archive-games.mjs export <archiveDir> <listFile> | mark <listFile>");
  process.exit(1);
}
