// Deeper look at relationship-related fields of each tracked game's newest
// snapshot. Logs real values (the games and API are public).
const base = (process.env.BACKEND_URL || "https://np-intelligence-backend.carsandbids-labs.workers.dev").replace(/\/+$/, "");
const get = async (path) => (await fetch(`${base}${path}`)).json();

const games = (await get("/api/games")).games;
for (const game of games) {
  const { snapshots } = await get(`/api/games/${game.gameNumber}/snapshots?limit=500`);
  if (!snapshots.length) continue;
  const { snapshot } = await get(`/api/snapshots/${encodeURIComponent(snapshots[0].id)}`);
  const d = snapshot.data;
  const players = d.players;
  const me = players[d.playerUid];
  console.log(`\n===== ${game.gameNumber} ${d.name} tick ${d.tick} gameOver=${d.gameOver} players=${Object.keys(players).length} me=${me?.alias}(${d.playerUid})`);
  console.log("config:", typeof d.config === "string" ? d.config.slice(0, 600) : JSON.stringify(d.config).slice(0, 600));
  console.log("victoryPoints:", String(d.victoryPoints).slice(0, 300));
  console.log("my war:", JSON.stringify(me?.war));
  console.log("my ledger:", JSON.stringify(me?.ledger).slice(0, 300));
  const peace = Object.entries(me?.war || {}).filter(([, v]) => v !== 3).map(([uid, v]) => `${players[uid]?.alias}(${uid})=${v}`);
  console.log("non-war relations:", peace.join(", "));
  const researchers = Object.values(players).filter((p) => p.researching !== undefined).map((p) => `${p.alias}(${p.uid})`);
  console.log("players with visible researching:", researchers.join(", "));
  const withCash = Object.values(players).filter((p) => p.cash !== undefined).map((p) => p.alias);
  console.log("players with visible cash:", withCash.join(", "));
  const regard = Object.values(players).filter((p) => p.regard).map((p) => `${p.alias}=${p.regard}`);
  console.log("non-zero regard:", regard.join(", "));
  const vassals = Object.values(players).filter((p) => p.vassals && Object.keys(p.vassals).length).map((p) => `${p.alias}: ${JSON.stringify(p.vassals)}`);
  console.log("vassals:", vassals.join(" | ") || "none");
  console.log("fealty offers:", Object.values(players).filter((p) => p.offersOfFealty?.length).map((p) => `${p.alias}: ${JSON.stringify(p.offersOfFealty)}`).join(" | ") || "none");
  console.log("conceded/ai codes sample:", Object.values(players).slice(0, 12).map((p) => `${p.alias}:c${p.conceded}/ai${p.ai}/stars${p.totalStars}`).join(", "));
  const techSample = Object.values(players).slice(0, 3).map((p) => `${p.alias}: ${JSON.stringify(p.tech)}`);
  console.log("tech sample:\n  " + techSample.join("\n  "));

  const stars = d.stars;
  const fleets = Object.values(d.fleets);
  const orderSamples = fleets.filter((f) => f.o?.length).slice(0, 3).map((f) => JSON.stringify(f.o.slice(0, 3)));
  console.log("order samples:", orderSamples.join(" ; "));
  const ouidVals = {};
  let inFlightOuid = 0, inFlight = 0;
  for (const f of fleets) {
    const star = stars[f.ouid];
    const atStar = star && Math.abs(star.x - f.x) < 1e-6 && Math.abs(star.y - f.y) < 1e-6;
    if (!atStar) { inFlight++; ouidVals[f.ouid] = (ouidVals[f.ouid] || 0) + 1; }
  }
  console.log(`fleets not at their ouid star: ${inFlight}; their ouid values: ${JSON.stringify(Object.entries(ouidVals).slice(0, 8))}`);
  const guests = fleets.filter((f) => { const s = stars[f.ouid]; return s && s.x === f.x && s.y === f.y && s.puid >= 0 && s.puid !== f.puid; });
  const pairs = {};
  for (const f of guests) { const k = `${players[f.puid]?.alias} @ ${players[stars[f.ouid].puid]?.alias}`; pairs[k] = (pairs[k] || 0) + f.st; }
  console.log(`guest fleets (fleet at another empire's star): ${guests.length}`);
  console.log("  top guest pairs (ships):", Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}: ${v}`).join("; "));
  console.log("star sample:", JSON.stringify(Object.values(stars)[0]));
  console.log("fleet sample:", JSON.stringify(fleets.find((f) => f.o?.length)));
  console.log("wormhole stars:", Object.values(stars).filter((s) => s.wh !== undefined).slice(0, 3).map((s) => JSON.stringify(s)).join(" "));
}
