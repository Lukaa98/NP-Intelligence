import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { buildPlayerIntel } from "../intel.js";
import { formatDateTime, notesForExport, renderMentions } from "../format.js";
import { downloadStandaloneHtml } from "../map/exportHtml.js";
import PlayerRating from "../components/PlayerRating.jsx";

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

  const gameContext = { gameNumber, gameName: game?.name || `Game ${gameNumber}` };
  const players = useMemo(() => intel ? buildPlayerIntel(intel.summary || {}, intel.events || []) : [], [intel]);
  const activePlayer = players.find((player) => player.name === selectedPlayer) || players[0] || null;
  const captures = snapshots.filter((snapshot) => snapshot.pinned);
  const history = showAllSnapshots ? snapshots : snapshots.slice(0, 12);
  const latest = snapshots[0];

  async function download(snapshotId) {
    await run("Building HTML", async () => {
      const snapshot = await api.snapshot(snapshotId);
      downloadStandaloneHtml(snapshot, notesForExport(notes));
      return "Downloaded a standalone HTML copy. It opens offline in any browser.";
    });
  }

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow"><a href="#/">Games</a> / #{gameNumber}</p>
          <h1>{game?.name || `Game ${gameNumber}`}</h1>
          <p className="muted">
            Tick {game?.lastTick ?? "?"} · last scan {formatDateTime(game?.lastSyncAt)}
            {game?.finishedAt && " · game finished"}
            {game?.archivedAt && " · deleted (history kept)"}
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
          <h2>Player intel</h2>
          <div className="actions">
            {WINDOWS.map(([key, label]) => (
              <button key={key} type="button" className={`ghost${windowKey === key ? " active" : ""}`} onClick={() => setWindowKey(key)}>{label}</button>
            ))}
          </div>
        </div>
        {intel?.summary?.players?.length ? (
          <p className="muted small">{intel.summary.gameName} · tick {intel.summary.tick} · {intel.summary.players.length} players · {intel.summary.stars?.length || 0} stars</p>
        ) : <p className="muted">No intel yet for this game.</p>}

        <div className="player-table">
          {players.map((player) => (
            <div
              key={player.name}
              className={`player-line${activePlayer?.name === player.name ? " active" : ""}`}
              onClick={() => setSelectedPlayer(player.name)}
            >
              <div className="player-name">
                <strong>{player.name}</strong>
                <span className="muted small">{player.quickSummary}</span>
              </div>
              <div className="player-stats small">
                <span>{player.stars}★</span>
                <span>{player.ships} ships</span>
                <span className={`pill ${player.tone === "danger" ? "danger" : player.tone === "success" ? "success" : ""}`}>{player.badge}</span>
              </div>
              <PlayerRating alias={player.name} notes={notes} game={gameContext} compact />
            </div>
          ))}
        </div>

        {activePlayer && (
          <div className="detail-box">
            <h3>{activePlayer.name}</h3>
            <p className="muted small">Eco {activePlayer.economy} · Ind {activePlayer.industry} · Sci {activePlayer.science}</p>
            {notes.byAlias[activePlayer.name.toLowerCase()]?.note && (
              <p className="note-text">📝 {notes.byAlias[activePlayer.name.toLowerCase()].note}</p>
            )}
            {!activePlayer.details.length ? <p className="muted">No meaningful changes in this window.</p> : (
              <ul className="event-list">
                {activePlayer.details.map((item, index) => (
                  <li key={index} className={item.tone}>
                    <strong><Mentions text={item.title} /></strong>
                    <span><Mentions text={item.detail} /></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Snapshot history <span className="muted">({snapshots.length}, last 48h + pinned)</span></h2>
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
    </>
  );
}

function SnapshotRow({ snapshot, onDownload, onPinToggle }) {
  return (
    <div className="snapshot-row">
      <div>
        <div className="name">
          Tick {snapshot.tick}
          {snapshot.label && <span className="pill">{snapshot.label}</span>}
        </div>
        <div className="meta">{formatDateTime(snapshot.capturedAt)} · {snapshot.source}</div>
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
