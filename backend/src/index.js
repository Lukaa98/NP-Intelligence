import { diffSnapshots, strategicIntel, summarize } from "./intel.js";
import { fetchScan, isGameOver, NeptuneApiError } from "./npApi.js";
import {
  archiveGame,
  comparisonSnapshotsForWindow,
  deletePlayerNote,
  enabledGamesWithCodes,
  getGameFetchHealth,
  gameWithCode,
  getGame,
  getSnapshot,
  latestSnapshot,
  latestSnapshotsForCompare,
  listGames,
  listPlayerNotes,
  listSnapshotMeta,
  markKeyProblem,
  pinSnapshot,
  purgeGame,
  recordScanAttempt,
  restoreGame,
  savePlayerNote,
  saveSnapshot,
  unpinSnapshot,
  updateGameAfterScan,
  upsertGame
} from "./store.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          schedulerEnabled: true,
          scanIntervalHours: 6,
          writeTokenRequired: Boolean(env.ADMIN_TOKEN)
        });
      }

      // The dashboard is a public GitHub Pages site, so when ADMIN_TOKEN is set
      // every write must carry it. Reads stay open (API codes are masked).
      if (request.method !== "GET" && env.ADMIN_TOKEN && request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
        return json({ error: "Write token missing or wrong. Set it in the dashboard settings." }, 401);
      }

      if (request.method === "GET" && url.pathname === "/api/players") {
        return json({ players: await listPlayerNotes(env) });
      }

      if (request.method === "PUT" && url.pathname === "/api/players") {
        const payload = await request.json();
        if (!String(payload.alias || "").trim()) {
          return json({ error: "alias is required" }, 400);
        }
        return json({ player: await savePlayerNote(env, payload) });
      }

      if (request.method === "DELETE" && matchPath(url.pathname, "/api/players/:alias")) {
        const { alias } = pathParams(url.pathname, "/api/players/:alias");
        await deletePlayerNote(env, alias);
        return json({ ok: true });
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/snapshots/:snapshotId")) {
        const { snapshotId } = pathParams(url.pathname, "/api/snapshots/:snapshotId");
        const snapshot = await getSnapshot(env, snapshotId);
        return snapshot ? json({ snapshot }) : json({ error: "Snapshot not found" }, 404);
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/snapshots/:snapshotId/pin")) {
        const { snapshotId } = pathParams(url.pathname, "/api/snapshots/:snapshotId/pin");
        const payload = await request.json().catch(() => ({}));
        await pinSnapshot(env, snapshotId, payload.label || null);
        return json({ ok: true });
      }

      if (request.method === "DELETE" && matchPath(url.pathname, "/api/snapshots/:snapshotId/pin")) {
        const { snapshotId } = pathParams(url.pathname, "/api/snapshots/:snapshotId/pin");
        await unpinSnapshot(env, snapshotId);
        return json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/api/games") {
        return createGame(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/games") {
        return json({ games: await listGames(env) });
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/scan")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/scan");
        return scanGame(env, gameNumber);
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber/snapshots")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/snapshots");
        const game = await getGame(env, gameNumber);
        if (!game) {
          return json({ error: "Game not found" }, 404);
        }

        const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
        const pinnedOnly = url.searchParams.get("pinned") === "1";
        return json({ snapshots: await listSnapshotMeta(env, gameNumber, { pinnedOnly, limit }) });
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/capture")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/capture");
        return captureGame(env, gameNumber);
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/restore")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/restore");
        await restoreGame(env, gameNumber);
        return json({ game: await getGame(env, gameNumber) });
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber/intel")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/intel");
        const game = await getGame(env, gameNumber);
        if (!game) {
          return json({ error: "Game not found" }, 404);
        }

        const requestedWindow = normalizeWindow(url.searchParams.get("window"));
        const comparison = requestedWindow === "latest"
          ? await latestSnapshotsForCompare(env, gameNumber)
          : await comparisonSnapshotsForWindow(env, gameNumber, windowHours(requestedWindow));
        const { previous, current } = comparison;
        const events = previous && current ? diffSnapshots(previous, current) : [];
        const summary = current ? summarize(current) : {};
        const fetchHealth = await getGameFetchHealth(env, gameNumber);
        return json({
          window: requestedWindow,
          windowHours: windowHours(requestedWindow),
          summary,
          previous,
          current,
          events,
          fetchHealth,
          intel: current ? strategicIntel(summary, events) : []
        });
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber");
        const game = await getGame(env, gameNumber);
        return game ? json({ game }) : json({ error: "Game not found" }, 404);
      }

      if (request.method === "DELETE" && matchPath(url.pathname, "/api/games/:gameNumber")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber");
        // Default is a soft delete into "Deleted games"; ?purge=1 wipes history.
        if (url.searchParams.get("purge") === "1") {
          await purgeGame(env, gameNumber);
        } else {
          await archiveGame(env, gameNumber);
        }
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message || String(error) }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    const games = await enabledGamesWithCodes(env);
    for (const game of games) {
      ctx.waitUntil(scanSavedGame(env, game, "scheduler"));
    }
  }
};

