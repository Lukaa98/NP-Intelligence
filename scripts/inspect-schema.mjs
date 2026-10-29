// Prints the *shape* of the newest stored snapshot (field names, types,
// counts, value distributions for small enums). No aliases, coordinates,
// names or codes are printed, because Actions logs are public.
const base = (process.env.BACKEND_URL || "https://np-intelligence-backend.carsandbids-labs.workers.dev").replace(/\/+$/, "");

const get = async (path) => {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
};

function shape(objects) {
  const fields = {};
  for (const object of objects) {
    for (const [key, value] of Object.entries(object || {})) {
      const type = Array.isArray(value) ? `array(${value.length ? typeof value[0] : "empty"})` : value === null ? "null" : typeof value;
      const entry = fields[key] ||= { types: new Set(), count: 0, small: new Map() };
      entry.types.add(type);
      entry.count += 1;
      if ((typeof value === "number" || typeof value === "boolean") && entry.small.size <= 8) {
        entry.small.set(String(value), (entry.small.get(String(value)) || 0) + 1);
      }
    }
  }
  return Object.entries(fields).map(([key, entry]) => {
    const enumish = entry.small.size && entry.small.size <= 8 ? ` values{${[...entry.small].map(([v, n]) => `${v}:${n}`).join(", ")}}` : "";
    return `  ${key}: ${[...entry.types].join("|")} (in ${entry.count}/${objects.length})${enumish}`;
  }).join("\n");
}

const games = (await get("/api/games")).games.filter((game) => !game.archivedAt);
console.log(`games tracked: ${games.length}`);
for (const game of games) {
  const { snapshots } = await get(`/api/games/${game.gameNumber}/snapshots?limit=500`);
  console.log(`\n=== game ${game.gameNumber}: ${snapshots.length} snapshots, ticks ${snapshots.at(-1)?.tick}..${snapshots[0]?.tick}`);
  if (!snapshots.length) continue;
  const { snapshot } = await get(`/api/snapshots/${encodeURIComponent(snapshots[0].id)}`);
  const data = snapshot.data;
  console.log(`snapshot json size: ${(JSON.stringify(data).length / 1024).toFixed(0)} KB`);
  console.log("top-level:\n" + shape([Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "object" && v && !Array.isArray(v) ? `{${Object.keys(v).length} keys}` : v]))]));

  const players = Object.values(data.players || {});
  console.log(`\nplayers (${players.length}):\n${shape(players)}`);
  const sample = players.find((player) => player.tech) || {};
  console.log(`\nplayer.tech keys: ${Object.keys(sample.tech || {}).join(", ")}`);
  console.log(`player.tech entry shape:\n${shape(Object.values(sample.tech || {}))}`);
  for (const key of ["war", "countdown_to_war", "regard", "relations", "alliances"]) {
    const holders = players.filter((player) => player[key] && typeof player[key] === "object");
    if (holders.length) {
      const values = holders.flatMap((player) => Object.values(player[key]));
      const dist = {};
      for (const value of values) dist[JSON.stringify(value)] = (dist[JSON.stringify(value)] || 0) + 1;
      console.log(`player.${key}: on ${holders.length} players, value distribution ${JSON.stringify(dist)}`);
    }
  }

  const stars = Object.values(data.stars || {});
  console.log(`\nstars (${stars.length}):\n${shape(stars)}`);
  const fleets = Object.values(data.fleets || {});
  console.log(`\nfleets (${fleets.length}):\n${shape(fleets)}`);
  const me = data.player_uid ?? data.playerUid;
  const foreign = fleets.filter((fleet) => fleet.puid !== me);
  console.log(`foreign fleets: ${foreign.length}, with orders: ${foreign.filter((fleet) => (fleet.o || []).length).length}, orbiting a star: ${foreign.filter((fleet) => fleet.ouid !== undefined && fleet.ouid >= 0).length}`);
  const starOwner = new Map(stars.map((star) => [star.uid, star.puid]));
  const atOthersStar = foreign.filter((fleet) => fleet.ouid >= 0 && starOwner.has(fleet.ouid) && starOwner.get(fleet.ouid) !== fleet.puid && starOwner.get(fleet.ouid) >= 0);
  console.log(`fleets orbiting another empire's star: ${atOthersStar.length}`);
  console.log(`stars with visible ship counts: ${stars.filter((star) => star.st !== undefined).length}`);
}
