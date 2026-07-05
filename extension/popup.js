const STORAGE_KEY = "np-intelligence-extension-settings";
const POPUP_SIZE_KEY = "popupSize";
const POPUP_FONT_KEY = "popupFontScale";
const TRACK_FORM_COLLAPSED_KEY = "trackFormCollapsed";
const SELECTED_INTEL_PLAYER_KEY = "selectedIntelPlayer";
const POPUP_SIZES = ["medium", "large", "xl"];
const EXTENSION_CONFIG = window.NP_INTELLIGENCE_CONFIG || {};
const DEFAULT_BACKEND_URL = String(EXTENSION_CONFIG.defaultBackendUrl || "").trim().replace(/\/+$/, "");
const HIDE_BACKEND_FIELD_WHEN_CONFIGURED = Boolean(EXTENSION_CONFIG.hideBackendUrlInputWhenConfigured);
const DEFAULT_FONT_SCALE = 1;
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 6;
const FONT_SCALE_STEP = 0.12;

const state = {
  selectedGameNumber: "",
  popupSize: "medium",
  popupFontScale: DEFAULT_FONT_SCALE,
  selectedWindow: "latest",
  trackFormCollapsed: true,
  selectedIntelPlayer: "",
  currentIntelPayload: null
};

const elements = {
  toggleTrackForm: document.getElementById("toggle-track-form"),
  trackGameBody: document.getElementById("track-game-body"),
  gameNumber: document.getElementById("game-number"),
  apiKey: document.getElementById("api-key"),
  gameName: document.getElementById("game-name"),
  gameStatus: document.getElementById("game-status"),
  gamesList: document.getElementById("games-list"),
  intelSummary: document.getElementById("intel-summary"),
  intelList: document.getElementById("intel-list"),
  playerDetailSummary: document.getElementById("player-detail-summary"),
  eventsList: document.getElementById("events-list"),
  fetchHealthBadge: document.getElementById("fetch-health-badge"),
  fetchHealthSummary: document.getElementById("fetch-health-summary"),
  fetchHealthList: document.getElementById("fetch-health-list"),
  windowLatest: document.getElementById("window-latest"),
  window1h: document.getElementById("window-1h"),
  window6h: document.getElementById("window-6h"),
  window32h: document.getElementById("window-32h"),
  sizeMedium: document.getElementById("size-medium"),
  sizeLarge: document.getElementById("size-large"),
  sizeXl: document.getElementById("size-xl"),
  fontDecrease: document.getElementById("font-decrease"),
  fontReset: document.getElementById("font-reset"),
  fontIncrease: document.getElementById("font-increase"),
  openDashboard: document.getElementById("open-dashboard")
};

document.getElementById("capture-page").addEventListener("click", capturePageHints);
document.getElementById("save-game").addEventListener("click", saveGame);
document.getElementById("scan-game").addEventListener("click", scanSelectedGame);
document.getElementById("refresh-games").addEventListener("click", refreshGames);
document.getElementById("refresh-intel").addEventListener("click", refreshIntel);
elements.toggleTrackForm?.addEventListener("click", toggleTrackForm);
elements.windowLatest?.addEventListener("click", () => setIntelWindow("latest"));
elements.window1h?.addEventListener("click", () => setIntelWindow("1h"));
elements.window6h?.addEventListener("click", () => setIntelWindow("6h"));
elements.window32h?.addEventListener("click", () => setIntelWindow("32h"));
elements.sizeMedium?.addEventListener("click", () => setPopupSize("medium"));
elements.sizeLarge?.addEventListener("click", () => setPopupSize("large"));
elements.sizeXl?.addEventListener("click", () => setPopupSize("xl"));
elements.fontDecrease?.addEventListener("click", () => stepPopupFont(-1));
elements.fontReset?.addEventListener("click", () => setPopupFont(DEFAULT_FONT_SCALE));
elements.fontIncrease?.addEventListener("click", () => stepPopupFont(1));
elements.openDashboard?.addEventListener("click", openDashboard);

init().catch((error) => {
  elements.gameStatus.textContent = error.message;
});

