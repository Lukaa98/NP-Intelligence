// Turns backend intel (summary + diff events) into per-player cards.
// Ported from the old Chrome extension popup.

export function buildPlayerIntel(summary, events) {
  const players = (summary.players || []).map((player) => ({
    uid: String(player.uid ?? ""),
    name: player.alias || `Player ${player.uid}`,
    stars: Number(player.totalStars || 0),
    ships: Number(player.totalStrength || 0),
    economy: Number(player.totalEconomy || 0),
    industry: Number(player.totalIndustry || 0),
    science: Number(player.totalScience || 0),
    deltaShips: 0,
    deltaStars: 0,
    deltaEconomy: 0,
    deltaIndustry: 0,
    deltaScience: 0,
    captures: [],
    losses: [],
    techUps: [],
    details: []
  }));

  const byName = new Map(players.map((player) => [player.name, player]));

  for (const item of events || []) {
    if (item.type === "star_owner") {
      const winner = ensurePlayer(byName, item.details?.afterOwnerName);
      const loser = ensurePlayer(byName, item.details?.beforeOwnerName);
      if (winner && item.details?.starName && item.details?.beforeOwnerName !== "unowned") {
        winner.captures.push({ starName: item.details.starName, from: item.details.beforeOwnerName });
      }
      if (loser && item.details?.starName && item.details?.beforeOwnerName !== "unowned") {
        loser.losses.push({ starName: item.details.starName, to: item.details.afterOwnerName });
      }
    }

    const player = ensurePlayer(byName, item.details?.playerName);
    if (!player) {
      continue;
    }

    if (item.type === "totalStrength") player.deltaShips = Number(item.details?.delta || 0);
    if (item.type === "totalStars") player.deltaStars = Number(item.details?.delta || 0);
    if (item.type === "totalEconomy") player.deltaEconomy = Number(item.details?.delta || 0);
    if (item.type === "totalIndustry") player.deltaIndustry = Number(item.details?.delta || 0);
    if (item.type === "totalScience") player.deltaScience = Number(item.details?.delta || 0);
    if (item.type === "tech_up") {
      player.techUps.push({ tech: item.details?.tech, from: item.details?.from, to: item.details?.to });
    }
  }

  for (const player of byName.values()) {
    player.quickSummary = playerQuickSummary(player);
    player.details = playerDetailRows(player);
    player.badge = playerBadge(player);
    player.tone = playerTone(player);
  }

  return [...byName.values()].sort((left, right) => {
    if (right.stars !== left.stars) {
      return right.stars - left.stars;
    }
    return right.ships - left.ships;
  });
}

function ensurePlayer(byName, name) {
  if (!name || name === "unowned") {
    return null;
  }

  if (!byName.has(name)) {
    byName.set(name, {
      uid: "",
      name,
      stars: 0,
      ships: 0,
      economy: 0,
      industry: 0,
      science: 0,
      deltaShips: 0,
      deltaStars: 0,
      deltaEconomy: 0,
      deltaIndustry: 0,
      deltaScience: 0,
      captures: [],
      losses: [],
      techUps: [],
      details: []
    });
  }

  return byName.get(name);
}

function playerQuickSummary(player) {
  const parts = [];
  if (player.captures.length) parts.push(`took ${player.captures.length} planet${player.captures.length === 1 ? "" : "s"}`);
  if (player.losses.length) parts.push(`lost ${player.losses.length} planet${player.losses.length === 1 ? "" : "s"}`);
  if (player.deltaShips) parts.push(`${formatSigned(player.deltaShips)} ships`);
  if (player.deltaStars) parts.push(`${formatSigned(player.deltaStars)} stars`);
  if (player.deltaEconomy) parts.push(`${formatSigned(player.deltaEconomy)} eco`);
  if (player.deltaIndustry) parts.push(`${formatSigned(player.deltaIndustry)} ind`);
  if (player.deltaScience) parts.push(`${formatSigned(player.deltaScience)} sci`);
  if (player.techUps.length) parts.push(`${player.techUps.length} tech up`);
  return parts.join(" • ") || "No major change in this window.";
}

// "3 from [[A]] (S1, S2, S3) · 2 from [[B]] (S4, S5)": one group per empire.
function groupedStars(items, key, word) {
  const groups = new Map();
  for (const item of items) {
    const other = item[key] || "another empire";
    if (!groups.has(other)) groups.set(other, []);
    groups.get(other).push(item.starName);
  }
  return [...groups.entries()]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([other, stars]) => {
      const names = stars.slice(0, 4).map((star) => `[[${star}]]`).join(", ");
      const more = stars.length > 4 ? ` and ${stars.length - 4} more` : "";
      const who = other === "another empire" ? other : `[[${other}]]`;
      return `${stars.length} ${word} ${who} (${names}${more})`;
    })
    .join(" · ") + ".";
}

function playerDetailRows(player) {
  const details = [];

  if (player.losses.length) {
    details.push({
      title: `[[${player.name}]] lost ${player.losses.length} planet${player.losses.length === 1 ? "" : "s"}.`,
      detail: groupedStars(player.losses, "to", "to"),
      tag: "loss",
      tone: "danger"
    });
  }

  if (player.captures.length) {
    details.push({
      title: `[[${player.name}]] captured ${player.captures.length} planet${player.captures.length === 1 ? "" : "s"}.`,
      detail: groupedStars(player.captures, "from", "from"),
      tag: "capture",
      tone: "success"
    });
  }

  if (player.deltaShips) {
    details.push({
      title: `[[${player.name}]] ${player.deltaShips > 0 ? "changed" : "lost"} ships.`,
      detail: `Ship total moved ${formatSigned(player.deltaShips)} in this comparison window.`,
      tag: "ships",
      tone: player.deltaShips < 0 ? "warning" : "success"
    });
  }

  if (player.deltaStars) {
    details.push({
      title: `[[${player.name}]] changed star count.`,
      detail: `Known star total moved ${formatSigned(player.deltaStars)}.`,
      tag: "stars",
      tone: player.deltaStars < 0 ? "warning" : "success"
    });
  }

  if (player.deltaEconomy || player.deltaIndustry || player.deltaScience) {
    details.push({
      title: `[[${player.name}]] changed infrastructure.`,
      detail: `Eco ${formatSigned(player.deltaEconomy)} • Ind ${formatSigned(player.deltaIndustry)} • Sci ${formatSigned(player.deltaScience)}.`,
      tag: "build",
      tone: "success"
    });
  }

  for (const tech of player.techUps.slice(0, 3)) {
    details.push({
      title: `[[${player.name}]] upgraded ${tech.tech}.`,
      detail: `${tech.tech} advanced from ${tech.from} to ${tech.to}.`,
      tag: "tech",
      tone: "success"
    });
  }

  return details;
}

function playerBadge(player) {
  if (player.losses.length) return "under fire";
  if (player.captures.length) return "attacking";
  if (player.deltaShips < 0) return "ships down";
  if (player.techUps.length) return "tech";
  return "stable";
}

function playerTone(player) {
  if (player.losses.length || player.deltaShips < 0) return "danger";
  if (player.captures.length || player.techUps.length) return "success";
  return "info";
}

export function formatSigned(value) {
  const number = Number(value || 0);
  if (!number) {
    return "0";
  }
  return number > 0 ? `+${number}` : String(number);
}
