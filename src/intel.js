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
      events.push(event('player_new', `${player.alias || `Player ${uid}`} appeared in scan data.`, 'info', { playerUid: uid }));
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
        events.push(event('tech_up', `${player.alias || `Player ${uid}`} upgraded ${TECH_NAMES[kind] || `Tech ${kind}`} from ${prevLevel} to ${tech.level}.`, 'success', {
          playerUid: uid,
          playerName: player.alias || `Player ${uid}`,
          tech: TECH_NAMES[kind] || `Tech ${kind}`,
          from: prevLevel,
          to: tech.level,
        }));
      }
    }
  }

  diffStars(events, previous, current);
  diffFleets(events, previous, current);

  return events.slice(0, 80);
}

export function strategicIntel(summary, events) {
  const players = summary.players || [];
  const insights = [];

  const captures = events.filter((item) => item.type === 'star_owner' && item.details?.beforeOwnerUid !== item.details?.afterOwnerUid);
  const playerDeltaEvents = events.filter((item) => item.details?.playerName);

  const capturesByPlayer = groupCounts(captures, (item) => item.details.afterOwnerName);
  for (const [name, count] of capturesByPlayer) {
    insights.push(intel('offensive', `${name} is expanding by conquest.`, `${name} captured ${count} known star${count === 1 ? '' : 's'} in the selected comparison window.`, 'danger'));
  }

  const lossesByPlayer = groupCounts(captures, (item) => item.details.beforeOwnerName);
  for (const [name, count] of lossesByPlayer) {
    if (name === 'unowned') continue;
    insights.push(intel('pressure', `${name} is under pressure.`, `${name} lost ${count} known star${count === 1 ? '' : 's'} in the selected comparison window.`, 'warning'));
  }

  const shipLosses = playerDeltaEvents
    .filter((item) => item.type === 'totalStrength' && item.details.delta < 0)
    .sort((a, b) => a.details.delta - b.details.delta);
  for (const item of shipLosses.slice(0, 3)) {
    insights.push(intel('combat', `${item.details.playerName} probably fought or overextended.`, `${item.details.playerName} lost ${Math.abs(item.details.delta)} total ships between the selected scans.`, 'warning'));
  }

  const builders = playerDeltaEvents
    .filter((item) => ['totalEconomy', 'totalIndustry', 'totalScience'].includes(item.type) && item.details.delta > 0)
    .reduce((acc, item) => {
      const entry = acc.get(item.details.playerName) || { name: item.details.playerName, economy: 0, industry: 0, science: 0 };
      if (item.type === 'totalEconomy') entry.economy += item.details.delta;
      if (item.type === 'totalIndustry') entry.industry += item.details.delta;
      if (item.type === 'totalScience') entry.science += item.details.delta;
      acc.set(item.details.playerName, entry);
      return acc;
    }, new Map());
  for (const entry of [...builders.values()].filter((item) => item.economy + item.industry + item.science > 0).slice(0, 4)) {
    const focus = topInvestment(entry);
    insights.push(intel('economy', `${entry.name} is investing in ${focus}.`, investmentSummary(entry), 'success'));
  }

  for (const item of events.filter((eventItem) => eventItem.type === 'tech_up').slice(0, 5)) {
    insights.push(intel('tech', `${item.details.playerName} changed strategic capability.`, `${item.details.tech} advanced from ${item.details.from} to ${item.details.to}.`, 'info'));
  }

  for (const relation of visibleWarRelations(players).slice(0, 8)) {
    insights.push(intel('war', `${relation.player} has visible war/diplomacy tension.`, relation.description, relation.tone));
  }

  if (insights.length === 0) {
    insights.push(intel('quiet', 'No major strategic change detected yet.', 'Once hourly scans capture different ticks, this panel will highlight captures, pressure, ship losses, investment focus, tech spikes, and visible wars.', 'info'));
  }

  return insights.slice(0, 12);
}

function addNumberDelta(events, player, prev, field, label) {
  const before = Number(prev[field] ?? 0);
  const after = Number(player[field] ?? 0);
  const delta = after - before;
  if (delta !== 0) {
    const sign = delta > 0 ? 'gained' : 'lost';
    const tone = delta > 0 ? 'success' : 'danger';
    events.push(event(field, `${player.alias || `Player ${player.uid}`} ${sign} ${Math.abs(delta)} ${label} since last scan.`, tone, {
      playerUid: player.uid,
      playerName: player.alias || `Player ${player.uid}`,
      field,
      label,
      before,
      after,
      delta,
    }));
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
      const ownerUid = starOwner(star);
      events.push(event('star_seen', `${name} appeared in scan data under ${ownerName(ownerUid, currPlayers)} control.`, 'info', {
        starUid: uid,
        starName: name,
        ownerUid,
        ownerName: ownerName(ownerUid, currPlayers),
      }));
      continue;
    }

    const beforeOwnerUid = starOwner(prev);
    const afterOwnerUid = starOwner(star);
    if (beforeOwnerUid !== afterOwnerUid) {
      const beforeOwner = ownerName(beforeOwnerUid, prevPlayers);
      const afterOwner = ownerName(afterOwnerUid, currPlayers);
      events.push(event('star_owner', `${name} changed owner from ${beforeOwner} to ${afterOwner}.`, 'warning', {
        starUid: uid,
        starName: name,
        beforeOwnerUid,
        afterOwnerUid,
        beforeOwnerName: beforeOwner,
        afterOwnerName: afterOwner,
      }));
    }

    const beforeShips = starShips(prev);
    const afterShips = starShips(star);
    if (beforeShips !== undefined && afterShips !== undefined && beforeShips !== afterShips) {
      const delta = afterShips - beforeShips;
      const verb = delta > 0 ? 'gained' : 'lost';
      const tone = delta > 0 ? 'success' : 'danger';
      events.push(event('star_ships', `${name} ${verb} ${Math.abs(delta)} stationed ships.`, tone, {
        starUid: uid,
        starName: name,
        before: beforeShips,
        after: afterShips,
        delta,
      }));
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
      events.push(event('fleet_route', `${fleet.n || fleet.name || `Fleet ${uid}`} changed destination from Star ${prevDestination} to Star ${currDestination}.`, 'warning', {
        fleetUid: uid,
        fleetName: fleet.n || fleet.name || `Fleet ${uid}`,
        from: prevDestination,
        to: currDestination,
      }));
    }
  }
}

function visibleWarRelations(players) {
  return players.flatMap((player) => Object.entries(player.war || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([otherUid, value]) => ({
      player: player.alias || `Player ${player.uid}`,
      description: `Visible relation toward Player ${otherUid}: war state ${value}.`,
      tone: Number(value) >= 3 ? 'danger' : 'warning',
    })));
}

function topInvestment(entry) {
  const choices = [
    ['economy', entry.economy],
    ['industry', entry.industry],
    ['science', entry.science],
  ].sort((a, b) => b[1] - a[1]);
  return choices[0][0];
}

function investmentSummary(entry) {
  const parts = [];
  if (entry.economy) parts.push(`economy +${entry.economy}`);
  if (entry.industry) parts.push(`industry +${entry.industry}`);
  if (entry.science) parts.push(`science +${entry.science}`);
  return parts.join(', ');
}

function groupCounts(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
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

function intel(type, title, detail, tone) {
  return { type, title, detail, tone };
}

function event(type, message, tone, details = {}) {
  return { type, message, tone, details };
}
