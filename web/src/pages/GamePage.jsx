import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, ARCHIVE_BROWSE } from "../api.js";
import { navigate } from "../router.js";
import { buildPlayerIntel } from "../intel.js";
import { formatBytes, formatDateTime, gameFacts, gameTitle, notesForExport, renderMentions } from "../format.js";
import { downloadStandaloneHtml, EXPORT_OVERHEAD_BYTES } from "../map/exportHtml.js";
import PlayerRating from "../components/PlayerRating.jsx";
import Diplomacy, { PickPlayer, PlayerBadge as DiplomacyBadge, STATUS_HINTS, STATUS_LABELS, describePair, groupTrades, useDiplomacy, verdictText } from "../components/Diplomacy.jsx";
import RenameGame from "../components/RenameGame.jsx";

const WINDOWS = [
  ["latest", "Latest"],
  ["1h", "1h"],
  ["6h", "6h"],
  ["32h", "32h"]
];

export default function GamePage({ gameNumber, notes }) {
  const [game, setGame] = useState(null);
  const [intel, setIntel] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [windowKey, setWindowKey] = useState("latest");
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [diplomacyKey, setDiplomacyKey] = useState(0);

  const loadGame = useCallback(async () => {
    const games = await api.listGames();
    setGame(games.find((item) => item.gameNumber === gameNumber) || null);
  }, [gameNumber]);

  const loadSnapshots = useCallback(async () => {
    setSnapshots(await api.snapshots(gameNumber, { limit: 300 }));
  }, [gameNumber]);

  const loadIntel = useCallback(async () => {
    setIntel(await api.intel(gameNumber, windowKey));
  }, [gameNumber, windowKey]);

  useEffect(() => {
    Promise.all([loadGame(), loadSnapshots()]).catch((error) => setStatus(error.message));
  }, [loadGame, loadSnapshots]);

  useEffect(() => {
    loadIntel().catch((error) => setStatus(error.message));
  }, [loadIntel]);

  async function run(label, action) {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const message = await action();
      setStatus(message || `${label} done.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  const diplomacy = useDiplomacy(gameNumber, diplomacyKey);
  const gameContext = { gameNumber, gameName: gameTitle(game, gameNumber) };
  const players = useMemo(() => intel ? buildPlayerIntel(intel.summary || {}, intel.events || []) : [], [intel]);
  const activePlayer = players.find((player) => player.name === selectedPlayer) || null;
  const captures = snapshots.filter((snapshot) => snapshot.pinned);
  const history = showAllSnapshots ? snapshots : snapshots.slice(0, 12);
  const latest = snapshots[0];
  const alive = players.filter((player) => player.stars > 0 || player.ships > 0);
  const eliminated = players.filter((player) => player.stars === 0 && player.ships === 0);

  // Any player name on the page opens that player's row here and scrolls to it.
  const openPlayer = useCallback((uid) => {
    const alias = diplomacy.players.get(uid)?.alias;
    if (!alias) return;
    setSelectedPlayer(alias);
    requestAnimationFrame(() => {
      document.getElementById(`player-${uid}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [diplomacy.players]);

  const renderPlayer = (player) => {
    const open = activePlayer?.name === player.name;
    return (
      <React.Fragment key={player.name}>
        <div
          id={`player-${player.uid}`}
          className={`player-line${open ? " active" : ""}`}
          onClick={() => setSelectedPlayer(open ? "" : player.name)}
          aria-expanded={open}
        >
          <div className="player-name">
            <strong><span className="caret">{open ? "▾" : "▸"}</span> {player.name}</strong>
            <span className="muted small">{player.quickSummary}</span>
          </div>
          <div className="player-stats small">
            <span>{player.stars}★</span>
            <span>{player.ships} ships</span>
            <span className={`pill ${player.tone === "danger" ? "danger" : player.tone === "success" ? "success" : ""}`}>{player.badge}</span>
          </div>
          <PlayerRating alias={player.name} notes={notes} game={gameContext} compact />
        </div>
        {open && (
          <PlayerDetail
            player={player}
            note={notes.byAlias[player.name.toLowerCase()]?.note}
            diplomacy={diplomacy}
          />
        )}
      </React.Fragment>
    );
  };

  async function download(snapshotId) {
    await run("Building HTML", async () => {
      const [snapshot, diplomacy] = await Promise.all([api.snapshot(snapshotId), api.diplomacy(gameNumber).catch(() => null)]);
      downloadStandaloneHtml(snapshot, notesForExport(notes), diplomacy?.pairs || []);
      return "Downloaded a standalone HTML copy. It opens offline in any browser.";
    });
  }

  return (
    <PickPlayer.Provider value={openPlayer}>
      <section className="hero card">
        <div>
          <p className="eyebrow"><a href="#/">Games</a> / #{gameNumber}</p>
          <div className="name-row">
            <h1>{gameTitle(game, gameNumber)}</h1>
            {game && <RenameGame game={game} onRenamed={setGame} />}
          </div>
          {game && <p className="muted small">{gameFacts(game)}</p>}
          <p className="muted">
            Tick {game?.lastTick ?? "?"} · last scan {formatDateTime(game?.lastSyncAt)}
            {game?.finishedAt && " · game finished"}
            {game?.archivedAt && " · deleted (history kept)"}
            {game?.exportedAt && <> · full replay <a href={`${ARCHIVE_BROWSE}/${gameNumber}`} target="_blank" rel="noreferrer">archived on GitHub</a></>}
          </p>
          {game?.keyStatus === "needs_fresh_key" && <p className="error small">Last scan failed: {game.keyStatusMessage}</p>}
        </div>
        <div className="actions wrap">
          {latest && <button type="button" className="secondary" onClick={() => navigate(`/snapshot/${latest.id}`)}>View latest map</button>}
          <button type="button" className="primary" disabled={busy} onClick={() => run("Capturing current state", async () => {
            const payload = await api.captureGame(gameNumber);
            navigate(`/snapshot/${payload.snapshot.id}`);
            return payload.fromHistory ? `NP did not answer (${payload.scanError}); pinned the latest stored snapshot instead.` : "";
          })}>Capture state</button>
          {!game?.archivedAt && <button type="button" className="secondary" disabled={busy} onClick={() => run("Scanning", async () => {
            const payload = await api.scanGame(gameNumber);
            await Promise.all([loadGame(), loadSnapshots(), loadIntel()]);
            setDiplomacyKey((value) => value + 1);
            return payload.unchanged
              ? `No new tick yet (still tick ${payload.snapshot.tick}).`
              : `Scanned. Latest tick ${payload.snapshot.tick}.`;
          })}>Scan now</button>}
          {game && (game.archivedAt ? (
            <button type="button" className="ghost" disabled={busy} onClick={() => run("Restoring", async () => {
              await api.restoreGame(gameNumber);
              await loadGame();
              return "Game is tracked again.";
            })}>Restore</button>
          ) : (
            <button type="button" className="ghost danger-text" disabled={busy} onClick={() => run("Deleting", async () => {
              await api.archiveGame(gameNumber);
              await loadGame();
              return "Moved to Deleted games. History is kept.";
            })}>Delete</button>
          ))}
        </div>
      </section>

      {status && <p className="status banner">{status}</p>}

      <Diplomacy diplomacy={diplomacy} />

      <section className="card">
        <div className="section-head">
          <h2>Players</h2>
          <div className="actions">
            <span className="muted small">changes over</span>
            {WINDOWS.map(([key, label]) => (
              <button key={key} type="button" className={`ghost${windowKey === key ? " active" : ""}`} onClick={() => setWindowKey(key)}>{label}</button>
            ))}
          </div>
        </div>
        {intel?.summary?.players?.length ? (
          <p className="muted small">Click a player for everything: stats, allies, wars, recent changes and possible tech trades. Tick {intel.summary.tick} · {alive.length} still in the game.</p>
        ) : <p className="muted">No intel yet for this game.</p>}

        <div className="player-table">
          {alive.map(renderPlayer)}
        </div>
        {!!eliminated.length && (
          <details className="eliminated">
            <summary>Eliminated or empty ({eliminated.length})</summary>
            <div className="player-table">{eliminated.map(renderPlayer)}</div>
          </details>
        )}
      </section>


      <section className="card">
        <div className="section-head">
          <h2>Captures</h2>
          <span className="muted small">Pinned snapshots. They're kept permanently and open as an interactive map.</span>
        </div>
        {!captures.length ? (
          <p className="muted">No captures yet. “Capture state” saves the current galaxy, and the final state is captured automatically when the game ends.</p>
        ) : (
          <div className="snapshot-list">
            {captures.map((snapshot) => (
              <SnapshotRow key={snapshot.id} snapshot={snapshot} onDownload={download} onPinToggle={async () => {
                await run("Unpinning", async () => {
                  await api.unpinSnapshot(snapshot.id);
                  await loadSnapshots();
                  return "Capture unpinned (snapshot still in history).";
                });
              }} />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Snapshot history <span className="muted">({snapshots.length} · {formatBytes(snapshots.reduce((sum, item) => sum + (item.sizeBytes || 0), 0))} stored)</span></h2>
          {snapshots.length > 12 && (
            <button type="button" className="ghost" onClick={() => setShowAllSnapshots((value) => !value)}>
              {showAllSnapshots ? "Show fewer" : "Show all"}
            </button>
          )}
        </div>
        {!history.length ? <p className="muted">No snapshots stored.</p> : (
          <div className="snapshot-list">
            {history.map((snapshot) => (
              <SnapshotRow key={snapshot.id} snapshot={snapshot} onDownload={download} onPinToggle={async () => {
                await run(snapshot.pinned ? "Unpinning" : "Pinning", async () => {
                  if (snapshot.pinned) {
                    await api.unpinSnapshot(snapshot.id);
                  } else {
                    await api.pinSnapshot(snapshot.id, "Manual capture");
                  }
                  await loadSnapshots();
                  return snapshot.pinned ? "Unpinned." : "Pinned as a capture.";
                });
              }} />
            ))}
          </div>
        )}
      </section>

      {intel?.fetchHealth && <FetchHealth health={intel.fetchHealth} />}
    </PickPlayer.Provider>
  );
}

// Everything about one player, opened directly under their row: stats, your
// note, diplomatic relations, recent changes and possible tech trades.
const RELATION_ORDER = { allied: 0, possible_allies: 1, war: 2, former_allies: 3, tension: 4, peaceful: 5 };

function PlayerDetail({ player, note, diplomacy }) {
  const uid = Number(player.uid);
  const data = diplomacy.data;
  const name = (other) => diplomacy.players.get(other)?.alias || `Player ${other}`;
  const relations = (data?.pairs || [])
    .filter((pair) => pair.a === uid || pair.b === uid)
    .sort((x, y) => (RELATION_ORDER[x.status] ?? 9) - (RELATION_ORDER[y.status] ?? 9) || y.allyScore + y.warScore - (x.allyScore + x.warScore));
  const team = data?.teams.find((item) => item.members.includes(uid));
  const middle = (data?.middlemen || []).filter((item) => item.middle === uid);
  const trades = groupTrades((data?.events || []).filter((event) => event.kind === "tech_trade" && (event.a === uid || event.b === uid))).slice(0, 6);

  return (
    <div className="detail-box inline">
      <p className="muted small">
        {player.stars} stars · {player.ships} ships · Eco {player.economy} · Ind {player.industry} · Sci {player.science}
        {player.stars === 0 && " · no stars left"}
        {team && ` · in a likely team of ${team.members.length}`}
      </p>
      {note && <p className="note-text">📝 {note}</p>}

      <h4>Relations</h4>
      {!data ? <p className="muted small">Loading…</p> : !relations.length ? <p className="muted small">Nothing recorded yet.</p> : (
        <ul className="relation-list compact">
          {relations.slice(0, 15).map((pair) => {
            const other = pair.a === uid ? pair.b : pair.a;
            return (
              <li key={`${pair.a}:${pair.b}`} className={pair.status}>
                <div className="relation-head">
                  <BadgeFor uid={other} diplomacy={diplomacy} />
                  <span className={`status ${pair.status}`} title={pair.confirmed ? "From your own game data." : STATUS_HINTS[pair.status]}>
                    {pair.confirmed ? "Allied (formal, certain)" : STATUS_LABELS[pair.status]}
                  </span>
                  {team && !team.members.includes(other) && ["allied", "possible_allies"].includes(pair.status) && <span className="pill">⚠ outside their team</span>}
                  {pair.warActive && <span className="pill danger">active</span>}
                </div>
                <div className="meta">{describePair(pair, uid, name)}</div>
              </li>
            );
          })}
        </ul>
      )}

      {!!middle.length && (
        <>
          <h4>Caught in the middle</h4>
          <ul className="relation-list compact">
            {middle.map((item) => (
              <li key={`${item.sides[0].uid}:${item.sides[1].uid}`} className="trade">
                <div className="meta">{verdictText(item, name)} ({name(item.sides[0].uid)} ⚔ {name(item.sides[1].uid)})</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Recent changes</h4>
      {!player.details.length ? <p className="muted small">No meaningful changes in this window.</p> : (
        <ul className="event-list">
          {player.details.map((item, index) => (
            <li key={index} className={item.tone}>
              <strong><Mentions text={item.title} /></strong>
              <span><Mentions text={item.detail} /></span>
            </li>
          ))}
        </ul>
      )}

      {!!trades.length && (
        <>
          <h4>Possible tech trades <span className="muted small">(about a coin flip each)</span></h4>
          <ul className="relation-list compact">
            {trades.map((trade) => (
              <li key={trade.key} className="trade">
                <div className="meta">
                  tick {trade.tick}: {trade.receiver === uid ? "got" : `${name(trade.receiver)} got`} {trade.detail}
                  {" "}— likely from {trade.sources.map(name).join(" or ")}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BadgeFor({ uid, diplomacy }) {
  const player = diplomacy.players.get(uid);
  return <DiplomacyBadge player={player} uid={uid} />;
}

function SnapshotRow({ snapshot, onDownload, onPinToggle }) {
  return (
    <div className="snapshot-row">
      <div>
        <div className="name">
          Tick {snapshot.tick}
          {snapshot.label && <span className="pill">{snapshot.label}</span>}
        </div>
        <div className="meta">
          {formatDateTime(snapshot.capturedAt)} · {snapshot.source}
          {snapshot.sizeBytes ? ` · ${formatBytes(snapshot.sizeBytes)} stored · HTML ≈ ${formatBytes(snapshot.sizeBytes + EXPORT_OVERHEAD_BYTES)}` : ""}
        </div>
      </div>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => navigate(`/snapshot/${snapshot.id}`)}>View map</button>
        <button type="button" className="ghost" onClick={() => onDownload(snapshot.id)}>Download HTML</button>
        <button type="button" className="ghost" onClick={onPinToggle} title={snapshot.pinned ? "Unpin" : "Pin as capture"}>
          {snapshot.pinned ? "★ Pinned" : "☆ Pin"}
        </button>
      </div>
    </div>
  );
}

function FetchHealth({ health }) {
  const outage = health.activeOutage;
  return (
    <section className="card">
      <div className="section-head">
        <h2>Fetch health</h2>
        <span className={`pill ${outage ? "danger" : "success"}`}>{outage ? "Outage" : "Healthy"}</span>
      </div>
      <p className="muted small">
        Last success {formatDateTime(health.latestSuccessAt)}
        {outage && ` · failing since ${formatDateTime(outage.startedAt)} (${outage.attemptsMissed} attempts)`}
        {!!health.failuresLast24h && ` · ${health.failuresLast24h} failures in 24h`}
      </p>
      {!!health.recentFailures?.length && (
        <ul className="event-list">
          {health.recentFailures.map((failure) => (
            <li key={failure.attemptedAt} className="danger">
              <strong>{formatDateTime(failure.attemptedAt)}</strong>
              <span>{failure.errorMessage || "Fetch failed"} · {failure.source}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Mentions({ text }) {
  return renderMentions(text).map((part) => part.mention
    ? <span key={part.key} className="mention">{part.mention}</span>
    : <React.Fragment key={part.key}>{part.text}</React.Fragment>);
}
