function nowIso() {
  return new Date().toISOString();
}

function snapshotId(gameNumber, tick) {
  return `${gameNumber}-${tick}-${Date.now()}`;
}

function attemptId(gameNumber) {
  return `${gameNumber}-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function upsertGame(env, gameNumber, code, name, playerUid = null) {
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO games (
      game_number,
      code,
      name,
      player_uid,
      enabled,
      key_status,
      key_status_message,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 1, 'valid', 'Saved key worked on the last successful scan.', ?, ?)
    ON CONFLICT(game_number) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      player_uid = COALESCE(excluded.player_uid, games.player_uid),
      enabled = 1,
      archived_at = NULL,
      key_status = 'valid',
      key_status_message = 'Saved key worked on the last successful scan.',
      updated_at = excluded.updated_at
  `).bind(gameNumber, code, name, playerUid, timestamp, timestamp).run();
}

export async function updateGameAfterScan(env, gameNumber, scanningData, { finished = false } = {}) {
  const timestamp = nowIso();
  const name = scanningData.name || scanningData.config?.name || `Game ${gameNumber}`;
  await env.DB.prepare(`
    UPDATE games
    SET
      name = ?,
      player_uid = ?,
      last_tick = ?,
      last_sync_at = ?,
      key_status = 'valid',
      key_status_message = 'Saved key worked on the last successful scan.',
      finished_at = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END,
      updated_at = ?
    WHERE game_number = ?
  `).bind(name, scanningData.playerUid ?? scanningData.player_uid ?? null, Number(scanningData.tick || 0), timestamp, finished ? 1 : 0, timestamp, timestamp, gameNumber).run();
}

export async function markKeyProblem(env, gameNumber, message) {
  const timestamp = nowIso();
  await env.DB.prepare(`
    UPDATE games
    SET
      key_status = 'needs_fresh_key',
      key_status_message = ?,
      last_error_at = ?,
      updated_at = ?
    WHERE game_number = ?
  `).bind(message, timestamp, timestamp, gameNumber).run();
}