async function init() {
  await loadSettings();
  if (DEFAULT_BACKEND_URL) {
    await refreshGames();
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] || {};
  state.selectedGameNumber = settings.selectedGameNumber || "";
  state.popupSize = POPUP_SIZES.includes(settings[POPUP_SIZE_KEY]) ? settings[POPUP_SIZE_KEY] : "medium";
  state.popupFontScale = sanitizeFontScale(settings[POPUP_FONT_KEY]);
  state.selectedWindow = ["latest", "1h", "6h", "32h"].includes(settings.selectedWindow) ? settings.selectedWindow : "latest";
  state.trackFormCollapsed = settings[TRACK_FORM_COLLAPSED_KEY] !== false;
  state.selectedIntelPlayer = settings[SELECTED_INTEL_PLAYER_KEY] || "";
  applyPopupSize();
  applyPopupFont();
  applyIntelWindow();
  applyTrackFormState();
}

async function persistSettings() {
  await chrome.storage.sync.set({
    [STORAGE_KEY]: {
      selectedGameNumber: state.selectedGameNumber,
      selectedWindow: state.selectedWindow,
      [TRACK_FORM_COLLAPSED_KEY]: state.trackFormCollapsed,
      [SELECTED_INTEL_PLAYER_KEY]: state.selectedIntelPlayer,
      [POPUP_SIZE_KEY]: state.popupSize,
      [POPUP_FONT_KEY]: state.popupFontScale
    }
  });
}

async function setPopupSize(size) {
  state.popupSize = POPUP_SIZES.includes(size) ? size : "medium";
  applyPopupSize();
  await persistSettings();
}

async function setPopupFont(scale) {
  state.popupFontScale = sanitizeFontScale(scale);
  applyPopupFont();
  await persistSettings();
}

async function stepPopupFont(direction) {
  const nextScale = state.popupFontScale + direction * FONT_SCALE_STEP;
  await setPopupFont(nextScale);
}

async function setIntelWindow(windowKey) {
  state.selectedWindow = ["latest", "1h", "6h", "32h"].includes(windowKey) ? windowKey : "latest";
  applyIntelWindow();
  await persistSettings();
  await refreshIntel();
}

async function toggleTrackForm() {
  state.trackFormCollapsed = !state.trackFormCollapsed;
  applyTrackFormState();
  await persistSettings();
}

function applyPopupSize() {
  for (const size of POPUP_SIZES) {
    document.body.classList.toggle(`size-${size}`, size === state.popupSize);
  }

  elements.sizeMedium?.classList.toggle("active", state.popupSize === "medium");
  elements.sizeLarge?.classList.toggle("active", state.popupSize === "large");
  elements.sizeXl?.classList.toggle("active", state.popupSize === "xl");
}

function applyPopupFont() {
  document.body.style.setProperty("--font-scale", String(state.popupFontScale));
  elements.fontDecrease?.classList.toggle("active", state.popupFontScale <= MIN_FONT_SCALE + 0.001);
  elements.fontReset?.classList.toggle("active", Math.abs(state.popupFontScale - DEFAULT_FONT_SCALE) < 0.001);
  elements.fontIncrease?.classList.toggle("active", state.popupFontScale > DEFAULT_FONT_SCALE);
}

function applyIntelWindow() {
  elements.windowLatest?.classList.toggle("active", state.selectedWindow === "latest");
  elements.window1h?.classList.toggle("active", state.selectedWindow === "1h");
  elements.window6h?.classList.toggle("active", state.selectedWindow === "6h");
  elements.window32h?.classList.toggle("active", state.selectedWindow === "32h");
}

function applyTrackFormState() {
  if (elements.trackGameBody) {
    elements.trackGameBody.hidden = state.trackFormCollapsed;
  }

  if (elements.toggleTrackForm) {
    elements.toggleTrackForm.textContent = state.trackFormCollapsed ? "Add or edit game" : "Hide game form";
    elements.toggleTrackForm.classList.toggle("active", !state.trackFormCollapsed);
  }
}

function requireBackendUrl() {
  const backendUrl = DEFAULT_BACKEND_URL;
  if (!backendUrl) {
    throw new Error("Default backend URL is missing in config.js.");
  }

  return backendUrl;
}

