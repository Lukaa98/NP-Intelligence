import { sendNtfy, threatNotification } from "./alerts.js";
import { ADMIN_ID, AuthError, cleanGameList, cleanPassword, cleanUsername, createUser, hashPassword, login, needsSetup, parseGameList, userFromRequest, userFromRow } from "./auth.js";
import { budgetState, countingEnv, DAILY_WRITE_LIMIT, HARD_LIMIT, recordUsage, SOFT_LIMIT, today, usageToday } from "./budget.js";
import { buildDiplomacy } from "./diplomacy.js";
import { detectThreats } from "./threats.js";
import { diffSnapshots, strategicIntel, summarize } from "./intel.js";
import { fetchScan, isGameOver, NeptuneApiError } from "./npApi.js";
import {
  activityByPlayer,
  playerActivityHistory,
  archiveGame,
  getSetting,
  listThreats,
  markThreatsNotified,
  openThreatCounts,
  openThreats,
  setSetting,
  updateThreats,
  backfillGamePlayers,
  knownPlayers,
  comparisonSnapshotsForWindow,
  deletePlayerNote,
  enabledGamesWithCodes,
  getGameFetchHealth,
  gameWithCode,
  getGame,
  getSnapshot,
  latestSnapshot,
  latestSnapshotMeta,
  latestSnapshotsForCompare,
  listGames,
  listPlayerNotes,
  listSnapshotMeta,
  markKeyProblem,
  pinSnapshot,
  gamesReadyForArchive,
  gamesWithPendingRelations,
  markExported,
  pendingRelationSnapshots,
  processRelations,
  pruneInactiveGames,
  purgeGame,
  recentRelationEvents,
  recordScanAttempt,
  relationRows,
  restoreGame,
  savePlayerNote,
  saveSnapshot,
  setNickname,
  unpinSnapshot,
  updateGameAfterScan,
  upsertGame,
  addFeedback,
  deleteFeedback,
  gameOwner,
  gamesByOwner,
  listFeedback,
  listUsers,
  purgeUserData,
  snapshotOwner,
  trackEvent,
  usageByUser
} from "./store.js";

// A live game whose scans have failed for this long is treated as gone (NP
// deletes finished games): its last state is pinned and its history dropped.
const STALE_GAME_HOURS = 48;

// Snapshots fed through relationship extraction per game per cron run, and
// per manual "analyze" request. Each one parses a full scan (up to ~1 MB).
// A full re-process (after a rule change) is spread over many cron runs so
// it doesn't burn the daily D1 write allowance at once.
const RELATION_BATCH_CRON = 3;
const RELATION_BUDGET_CRON = 4;
const RELATION_BATCH_REQUEST = 3;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-view-as"
};

export default {
  async fetch(request, rawEnv, ctx) {
    // Count every row this request writes; saved to usage_daily at the end.
    const { env, counter } = countingEnv(rawEnv);
    try {
      return await handleFetch(request, env, ctx, budgetState(await usageToday(rawEnv)));
    } finally {
      ctx.waitUntil(recordUsage(rawEnv, counter.written));
    }
  },

  async scheduled(controller, rawEnv, ctx) {
    const { env, counter } = countingEnv(rawEnv);
    const budget = budgetState(await usageToday(rawEnv));
    if (budget === "paused_all") {
      console.log("D1 write budget used up for today; skipping scheduled work.");
      return;
    }
    const games = await enabledGamesWithCodes(env);
    ctx.waitUntil((async () => {
      try {
        await Promise.all(games.map((game) => scanSavedGame(env, game, "scheduler")));
        if (budget === "ok") {
          // Spread backlogs (e.g. a fresh backfill) over several runs so one
          // cron invocation never parses more than RELATION_BUDGET_CRON snapshots.
          let remaining = RELATION_BUDGET_CRON;
          for (const gameNumber of await gamesWithPendingRelations(env)) {
            if (remaining <= 0) break;
            const { processed } = await processRelations(env, gameNumber, Math.min(RELATION_BATCH_CRON, remaining));
            remaining -= Math.max(processed, 1);
          }
          await backfillGamePlayers(env, 3);
          // Only prunes games whose history relationship intel has fully read.
          await pruneInactiveGames(env, STALE_GAME_HOURS);
        }
      } finally {
        await recordUsage(rawEnv, counter.written);
      }
    })());
  }
};

