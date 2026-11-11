// Incoming-attack detection for the API key owner ("viewer"). Pure: takes one
// scan's scanning_data and returns the enemy fleets heading at the viewer's
// stars, so it can be unit tested and run after every new tick.
//
// A threat is any fleet not owned by the viewer or a formal ally whose route
// (fleet.o) includes one of the viewer's stars, at any stop: fleets stop at
// every star on their route. Fleets without a visible route are not guessed
// at: their last movement is not a reliable sign of where they go next.

const WEAPONS_TECH = "5";
// Fleets smaller than this share of the defence at their target (scouts,
// leftovers) are not worth an alert.
export const MIN_SHARE_OF_DEFENCE = 0.05;

export function isNegligible(ships, defenders) {
  return defenders > 0 && ships < defenders * MIN_SHARE_OF_DEFENCE;
}

export function detectThreats(data) {
  const viewer = Number(data.playerUid ?? data.player_uid ?? -1);
  const players = data.players || {};
  const stars = data.stars || {};
  const fleets = Object.values(data.fleets || {});
  if (!players[viewer]) return [];

  const allies = new Set(Object.entries(players[viewer].war || {})
    .filter(([, value]) => Number(value) === 0)
    .map(([uid]) => Number(uid)));
  const myStarIds = new Set(Object.values(stars).filter((star) => star.puid === viewer).map((star) => star.uid));
  if (!myStarIds.size) return [];
  const starAt = new Map(Object.values(stars).map((star) => [`${star.x},${star.y}`, star]));
  const defaultSpeed = Number(data.fleetSpeed || data.fleet_speed || 1 / 24);
  const tickMinutes = Number(data.tickRate || data.tick_rate || 60);
  const weapons = (uid) => Number(players[uid]?.tech?.[WEAPONS_TECH]?.level ?? 1);

  const threats = [];
  for (const fleet of fleets) {
    const owner = Number(fleet.puid);
    if (!(owner >= 0) || owner === viewer || allies.has(owner)) continue;
    const ships = Number(fleet.st || 0);
    if (!ships) continue;
    const speed = Number(fleet.speed) > 0 ? Number(fleet.speed) : defaultSpeed;

    // Walk the route stop by stop until it reaches one of the viewer's stars.
    let target = null;
    let distance = 0;
    let position = { x: fleet.x, y: fleet.y };
    const route = [];
    for (const order of Array.isArray(fleet.o) ? fleet.o : []) {
      const stop = stars[Array.isArray(order) ? order[1] : -1];
      if (!stop) break;
      distance += Math.hypot(stop.x - position.x, stop.y - position.y);
      position = stop;
      route.push({ uid: stop.uid, name: stop.n || `Star ${stop.uid}` });
      if (myStarIds.has(stop.uid)) {
        target = stop;
        break;
      }
    }
    if (!target) continue;

    const etaTicks = Math.max(1, Math.ceil(distance / speed));
    const defenders = Number(target.st || 0) + fleets
      .filter((other) => other.puid === viewer && other.x === target.x && other.y === target.y)
      .reduce((sum, other) => sum + Number(other.st || 0), 0);
    if (isNegligible(ships, defenders)) continue;
    // Rough NP combat: the defender fires first with +1 weapons. Compare how
    // many rounds each side needs to destroy the other.
    const attackRounds = defenders / Math.max(weapons(owner), 1);
    const defendRounds = ships / Math.max(weapons(viewer) + 1, 1);
    const verdict = defenders === 0 ? "undefended" : attackRounds < defendRounds ? "likely_falls" : "likely_holds";

    // Where it is now: at a star (orbiting / just left) or in deep space.
    const here = starAt.get(`${fleet.x},${fleet.y}`);
    const origin = here ? { name: here.n, at: true } : { name: nearestStarName(stars, fleet), at: false };

    threats.push({
      key: `${fleet.uid}:${target.uid}`,
      kind: "route",
      fleetUid: fleet.uid,
      fleetName: fleet.n || `Fleet ${fleet.uid}`,
      ownerUid: owner,
      ownerAlias: players[owner]?.alias || `Player ${owner}`,
      ships,
      targetUid: target.uid,
      targetName: target.n || `Star ${target.uid}`,
      route,
      origin,
      etaTicks,
      etaMinutes: etaTicks * tickMinutes,
      defenders,
      verdict
    });
  }
  return threats.sort((x, y) => x.etaTicks - y.etaTicks);
}

function nearestStarName(stars, fleet) {
  let best = null;
  let bestDistance = Infinity;
  for (const star of Object.values(stars)) {
    const distance = Math.hypot(star.x - fleet.x, star.y - fleet.y);
    if (distance < bestDistance) {
      best = star;
      bestDistance = distance;
    }
  }
  return best?.n || "deep space";
}