async function createGame(request, env) {
  const payload = await request.json();
  const gameNumber = String(payload.game_number || "").trim();
  const code = String(payload.code || "").trim();

  if (!gameNumber || !code) {
    return json({ error: "game_number and code are required" }, 400);
  }

  try {
    const scanningData = await fetchScan(gameNumber, code);
    const name = payload.name || scanningData.name || scanningData.config?.name || `Game ${gameNumber}`;
    await upsertGame(env, gameNumber, code, name, scanningData.playerUid || null);
    const finished = isGameOver(scanningData);
    const snapshot = await saveSnapshot(env, gameNumber, scanningData, "backend-register", finished ? { pinned: true, label: "Final state" } : {});
    await updateGameAfterScan(env, gameNumber, scanningData, { finished });
    await recordScanAttempt(env, { gameNumber, source: "backend-register", success: true });
    return json({
      game: await getGame(env, gameNumber),
      snapshot: { ...snapshot, data: undefined }
    });
  } catch (error) {
    if (error instanceof NeptuneApiError) {
      await recordScanAttempt(env, { gameNumber, source: "backend-register", success: false, errorMessage: error.message });
      return json({ error: `Could not validate NP key: ${error.message}` }, 400);
    }
    throw error;
  }
}

async function scanGame(env, gameNumber) {
  const game = await gameWithCode(env, gameNumber);
  if (!game) {
    return json({ error: "Game not found" }, 404);
  }

  const result = await scanSavedGame(env, game, "backend-manual");
  return result.ok ? json(result) : json({ error: result.error }, 400);
}

// Scans now and pins the result. If NP no longer serves the game (it deletes
// finished games after about a week), pin the newest stored snapshot instead so
// the capture still works from history.
async function captureGame(env, gameNumber) {
  const game = await gameWithCode(env, gameNumber);
  if (!game) {
    return json({ error: "Game not found" }, 404);
  }

  const result = await scanSavedGame(env, game, "backend-capture", { pin: true });
  if (result.ok) {
    return json({ ...result, fromHistory: false });
  }

  const fallback = await latestSnapshot(env, gameNumber);
  if (!fallback) {
    return json({ error: result.error }, 400);
  }

  await pinSnapshot(env, fallback.id, fallback.label || "Captured from history");
  return json({
    ok: true,
    gameNumber,
    fromHistory: true,
    scanError: result.error,
    snapshot: { ...fallback, data: undefined, pinned: true }
  });
}

async function scanSavedGame(env, game, source, { pin = false } = {}) {
  try {
    const scanningData = await fetchScan(game.gameNumber, game.code);
    const finished = isGameOver(scanningData);
    const label = finished ? "Final state" : pin ? "Manual capture" : null;
    const snapshot = await saveSnapshot(env, game.gameNumber, scanningData, source, { pinned: pin || finished, label });
    await updateGameAfterScan(env, game.gameNumber, scanningData, { finished });
    await recordScanAttempt(env, { gameNumber: game.gameNumber, source, success: true });
    return { ok: true, gameNumber: game.gameNumber, snapshot: { ...snapshot, data: undefined } };
  } catch (error) {
    if (error instanceof NeptuneApiError) {
      await markKeyProblem(env, game.gameNumber, error.message);
      await recordScanAttempt(env, { gameNumber: game.gameNumber, source, success: false, errorMessage: error.message });
      return { ok: false, gameNumber: game.gameNumber, error: error.message };
    }
    // Network trouble reaching NP is not the key's fault: log it, keep the key.
    await recordScanAttempt(env, { gameNumber: game.gameNumber, source, success: false, errorMessage: error.message || String(error) });
    return { ok: false, gameNumber: game.gameNumber, error: `Could not reach Neptune's Pride: ${error.message || error}` };
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    }
  });
}

function matchPath(pathname, pattern) {
  const pathSegments = pathname.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);

  if (pathSegments.length !== patternSegments.length) {
    return false;
  }

  return patternSegments.every((segment, index) => segment.startsWith(":") || segment === pathSegments[index]);
}

function pathParams(pathname, pattern) {
  const params = {};
  const pathSegments = pathname.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);

  for (let index = 0; index < patternSegments.length; index += 1) {
    if (patternSegments[index].startsWith(":")) {
      params[patternSegments[index].slice(1)] = decodeURIComponent(pathSegments[index]);
    }
  }

  return params;
}

function normalizeWindow(value) {
  return value === "1h" || value === "6h" || value === "32h" ? value : "latest";
}

function windowHours(value) {
  if (value === "1h") {
    return 1;
  }
  if (value === "6h") {
    return 6;
  }
  if (value === "32h") {
    return 32;
  }
  return 0;
}
