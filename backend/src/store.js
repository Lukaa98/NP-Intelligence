import { extractRelations, RELATIONS_VERSION } from "./relations.js";
import { isNegligible } from "./threats.js";

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
      exported_at = NULL,
      key_status = 'valid',
      key_status_message = 'Saved key worked on the last successful scan.',
      updated_at = excluded.updated_at
  `).bind(gameNumber, code, name, playerUid, timestamp, timestamp).run();
}

export async function updateGameAfterScan(env, gameNumber, scanningData, { finished = false, players = true } = {}) {
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
  if (players) {
    await recordGamePlayers(env, gameNumber, scanningData);
  }
}

// Remembers who is in a game (refreshed by every scan; INSERT OR REPLACE keeps
// it current if someone renames).
export async function recordGamePlayers(env, gameNumber, scanningData) {
  const players = Object.values(scanningData?.players || {}).filter((player) => player?.alias);
  if (!players.length) return;
  const statement = env.DB.prepare(`
    INSERT OR REPLACE INTO game_players (game_number, alias_key, alias, uid) VALUES (?, ?, ?, ?)
  `);
  await env.DB.batch(players.map((player) => statement.bind(String(gameNumber), aliasKey(player.alias), String(player.alias), Number(player.uid))));
}

// One-off fill for games tracked before game_players existed: reads each
// such game's newest snapshot.
export async function backfillGamePlayers(env, limit = 3) {
  const rows = await env.DB.prepare(`
    SELECT game_number FROM games
    WHERE NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_number = games.game_number)
      AND EXISTS (SELECT 1 FROM snapshots s WHERE s.game_number = games.game_number)
    LIMIT ?
  `).bind(limit).all();
  for (const row of rows.results) {
    const latest = await latestSnapshot(env, row.game_number);
    if (latest) await recordGamePlayers(env, row.game_number, latest.data);
  }
  return rows.results.length;
}

// Players in `gameNumber` you have met before: rated in your player book
// and/or present in your other tracked games, with how they related to you
// there (formal alliance, stars taken either way).
export async function knownPlayers(env, gameNumber) {
  const game = await env.DB.prepare(`SELECT player_uid FROM games WHERE game_number = ?`).bind(gameNumber).first();
  const here = (await env.DB.prepare(`SELECT alias_key, alias, uid FROM game_players WHERE game_number = ?`).bind(gameNumber).all()).results
    .filter((row) => row.uid !== game?.player_uid);
  if (!here.length) return [];
  const keys = JSON.stringify(here.map((row) => row.alias_key));

  const notes = (await env.DB.prepare(`
    SELECT * FROM player_notes WHERE alias_key IN (SELECT value FROM json_each(?))
  `).bind(keys).all()).results.map(playerNoteFromRow);

  const elsewhere = (await env.DB.prepare(`
    SELECT gp.alias_key, gp.uid, gp.game_number, g.name, g.nickname, g.player_uid AS my_uid, g.finished_at, g.archived_at, g.last_tick
    FROM game_players gp
    JOIN games g ON g.game_number = gp.game_number
    WHERE gp.alias_key IN (SELECT value FROM json_each(?)) AND gp.game_number != ?
  `).bind(keys, gameNumber).all()).results;

  const gameNumbers = JSON.stringify([...new Set(elsewhere.map((row) => row.game_number))]);
  const relationRowsFound = elsewhere.length ? (await env.DB.prepare(`
    SELECT game_number, kind, a_uid, b_uid, count FROM relations
    WHERE kind IN ('ally_confirmed', 'capture') AND game_number IN (SELECT value FROM json_each(?))
  `).bind(gameNumbers).all()).results : [];

  const byKey = new Map(here.map((row) => [row.alias_key, { alias: row.alias, uid: row.uid, note: null, games: [] }]));
  for (const note of notes) {
    byKey.get(note.aliasKey).note = { rating: note.rating, note: note.note };
  }
  for (const row of elsewhere) {
    const me = row.my_uid;
    const them = row.uid;
    const between = relationRowsFound.filter((rel) => rel.game_number === row.game_number);
    const count = (kind, a, b) => between.filter((rel) => rel.kind === kind && rel.a_uid === a && rel.b_uid === b).reduce((sum, rel) => sum + rel.count, 0);
    byKey.get(row.alias_key).games.push({
      gameNumber: row.game_number,
      title: row.nickname || row.name,
      over: Boolean(row.finished_at || row.archived_at),
      wasAlly: me !== null && count("ally_confirmed", Math.min(me, them), Math.max(me, them)) > 0,
      youTook: me === null ? 0 : count("capture", me, them),
      theyTook: me === null ? 0 : count("capture", them, me)
    });
  }

  return [...byKey.values()]
    .filter((player) => player.note || player.games.length)
    .sort((x, y) => Math.abs(y.note?.rating || 0) - Math.abs(x.note?.rating || 0) || y.games.length - x.games.length);
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
    SET archived_at = NULL, exported_at = NULL, updated_at = ?
    WHERE game_number = ?
  `).bind(nowIso(), gameNumber).run();
}

