const DEFAULT_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "https://np-intelligence-backend.carsandbids-labs.workers.dev").replace(/\/+$/, "");
const BACKEND_KEY = "np-intel.backendUrl";
// Finished games live on the np-archive branch (see archive-games workflow).
export const ARCHIVE_BASE = (import.meta.env.VITE_ARCHIVE_BASE || "https://raw.githubusercontent.com/Lukaa98/NP-Intelligence/np-archive/archive").replace(/\/+$/, "");
export const ARCHIVE_BROWSE = "https://github.com/Lukaa98/NP-Intelligence/tree/np-archive/archive";
const TOKEN_KEY = "np-intel.writeToken";

function readStorage(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStorage(key, value) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked (private mode): settings just won't persist.
  }
}

export function getSettings() {
  return {
    backendUrl: readStorage(BACKEND_KEY) || DEFAULT_BACKEND_URL,
    writeToken: readStorage(TOKEN_KEY),
    defaultBackendUrl: DEFAULT_BACKEND_URL
  };
}

export function saveSettings({ backendUrl, writeToken }) {
  const cleaned = String(backendUrl || "").trim().replace(/\/+$/, "");
  writeStorage(BACKEND_KEY, cleaned === DEFAULT_BACKEND_URL ? "" : cleaned);
  writeStorage(TOKEN_KEY, String(writeToken || "").trim());
}

async function request(path, init = {}) {
  const { backendUrl, writeToken } = getSettings();
  const headers = { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) };
  if (writeToken) {
    headers.authorization = `Bearer ${writeToken}`;
  }

  const response = await fetch(`${backendUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Backend returned ${response.status}`);
  }
  return payload;
}

const game = (gameNumber) => `/api/games/${encodeURIComponent(gameNumber)}`;

export const api = {
  health: () => request("/health"),
  listGames: () => request("/api/games").then((payload) => payload.games || []),
  saveGame: (body) => request("/api/games", { method: "POST", body: JSON.stringify(body) }),
  scanGame: (gameNumber) => request(`${game(gameNumber)}/scan`, { method: "POST" }),
  captureGame: (gameNumber) => request(`${game(gameNumber)}/capture`, { method: "POST" }),
  archiveGame: (gameNumber) => request(game(gameNumber), { method: "DELETE" }),
  purgeGame: (gameNumber) => request(`${game(gameNumber)}?purge=1`, { method: "DELETE" }),
  renameGame: (gameNumber, nickname) => request(game(gameNumber), { method: "PUT", body: JSON.stringify({ nickname }) }),
  diplomacy: (gameNumber) => request(`${game(gameNumber)}/diplomacy`),
  processRelations: (gameNumber) => request(`${game(gameNumber)}/relations/process`, { method: "POST" }),
  restoreGame: (gameNumber) => request(`${game(gameNumber)}/restore`, { method: "POST" }),
  intel: (gameNumber, window) => request(`${game(gameNumber)}/intel?window=${encodeURIComponent(window)}`),
  snapshots: (gameNumber, { pinnedOnly = false, limit = 100 } = {}) =>
    request(`${game(gameNumber)}/snapshots?limit=${limit}${pinnedOnly ? "&pinned=1" : ""}`).then((payload) => payload.snapshots || []),
  snapshot: (snapshotId) => request(`/api/snapshots/${encodeURIComponent(snapshotId)}`).then((payload) => payload.snapshot),
  pinSnapshot: (snapshotId, label) => request(`/api/snapshots/${encodeURIComponent(snapshotId)}/pin`, { method: "POST", body: JSON.stringify({ label }) }),
  unpinSnapshot: (snapshotId) => request(`/api/snapshots/${encodeURIComponent(snapshotId)}/pin`, { method: "DELETE" }),
  // Archived games: null when the game isn't in the git archive (yet).
  archivedGame: (gameNumber) => fetch(`${ARCHIVE_BASE}/${encodeURIComponent(gameNumber)}/game.json`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null),
  archivedFrame: async (gameNumber, file) => {
    const response = await fetch(`${ARCHIVE_BASE}/${encodeURIComponent(gameNumber)}/${file}`);
    if (!response.ok) throw new Error(`Archived tick not found (${response.status})`);
    return response.json();
  },
  listPlayers: () => request("/api/players").then((payload) => payload.players || []),
  savePlayer: (body) => request("/api/players", { method: "PUT", body: JSON.stringify(body) }).then((payload) => payload.player),
  deletePlayer: (alias) => request(`/api/players/${encodeURIComponent(alias)}`, { method: "DELETE" })
};
