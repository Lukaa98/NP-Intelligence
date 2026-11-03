// Incoming-attack detection for the API key owner ("viewer"). Pure: takes one
// scan's scanning_data and returns the enemy fleets heading at the viewer's
// stars, so it can be unit tested and run after every new tick.
//
// A threat is any fleet not owned by the viewer or a formal ally that either
//   - has a route (fleet.o) whose next stops include one of the viewer's
//     stars ("route": certain), or
//   - has no visible route but is flying straight at one of the viewer's
//     stars, judged from its last and current position ("heading": likely).

const WEAPONS_TECH = "5";
const HEADING_MAX_ANGLE = (8 * Math.PI) / 180;
const HEADING_MAX_TICKS = 48;

export function detectThreats(data) {
  const viewer = Number(data.playerUid ?? data.player_uid ?? -1);
  const players = data.players || {};
  const stars = data.stars || {};
  const fleets = Object.values(data.fleets || {});
  if (!players[viewer]) return [];

  const allies = new Set(Object.entries(players[viewer].war || {})
    .filter(([, value]) => Number(value) === 0)
    .map(([uid]) => Number(uid)));
  const myStars = Object.values(stars).filter((star) => star.puid === viewer);
  if (!myStars.length) return [];
  const myStarIds = new Set(myStars.map((star) => star.uid));
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

    let target = null;
    let distance = 0;
    let kind = "route";
    let position = { x: fleet.x, y: fleet.y };
    for (const order of Array.isArray(fleet.o) ? fleet.o : []) {
      const stop = stars[Array.isArray(order) ? order[1] : -1];
      if (!stop) break;
      distance += Math.hypot(stop.x - position.x, stop.y - position.y);
      position = stop;
      if (myStarIds.has(stop.uid)) {
        target = stop;
        break;
      }
    }

    if (!target && !(fleet.o || []).length) {
      const heading = headingTarget(fleet, myStars, speed);
      if (heading) {
        target = heading.star;
        distance = heading.distance;
        kind = "heading";
      }
    }
    if (!target) continue;

    const etaTicks = Math.max(1, Math.ceil(distance / speed));
    const defenders = Number(target.st || 0) + fleets
      .filter((other) => other.puid === viewer && other.x === target.x && other.y === target.y)
      .reduce((sum, other) => sum + Number(other.st || 0), 0);
    // Rough NP combat: the defender fires first with +1 weapons. Compare how
    // many rounds each side needs to destroy the other.
    const attackRounds = defenders / Math.max(weapons(owner), 1);
    const defendRounds = ships / Math.max(weapons(viewer) + 1, 1);
    const verdict = defenders === 0 ? "undefended" : attackRounds < defendRounds ? "likely_falls" : "likely_holds";

    threats.push({
      key: `${fleet.uid}:${target.uid}`,
      kind,
      fleetUid: fleet.uid,
      fleetName: fleet.n || `Fleet ${fleet.uid}`,
      ownerUid: owner,
      ownerAlias: players[owner]?.alias || `Player ${owner}`,
      ships,
      targetUid: target.uid,
      targetName: target.n || `Star ${target.uid}`,
      etaTicks,
      etaMinutes: etaTicks * tickMinutes,
      defenders,
      verdict
    });
  }
  return threats.sort((x, y) => x.etaTicks - y.etaTicks);
}

// Fleet with no visible route: if its movement since the last tick points at
// one of the viewer's stars (within a few degrees) and it would get there
// within two days, treat that star as the likely target.
function headingTarget(fleet, myStars, speed) {
  const dx = fleet.x - (fleet.lx ?? fleet.x);
  const dy = fleet.y - (fleet.ly ?? fleet.y);
  const moved = Math.hypot(dx, dy);
  if (moved < 1e-6) return null;
  let best = null;
  for (const star of myStars) {
    const tx = star.x - fleet.x;
    const ty = star.y - fleet.y;
    const distance = Math.hypot(tx, ty);
    if (!distance || distance / speed > HEADING_MAX_TICKS) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * tx + dy * ty) / (moved * distance))));
    if (angle <= HEADING_MAX_ANGLE && (!best || distance < best.distance)) best = { star, distance };
  }
  return best;
}
