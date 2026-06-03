export const TECH_NAMES = {
  0: 'Banking',
  1: 'Experimentation',
  2: 'Manufacturing',
  3: 'Range',
  4: 'Scanning',
  5: 'Weapons',
  6: 'Terraforming',
};

export function summarize(snapshot) {
  const data = snapshot?.data || {};
  const players = Object.values(data.players || {}).sort((a, b) => b.totalStars - a.totalStars);
  const stars = Object.values(data.stars || data.galaxy?.stars || {});
  const fleets = Object.values(data.fleets || data.carriers || data.galaxy?.fleets || {});

  return {
    gameName: snapshot?.gameName || data.name || 'Unknown game',
    tick: data.tick ?? snapshot?.tick ?? 0,
    productionCounter: data.productionCounter ?? 0,
    productionRate: data.productionRate ?? 0,
    playerUid: data.playerUid,
    players,
    stars,
    fleets,
  };
}

export function diffSnapshots(previous, current) {
  if (!previous || !current) return [];
  const events = [];
  const prevPlayers = previous.data?.players || {};
  const currPlayers = current.data?.players || {};

  for (const [uid, player] of Object.entries(currPlayers)) {
    const prev = prevPlayers[uid];
    if (!prev) {
      events.push(event('player_new', `${player.alias || `Player ${uid}`} appeared in scan data.`, 'info'));
      continue;
    }

    addNumberDelta(events, player, prev, 'totalStrength', 'ships');
    addNumberDelta(events, player, prev, 'totalStars', 'stars');
    addNumberDelta(events, player, prev, 'totalEconomy', 'economy');
    addNumberDelta(events, player, prev, 'totalIndustry', 'industry');
    addNumberDelta(events, player, prev, 'totalScience', 'science');

    for (const [kind, tech] of Object.entries(player.tech || {})) {
      const prevLevel = prev.tech?.[kind]?.level;
      if (typeof prevLevel === 'number' && tech.level > prevLevel) {
        events.push(event('tech_up', `${player.alias || `Player ${uid}`} upgraded ${TECH_NAMES[kind] || `Tech ${kind}`} from ${prevLevel} to ${tech.level}.`, 'success'));
      }
    }
  }

  diffStars(events, previous, current);
  diffFleets(events, previous, current);

  return events.slice(0, 80);
}

function addNumberDelta(events, player, prev, field, label) {
  const before = Number(prev[field] ?? 0);
  const after = Number(player[field] ?? 0);
  const delta = after - before;
  if (delta !== 0) {
    const sign = delta > 0 ? 'gained' : 'lost';
    const tone = delta > 0 ? 'success' : 'danger';
    events.push(event(field, `${player.alias || `Player ${player.uid}`} ${sign} ${Math.abs(delta)} ${label} since last scan.`, tone));
  }
}

function diffStars(events, previous, current) {
  const prevStars = previous.data?.stars || previous.data?.galaxy?.stars || {};
  const currStars = current.data?.stars || current.data?.galaxy?.stars || {};
  const currPlayers = current.data?.players || {};
  const prevPlayers = previous.data?.players || {};

  for (const [uid, star] of Object.entries(currStars)) {
    const prev = prevStars[uid];
    const name = starName(star, uid);
    if (!prev) {
      events.push(event('star_seen', `${name} appeared in scan data under ${ownerName(starOwner(star), currPlayers)} control.`, 'info'));
      continue;
    }

    const beforeOwnerUid = starOwner(prev);
    const afterOwnerUid = starOwner(star);
    if (beforeOwnerUid !== afterOwnerUid) {
      const beforeOwner = ownerName(beforeOwnerUid, prevPlayers);
      const afterOwner = ownerName(afterOwnerUid, currPlayers);
      events.push(event('star_owner', `${name} changed owner from ${beforeOwner} to ${afterOwner}.`, 'warning'));
    }

    const beforeShips = starShips(prev);
    const afterShips = starShips(star);
    if (beforeShips !== undefined && afterShips !== undefined && beforeShips !== afterShips) {
      const delta = afterShips - beforeShips;
      const verb = delta > 0 ? 'gained' : 'lost';
      const tone = delta > 0 ? 'success' : 'danger';
      events.push(event('star_ships', `${name} ${verb} ${Math.abs(delta)} stationed ships.`, tone));
    }
  }
}

function diffFleets(events, previous, current) {
  const prevFleets = previous.data?.fleets || previous.data?.carriers || previous.data?.galaxy?.fleets || {};
  const currFleets = current.data?.fleets || current.data?.carriers || current.data?.galaxy?.fleets || {};

  for (const [uid, fleet] of Object.entries(currFleets)) {
    const prev = prevFleets[uid];
    if (!prev) continue;
    const prevDestination = firstDestination(prev);
    const currDestination = firstDestination(fleet);
    if (prevDestination && currDestination && prevDestination !== currDestination) {
      events.push(event('fleet_route', `${fleet.n || fleet.name || `Fleet ${uid}`} changed destination from Star ${prevDestination} to Star ${currDestination}.`, 'warning'));
    }
  }
}

function firstDestination(fleet) {
  const firstOrder = Array.isArray(fleet.o) ? fleet.o[0] : Array.isArray(fleet.orders) ? fleet.orders[0] : undefined;
  return firstOrder?.[1] ?? firstOrder?.starId ?? firstOrder?.planetId;
}

function starOwner(star) {
  return star?.playerUid ?? star?.puid ?? star?.playerId ?? star?.owner ?? star?.ownedBy;
}

function starShips(star) {
  const value = star?.ships ?? star?.st ?? star?.totalStrength;
  return value === undefined ? undefined : Number(value);
}

function starName(star, uid) {
  return star?.n || star?.name || `Star ${uid}`;
}

function ownerName(uid, players) {
  if (uid === undefined || uid === null || Number(uid) < 0) return 'unowned';
  return players?.[uid]?.alias || `Player ${uid}`;
}

function event(type, message, tone) {
  return { type, message, tone };
}
