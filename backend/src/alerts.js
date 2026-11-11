// Phone alerts through ntfy (https://ntfy.sh): the user installs the ntfy app
// and subscribes to a private topic name saved in Settings; the Worker posts
// to that topic.
const NTFY_URL = "https://ntfy.sh";
const DEFAULT_SITE_URL = "https://lukaa98.github.io/NP-Intelligence/";

export async function sendNtfy(topic, { title, message, click, priority = 4, tags = [] }) {
  const response = await fetch(NTFY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, title, message, click, priority, tags })
  });
  if (!response.ok) {
    throw new Error(`ntfy returned ${response.status}: ${await response.text()}`);
  }
}

export function formatEta(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const VERDICT_TEXT = {
  undefended: "undefended",
  likely_falls: "likely to fall",
  likely_holds: "should hold"
};

// One notification per game per scan, listing every new incoming fleet.
export function threatNotification(env, game, threats, snapshotId) {
  const site = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/?$/, "/");
  const first = threats[0];
  const gameName = game.nickname || game.name || `Game ${game.gameNumber}`;
  const lines = threats.map((threat) => {
    const via = (threat.route || []).length > 1 ? ` via ${threat.route.slice(0, -1).map((stop) => stop.name).join(" → ")}` : "";
    return `${threat.ownerAlias}: ${threat.ships} ships → ${threat.targetName} in ~${formatEta(threat.etaMinutes)} · you have ${threat.defenders} there · ${VERDICT_TEXT[threat.verdict]}${via}`;
  });
  return {
    title: threats.length === 1
      ? `🚨 ${gameName}: ${first.ships} ships heading to ${first.targetName}`
      : `🚨 ${gameName}: ${threats.length} fleets heading at your stars`,
    message: lines.join("\n"),
    click: `${site}#/snapshot/${encodeURIComponent(snapshotId)}?star=${first.targetUid}&fleet=${first.fleetUid}`,
    priority: threats.some((threat) => threat.verdict !== "likely_holds") ? 5 : 4,
    tags: ["rotating_light"]
  };
}
