import { extractRelations, RELATIONS_VERSION } from "./relations.js";

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
  const playerUid = scanningData.playerUid ?? scanningData.player_uid;
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
      player_count = ?,
      my_alias = ?,
      updated_at = ?
    WHERE game_number = ?
  `).bind(
    name,
    playerUid ?? null,
    Number(scanningData.tick || 0),
    timestamp,
    finished ? 1 : 0,
    timestamp,
    Object.keys(scanningData.players || {}).length || null,
    scanningData.players?.[playerUid]?.alias || null,
    timestamp,
    gameNumber
  ).run();
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

export async function setNickname(env, gameNumber, nickname) {
  const cleaned = String(nickname || "").trim().slice(0, 120);
  await env.DB.prepare(`UPDATE games SET nickname = ?, updated_at = ? WHERE game_number = ?`)
    .bind(cleaned || null, nowIso(), gameNumber).run();
}

export async function purgeGame(env, gameNumber) {
  await env.DB.prepare(`DELETE FROM relation_events WHERE game_number = ?`).bind(gameNumber).run();
  await env.DB.prepare(`DELETE FROM relations WHERE game_number = ?`).bind(gameNumber).run();
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
    SELECT id, game_number, tick, source, captured_at, production_counter, production_rate, player_uid, game_name, pinned, label,
      LENGTH(data_json) AS size_bytes
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

export async function latestSnapshotMeta(env, gameNumber) {
  const [latest] = await listSnapshotMeta(env, gameNumber, { limit: 1 });
  return latest || null;
}

// History is kept in full while a game is live. Once a game stops producing
// data (finished, deleted by you, or NP has refused scans for `staleHours`),
// its latest scan is pinned and the unpinned hourly history is dropped, but
// only after relationship intel has processed every snapshot, so the alliance
// and war record outlives the snapshots it came from.
const RELATIONS_CAUGHT_UP = `(
  COALESCE(games.relation_tick, -1) >= COALESCE((SELECT MAX(tick) FROM snapshots s WHERE s.game_number = games.game_number), -1)
  AND (
    games.relation_state IS NULL
    OR COALESCE(json_extract(games.relation_state, '$.version'), 1) = ${RELATIONS_VERSION}
    OR NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.game_number = games.game_number AND s.pinned = 0)
  )
)`;

export async function pruneInactiveGames(env, staleHours) {
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();

  const stale = await env.DB.prepare(`
    SELECT game_number
    FROM games
    WHERE archived_at IS NULL
      AND finished_at IS NULL
      AND key_status = 'needs_fresh_key'
      AND COALESCE(last_sync_at, created_at) < ?
      AND ${RELATIONS_CAUGHT_UP}
      AND exported_at IS NOT NULL
  `).bind(cutoff).all();
  for (const row of stale.results) {
    await env.DB.prepare(`
      UPDATE snapshots
      SET pinned = 1, label = COALESCE(label, 'Last known state')
      WHERE id = (SELECT id FROM snapshots WHERE game_number = ? ORDER BY captured_at DESC LIMIT 1)
    `).bind(row.game_number).run();
    await env.DB.prepare(`DELETE FROM snapshots WHERE game_number = ? AND pinned = 0`).bind(row.game_number).run();
  }

  await env.DB.prepare(`
    DELETE FROM snapshots
    WHERE pinned = 0
      AND game_number IN (
        SELECT game_number FROM games
        WHERE (archived_at IS NOT NULL OR finished_at IS NOT NULL)
          AND ${RELATIONS_CAUGHT_UP}
          AND exported_at IS NOT NULL
      )
  `).run();
  await env.DB.prepare(`DELETE FROM scan_attempts WHERE attempted_at < ?`).bind(cutoff).run();
}

// Feeds up to `limit` not-yet-processed snapshots (oldest first) through
// relationship extraction and folds the evidence into `relations`.
export async function processRelations(env, gameNumber, limit = 4) {
  const game = await env.DB.prepare(`SELECT relation_tick, relation_state FROM games WHERE game_number = ?`).bind(gameNumber).first();
  if (!game) return { processed: 0, remaining: 0 };

  let state = game.relation_state ? JSON.parse(game.relation_state) : null;
  let lastTick = game.relation_tick ?? -1;

  // Evidence from older extraction rules is rebuilt while the hourly history
  // it came from still exists; once that is pruned the old evidence is kept.
  if (state && state.version !== RELATIONS_VERSION) {
    const history = await env.DB.prepare(`SELECT COUNT(*) AS n FROM snapshots WHERE game_number = ? AND pinned = 0`).bind(gameNumber).first();
    if (history?.n > 0) {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM relations WHERE game_number = ?`).bind(gameNumber),
        env.DB.prepare(`DELETE FROM relation_events WHERE game_number = ?`).bind(gameNumber),
        env.DB.prepare(`UPDATE games SET relation_tick = NULL, relation_state = NULL, relation_snapshots = 0 WHERE game_number = ?`).bind(gameNumber)
      ]);
      state = null;
      lastTick = -1;
    } else {
      state.version = RELATIONS_VERSION;
    }
  }
  const rows = await env.DB.prepare(`
    SELECT id, tick FROM snapshots
    WHERE game_number = ? AND tick > ?
    ORDER BY tick ASC, captured_at ASC
    LIMIT ?
  `).bind(gameNumber, lastTick, limit).all();

  let processed = 0;
  for (const meta of rows.results) {
    if (meta.tick <= lastTick) continue;
    const row = await env.DB.prepare(`SELECT data_json FROM snapshots WHERE id = ?`).bind(meta.id).first();
    const result = extractRelations(JSON.parse(row.data_json), state);
    await env.DB.batch(relationStatements(env, gameNumber, result));
    state = result.state;
    lastTick = meta.tick;
    processed += 1;
  }

  if (processed) {
    await env.DB.prepare(`
      UPDATE games
      SET relation_tick = ?, relation_state = ?, relation_snapshots = relation_snapshots + ?
      WHERE game_number = ?
    `).bind(lastTick, JSON.stringify(state), processed, gameNumber).run();
  }

  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS n FROM snapshots WHERE game_number = ? AND tick > ?`)
    .bind(gameNumber, lastTick).first();
  return { processed, remaining: remaining?.n || 0, relationTick: lastTick };
}

function relationStatements(env, gameNumber, { tick, observations, events }) {
  const upsert = env.DB.prepare(`
    INSERT INTO relations (game_number, kind, a_uid, b_uid, count, weight, ships, first_tick, last_tick, samples_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (game_number, kind, a_uid, b_uid) DO UPDATE SET
      count = relations.count + excluded.count,
      weight = relations.weight + excluded.weight,
      ships = MAX(relations.ships, excluded.ships),
      last_tick = excluded.last_tick,
      samples_json = CASE WHEN excluded.samples_json = '[]' THEN relations.samples_json ELSE excluded.samples_json END
  `);
  const statements = observations.map((item) => upsert.bind(
    gameNumber, item.kind, item.a, item.b, 1, 1, item.ships || 0, tick, tick, JSON.stringify((item.samples || []).slice(0, 8))
  ));

  // Several captures between the same pair in one scan fold into one row update.
  const grouped = new Map();
  for (const event of events) {
    const key = `${event.kind}:${event.a}:${event.b}`;
    const entry = grouped.get(key) || { ...event, count: 0, weight: 0, samples: [] };
    entry.count += 1;
    entry.weight += event.weight;
    entry.samples.push(event.detail);
    grouped.set(key, entry);
  }
  for (const entry of grouped.values()) {
    statements.push(upsert.bind(gameNumber, entry.kind, entry.a, entry.b, entry.count, entry.weight, 0, tick, tick, JSON.stringify(entry.samples.slice(0, 8))));
  }

  const insertEvent = env.DB.prepare(`
    INSERT INTO relation_events (game_number, tick, kind, a_uid, b_uid, weight, detail) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const event of events) {
    statements.push(insertEvent.bind(gameNumber, tick, event.kind, event.a, event.b, event.weight, event.detail));
  }
  return statements;
}