async function api(path, init = {}) {
  const base = requireBackendUrl();
  await persistSettings();

  const response = await fetch(`${base}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    },
    ...init
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Backend returned ${response.status}`);
  }

  return payload;
}

async function capturePageHints() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("Open a Neptune's Pride tab first.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "NP_CAPTURE_HINTS" });
    if (!response?.ok) {
      throw new Error("Could not read page hints.");
    }

    const { hints } = response;
    if (hints.gameNumber) {
      elements.gameNumber.value = hints.gameNumber;
    }
    if (hints.apiKey) {
      elements.apiKey.value = hints.apiKey;
    }
    if (!elements.gameName.value && hints.title) {
      elements.gameName.value = hints.title.replace(/\s+-\s+Neptune.*$/i, "").trim();
    }

    if (state.trackFormCollapsed) {
      state.trackFormCollapsed = false;
      applyTrackFormState();
      await persistSettings();
    }

    elements.gameStatus.textContent = hints.apiKey
      ? "Captured likely game number and API code from the current page."
      : "Page scanned. I found page hints, but not a confident API code.";
  } catch (error) {
    elements.gameStatus.textContent = error.message;
  }
}

async function saveGame() {
  try {
    const gameNumber = elements.gameNumber.value.trim();
    const apiKey = elements.apiKey.value.trim();
    const name = elements.gameName.value.trim();

    if (!gameNumber || !apiKey) {
      throw new Error("Game number and API code are required.");
    }

    const payload = await api("/api/games", {
      method: "POST",
      body: JSON.stringify({
        game_number: gameNumber,
        code: apiKey,
        name
      })
    });

    state.selectedGameNumber = payload.game.gameNumber;
    state.trackFormCollapsed = true;
    await persistSettings();
    applyTrackFormState();
    elements.gameStatus.textContent = `Saved ${payload.game.name}. First scan stored at tick ${payload.snapshot.tick}.`;
    await refreshGames();
    await refreshIntel();
  } catch (error) {
    elements.gameStatus.textContent = error.message;
  }
}

async function scanSelectedGame() {
  try {
    const gameNumber = state.selectedGameNumber || elements.gameNumber.value.trim();
    if (!gameNumber) {
      throw new Error("Select or save a tracked game first.");
    }

    const payload = await api(`/api/games/${encodeURIComponent(gameNumber)}/scan`, {
      method: "POST"
    });

    state.selectedGameNumber = gameNumber;
    await persistSettings();
    elements.gameStatus.textContent = `Scanned ${gameNumber}. Latest tick ${payload.snapshot.tick}.`;
    await refreshGames();
    await refreshIntel();
  } catch (error) {
    elements.gameStatus.textContent = error.message;
  }
}

async function refreshGames() {
  try {
    const payload = await api("/api/games", { headers: {} });
    renderGames(payload.games || []);

    if (!state.selectedGameNumber && payload.games?.length) {
      state.selectedGameNumber = payload.games[0].gameNumber;
      await persistSettings();
    }

    await refreshIntel();
  } catch (error) {
    elements.gamesList.className = "list empty";
    elements.gamesList.textContent = error.message;
  }
}

function renderGames(games) {
  if (!games.length) {
    elements.gamesList.className = "list empty";
    elements.gamesList.textContent = "No tracked games yet.";
    return;
  }

  elements.gamesList.className = "list";
  elements.gamesList.innerHTML = games.map((game) => `
    <article class="game-row ${game.gameNumber === state.selectedGameNumber ? "active" : ""}">
      <button class="game-button" data-game-number="${escapeHtml(game.gameNumber)}">
        <div class="name">${escapeHtml(game.name || `Game ${game.gameNumber}`)}</div>
        <div class="meta">#${escapeHtml(game.gameNumber)} • tick ${escapeHtml(String(game.lastTick || 0))} • ${escapeHtml(game.apiKeyPreview || "no key")}</div>
      </button>
      <span class="pill ${game.keyStatus === "needs_fresh_key" ? "danger" : "success"}">${escapeHtml(game.keyStatus)}</span>
    </article>
  `).join("");

  for (const button of elements.gamesList.querySelectorAll(".game-button")) {
    button.addEventListener("click", async () => {
      state.selectedGameNumber = button.dataset.gameNumber;
      elements.gameNumber.value = state.selectedGameNumber;
      await persistSettings();
      renderGames(games);
      await refreshIntel();
    });
  }
}