export async function saveSnapshot(env, gameNumber, scanningData, source, { pinned = false, label = null } = {}) {
  const capturedAt = nowIso();
  const tick = Number(scanningData.tick || 0);
  const snapshot = {
    id: snapshotId(gameNumber, tick),
    gameNumber: String(gameNumber),
    source,
    capturedAt,
    tick,
    productionCounter: Number(scanningData.productionCounter || 0),
    productionRate: Number(scanningData.productionRate || 0),
    playerUid: Number(scanningData.playerUid || 0),
    gameName: scanningData.name || scanningData.config?.name || `Game ${gameNumber}`,
    pinned,
    label,
    data: scanningData
  };

  await env.DB.prepare(`
    INSERT INTO snapshots (
      id,
      game_number,
      tick,
      source,
      captured_at,
      production_counter,
      production_rate,
      player_uid,
      game_name,
      data_json,
      pinned,
      label
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    snapshot.id,
    snapshot.gameNumber,
    snapshot.tick,
    snapshot.source,
    snapshot.capturedAt,
    snapshot.productionCounter,
    snapshot.productionRate,
    snapshot.playerUid,
    snapshot.gameName,
    JSON.stringify(scanningData),
    pinned ? 1 : 0,
    label
  ).run();

  return snapshot;
}

export async function listGames(env) {
  const rows = await env.DB.prepare(`
    SELECT *
    FROM games
    ORDER BY COALESCE(last_sync_at, created_at) DESC
  `).all();
  return rows.results.map(gameFromRow);
}

export async function getGame(env, gameNumber) {
  const row = await env.DB.prepare(`
    SELECT *
    FROM games
    WHERE game_number = ?
  `).bind(gameNumber).first();
  return row ? gameFromRow(row) : null;
}

export async function archiveGame(env, gameNumber) {
  const timestamp = nowIso();
  await env.DB.prepare(`
    UPDATE games
    SET archived_at = COALESCE(archived_at, ?), updated_at = ?
    WHERE game_number = ?
  `).bind(timestamp, timestamp, gameNumber).run();
}

export async function restoreGame(env, gameNumber) {
  await env.DB.prepare(`
    UPDATE games
    SET archived_at = NULL, updated_at = ?
    WHERE game_number = ?
  `).bind(nowIso(), gameNumber).run();
}

export async function purgeGame(env, gameNumber) {
  await env.DB.prepare(`DELETE FROM scan_attempts WHERE game_number = ?`).bind(gameNumber).run();
  await env.DB.prepare(`DELETE FROM snapshots WHERE game_number = ?`).bind(gameNumber).run();
  await env.DB.prepare(`DELETE FROM games WHERE game_number = ?`).bind(gameNumber).run();
}

export async function listSnapshots(env, gameNumber, limit = 50) {
  const rows = await env.DB.prepare(`
    SELECT *
    FROM snapshots
    WHERE game_number = ?
    ORDER BY tick DESC, captured_at DESC
    LIMIT ?
  `).bind(gameNumber, limit).all();
  return rows.results.map(snapshotFromRow);
}

// Lists snapshots without their (large) scan payloads, for history pickers.
export async function listSnapshotMeta(env, gameNumber, { pinnedOnly = false, limit = 100 } = {}) {
  const rows = await env.DB.prepare(`
    SELECT id, game_number, tick, source, captured_at, production_counter, production_rate, player_uid, game_name, pinned, label
    FROM snapshots
    WHERE game_number = ? ${pinnedOnly ? "AND pinned = 1" : ""}
    ORDER BY captured_at DESC
    LIMIT ?
  `).bind(gameNumber, limit).all();
  return rows.results.map(snapshotMetaFromRow);
}

export async function getSnapshot(env, snapshotId) {
  const row = await env.DB.prepare(`SELECT * FROM snapshots WHERE id = ?`).bind(snapshotId).first();
  return row ? snapshotFromRow(row) : null;
}

export async function latestSnapshot(env, gameNumber) {
  const row = await env.DB.prepare(`
    SELECT *
    FROM snapshots
    WHERE game_number = ?
    ORDER BY captured_at DESC
    LIMIT 1
  `).bind(gameNumber).first();
  return row ? snapshotFromRow(row) : null;
}

export async function pinSnapshot(env, snapshotId, label = null) {
  await env.DB.prepare(`
    UPDATE snapshots
    SET pinned = 1, label = COALESCE(?, label)
    WHERE id = ?
  `).bind(label, snapshotId).run();
}

export async function unpinSnapshot(env, snapshotId) {
  await env.DB.prepare(`UPDATE snapshots SET pinned = 0 WHERE id = ?`).bind(snapshotId).run();
}

export async function latestSnapshotsForCompare(env, gameNumber) {
  const snapshots = await listSnapshots(env, gameNumber, 2);
  return {
    previous: snapshots[1] || null,
    current: snapshots[0] || null
  };
}

export async function comparisonSnapshotsForWindow(env, gameNumber, hours) {
  const currentRow = await env.DB.prepare(`
    SELECT *
    FROM snapshots
    WHERE game_number = ?
    ORDER BY captured_at DESC
    LIMIT 1
  `).bind(gameNumber).first();

  if (!currentRow) {
    return { current: null, previous: null };
  }

  const current = snapshotFromRow(currentRow);
  const targetIso = new Date(Date.parse(current.capturedAt) - hours * 60 * 60 * 1000).toISOString();

  const previousRow = await env.DB.prepare(`
    SELECT *
    FROM snapshots
    WHERE game_number = ?
      AND captured_at <= ?
    ORDER BY captured_at DESC
    LIMIT 1
  `).bind(gameNumber, targetIso).first();

  return {
    current,
    previous: previousRow ? snapshotFromRow(previousRow) : null
  };
}

export async function gameWithCode(env, gameNumber) {
  const row = await env.DB.prepare(`
    SELECT *
    FROM games
    WHERE game_number = ?
  `).bind(gameNumber).first();

  if (!row) {
    return null;
  }

  const game = gameFromRow(row);
  game.code = row.code;
  return game;
}

export async function enabledGamesWithCodes(env) {
  const rows = await env.DB.prepare(`
    SELECT *
    FROM games
    WHERE enabled = 1
      AND key_status != 'needs_fresh_key'
      AND archived_at IS NULL
      AND finished_at IS NULL
  `).all();

  return rows.results.map((row) => {
    const game = gameFromRow(row);
    game.code = row.code;
    return game;
  });
}

export async function recordScanAttempt(env, { gameNumber, source, success, errorMessage = null }) {
  const attemptedAt = nowIso();
  await env.DB.prepare(`
    INSERT INTO scan_attempts (
      id,
      game_number,
      source,
      attempted_at,
      success,
      error_message
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    attemptId(gameNumber),
    String(gameNumber),
    source,
    attemptedAt,
    success ? 1 : 0,
    errorMessage
  ).run();
}

export async function getGameFetchHealth(env, gameNumber) {
  const rows = await env.DB.prepare(`
    SELECT game_number, source, attempted_at, success, error_message
    FROM scan_attempts
    WHERE game_number = ?
    ORDER BY attempted_at DESC
    LIMIT 50
  `).bind(gameNumber).all();

  const attempts = rows.results.map((row) => ({
    gameNumber: row.game_number,
    source: row.source,
    attemptedAt: row.attempted_at,
    success: Boolean(row.success),
    errorMessage: row.error_message || ""
  }));

  const latestSuccess = attempts.find((attempt) => attempt.success) || null;
  const latestFailure = attempts.find((attempt) => !attempt.success) || null;
  const failuresLast24h = attempts.filter((attempt) => !attempt.success && Date.now() - Date.parse(attempt.attemptedAt) <= 24 * 60 * 60 * 1000).length;
  const consecutiveFailures = countLeadingFailures(attempts);
  const activeOutageAttempts = consecutiveFailures > 0 ? attempts.slice(0, consecutiveFailures) : [];
  const recentFailures = attempts.filter((attempt) => !attempt.success).slice(0, 5);

  return {
    totalAttemptsTracked: attempts.length,
    latestSuccessAt: latestSuccess?.attemptedAt || null,
    latestFailureAt: latestFailure?.attemptedAt || null,
    latestFailureMessage: latestFailure?.errorMessage || "",
    failuresLast24h,
    consecutiveFailures,
    activeOutage: consecutiveFailures > 0 ? {
      startedAt: activeOutageAttempts[activeOutageAttempts.length - 1]?.attemptedAt || activeOutageAttempts[0]?.attemptedAt || null,
      latestAttemptAt: activeOutageAttempts[0]?.attemptedAt || null,
      attemptsMissed: activeOutageAttempts.length
    } : null,
    estimatedFailureGapHours: estimateFailureGapHours(recentFailures),
    recentFailures
  };
}

function countLeadingFailures(attempts) {
  let count = 0;
  for (const attempt of attempts) {
    if (attempt.success) {
      break;
    }
    count += 1;
  }
  return count;
}

function estimateFailureGapHours(failures) {
  if (failures.length < 2) {
    return null;
  }

  const gaps = [];
  for (let index = 0; index < failures.length - 1; index += 1) {
    const current = Date.parse(failures[index].attemptedAt);
    const next = Date.parse(failures[index + 1].attemptedAt);
    const hours = (current - next) / (60 * 60 * 1000);
    if (Number.isFinite(hours) && hours > 0) {
      gaps.push(hours);
    }
  }

  if (!gaps.length) {
    return null;
  }

  const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  return Math.round(average * 10) / 10;
}

function gameFromRow(row) {
  return {
    gameNumber: row.game_number,
    name: row.name,
    playerUid: row.player_uid,
    enabled: Boolean(row.enabled),
    keyStatus: row.key_status,
    keyStatusMessage: row.key_status_message,
    lastTick: row.last_tick,
    lastSyncAt: row.last_sync_at,
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || null,
    finishedAt: row.finished_at || null,
    apiKeyPreview: maskKey(row.code)
  };
}

function snapshotMetaFromRow(row) {
  return {
    id: row.id,
    gameNumber: row.game_number,
    source: row.source,
    capturedAt: row.captured_at,
    tick: row.tick,
    productionCounter: row.production_counter,
    productionRate: row.production_rate,
    playerUid: row.player_uid,
    gameName: row.game_name,
    pinned: Boolean(row.pinned),
    label: row.label || ""
  };
}

function snapshotFromRow(row) {
  return {
    ...snapshotMetaFromRow(row),
    data: JSON.parse(row.data_json)
  };
}

export function aliasKey(alias) {
  return String(alias || "").trim().toLowerCase();
}

export async function listPlayerNotes(env) {
  const rows = await env.DB.prepare(`
    SELECT *
    FROM player_notes
    ORDER BY updated_at DESC
  `).all();
  return rows.results.map(playerNoteFromRow);
}

// Upserts a rating/note. `game` ({ gameNumber, gameName }) is appended to the
// list of games the player was rated from, so the Players page can show where
// you met them.
export async function savePlayerNote(env, { alias, rating, note, game }) {
  const key = aliasKey(alias);
  const existing = await env.DB.prepare(`SELECT * FROM player_notes WHERE alias_key = ?`).bind(key).first();
  const games = existing ? JSON.parse(existing.games_json || "[]") : [];
  if (game?.gameNumber && !games.some((item) => String(item.gameNumber) === String(game.gameNumber))) {
    games.push({ gameNumber: String(game.gameNumber), gameName: String(game.gameName || `Game ${game.gameNumber}`) });
  }

  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO player_notes (alias_key, alias, rating, note, games_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(alias_key) DO UPDATE SET
      alias = excluded.alias,
      rating = excluded.rating,
      note = excluded.note,
      games_json = excluded.games_json,
      updated_at = excluded.updated_at
  `).bind(
    key,
    String(alias).trim(),
    Math.max(-1, Math.min(1, Number(rating) || 0)),
    String(note || ""),
    JSON.stringify(games),
    timestamp,
    timestamp
  ).run();

  return playerNoteFromRow(await env.DB.prepare(`SELECT * FROM player_notes WHERE alias_key = ?`).bind(key).first());
}

export async function deletePlayerNote(env, alias) {
  await env.DB.prepare(`DELETE FROM player_notes WHERE alias_key = ?`).bind(aliasKey(alias)).run();
}

function playerNoteFromRow(row) {
  return {
    aliasKey: row.alias_key,
    alias: row.alias,
    rating: row.rating,
    note: row.note,
    games: JSON.parse(row.games_json || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function maskKey(key = "") {
  if (!key) {
    return "";
  }

  if (key.length <= 6) {
    return "****";
  }

  return `${key.slice(0, 3)}****${key.slice(-3)}`;
}