export async function setNickname(env, gameNumber, nickname) {
  const cleaned = String(nickname || "").trim().slice(0, 120);
  await env.DB.prepare(`UPDATE games SET nickname = ?, updated_at = ? WHERE game_number = ?`)
    .bind(cleaned || null, nowIso(), gameNumber).run();
}

export async function purgeGame(env, gameNumber) {
  await env.DB.prepare(`DELETE FROM game_players WHERE game_number = ?`).bind(gameNumber).run();
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

// Folds this tick's detected threats into the threats table. Returns the ones
// seen for the first time (to notify about). Open threats that are no longer
// detected are closed: "fell" if the attacker now owns the target, "held" if
// the arrival time has passed, otherwise "gone" (turned away / out of view).
export async function updateThreats(env, gameNumber, tick, detected, scanningData, snapshotId) {
  const timestamp = nowIso();
  const existing = (await env.DB.prepare(`SELECT * FROM threats WHERE game_number = ?`).bind(gameNumber).all()).results;
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const seen = new Set();
  const fresh = [];
  const statements = [];

  for (const threat of detected) {
    seen.add(threat.key);
    const row = byKey.get(threat.key);
    if (!row || row.status !== "open") fresh.push(threat);
    statements.push(env.DB.prepare(`
      INSERT INTO threats (game_number, key, kind, fleet_uid, owner_uid, owner_alias, ships, target_uid, target_name,
        eta_tick, eta_minutes, defenders, verdict, first_tick, last_tick, status, outcome, snapshot_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)
      ON CONFLICT (game_number, key) DO UPDATE SET
        kind = excluded.kind, ships = excluded.ships, eta_tick = excluded.eta_tick, eta_minutes = excluded.eta_minutes,
        defenders = excluded.defenders, verdict = excluded.verdict, last_tick = excluded.last_tick,
        first_tick = CASE WHEN threats.status = 'open' THEN threats.first_tick ELSE excluded.first_tick END,
        notified_at = CASE WHEN threats.status = 'open' THEN threats.notified_at ELSE NULL END,
        status = 'open', outcome = NULL, snapshot_id = excluded.snapshot_id, updated_at = excluded.updated_at
    `).bind(gameNumber, threat.key, threat.kind, threat.fleetUid, threat.ownerUid, threat.ownerAlias, threat.ships,
      threat.targetUid, threat.targetName, tick + threat.etaTicks, threat.etaMinutes, threat.defenders, threat.verdict,
      tick, tick, snapshotId, timestamp));
  }

  for (const row of existing) {
    if (row.status !== "open" || seen.has(row.key)) continue;
    // Raised before tiny fleets were filtered out: drop instead of closing.
    if (isNegligible(row.ships, row.defenders)) {
      statements.push(env.DB.prepare(`DELETE FROM threats WHERE game_number = ? AND key = ?`).bind(gameNumber, row.key));
      continue;
    }
    const ownerNow = scanningData.stars?.[row.target_uid]?.puid;
    const outcome = ownerNow === row.owner_uid ? "fell" : tick >= row.eta_tick ? "held" : "gone";
    statements.push(env.DB.prepare(`UPDATE threats SET status = 'closed', outcome = ?, updated_at = ? WHERE game_number = ? AND key = ?`)
      .bind(outcome, timestamp, gameNumber, row.key));
  }

  // Keep a day of closed alerts for context.
  statements.push(env.DB.prepare(`DELETE FROM threats WHERE game_number = ? AND status = 'closed' AND updated_at < ?`)
    .bind(gameNumber, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()));
  if (statements.length) await env.DB.batch(statements);
  return fresh;
}

export async function markThreatsNotified(env, gameNumber, keys) {
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE threats SET notified_at = ? WHERE game_number = ? AND key IN (SELECT value FROM json_each(?))`)
    .bind(nowIso(), gameNumber, JSON.stringify(keys)).run();
}

export async function listThreats(env, gameNumber) {
  const rows = (await env.DB.prepare(`
    SELECT * FROM threats WHERE game_number = ? ORDER BY status = 'open' DESC, eta_tick ASC
  `).bind(gameNumber).all()).results;
  return rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    fleetUid: row.fleet_uid,
    ownerUid: row.owner_uid,
    ownerAlias: row.owner_alias,
    ships: row.ships,
    targetUid: row.target_uid,
    targetName: row.target_name,
    etaTick: row.eta_tick,
    etaMinutes: row.eta_minutes,
    defenders: row.defenders,
    verdict: row.verdict,
    firstTick: row.first_tick,
    lastTick: row.last_tick,
    status: row.status,
    outcome: row.outcome,
    snapshotId: row.snapshot_id,
    updatedAt: row.updated_at
  }));
}

// Open threats across all games (for the in-app notification bell).
export async function openThreats(env) {
  const rows = (await env.DB.prepare(`
    SELECT t.*, g.name AS game_name, g.nickname AS game_nickname, g.last_tick AS game_tick
    FROM threats t JOIN games g ON g.game_number = t.game_number
    WHERE t.status = 'open'
    ORDER BY t.first_tick DESC
  `).all()).results;
  return rows.map((row) => ({
    gameNumber: row.game_number,
    gameTitle: row.game_nickname || row.game_name,
    gameTick: row.game_tick,
    key: row.key,
    kind: row.kind,
    ownerUid: row.owner_uid,
    ownerAlias: row.owner_alias,
    ships: row.ships,
    targetUid: row.target_uid,
    targetName: row.target_name,
    fleetUid: row.fleet_uid,
    etaTick: row.eta_tick,
    defenders: row.defenders,
    verdict: row.verdict,
    snapshotId: row.snapshot_id,
    firstSeenAt: row.notified_at || row.updated_at
  }));
}

export async function openThreatCounts(env) {
  const rows = (await env.DB.prepare(`SELECT game_number, COUNT(*) AS n FROM threats WHERE status = 'open' GROUP BY game_number`).all()).results;
  return Object.fromEntries(rows.map((row) => [row.game_number, row.n]));
}

export async function getSetting(env, key) {
  return (await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first())?.value ?? null;
}

export async function setSetting(env, key, value) {
  if (value === null || value === "") {
    await env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(key).run();
  } else {
    await env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(key, String(value)).run();
  }
}

// Per player: human actions in the last 24 / 48 ticks (hourly ticks, so ~hours)
// and the tick of their latest action, from the activity and capture events.
export async function activityByPlayer(env, gameNumber, latestTick) {
  const since = latestTick - 48;
  const rows = (await env.DB.prepare(`
    SELECT a_uid, kind, detail, tick, weight FROM relation_events
    WHERE game_number = ? AND kind IN ('activity', 'capture') AND tick > ?
  `).bind(gameNumber, since).all()).results;
  const last = (await env.DB.prepare(`
    SELECT a_uid, MAX(tick) AS last_tick FROM relation_events
    WHERE game_number = ? AND kind IN ('activity', 'capture')
    GROUP BY a_uid
  `).bind(gameNumber).all()).results;
  const firstTick = (await env.DB.prepare(`SELECT MIN(first_tick) AS t FROM relations WHERE game_number = ?`).bind(gameNumber).first())?.t;

  const byPlayer = {};
  const entry = (uid) => (byPlayer[uid] ||= {
    day: { infra: 0, carriers: 0, orders: 0, captures: 0 },
    twoDays: { infra: 0, carriers: 0, orders: 0, captures: 0 },
    lastActionTick: null
  });
  for (const row of rows) {
    const key = row.kind === "capture" ? "captures" : row.detail;
    const amount = row.kind === "capture" ? 1 : row.weight;
    const player = entry(row.a_uid);
    player.twoDays[key] += amount;
    if (row.tick > latestTick - 24) player.day[key] += amount;
  }
  for (const row of last) entry(row.a_uid).lastActionTick = row.last_tick;
  return { observedTicks: firstTick === null || firstTick === undefined ? 0 : latestTick - firstTick, players: byPlayer };
}