async function refreshIntel() {
  if (!DEFAULT_BACKEND_URL || !state.selectedGameNumber) {
    state.currentIntelPayload = null;
    elements.intelSummary.className = "summary empty";
    elements.intelSummary.textContent = "Select a tracked game to see its latest backend intel.";
    elements.intelList.className = "list empty";
    elements.intelList.textContent = "No players loaded yet.";
    if (elements.playerDetailSummary) {
      elements.playerDetailSummary.className = "summary empty";
      elements.playerDetailSummary.textContent = "Select a player to see captures, losses, and stat swings.";
    }
    elements.eventsList.className = "list empty";
    elements.eventsList.textContent = "No player details yet.";
    renderFetchHealth(null);
    return;
  }

  try {
    const payload = await api(`/api/games/${encodeURIComponent(state.selectedGameNumber)}/intel?window=${encodeURIComponent(state.selectedWindow)}`, { headers: {} });
    state.currentIntelPayload = payload;
    renderIntel(payload);
  } catch (error) {
    state.currentIntelPayload = null;
    elements.intelSummary.className = "summary empty";
    elements.intelSummary.textContent = error.message;
  }
}

function renderIntel(payload) {
  const summary = payload.summary || {};
  const events = payload.events || [];
  const fetchHealth = payload.fetchHealth || null;
  const players = buildPlayerIntel(summary, events);
  const windowLabel =
    payload.window === "1h" ? "last 1 hour" :
    payload.window === "6h" ? "last 6 hours" :
    payload.window === "32h" ? "last 32 hours" :
    "latest vs previous snapshot";

  elements.intelSummary.className = "summary";
  elements.intelSummary.textContent = summary.players?.length
    ? `${summary.gameName} • tick ${summary.tick} • ${summary.players.length} players • ${summary.stars?.length || 0} stars • ${windowLabel}`
    : "No backend summary yet for this game.";

  if (!players.length) {
    elements.intelList.className = "list empty";
    elements.intelList.textContent = "No players loaded yet.";
  } else {
    if (!players.some((player) => player.name === state.selectedIntelPlayer)) {
      state.selectedIntelPlayer = players[0].name;
      persistSettings();
    }

    elements.intelList.className = "player-picker";
    elements.intelList.innerHTML = players.map((player) => `
      <button
        class="player-chip ${player.name === state.selectedIntelPlayer ? "active" : ""}"
        type="button"
        data-player-name="${escapeHtml(player.name)}"
        title="${escapeHtml(player.quickSummary)}"
      >
        ${escapeHtml(player.name)}
      </button>
    `).join("");
  }

  const selectedPlayer = players.find((player) => player.name === state.selectedIntelPlayer) || null;
  renderPlayerDetails(selectedPlayer, windowLabel);

  if (!players.length) {
    elements.eventsList.className = "list empty";
    elements.eventsList.textContent = "No player details yet.";
  }

  renderFetchHealth(fetchHealth);
  bindReferenceActions();
  bindPlayerActions();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRichText(value) {
  return escapeHtml(String(value || "")).replace(/\[\[([^[\]]+)\]\]/g, (_match, referenceName) => {
    const trimmed = String(referenceName).trim();
    const safe = escapeHtml(trimmed);
    return `<button class="mention-link" type="button" data-reference-name="${safe}" title="Focus ${safe} in your open Neptune's Pride tab">${safe}</button>`;
  });
}

function bindReferenceActions() {
  for (const element of document.querySelectorAll(".mention-link")) {
    element.addEventListener("click", () => sendReferenceToGame(element.dataset.referenceName || ""));
  }
}

function bindPlayerActions() {
  for (const element of document.querySelectorAll(".player-button")) {
    element.addEventListener("click", async () => {
      state.selectedIntelPlayer = element.dataset.playerName || "";
      await persistSettings();
      if (state.currentIntelPayload) {
        renderIntel(state.currentIntelPayload);
      }
    });
  }

  for (const element of document.querySelectorAll(".player-chip")) {
    element.addEventListener("click", async () => {
      state.selectedIntelPlayer = element.dataset.playerName || "";
      await persistSettings();
      if (state.currentIntelPayload) {
        renderIntel(state.currentIntelPayload);
      }
      await focusPlayerInGame(state.selectedIntelPlayer);
    });
  }
}

async function sendReferenceToGame(referenceName) {
  const trimmed = String(referenceName || "").trim();
  if (!trimmed) {
    return;
  }

  try {
    const tab = await findNeptuneTab();
    if (!tab?.id) {
      throw new Error("Open your Neptune's Pride game tab first.");
    }

    await chrome.tabs.update(tab.id, { active: true });
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "NP_FOCUS_REFERENCE",
      referenceName: trimmed
    });

    if (result?.ok) {
      elements.gameStatus.textContent =
        result.mode === "direct-reference" ? `Focused ${trimmed} in Neptune's Pride.` :
        result.mode === "eye-button" ? `Opened ${trimmed} from the leaderboard.` :
        result.mode === "row-click" ? `Clicked ${trimmed} in Neptune's Pride.` :
        `Inserted [[${trimmed}]] into the active field on your NP tab.`;
      return;
    }

    throw new Error(result?.detail || result?.error || `Could not use [[${trimmed}]] on the NP tab.`);
  } catch (error) {
    elements.gameStatus.textContent = error.message;
  }
}

