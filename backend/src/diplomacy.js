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
        confirmedLastTick: -1,
        guest: { ab: 0, ba: 0, ships: 0, lastTick: -1, samples: [] },
        route: { ab: 0, ba: 0, shipsAB: 0, shipsBA: 0, lastTick: -1, samples: [] },
        captures: { ab: 0, ba: 0, lastTick: -1 },
        trade: { ab: 0, ba: 0 },
        contact: 0
      });
    }
    return pairs.get(key);
  };

  // Formal alliances are current if seen in the latest scan that reported
  // them at all (the game-over scan doesn't).
  const census = rows.find((row) => row.kind === "ally_census")?.lastTick ?? latestTick;

  for (const row of rows) {
    if (row.a === row.b) continue;
    const pair = pairFor(row.a, row.b);
    const forward = row.a === pair.a;
    if (row.kind === "ally_confirmed") {
      // Only an alliance present in the newest scan is current.
      pair.confirmedLastTick = Math.max(pair.confirmedLastTick, row.lastTick);
      pair.confirmed = pair.confirmedLastTick >= census;
    }
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
  const teams = findTeams(meaningful, active);
  const conflicts = findConflicts(meaningful.filter((pair) => pair.status === "war"), teams);

  return {
    coverage: { snapshotsProcessed, latestTick },
    viewerUid,
    pairs: meaningful.sort((left, right) => right.allyScore + right.warScore - (left.allyScore + left.warScore)),
    teams,
    conflicts,
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
  } else if (pair.confirmedLastTick >= 0) {
    allyScore = 0.3;
  } else {
    allyScore = 1 - Math.exp(-guestTotal / 2);
    if (mutualGuests) allyScore += 0.2;
    allyScore += Math.min(0.3, tradeTotal * 0.15);
  }

  // Stars taken after the last friendly visit, or a formal alliance that no
  // longer exists, mean the alliance ended.
  const lastFriendly = Math.max(pair.guest.lastTick, pair.confirmedLastTick);
  const betrayed = (guestTotal > 0 || pair.confirmedLastTick >= 0) && !pair.confirmed
    && (pair.captures.lastTick > lastFriendly || (pair.confirmedLastTick >= 0 && guestTotal === 0));
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

// Groups allied players into teams by merging the strongest alliances first.
// Two groups never merge if any pair across them is at war (or used to be
// allied and fell out), which stops one weak link chaining rival blocs
// together. Each team reports how many of its pairs are directly linked.
function findTeams(pairs, players) {
  const byKey = new Map(pairs.map((pair) => [`${pair.a}:${pair.b}`, pair]));
  const relation = (x, y) => byKey.get(`${Math.min(x, y)}:${Math.max(x, y)}`);
  const hostile = (pair) => pair && ["war", "former_allies"].includes(pair.status);

  const teamOf = new Map();
  const teams = [];
  for (const pair of pairs.filter((item) => item.allied).sort((left, right) => right.allyScore - left.allyScore)) {
    const left = teamOf.get(pair.a);
    const right = teamOf.get(pair.b);
    if (left && left === right) continue;
    const leftMembers = left ? left.members : [pair.a];
    const rightMembers = right ? right.members : [pair.b];
    const clash = leftMembers.some((x) => rightMembers.some((y) => hostile(relation(x, y))));
    if (clash) continue;

    const merged = left || right || { members: [] };
    for (const uid of [...leftMembers, ...rightMembers]) {
      if (!merged.members.includes(uid)) merged.members.push(uid);
      teamOf.set(uid, merged);
    }
    if (left && right && left !== right) teams.splice(teams.indexOf(right), 1);
    if (!teams.includes(merged)) teams.push(merged);
  }

  return teams
    .map(({ members }) => {
      const links = [];
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          const pair = relation(members[i], members[j]);
          if (pair?.allied) links.push(pair);
        }
      }
      const possible = (members.length * (members.length - 1)) / 2;
      const stars = members.reduce((sum, uid) => sum + Number(players.get(uid)?.totalStars || 0), 0);
      const ships = members.reduce((sum, uid) => sum + Number(players.get(uid)?.totalStrength || 0), 0);
      return {
        members: members.sort((x, y) => Number(players.get(y)?.totalStars || 0) - Number(players.get(x)?.totalStars || 0)),
        links: links.length,
        density: round(links.length / possible),
        confidence: round(links.reduce((sum, pair) => sum + pair.allyScore, 0) / Math.max(links.length, 1)),
        confirmed: links.some((pair) => pair.confirmed),
        stars,
        ships
      };
    })
    .sort((left, right) => right.stars - left.stars);
}