// Snapshots still to process for a game, counting a full rebuild when its
// evidence came from older extraction rules and its history still exists.
export async function pendingRelationSnapshots(env, gameNumber) {
  const row = await env.DB.prepare(`
    SELECT
      CASE WHEN ${RELATIONS_CAUGHT_UP} THEN 0
        WHEN games.relation_state IS NOT NULL
          AND COALESCE(json_extract(games.relation_state, '$.version'), 1) != ${RELATIONS_VERSION}
          THEN (SELECT COUNT(*) FROM snapshots s WHERE s.game_number = games.game_number)
        ELSE (SELECT COUNT(*) FROM snapshots s WHERE s.game_number = games.game_number AND s.tick > COALESCE(games.relation_tick, -1))
      END AS n
    FROM games
    WHERE game_number = ?
  `).bind(gameNumber).first();
  return row?.n || 0;
}

// Games that stopped producing data and are ready for the GitHub archive:
// finished, deleted, or failing scans for `staleHours`, with relationship
// intel fully processed, and not exported yet.
export async function gamesReadyForArchive(env, staleHours) {
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(`
    SELECT * FROM games
    WHERE exported_at IS NULL
      AND (
        archived_at IS NOT NULL
        OR finished_at IS NOT NULL
        OR (key_status = 'needs_fresh_key' AND COALESCE(last_sync_at, created_at) < ?)
      )
      AND ${RELATIONS_CAUGHT_UP}
  `).bind(cutoff).all();
  return rows.results.map(gameFromRow);
}