async function focusPlayerInGame(playerName) {
  const trimmed = String(playerName || "").trim();
  if (!trimmed) {
    return;
  }

  try {
    const tab = await findNeptuneTab();
    if (!tab?.id) {
      return;
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "NP_FOCUS_PLAYER",
      playerName: trimmed
    });

    if (result?.ok) {
      elements.gameStatus.textContent = `Focused ${trimmed} in Neptune's Pride.`;
      return;
    }

    if (result?.detail) {
      elements.gameStatus.textContent = result.detail;
    }
  } catch (_error) {
    elements.gameStatus.textContent = `Could not focus ${trimmed} in the game automatically yet.`;
  }
}

async function findNeptuneTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => /^https:\/\/np\.ironhelmet\.com\//i.test(tab.url || ""))
    || tabs.find((tab) => /^https:\/\/[^/]*neptunespride\.com\//i.test(tab.url || ""));
}

async function openDashboard() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html")
  });
}

function renderFetchHealth(fetchHealth) {
  if (!fetchHealth) {
    elements.fetchHealthBadge.textContent = "Unknown";
    elements.fetchHealthBadge.className = "pill";
    elements.fetchHealthSummary.className = "summary empty";
    elements.fetchHealthSummary.textContent = "No fetch health data yet.";
    elements.fetchHealthList.className = "list empty";
    elements.fetchHealthList.textContent = "No recent failures logged.";
    return;
  }

  const hasOutage = Boolean(fetchHealth.activeOutage);
  elements.fetchHealthBadge.textContent = hasOutage ? "Outage" : "Healthy";
  elements.fetchHealthBadge.className = `pill ${hasOutage ? "danger" : "success"}`;

  const summaryParts = [];
  if (fetchHealth.latestSuccessAt) {
    summaryParts.push(`Last success ${formatDateTime(fetchHealth.latestSuccessAt)}`);
  }
  if (fetchHealth.activeOutage) {
    summaryParts.push(`Failed fetching from ${formatDateTime(fetchHealth.activeOutage.startedAt)} to ${formatDateTime(fetchHealth.activeOutage.latestAttemptAt)}`);
    summaryParts.push(`${fetchHealth.activeOutage.attemptsMissed} failed attempt${fetchHealth.activeOutage.attemptsMissed === 1 ? "" : "s"} in current outage`);
  } else if (fetchHealth.latestFailureAt) {
    summaryParts.push(`Last failure ${formatDateTime(fetchHealth.latestFailureAt)}`);
  }
  if (fetchHealth.failuresLast24h) {
    summaryParts.push(`${fetchHealth.failuresLast24h} failure${fetchHealth.failuresLast24h === 1 ? "" : "s"} in last 24h`);
  }
  if (fetchHealth.estimatedFailureGapHours) {
    summaryParts.push(`Avg failure gap ${fetchHealth.estimatedFailureGapHours}h`);
  }

  elements.fetchHealthSummary.className = "summary";
  elements.fetchHealthSummary.textContent = summaryParts.join(" • ") || "No fetch health data yet.";

  if (!fetchHealth.recentFailures?.length) {
    elements.fetchHealthList.className = "list empty";
    elements.fetchHealthList.textContent = "No recent failures logged.";
    return;
  }

  elements.fetchHealthList.className = "list";
  elements.fetchHealthList.innerHTML = fetchHealth.recentFailures.map((failure) => `
    <article class="event-row">
      <div>
        <div class="name">${escapeHtml(formatDateTime(failure.attemptedAt))}</div>
        <div class="meta">${escapeHtml(failure.errorMessage || "Fetch failed")} • ${escapeHtml(failure.source || "unknown")}</div>
      </div>
      <span class="pill danger">failed</span>
    </article>
  `).join("");
}

