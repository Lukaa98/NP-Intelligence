import { TECH_NAMES } from "./intel.js";

// Pulls relationship evidence out of one NP4 snapshot, diffing against the
// compact state left by the previous one. Pure: no I/O, so it can be unit
// tested and run both for new scans and for backfilling stored history.
//
// Observations (counted once per snapshot):
//   ally_confirmed  viewer's formal alliances (player.war[uid] === 0)
//   guest           a's fleet sits at b's star; in NP4 only allies can
//   en_route        a's fleet is flying to a star b owns
//   contact         a and b own stars close to each other (a < b)
// Events (counted once when they happen):
//   capture         a took a star from b
//   tech_trade      a gained tech that b already had (b is a likely source)
export function extractRelations(data, previousState) {
  const tick = Number(data.tick || 0);
  const viewer = Number(data.playerUid ?? data.player_uid ?? -1);
  const players = data.players || {};
  const stars = data.stars || {};
  const fleets = Object.values(data.fleets || {});
  const observations = [];
  const events = [];

  const viewerWar = players[viewer]?.war || {};
  for (const [uid, value] of Object.entries(viewerWar)) {
    if (Number(value) === 0 && Number(uid) !== viewer && players[uid]) {
      observations.push(pairObservation("ally_confirmed", viewer, Number(uid)));
    }
  }

  const starAt = new Map();
  for (const star of Object.values(stars)) {
    starAt.set(`${star.x},${star.y}`, star);
  }

  const guests = new Map();
  const routes = new Map();
  for (const fleet of fleets) {
    const owner = Number(fleet.puid);
    if (!(owner >= 0)) continue;
    const ships = Number(fleet.st || 0);
    const here = starAt.get(`${fleet.x},${fleet.y}`);
    if (here && here.puid >= 0 && here.puid !== owner) {
      bump(guests, `${owner}:${here.puid}`, { a: owner, b: here.puid, ships, sample: here.n });
    }

    const firstOrder = Array.isArray(fleet.o) ? fleet.o[0] : null;
    const target = stars[Array.isArray(firstOrder) ? firstOrder[1] : -1];
    if (target && target.puid >= 0 && target.puid !== owner && target !== here) {
      bump(routes, `${owner}:${target.puid}`, { a: owner, b: target.puid, ships, sample: target.n });
    }
  }
  for (const entry of guests.values()) observations.push({ kind: "guest", ...entry, samples: [...entry.samples] });
  for (const entry of routes.values()) observations.push({ kind: "en_route", ...entry, samples: [...entry.samples] });

  for (const [a, b] of borderPairs(Object.values(stars))) {
    observations.push(pairObservation("contact", a, b));
  }

  const owners = {};
  for (const star of Object.values(stars)) owners[star.uid] = star.puid;
  const tech = {};
  for (const player of Object.values(players)) {
    tech[player.uid] = Object.fromEntries(Object.entries(player.tech || {}).map(([kind, value]) => [kind, Number(value?.level ?? 0)]));
  }

  if (previousState && previousState.tick < tick) {
    for (const star of Object.values(stars)) {
      const before = previousState.owners?.[star.uid];
      if (before !== undefined && before >= 0 && star.puid >= 0 && before !== star.puid) {
        events.push({ kind: "capture", a: star.puid, b: before, weight: 1, detail: star.n || `Star ${star.uid}` });
      }
    }
    events.push(...techTradeEvents(previousState.tech || {}, tech, tick - previousState.tick, players));
  }

  return { tick, observations, events, state: { tick, owners, tech } };
}

// A player gaining a tech level is normally research (+1). A jump of 2+
// levels between hourly scans, or reaching a level that only a few others
// already had, points at a trade; those others are the candidate sources.
function techTradeEvents(previousTech, currentTech, tickGap, players) {
  const events = [];
  for (const [uid, levels] of Object.entries(currentTech)) {
    const before = previousTech[uid];
    if (!before) continue;
    for (const [kind, level] of Object.entries(levels)) {
      const gain = level - Number(before[kind] ?? level);
      if (gain <= 0) continue;

      const sources = Object.entries(previousTech)
        .filter(([otherUid, otherLevels]) => otherUid !== uid && Number(otherLevels[kind] ?? 0) >= level && isActive(players[otherUid]))
        .map(([otherUid]) => Number(otherUid));
      if (!sources.length) continue;

      // Research can't plausibly add more than one level per scan interval of
      // a day or less, so a bigger jump is a trade; a +1 is only suspicious
      // when very few players could have supplied it.
      const bigJump = gain >= 2 && tickGap <= 24;
      const rare = sources.length <= 2;
      if (!bigJump && !rare) continue;

      const techName = TECH_NAMES[kind] || `Tech ${kind}`;
      const weight = (bigJump ? 1 : 0.5) / sources.length;
      for (const source of sources) {
        events.push({
          kind: "tech_trade",
          a: Number(uid),
          b: source,
          weight,
          detail: `${techName} ${level - gain}→${level}${sources.length > 1 ? ` (1 of ${sources.length} possible sources)` : ""}`
        });
      }
    }
  }
  return events;
}

function isActive(player) {
  return Boolean(player) && !Number(player.conceded);
}

// Pairs of empires whose stars sit close together. "Close" adapts to the map:
// 1.6x the median distance from a star to its nearest neighbour.
export function borderPairs(stars) {
  const owned = stars.filter((star) => star.puid >= 0);
  if (owned.length < 2) return [];

  const cell = Math.max(nearestNeighbourMedian(stars) * 1.6, 1e-6);
  const grid = new Map();
  for (const star of owned) {
    const key = `${Math.floor(star.x / cell)},${Math.floor(star.y / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(star);
  }

  const pairs = new Set();
  for (const star of owned) {
    const cx = Math.floor(star.x / cell);
    const cy = Math.floor(star.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (other.puid === star.puid) continue;
          if (Math.hypot(other.x - star.x, other.y - star.y) > cell) continue;
          const a = Math.min(star.puid, other.puid);
          const b = Math.max(star.puid, other.puid);
          pairs.add(`${a}:${b}`);
        }
      }
    }
  }
  return [...pairs].map((key) => key.split(":").map(Number));
}

function nearestNeighbourMedian(stars) {
  const sample = stars.slice(0, 300);
  const distances = sample.map((star) => {
    let best = Infinity;
    for (const other of stars) {
      if (other === star) continue;
      const distance = Math.hypot(other.x - star.x, other.y - star.y);
      if (distance < best) best = distance;
    }
    return best;
  }).filter(Number.isFinite).sort((left, right) => left - right);
  return distances[Math.floor(distances.length / 2)] || 1;
}

function pairObservation(kind, a, b) {
  return { kind, a: Math.min(a, b), b: Math.max(a, b), ships: 0, samples: [] };
}

function bump(map, key, { a, b, ships, sample }) {
  const entry = map.get(key) || { a, b, ships: 0, samples: new Set() };
  entry.ships += ships;
  if (sample) entry.samples.add(sample);
  map.set(key, entry);
}