// Merges pairwise wars into conflicts read from one side's point of view:
// whoever fights the most enemies becomes the centre ("A vs B + C"), then the
// next, until every war is used exactly once. Known teams count as one side.
// No transitive chaining: A vs B and B vs C never make A and C a side.
function findConflicts(wars, teams) {
  const unitOf = new Map();
  teams.forEach((team, index) => team.members.forEach((uid) => unitOf.set(uid, `t${index}`)));
  const unitKey = (uid) => unitOf.get(uid) || `p${uid}`;
  const unitMembers = (key) => (key.startsWith("t") ? teams[Number(key.slice(1))].members : [Number(key.slice(1))]);

  // Fold player-level wars into unit-level fronts, oriented low key -> high key.
  const fronts = new Map();
  for (const pair of wars) {
    const ua = unitKey(pair.a);
    const ub = unitKey(pair.b);
    if (ua === ub) continue;
    const [left, right] = ua < ub ? [ua, ub] : [ub, ua];
    const flip = left !== ua;
    const key = `${left}|${right}`;
    const front = fronts.get(key) || { left, right, leftTook: 0, rightTook: 0, active: false, lastTick: -1, pairs: [] };
    front.leftTook += flip ? pair.evidence.capturesBA : pair.evidence.capturesAB;
    front.rightTook += flip ? pair.evidence.capturesAB : pair.evidence.capturesBA;
    front.active ||= pair.warActive;
    front.lastTick = Math.max(front.lastTick, pair.evidence.lastCaptureTick);
    front.pairs.push(pair);
    fronts.set(key, front);
  }

  const remaining = new Set(fronts.keys());
  const conflicts = [];
  while (remaining.size) {
    const degree = new Map();
    for (const key of remaining) {
      const front = fronts.get(key);
      for (const unit of [front.left, front.right]) {
        const entry = degree.get(unit) || { count: 0, active: 0, captures: 0 };
        entry.count += 1;
        entry.active += front.active ? 1 : 0;
        entry.captures += front.leftTook + front.rightTook;
        degree.set(unit, entry);
      }
    }
    const [hub] = [...degree.entries()].sort((x, y) =>
      y[1].count - x[1].count || y[1].active - x[1].active || y[1].captures - x[1].captures)[0];

    const enemies = [];
    for (const key of [...remaining]) {
      const front = fronts.get(key);
      if (front.left !== hub && front.right !== hub) continue;
      const hubIsLeft = front.left === hub;
      enemies.push({
        members: unitMembers(hubIsLeft ? front.right : front.left),
        took: hubIsLeft ? front.leftTook : front.rightTook,
        lost: hubIsLeft ? front.rightTook : front.leftTook,
        active: front.active,
        lastTick: front.lastTick
      });
      remaining.delete(key);
    }
    enemies.sort((x, y) => Number(y.active) - Number(x.active) || (y.took + y.lost) - (x.took + x.lost));
    conflicts.push({
      side: unitMembers(hub),
      enemies,
      took: enemies.reduce((sum, enemy) => sum + enemy.took, 0),
      lost: enemies.reduce((sum, enemy) => sum + enemy.lost, 0),
      active: enemies.some((enemy) => enemy.active),
      lastTick: Math.max(...enemies.map((enemy) => enemy.lastTick))
    });
  }

  return conflicts.sort((x, y) => Number(y.active) - Number(x.active) || (y.took + y.lost) - (x.took + x.lost));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