const BUDGET_MESSAGES = {
  paused_optional: "Paused for today to stay inside Cloudflare's free D1 limit; resumes at 00:00 UTC.",
  paused_all: "Database writes are paused for today to stay inside Cloudflare's free D1 limit; resumes at 00:00 UTC."
};

async function handleFetch(request, env, ctx, budget) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          schedulerEnabled: true,
          staleGameHours: STALE_GAME_HOURS,
          loginRequired: true
        });
      }

      if (request.method === "GET" && url.pathname === "/api/auth/status") {
        return json({ needsSetup: await needsSetup(env), setupNeedsToken: Boolean(env.ADMIN_TOKEN) });
      }

      // First run: create the admin account. Guarded by the existing write
      // token (ADMIN_TOKEN) so nobody else can claim the site first.
      if (request.method === "POST" && url.pathname === "/api/auth/setup") {
        if (!(await needsSetup(env))) {
          return json({ error: "The admin account already exists. Log in instead." }, 409);
        }
        const payload = await request.json().catch(() => ({}));
        if (env.ADMIN_TOKEN && String(payload.writeToken || "").trim() !== env.ADMIN_TOKEN) {
          return json({ error: "Write token missing or wrong." }, 401);
        }
        const username = cleanUsername(payload.username);
        const password = cleanPassword(payload.password);
        await createUser(env, { id: ADMIN_ID, username, password, role: "admin" });
        return json(await login(env, username, password));
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const payload = await request.json().catch(() => ({}));
        const result = await login(env, payload.username, payload.password);
        if (!result.user.isAdmin) await trackEvent(env, result.user.id, "login");
        return json(result);
      }

      const caller = await userFromRequest(env, request);
      if (!caller) {
        return json({ error: "Please log in.", login: true }, 401);
      }
      // The admin can look at the site exactly as one tester sees it.
      let user = caller;
      const viewAs = request.headers.get("x-view-as");
      if (viewAs && caller.isAdmin && viewAs !== caller.id) {
        const row = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(viewAs).first();
        if (row) user = userFromRow(row);
      }
      const owner = user.id;
      const track = (event) => (caller.isAdmin ? null : trackEvent(env, caller.id, event));

      // Game and snapshot routes: only the game's owner (or the admin).
      const gamePath = url.pathname.match(/^\/api\/games\/([^/]+)/);
      const snapshotPath = url.pathname.match(/^\/api\/snapshots\/([^/]+)/);
      const ownerOfTarget = gamePath ? await gameOwner(env, decodeURIComponent(gamePath[1]))
        : snapshotPath ? await snapshotOwner(env, decodeURIComponent(snapshotPath[1])) : null;
      if (ownerOfTarget && ownerOfTarget !== owner && !caller.isAdmin) {
        return json({ error: gamePath ? "Game not found" : "Snapshot not found" }, 404);
      }

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        return json({ user: caller, viewingAs: user.id !== caller.id ? user : null });
      }

      if (request.method === "POST" && url.pathname === "/api/track") {
        const payload = await request.json().catch(() => ({}));
        if (/^[a-z0-9_:-]{1,40}$/.test(String(payload.event || ""))) await track(payload.event);
        return json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/api/feedback") {
        const payload = await request.json().catch(() => ({}));
        const message = String(payload.message || "").trim();
        if (!message) return json({ error: "Write something first." }, 400);
        await addFeedback(env, caller.id, payload.page, message);
        return json({ ok: true });
      }

      const adminResponse = await handleAdmin(request, env, url, caller);
      if (adminResponse) return adminResponse;

      // Everything below that isn't about the caller's own games is admin-only.
      const adminOnly = url.pathname === "/api/usage" || url.pathname === "/api/settings" || url.pathname === "/api/alerts/test"
        || url.pathname === "/api/archive/pending" || matchPath(url.pathname, "/api/games/:gameNumber/exported");
      if (adminOnly && !caller.isAdmin) {
        return json({ error: "Admin only." }, 403);
      }

      if (request.method === "GET" && url.pathname === "/api/usage") {
        const rowsWritten = await usageToday(env);
        return json({ day: today(), rowsWritten, limit: DAILY_WRITE_LIMIT, softLimit: SOFT_LIMIT, hardLimit: HARD_LIMIT, state: budgetState(rowsWritten) });
      }

      // Writes that make new data stop once the day's budget is nearly used up.
      const heavyWrite = request.method === "POST" && (
        url.pathname === "/api/games"
        || matchPath(url.pathname, "/api/games/:gameNumber/scan")
        || matchPath(url.pathname, "/api/games/:gameNumber/capture")
      );
      if (heavyWrite && budget === "paused_all") {
        return json({ error: BUDGET_MESSAGES.paused_all, budget }, 429);
      }
      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/relations/process") && budget !== "ok") {
        return json({ error: BUDGET_MESSAGES[budget], budget }, 429);
      }

      if (request.method === "GET" && url.pathname === "/api/settings") {
        const topic = await getSetting(env, "ntfy_topic");
        // The topic works like a password for your alerts, so only a hint is returned.
        return json({ ntfyTopicSet: Boolean(topic), ntfyTopicHint: topic ? `…${topic.slice(-4)}` : "" });
      }

      if (request.method === "PUT" && url.pathname === "/api/settings") {
        const payload = await request.json();
        if (payload.ntfyTopic !== undefined) {
          const topic = String(payload.ntfyTopic || "").trim();
          if (topic && !/^[A-Za-z0-9_-]{6,64}$/.test(topic)) {
            return json({ error: "Topic must be 6-64 letters, numbers, - or _." }, 400);
          }
          await setSetting(env, "ntfy_topic", topic);
        }
        return json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/api/alerts/test") {
        const topic = await getSetting(env, "ntfy_topic");
        if (!topic) {
          return json({ error: "Save an ntfy topic first." }, 400);
        }
        await sendNtfy(topic, {
          title: "NP Intelligence test alert",
          message: "If you can read this, attack alerts will reach this phone.",
          tags: ["white_check_mark"],
          priority: 3
        });
        return json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/api/threats") {
        return json({ counts: await openThreatCounts(env, owner), threats: await openThreats(env, owner) });
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber/threats")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/threats");
        return json({ threats: await listThreats(env, gameNumber) });
      }

      if (request.method === "GET" && url.pathname === "/api/archive/pending") {
        return json({ games: await gamesReadyForArchive(env, STALE_GAME_HOURS) });
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/exported")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/exported");
        const payload = await request.json().catch(() => ({}));
        await markExported(env, gameNumber, payload.ref);
        return json({ game: await getGame(env, gameNumber) });
      }

      if (request.method === "GET" && url.pathname === "/api/players") {
        return json({ players: await listPlayerNotes(env, owner) });
      }

      if (request.method === "PUT" && url.pathname === "/api/players") {
        const payload = await request.json();
        if (!String(payload.alias || "").trim()) {
          return json({ error: "alias is required" }, 400);
        }
        return json({ player: await savePlayerNote(env, owner, payload) });
      }

      if (request.method === "DELETE" && matchPath(url.pathname, "/api/players/:alias")) {
        const { alias } = pathParams(url.pathname, "/api/players/:alias");
        await deletePlayerNote(env, owner, alias);
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
        await track("add_game");
        return createGame(request, env, user);
      }

      if (request.method === "GET" && url.pathname === "/api/games") {
        return json({ games: await listGames(env, owner) });
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/scan")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/scan");
        await track("scan");
        return scanGame(env, gameNumber);
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber/snapshots")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/snapshots");
        const game = await getGame(env, gameNumber);
        if (!game) {
          return json({ error: "Game not found" }, 404);
        }

        // Metadata only (no scan payloads), so long games can list every scan.
        const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 5000));
        const pinnedOnly = url.searchParams.get("pinned") === "1";
        return json({ snapshots: await listSnapshotMeta(env, gameNumber, { pinnedOnly, limit }) });
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/capture")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/capture");
        await track("capture");
        return captureGame(env, gameNumber);
      }

      if (request.method === "PUT" && matchPath(url.pathname, "/api/games/:gameNumber")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber");
        const payload = await request.json();
        if (payload.nickname !== undefined) {
          await setNickname(env, gameNumber, payload.nickname);
        }
        const game = await getGame(env, gameNumber);
        return game ? json({ game }) : json({ error: "Game not found" }, 404);
      }

      if (request.method === "POST" && matchPath(url.pathname, "/api/games/:gameNumber/relations/process")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/relations/process");
        return json(await processRelations(env, gameNumber, RELATION_BATCH_REQUEST));
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber/known-players")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/known-players");
        if (budget === "ok") {
          await backfillGamePlayers(env, 10);
        }
        return json({ players: await knownPlayers(env, gameNumber) });
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber/players/:uid/activity")) {
        const { gameNumber, uid } = pathParams(url.pathname, "/api/games/:gameNumber/players/:uid/activity");
        return json(await playerActivityHistory(env, gameNumber, Number(uid)));
      }

      if (request.method === "GET" && matchPath(url.pathname, "/api/games/:gameNumber/diplomacy")) {
        const { gameNumber } = pathParams(url.pathname, "/api/games/:gameNumber/diplomacy");
        return diplomacyForGame(env, gameNumber);
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
          // Pin the latest scan so a deleted game always keeps a viewable map;
          // the next cron run drops its unpinned history.
          const latest = await latestSnapshotMeta(env, gameNumber);
          if (latest && !latest.pinned) {
            await pinSnapshot(env, latest.id, "Last state before delete");
          }
          await archiveGame(env, gameNumber);
        }
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status);
      return json({ error: error.message || String(error) }, 500);
    }
}

