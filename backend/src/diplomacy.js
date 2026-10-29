// Turns accumulated relationship evidence into a diplomatic picture: pair
// statuses (allied / war / ...), likely teams and recent events.
//
// rows:    aggregated `relations` rows ({ kind, a, b, count, weight, ships, firstTick, lastTick, samples })
// events:  recent `relation_events` rows ({ tick, kind, a, b, weight, detail })
// players: latest snapshot players ({ uid, alias, ... })
export function buildDiplomacy({ rows, events, players, viewerUid, snapshotsProcessed, latestTick }) {
  const pairs = new Map();
  const pairFor = (x, y) => {
    const a = Math.min(x, y);
    const b = Math.max(x, y);
    const key = `${a}:${b}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        a, b,
        confirmed: false,
        guest: { ab: 0, ba: 0, ships: 0, lastTick: -1, samples: [] },
        route: { ab: 0, ba: 0, shipsAB: 0, shipsBA: 0, lastTick: -1, samples: [] },
        captures: { ab: 0, ba: 0, lastTick: -1 },
        trade: { ab: 0, ba: 0 },
        contact: 0
      });
    }
    return pairs.get(key);
  };

  for (const row of rows) {
    if (row.a === row.b) continue;
    const pair = pairFor(row.a, row.b);
    const forward = row.a === pair.a;
    if (row.kind === "ally_confirmed") pair.confirmed = true;
    if (row.kind === "contact") pair.contact += row.count;
    if (row.kind === "guest") {
      pair.guest[forward ? "ab" : "ba"] += row.count;
      pair.guest.ships = Math.max(pair.guest.ships, row.ships);
      pair.guest.lastTick = Math.max(pair.guest.lastTick, row.lastTick);
      pair.guest.samples.push(...row.samples);
    }
    if (row.kind === "en_route") {
      pair.route[forward ? "ab" : "ba"] += row.count;
      pair.route[forward ? "shipsAB" : "shipsBA"] = Math.max(pair.route[forward ? "shipsAB" : "shipsBA"], row.ships);
      pair.route.lastTick = Math.max(pair.route.lastTick, row.lastTick);
      pair.route.samples.push(...row.samples);
    }
    if (row.kind === "capture") {
      pair.captures[forward ? "ab" : "ba"] += row.count;
      pair.captures.lastTick = Math.max(pair.captures.lastTick, row.lastTick);
    }
    if (row.kind === "tech_trade") pair.trade[forward ? "ab" : "ba"] += row.weight;
  }

  const contactThreshold = Math.max(3, Math.min(12, Math.round(snapshotsProcessed * 0.25)));
  const scored = [...pairs.values()].map((pair) => scorePair(pair, { contactThreshold, latestTick }));
  const meaningful = scored.filter((pair) => pair.status !== "none");

  const active = new Map(players.map((player) => [player.uid, player]));
  const teams = findTeams(meaningful.filter((pair) => pair.allied), active);

  return {
    coverage: { snapshotsProcessed, latestTick },
    viewerUid,
    pairs: meaningful.sort((left, right) => right.allyScore + right.warScore - (left.allyScore + left.warScore)),
    teams,
    events: events.map((event) => ({ ...event }))
  };
}

function scorePair(pair, { contactThreshold, latestTick }) {
  const guestTotal = pair.guest.ab + pair.guest.ba;
  const mutualGuests = pair.guest.ab > 0 && pair.guest.ba > 0;
  const tradeTotal = pair.trade.ab + pair.trade.ba;
  const captureTotal = pair.captures.ab + pair.captures.ba;
  const routeTotal = pair.route.ab + pair.route.ba;

  let allyScore = 0;
  if (pair.confirmed) {
    allyScore = 1;
  } else {
    allyScore = 1 - Math.exp(-guestTotal / 2);
    if (mutualGuests) allyScore += 0.2;
    allyScore += Math.min(0.3, tradeTotal * 0.15);
  }

  // Stars taken after the last friendly visit mean the alliance (if any) ended.
  const betrayed = guestTotal > 0 && pair.captures.lastTick > pair.guest.lastTick;
  if (betrayed && !pair.confirmed) allyScore *= 0.2;

  const peaceful = pair.contact >= contactThreshold && captureTotal === 0 && routeTotal === 0;
  if (peaceful) allyScore = Math.max(allyScore, 0.2);
  allyScore = Math.min(1, allyScore);

  // Fleets heading at an ally's stars are reinforcements, not attacks.
  const hostileRoutes = allyScore >= 0.6 ? 0 : routeTotal;
  const warScore = Math.min(1, 1 - Math.exp(-(captureTotal + hostileRoutes * 0.15) / 2));

  let status = "none";
  if (pair.confirmed) status = "allied";
  else if (betrayed) status = "former_allies";
  else if (allyScore >= 0.6) status = "allied";
  else if (warScore >= 0.3 && captureTotal > 0) status = "war";
  else if (allyScore >= 0.3) status = "possible_allies";
  else if (hostileRoutes > 0) status = "tension";
  else if (peaceful) status = "peaceful";

  const warActive = captureTotal > 0 && latestTick - pair.captures.lastTick <= 24;

  return {
    a: pair.a,
    b: pair.b,
    status,
    allied: status === "allied",
    confirmed: pair.confirmed,
    allyScore: round(allyScore),
    warScore: round(warScore),
    warActive,
    evidence: {
      guestAB: pair.guest.ab,
      guestBA: pair.guest.ba,
      guestShips: pair.guest.ships,
      guestStars: [...new Set(pair.guest.samples)].slice(0, 6),
      routeAB: pair.route.ab,
      routeBA: pair.route.ba,
      routeStars: [...new Set(pair.route.samples)].slice(0, 6),
      capturesAB: pair.captures.ab,
      capturesBA: pair.captures.ba,
      lastCaptureTick: pair.captures.lastTick,
      tradeAB: round(pair.trade.ab),
      tradeBA: round(pair.trade.ba),
      contact: pair.contact
    }
  };
}

// Connected groups of allied players. Chains (A-B, B-C) still form one team,
// so each team reports how many of its possible pairs are directly linked.
function findTeams(alliedPairs, players) {
  const parent = new Map();
  const find = (uid) => {
    if (!parent.has(uid)) parent.set(uid, uid);
    let root = uid;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(uid, root);
    return root;
  };
  for (const pair of alliedPairs) parent.set(find(pair.a), find(pair.b));

  const groups = new Map();
  for (const uid of parent.keys()) {
    const root = find(uid);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(uid);
  }

  return [...groups.values()]
    .filter((members) => members.length >= 2)
    .map((members) => {
      const memberSet = new Set(members);
      const links = alliedPairs.filter((pair) => memberSet.has(pair.a) && memberSet.has(pair.b));
      const possible = (members.length * (members.length - 1)) / 2;
      const stars = members.reduce((sum, uid) => sum + Number(players.get(uid)?.totalStars || 0), 0);
      const ships = members.reduce((sum, uid) => sum + Number(players.get(uid)?.totalStrength || 0), 0);
      return {
        members: members.sort((left, right) => Number(players.get(right)?.totalStars || 0) - Number(players.get(left)?.totalStars || 0)),
        links: links.length,
        density: round(links.length / possible),
        confidence: round(links.reduce((sum, pair) => sum + pair.allyScore, 0) / links.length),
        confirmed: links.some((pair) => pair.confirmed),
        stars,
        ships
      };
    })
    .sort((left, right) => right.stars - left.stars);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