function renderPlayerDetails(player, windowLabel) {
  if (!elements.playerDetailSummary) {
    return;
  }

  if (!player) {
    elements.playerDetailSummary.className = "summary empty";
    elements.playerDetailSummary.textContent = "Select a player to see captures, losses, and stat swings.";
    elements.eventsList.className = "list empty";
    elements.eventsList.textContent = "No player details yet.";
    return;
  }

  elements.playerDetailSummary.className = "summary";
  elements.playerDetailSummary.innerHTML = `
    <div class="name rich-text">${renderRichText(`[[${player.name}]] • ${player.stars} stars • ${player.ships} ships • ${windowLabel}`)}</div>
    <div class="meta">${escapeHtml(`Eco ${player.economy} • Ind ${player.industry} • Sci ${player.science}`)}</div>
  `;

  if (!player.details.length) {
    elements.eventsList.className = "list empty";
    elements.eventsList.textContent = "No meaningful changes tracked for this player in the selected window.";
    return;
  }

  elements.eventsList.className = "list";
  elements.eventsList.innerHTML = player.details.map((item) => `
    <article class="event-row">
      <div>
        <div class="name rich-text">${renderRichText(item.title)}</div>
        <div class="meta rich-text">${renderRichText(item.detail)}</div>
      </div>
      <span class="pill ${item.tone === "danger" || item.tone === "warning" ? "danger" : "success"}">${escapeHtml(item.tag)}</span>
    </article>
  `).join("");
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : "unknown";
}

function sanitizeFontScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FONT_SCALE;
  }

  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Number(parsed.toFixed(2))));
}

function buildPlayerIntel(summary, events) {
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

function playerDetailRows(player) {
  const details = [];

  if (player.losses.length) {
    const names = player.losses.slice(0, 4).map((item) => `[[${item.starName}]]`).join(", ");
    const target = player.losses[0]?.to ? `[[${player.losses[0].to}]]` : "another empire";
    details.push({
      title: `[[${player.name}]] lost ${player.losses.length} planet${player.losses.length === 1 ? "" : "s"}.`,
      detail: `${names}${player.losses.length > 4 ? ` and ${player.losses.length - 4} more` : ""} transferred to ${target}.`,
      tag: "loss",
      tone: "danger"
    });
  }

  if (player.captures.length) {
    const names = player.captures.slice(0, 4).map((item) => `[[${item.starName}]]`).join(", ");
    const source = player.captures[0]?.from ? `[[${player.captures[0].from}]]` : "another empire";
    details.push({
      title: `[[${player.name}]] captured ${player.captures.length} planet${player.captures.length === 1 ? "" : "s"}.`,
      detail: `${names}${player.captures.length > 4 ? ` and ${player.captures.length - 4} more` : ""} came from ${source}.`,
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

function formatSigned(value) {
  const number = Number(value || 0);
  if (!number) {
    return "0";
  }
  return number > 0 ? `+${number}` : String(number);
}