// Admin page: testers, their games and usage, and feedback.
async function handleAdmin(request, env, url, caller) {
  if (!url.pathname.startsWith("/api/admin/")) return null;
  if (!caller.isAdmin) return json({ error: "Admin only." }, 403);

  if (request.method === "GET" && url.pathname === "/api/admin/users") {
    const [rows, games, usage] = await Promise.all([listUsers(env), gamesByOwner(env), usageByUser(env, 30)]);
    return json({
      users: rows.map((row) => {
        const mine = usage.filter((item) => item.owner === row.id);
        const totals = {};
        for (const item of mine) totals[item.event] = (totals[item.event] || 0) + item.count;
        return {
          ...userFromRow(row),
          games: games.filter((game) => game.owner === row.id),
          usage: { totals, activeDays: new Set(mine.map((item) => item.day)).size, lastActiveDay: mine[0]?.day || null, byDay: mine }
        };
      })
    });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users") {
    const payload = await request.json().catch(() => ({}));
    const username = cleanUsername(payload.username);
    const id = username.toLowerCase();
    if (id === ADMIN_ID) return json({ error: "That username is reserved." }, 400);
    if (await env.DB.prepare(`SELECT 1 FROM users WHERE id = ? OR username = ?`).bind(id, username).first()) {
      return json({ error: `User ${username} already exists.` }, 409);
    }
    const user = await createUser(env, { id, username, password: cleanPassword(payload.password), assignedGames: cleanGameList(payload.assignedGames) });
    return json({ user });
  }

  const userPath = url.pathname.match(/^\/api\/admin\/users\/([^/]+)(\/games)?$/);
  if (userPath) {
    const id = decodeURIComponent(userPath[1]);
    const row = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
    if (!row) return json({ error: "User not found" }, 404);

    if (request.method === "PUT" && !userPath[2]) {
      const payload = await request.json().catch(() => ({}));
      if (payload.password !== undefined) {
        const { hash, salt } = await hashPassword(cleanPassword(payload.password));
        await env.DB.prepare(`UPDATE users SET password_hash = ?, salt = ? WHERE id = ?`).bind(hash, salt, id).run();
      }
      // Assigned games: a game taken away also erases the tester's copy of it.
      if (payload.assignedGames !== undefined && row.role !== "admin") {
        const games = cleanGameList(payload.assignedGames);
        const removed = parseGameList(row.locked_game).filter((game) => !games.includes(game));
        await env.DB.prepare(`UPDATE users SET locked_game = ? WHERE id = ?`).bind(games.join(",") || null, id).run();
        for (const game of removed) await purgeGame(env, `${game}~${id}`);
      }
      if (payload.disabled !== undefined && row.role !== "admin") {
        await env.DB.prepare(`UPDATE users SET disabled = ? WHERE id = ?`).bind(payload.disabled ? 1 : 0, id).run();
      }
      return json({ user: userFromRow(await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first()) });
    }

    if (request.method === "DELETE" && userPath[2]) {
      return json({ erased: await purgeUserData(env, id) });
    }

    if (request.method === "DELETE" && !userPath[2]) {
      if (row.role === "admin") return json({ error: "The admin account can't be deleted." }, 400);
      const erased = await purgeUserData(env, id, { notes: true });
      await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
      return json({ erased });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/admin/feedback") {
    return json({ feedback: await listFeedback(env) });
  }

  const feedbackPath = url.pathname.match(/^\/api\/admin\/feedback\/(\d+)$/);
  if (request.method === "DELETE" && feedbackPath) {
    await deleteFeedback(env, feedbackPath[1]);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

async function createGame(request, env, user) {
  const payload = await request.json();
  const number = String(payload.game_number || "").trim();
  const code = String(payload.code || "").trim();
  const nickname = String(payload.name || "").trim();

  if (!number || !code) {
    return json({ error: "game_number and code are required" }, 400);
  }
  if (!/^\d{1,20}$/.test(number)) {
    return json({ error: "Game number must be digits only." }, 400);
  }
  if (user.assignedGames?.length && !user.assignedGames.includes(number)) {
    return json({ error: `Your account is set up for game ${user.assignedGames.join(", ")} only.` }, 403);
  }
  // The admin's games keep their plain number; a tester's copy of a game
  // gets its own key so two people can track the same game separately.
  const gameNumber = user.id === ADMIN_ID ? number : `${number}~${user.id}`;

  let scanningData;
  try {
    scanningData = await fetchScan(gameNumber, code);
  } catch (error) {
    const message = error instanceof NeptuneApiError
      ? `Could not validate NP key: ${error.message}`
      : `Could not reach Neptune's Pride: ${error.message || error}`;
    await recordScanAttempt(env, { gameNumber, source: "backend-register", success: false, errorMessage: message });
    return json({ error: message }, 400);
  }

  const existing = await getGame(env, gameNumber);
  const name = scanningData.name || scanningData.config?.name || `Game ${gameNumber}`;
  await upsertGame(env, gameNumber, code, name, scanningData.playerUid ?? null, user.id);
  // The form's "Name" is your own label; NP's name is refreshed by every scan.
  if (nickname) {
    await setNickname(env, gameNumber, nickname);
  }

  // Re-saving a tracked game (e.g. a fresh API code) shouldn't store a
  // duplicate scan of a tick we already have.
  const finished = isGameOver(scanningData);
  const tick = Number(scanningData.tick || 0);
  const latest = await latestSnapshotMeta(env, gameNumber);
  let snapshot = latest;
  if (!latest || latest.tick !== tick || (finished && !latest.pinned)) {
    snapshot = await saveSnapshot(env, gameNumber, scanningData, "backend-register", finished ? { pinned: true, label: "Final state" } : {});
  }
  await updateGameAfterScan(env, gameNumber, scanningData, { finished });
  if (!finished) {
    await checkThreats(env, await getGame(env, gameNumber), scanningData, snapshot.id);
  }
  await recordScanAttempt(env, { gameNumber, source: "backend-register", success: true });
  await backfillGamePlayers(env, 10);
  return json({
    game: await getGame(env, gameNumber),
    existing: Boolean(existing),
    knownPlayers: await knownPlayers(env, gameNumber),
    snapshot: { ...snapshot, data: undefined }
  });
}

async function diplomacyForGame(env, gameNumber) {
  const game = await getGame(env, gameNumber);
  if (!game) {
    return json({ error: "Game not found" }, 404);
  }

  const [rows, events, latest, pending, activity] = await Promise.all([
    relationRows(env, gameNumber),
    recentRelationEvents(env, gameNumber, 1000),
    latestSnapshot(env, gameNumber),
    pendingRelationSnapshots(env, gameNumber),
    activityByPlayer(env, gameNumber, game.relationTick ?? 0)
  ]);

  const players = Object.values(latest?.data?.players || {}).map((player) => ({
    uid: player.uid,
    alias: player.alias,
    color: player.color,
    shape: player.shape,
    totalStars: player.totalStars ?? player.total_stars ?? 0,
    totalStrength: player.totalStrength ?? player.total_strength ?? 0,
    conceded: player.conceded || 0,
    ai: player.ai || 0
  }));

  return json({
    gameNumber,
    pendingSnapshots: pending,
    activity: activityVerdicts(activity, players, game.relationTick ?? 0),
    players,
    ...buildDiplomacy({
      rows,
      events,
      players,
      viewerUid: latest?.data?.playerUid ?? latest?.data?.player_uid ?? null,
      snapshotsProcessed: game.relationSnapshots,
      latestTick: game.relationTick ?? 0
    })
  });
}

// Turns raw action counts into a verdict per player. Ticks are hourly, so a
// 24-tick window is roughly a day.
function activityVerdicts(activity, players, latestTick) {
  const result = {};
  for (const player of players) {
    const stats = activity.players[player.uid] || {
      day: { infra: 0, carriers: 0, orders: 0, captures: 0 },
      twoDays: { infra: 0, carriers: 0, orders: 0, captures: 0 },
      lastActionTick: null
    };
    const any = (window) => Object.values(window).some((value) => value > 0);
    let status;
    if (player.ai || player.conceded) status = "ai";
    else if (any(stats.day)) status = "active";
    else if (activity.observedTicks < 12) status = "unknown";
    else if (any(stats.twoDays) || activity.observedTicks < 48) status = "possibly_afk";
    else status = "afk";
    result[player.uid] = {
      status,
      ...stats,
      ticksSinceAction: stats.lastActionTick === null ? null : latestTick - stats.lastActionTick,
      observedTicks: activity.observedTicks
    };
  }
  return result;
}

async function scanGame(env, gameNumber) {
  const game = await gameWithCode(env, gameNumber);
  if (!game) {
    return json({ error: "Game not found" }, 404);
  }

  const result = await scanSavedGame(env, game, "backend-manual");
  if (result.ok && !result.unchanged) {
    await processRelations(env, gameNumber, RELATION_BATCH_REQUEST);
  }
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

// New tick: find enemy fleets heading at the viewer's stars, keep the threat
// list current, and send one phone alert for any fleet seen for the first time.
async function checkThreats(env, game, scanningData, snapshotId) {
  try {
    const fresh = await updateThreats(env, game.gameNumber, Number(scanningData.tick || 0), detectThreats(scanningData), scanningData, snapshotId);
    if (!fresh.length) return;
    const topic = await getSetting(env, "ntfy_topic");
    if (!topic) return;
    await sendNtfy(topic, threatNotification(env, game, fresh, snapshotId));
    await markThreatsNotified(env, game.gameNumber, fresh.map((threat) => threat.key));
  } catch (error) {
    // Alerts must never break scanning; the in-app list still updates next tick.
    console.error("threat check failed", game.gameNumber, error);
  }
}

async function scanSavedGame(env, game, source, { pin = false } = {}) {
  try {
    const scanningData = await fetchScan(game.gameNumber, game.code);
    const finished = isGameOver(scanningData);
    const tick = Number(scanningData.tick || 0);
    const latest = await latestSnapshotMeta(env, game.gameNumber);

    // Hourly scans often land on the same tick; don't store duplicates unless
    // this is a capture or the first time we see the game is over.
    if (!pin && latest && latest.tick === tick && (!finished || latest.pinned)) {
      // No new tick: nothing changed, so nothing is written. The one
      // exception is a game whose key had been failing: mark it working again.
      if (game.keyStatus === "needs_fresh_key" || (finished && !game.finishedAt)) {
        await updateGameAfterScan(env, game.gameNumber, scanningData, { finished, players: false });
      }
      return { ok: true, gameNumber: game.gameNumber, unchanged: true, snapshot: latest };
    }

    const label = finished ? "Final state" : pin ? "Manual capture" : null;
    const snapshot = await saveSnapshot(env, game.gameNumber, scanningData, source, { pinned: pin || finished, label });
    await updateGameAfterScan(env, game.gameNumber, scanningData, { finished });
    if (!finished) {
      await checkThreats(env, game, scanningData, snapshot.id);
    }
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
