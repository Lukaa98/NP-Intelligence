export const TECH_NAMES = {
  0: "Banking",
  1: "Experimentation",
  2: "Manufacturing",
  3: "Range",
  4: "Scanning",
  5: "Weapons",
  6: "Terraforming"
};

export function summarize(snapshot) {
  const data = snapshot?.data || {};
  const players = Object.values(data.players || {}).sort((left, right) => (right.totalStars || 0) - (left.totalStars || 0));
  const stars = Object.values(data.stars || data.galaxy?.stars || {});
  const fleets = Object.values(data.fleets || data.carriers || data.galaxy?.fleets || {});

  return {
    gameName: snapshot?.gameName || data.name || "Unknown game",
    tick: data.tick ?? snapshot?.tick ?? 0,
    productionCounter: data.productionCounter ?? 0,
    productionRate: data.productionRate ?? 0,
    playerUid: data.playerUid,
    players,
    stars,
    fleets
  };
}

export function diffSnapshots(previous, current) {
  if (!previous || !current) {
    return [];
  }

  const events = [];
  const previousPlayers = previous.data?.players || {};
  const currentPlayers = current.data?.players || {};

  for (const [uid, player] of Object.entries(currentPlayers)) {
    const prior = previousPlayers[uid];
    if (!prior) {
      events.push(event("player_new", `${mentionPlayer(player.alias || `Player ${uid}`)} appeared in scan data.`, "info", { playerUid: uid }));
      continue;
    }

    addNumberDelta(events, player, prior, "totalStrength", "ships");
    addNumberDelta(events, player, prior, "totalStars", "stars");
    addNumberDelta(events, player, prior, "totalEconomy", "economy");
    addNumberDelta(events, player, prior, "totalIndustry", "industry");
    addNumberDelta(events, player, prior, "totalScience", "science");

    for (const [kind, tech] of Object.entries(player.tech || {})) {
      const previousLevel = prior.tech?.[kind]?.level;
      if (typeof previousLevel === "number" && tech.level > previousLevel) {
        events.push(event("tech_up", `${mentionPlayer(player.alias || `Player ${uid}`)} upgraded ${TECH_NAMES[kind] || `Tech ${kind}`} from ${previousLevel} to ${tech.level}.`, "success", {
          playerUid: uid,
          playerName: player.alias || `Player ${uid}`,
          tech: TECH_NAMES[kind] || `Tech ${kind}`,
          from: previousLevel,
          to: tech.level
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

  const captures = events.filter((item) => item.type === "star_owner" && item.details?.beforeOwnerUid !== item.details?.afterOwnerUid);
  const playerDeltaEvents = events.filter((item) => item.details?.playerName);
  const capturePairs = summarizeCapturePairs(captures);
  for (const item of capturePairs.slice(0, 6)) {
    insights.push(intel(
      "capture",
      `${mentionPlayer(item.loserName)} lost ${item.starCount} planet${item.starCount === 1 ? "" : "s"} to ${mentionPlayer(item.winnerName)}.`,
      `${mentionPlayer(item.winnerName)} took ${mentionStarList(item.starNames)} from ${mentionPlayer(item.loserName)}.`,
      "danger"
    ));
  }

  const shipLosses = playerDeltaEvents
    .filter((item) => item.type === "totalStrength" && item.details.delta < 0)
    .sort((left, right) => left.details.delta - right.details.delta);
  for (const item of shipLosses.slice(0, 5)) {
    const capturePressure = capturePressureText(item.details.playerName, capturePairs);
    insights.push(intel(
      "combat",
      `${mentionPlayer(item.details.playerName)} lost ${Math.abs(item.details.delta)} ships in the selected window.`,
      capturePressure || `${mentionPlayer(item.details.playerName)} dropped from ${item.details.before} to ${item.details.after} total ships.`,
      "warning"
    ));
  }

  const builders = playerDeltaEvents
    .filter((item) => ["totalEconomy", "totalIndustry", "totalScience"].includes(item.type) && item.details.delta > 0)
    .reduce((accumulator, item) => {
      const current = accumulator.get(item.details.playerName) || { name: item.details.playerName, economy: 0, industry: 0, science: 0 };
      if (item.type === "totalEconomy") current.economy += item.details.delta;
      if (item.type === "totalIndustry") current.industry += item.details.delta;
      if (item.type === "totalScience") current.science += item.details.delta;
      accumulator.set(item.details.playerName, current);
      return accumulator;
    }, new Map());
  for (const item of [...builders.values()].filter((entry) => entry.economy + entry.industry + entry.science > 0).slice(0, 4)) {
    const focus = topInvestment(item);
    insights.push(intel("economy", `${mentionPlayer(item.name)} is investing in ${focus}.`, investmentSummary(item), "success"));
  }

  for (const item of events.filter((eventItem) => eventItem.type === "tech_up").slice(0, 5)) {
    insights.push(intel("tech", `${mentionPlayer(item.details.playerName)} changed strategic capability.`, `${item.details.tech} advanced from ${item.details.from} to ${item.details.to}.`, "info"));
  }

  for (const relation of visibleWarRelations(players).slice(0, 8)) {
    insights.push(intel("war", `${mentionPlayer(relation.player)} has visible war or diplomacy tension.`, relation.description, relation.tone));
  }

  if (!insights.length) {
    insights.push(intel("quiet", "No major strategic change detected yet.", "Once the backend has multiple snapshots from later ticks, this panel will highlight captures, pressure, ship losses, investment focus, tech spikes, and visible wars.", "info"));
  }

  return insights.slice(0, 12);
}

function addNumberDelta(events, player, prior, field, label) {
  const before = Number(prior[field] ?? 0);
  const after = Number(player[field] ?? 0);
  const delta = after - before;
  if (!delta) {
    return;
  }

  const sign = delta > 0 ? "gained" : "lost";
  const tone = delta > 0 ? "success" : "danger";
  events.push(event(field, `${mentionPlayer(player.alias || `Player ${player.uid}`)} ${sign} ${Math.abs(delta)} ${label} since last scan.`, tone, {
    playerUid: player.uid,
    playerName: player.alias || `Player ${player.uid}`,
    field,
    label,
    before,
    after,
    delta
  }));
}

function diffStars(events, previous, current) {
  const previousStars = previous.data?.stars || previous.data?.galaxy?.stars || {};
  const currentStars = current.data?.stars || current.data?.galaxy?.stars || {};
  const currentPlayers = current.data?.players || {};
  const previousPlayers = previous.data?.players || {};

  for (const [uid, star] of Object.entries(currentStars)) {
    const prior = previousStars[uid];
    const name = starName(star, uid);
    if (!prior) {
      const ownerUid = starOwner(star);
      events.push(event("star_seen", `${mentionStar(name)} appeared in scan data under ${mentionPlayer(ownerName(ownerUid, currentPlayers))} control.`, "info", {
        starUid: uid,
        starName: name,
        ownerUid,
        ownerName: ownerName(ownerUid, currentPlayers)
      }));
      continue;
    }

    const beforeOwnerUid = starOwner(prior);
    const afterOwnerUid = starOwner(star);
    if (beforeOwnerUid !== afterOwnerUid) {
      const beforeOwner = ownerName(beforeOwnerUid, previousPlayers);
      const afterOwner = ownerName(afterOwnerUid, currentPlayers);
      events.push(event("star_owner", `${mentionStar(name)} changed owner from ${mentionPlayer(beforeOwner)} to ${mentionPlayer(afterOwner)}.`, "warning", {
        starUid: uid,
        starName: name,
        beforeOwnerUid,
        afterOwnerUid,
        beforeOwnerName: beforeOwner,
        afterOwnerName: afterOwner
      }));
    }

    const beforeShips = starShips(prior);
    const afterShips = starShips(star);
    if (beforeShips !== undefined && afterShips !== undefined && beforeShips !== afterShips) {
      const delta = afterShips - beforeShips;
      const verb = delta > 0 ? "gained" : "lost";
      const tone = delta > 0 ? "success" : "danger";
      events.push(event("star_ships", `${mentionStar(name)} ${verb} ${Math.abs(delta)} stationed ships.`, tone, {
        starUid: uid,
        starName: name,
        before: beforeShips,
        after: afterShips,
        delta
      }));
    }
  }
}

function diffFleets(events, previous, current) {
  const previousFleets = previous.data?.fleets || previous.data?.carriers || previous.data?.galaxy?.fleets || {};
  const currentFleets = current.data?.fleets || current.data?.carriers || current.data?.galaxy?.fleets || {};

  for (const [uid, fleet] of Object.entries(currentFleets)) {
    const prior = previousFleets[uid];
    if (!prior) {
      continue;
    }

    const previousDestination = firstDestination(prior);
    const currentDestination = firstDestination(fleet);
    if (previousDestination && currentDestination && previousDestination !== currentDestination) {
      events.push(event("fleet_route", `${mention(fleet.n || fleet.name || `Fleet ${uid}`)} changed destination from Star ${previousDestination} to Star ${currentDestination}.`, "warning", {
        fleetUid: uid,
        fleetName: fleet.n || fleet.name || `Fleet ${uid}`,
        from: previousDestination,
        to: currentDestination
      }));
    }
  }
}

function visibleWarRelations(players) {
  return players.flatMap((player) => Object.entries(player.war || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([otherUid, value]) => ({
      player: player.alias || `Player ${player.uid}`,
      description: `Visible relation toward ${mentionPlayer(players.find((candidate) => String(candidate.uid) === String(otherUid))?.alias || `Player ${otherUid}`)}: war state ${value}.`,
      tone: Number(value) >= 3 ? "danger" : "warning"
    })));
}

function summarizeCapturePairs(captures) {
  const pairs = new Map();
  for (const item of captures) {
    const loserName = item.details?.beforeOwnerName;
    const winnerName = item.details?.afterOwnerName;
    const starName = item.details?.starName;
    if (!loserName || loserName === "unowned" || !winnerName || !starName) {
      continue;
    }

    const key = `${loserName}::${winnerName}`;
    const current = pairs.get(key) || { loserName, winnerName, starCount: 0, starNames: [] };
    current.starCount += 1;
    current.starNames.push(starName);
    pairs.set(key, current);
  }

  return [...pairs.values()].sort((left, right) => right.starCount - left.starCount);
}

function capturePressureText(playerName, capturePairs) {
  const losses = capturePairs.filter((item) => item.loserName === playerName);
  if (!losses.length) {
    return "";
  }

  const totalStarsLost = losses.reduce((sum, item) => sum + item.starCount, 0);
  const biggestLoss = losses[0];
  return `${mentionPlayer(playerName)} also lost ${totalStarsLost} planet${totalStarsLost === 1 ? "" : "s"}, including ${mentionStarList(biggestLoss.starNames)} to ${mentionPlayer(biggestLoss.winnerName)}.`;
}

function topInvestment(entry) {
  return [
    ["economy", entry.economy],
    ["industry", entry.industry],
    ["science", entry.science]
  ].sort((left, right) => right[1] - left[1])[0][0];
}

function investmentSummary(entry) {
  const parts = [];
  if (entry.economy) parts.push(`economy +${entry.economy}`);
  if (entry.industry) parts.push(`industry +${entry.industry}`);
  if (entry.science) parts.push(`science +${entry.science}`);
  return parts.join(", ");
}

function groupCounts(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
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
  if (uid === undefined || uid === null || Number(uid) < 0) {
    return "unowned";
  }
  return players?.[uid]?.alias || `Player ${uid}`;
}

function intel(type, title, detail, tone) {
  return { type, title, detail, tone };
}

function event(type, message, tone, details = {}) {
  return { type, message, tone, details };
}

function mentionPlayer(name) {
  return mention(name);
}

function mentionStar(name) {
  return mention(name);
}

function mention(value) {
  return value ? `[[${String(value)}]]` : "";
}

function mentionStarList(starNames) {
  const names = (starNames || []).filter(Boolean).slice(0, 3).map(mentionStar);
  if (!names.length) {
    return "known planets";
  }
  if (starNames.length > 3) {
    return `${names.join(", ")} and ${starNames.length - 3} more`;
  }
  return names.join(", ");
}