export async function markExported(env, gameNumber, archiveRef) {
  await env.DB.prepare(`UPDATE games SET exported_at = ?, archive_ref = ?, updated_at = ? WHERE game_number = ?`)
    .bind(nowIso(), archiveRef || null, nowIso(), gameNumber).run();
}

export async function gamesWithPendingRelations(env) {
  const rows = await env.DB.prepare(`
    SELECT game_number FROM games WHERE NOT (${RELATIONS_CAUGHT_UP})
  `).all();
  return rows.results.map((row) => row.game_number);
}

export async function relationRows(env, gameNumber) {
  const rows = await env.DB.prepare(`SELECT * FROM relations WHERE game_number = ?`).bind(gameNumber).all();
  return rows.results.map((row) => ({
    kind: row.kind,
    a: row.a_uid,
    b: row.b_uid,
    count: row.count,
    weight: row.weight,
    ships: row.ships,
    firstTick: row.first_tick,
    lastTick: row.last_tick,
    samples: JSON.parse(row.samples_json || "[]")
  }));
}

export async function recentRelationEvents(env, gameNumber, limit = 300) {
  const rows = await env.DB.prepare(`
    SELECT tick, kind, a_uid, b_uid, weight, detail
    FROM relation_events
    WHERE game_number = ?
    ORDER BY tick DESC, id DESC
    LIMIT ?
  `).bind(gameNumber, limit).all();
  return rows.results.map((row) => ({ tick: row.tick, kind: row.kind, a: row.a_uid, b: row.b_uid, weight: row.weight, detail: row.detail }));
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
    nickname: row.nickname || "",
    playerCount: row.player_count ?? null,
    myAlias: row.my_alias || "",
    relationTick: row.relation_tick ?? null,
    exportedAt: row.exported_at || null,
    archiveRef: row.archive_ref || null,
    relationSnapshots: row.relation_snapshots ?? 0,
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
    label: row.label || "",
    sizeBytes: row.size_bytes ?? row.data_json?.length ?? null
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
