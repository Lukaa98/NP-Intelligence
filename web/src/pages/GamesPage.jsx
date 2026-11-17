import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { formatBytes, formatDateTime, gameFacts, gameTitle } from "../format.js";
import RenameGame from "../components/RenameGame.jsx";
import KnownPlayers from "../components/KnownPlayers.jsx";
import AssignedGames from "./AssignedGames.jsx";

// Testers with assigned games get a page with just those games.
export default function GamesPage({ user, isAdmin }) {
  if (!isAdmin && user?.assignedGames?.length) {
    return <AssignedGames assigned={user.assignedGames} />;
  }
  return <TrackedGames isAdmin={isAdmin} />;
}

function TrackedGames({ isAdmin }) {
  const locked = "";
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ gameNumber: locked, code: "", name: "" });
  const [query, setQuery] = useState("");
  // Players from the game just added that you have met before.
  const [known, setKnown] = useState(null);
  const [threatCounts, setThreatCounts] = useState({});
  const [usage, setUsage] = useState(null);

  const load = useCallback(async () => {
    try {
      setGames(await api.listGames());
      api.threatCounts().then(setThreatCounts).catch(() => {});
      if (isAdmin) api.usage().then(setUsage).catch(() => {});
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(key, label, action) {
    setBusy(key);
    setStatus(`${label}…`);
    try {
      const message = await action();
      setStatus(message || `${label} done.`);
      await load();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy("");
    }
  }

  async function saveGame(event) {
    event.preventDefault();
    if (!form.gameNumber.trim() || !form.code.trim()) {
      setStatus("Game number and API code are required.");
      return;
    }
    await run("save", "Saving and validating key", async () => {
      const payload = await api.saveGame({ game_number: form.gameNumber.trim(), code: form.code.trim(), name: form.name.trim() });
      setKnown(payload.knownPlayers?.length ? { gameNumber: payload.game.gameNumber, title: gameTitle(payload.game), players: payload.knownPlayers } : null);
      setForm({ gameNumber: locked, code: "", name: "" });
      setFormOpen(false);
      return payload.existing
        ? `${gameTitle(payload.game)} was already tracked: API code updated, latest tick ${payload.snapshot.tick}.`
        : `Now tracking ${gameTitle(payload.game)}. First scan stored at tick ${payload.snapshot.tick}.`;
    });
  }

  const needle = query.trim().toLowerCase();
  const matches = (game) => !needle || [game.nickname, game.name, game.gameNumber, game.myAlias, game.playerCount && `${game.playerCount}p`]
    .some((value) => String(value || "").toLowerCase().includes(needle));
  const replaceGame = (updated) => setGames((current) => current.map((item) => (item.gameNumber === updated.gameNumber ? updated : item)));
  const active = games.filter((game) => !game.archivedAt && matches(game));
  const deleted = games.filter((game) => game.archivedAt && matches(game));

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">Neptune's Pride intel</p>
          <h1>Your games</h1>
          {isAdmin ? (
            <p className="muted">Tracked games are scanned every 10 minutes (a new scan is stored once per NP tick), and the 🔔 lights up when an enemy fleet is launched at one of your stars. When a game ends or you delete it, its final state, your captures and its full alliance and war record are kept, so finished games stay viewable after Neptune's Pride deletes them.</p>
          ) : (
            <p className="muted">Add your game with its API code and it is scanned every 10 minutes: who is allied or at war, who is AFK, a replayable map, and the 🔔 lights up when an enemy fleet is launched at one of your stars. Your games are only visible to you and the site admin, and are erased 24 hours after the game ends. Use 💬 Feedback to say what you think.</p>
          )}
        </div>
        <button type="button" className="primary" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? "Hide form" : "Track a game"}
        </button>
      </section>

      {formOpen && (
        <form className="card" onSubmit={saveGame}>
          <h2>Track a game</h2>
          <div className="form-grid">
            <label className="field">
              <span>Game number</span>
              <input value={form.gameNumber} onChange={(event) => setForm({ ...form, gameNumber: event.target.value })} placeholder="5123456789" />
            </label>
            <label className="field">
              <span>API code</span>
              <input type="password" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="From Options → API in your game" />
            </label>
            <label className="field">
              <span>Your name for it (optional)</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="64p blob with TeFinete" />
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy === "save"}>Save and scan</button>
          </div>
        </form>
      )}

      {status && <p className="status banner">{status}</p>}

      {known && (
        <KnownPlayers
          title={`You've met players in ${known.title} before`}
          players={known.players}
          onDismiss={() => setKnown(null)}
        />
      )}

      <section className="card">
        <div className="section-head">
          <h2>Tracked games</h2>
          <div className="actions">
            <input className="search" placeholder="Find by name, number, 64p…" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="button" className="ghost" onClick={load}>Refresh</button>
          </div>
        </div>
        {loading ? <p className="muted">Loading…</p> : !active.length ? (
          <p className="muted">No tracked games. Use “Track a game” to add one.</p>
        ) : (
          <div className="game-list">
            {active.map((game) => (
              <article key={game.gameNumber} className="game-card" onClick={() => navigate(`/game/${game.gameNumber}`)}>
                <div className="game-main">
                  <div className="name-row">
                    <span className="name">{gameTitle(game)}</span>
                    <RenameGame game={game} onRenamed={replaceGame} />
                  </div>
                  <div className="meta">{gameFacts(game)}</div>
                  <div className="meta">tick {game.lastTick ?? 0} · new tick seen {formatDateTime(game.lastSyncAt)}</div>
                  <StorageLine game={game} />
                  <div className="pills">
                    {!!threatCounts[game.gameNumber] && (
                      <span className="pill danger">🚨 {threatCounts[game.gameNumber]} incoming</span>
                    )}
                    {game.finishedAt && <span className="pill">finished</span>}
                    <span className={`pill ${game.keyStatus === "needs_fresh_key" ? "danger" : "success"}`}>
                      {game.keyStatus === "needs_fresh_key" ? "key failing" : "key ok"}
                    </span>
                  </div>
                </div>
                <div className="game-actions" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="secondary" disabled={!!busy} onClick={() => run(game.gameNumber, `Scanning ${gameTitle(game)}`, async () => {
                    const payload = await api.scanGame(game.gameNumber);
                    return payload.unchanged
                      ? `${gameTitle(game)}: no new tick yet (still tick ${payload.snapshot.tick}).`
                      : `Scanned ${gameTitle(game)}. Latest tick ${payload.snapshot.tick}.`;
                  })}>Scan</button>
                  <button type="button" className="primary" disabled={!!busy} onClick={() => run(game.gameNumber, `Capturing ${gameTitle(game)}`, async () => {
                    const payload = await api.captureGame(game.gameNumber);
                    navigate(`/snapshot/${payload.snapshot.id}`);
                    return "";
                  })}>Capture state</button>
                  <button type="button" className="ghost danger-text" disabled={!!busy} onClick={() => run(game.gameNumber, `Deleting ${gameTitle(game)}`, async () => {
                    await api.archiveGame(game.gameNumber);
                    return `${gameTitle(game)} moved to Deleted games. Its history is kept.`;
                  })}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Deleted games <span className="muted">({deleted.length})</span></h2>
        </div>
        <p className="muted small">{isAdmin
          ? "Deleted games are no longer scanned, but their snapshots, captures and maps stay available."
          : "Deleted games are no longer scanned and are erased 24 hours after you delete them."}</p>
        {!deleted.length ? <p className="muted">Nothing here yet.</p> : (
          <div className="game-list">
            {deleted.map((game) => (
              <article key={game.gameNumber} className="game-card archived" onClick={() => navigate(`/game/${game.gameNumber}`)}>
                <div className="game-main">
                  <div className="name-row">
                    <span className="name">{gameTitle(game)}</span>
                    <RenameGame game={game} onRenamed={replaceGame} />
                  </div>
                  <div className="meta">{gameFacts(game)} · final tick {game.lastTick ?? 0} · deleted {formatDateTime(game.archivedAt)}</div>
                  <StorageLine game={game} />
                </div>
                <div className="game-actions" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="secondary" onClick={() => navigate(`/game/${game.gameNumber}`)}>History</button>
                  <button type="button" className="ghost" disabled={!!busy} onClick={() => run(game.gameNumber, `Restoring ${gameTitle(game)}`, async () => {
                    await api.restoreGame(game.gameNumber);
                    return `${gameTitle(game)} is tracked again.`;
                  })}>Restore</button>
                  <button type="button" className="ghost danger-text" disabled={!!busy} onClick={() => {
                    if (!window.confirm(`Permanently erase ${gameTitle(game)} and all of its snapshots? This cannot be undone.`)) return;
                    run(game.gameNumber, `Erasing ${gameTitle(game)}`, async () => {
                      await api.purgeGame(game.gameNumber);
                      return `${gameTitle(game)} erased.`;
                    });
                  }}>Erase forever</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {usage && <UsageBar usage={usage} />}
    </>
  );
}

// What a game's stored scans take in the Cloudflare database.
function StorageLine({ game }) {
  if (game.storageBytes === null || game.storageBytes === undefined) return null;
  return (
    <div className="meta" title="Space this game's stored scans take in the Cloudflare database">
      💾 {formatBytes(game.storageBytes)} in Cloudflare · {game.snapshotCount} scan{game.snapshotCount === 1 ? "" : "s"}
      {game.exportedAt ? " · full history on GitHub" : ""}
    </div>
  );
}

// Database writes today vs Cloudflare's free D1 limit (100k rows a day),
// and how much of the free storage the database uses.
function UsageBar({ usage }) {
  const share = Math.min(1, usage.rowsWritten / usage.limit);
  const storage = usage.storage;
  const note = usage.state === "paused_all"
    ? "Scans are paused until 00:00 UTC to stay on the free plan."
    : usage.state === "paused_optional"
      ? "Analysis and clean-up are paused until 00:00 UTC; scans and alerts keep running."
      : "Optional work pauses at 40%, scans at 75%, so the free limit is never reached.";
  return (
    <section className="card usage">
      <div className="section-head">
        <span className="small">Database writes today: <strong>{usage.rowsWritten.toLocaleString()}</strong> / {usage.limit.toLocaleString()} (Cloudflare free plan)</span>
      </div>
      <div className={`usage-bar ${usage.state}`}><span style={{ width: `${share * 100}%` }} /></div>
      <p className="muted small">{note}</p>
      {storage?.writesByDay?.length > 1 && (
        <p className="muted small">Last days: {storage.writesByDay.map((item) => `${item.day.slice(5)} ${item.rowsWritten.toLocaleString()}`).join(" · ")}</p>
      )}
      {storage && <StorageBar storage={storage} />}
    </section>
  );
}

function StorageBar({ storage }) {
  const size = storage.databaseBytes ?? storage.scanBytes;
  const share = Math.min(1, size / storage.databaseLimit);
  const state = share >= 0.9 ? "paused_all" : share >= 0.7 ? "paused_optional" : "ok";
  return (
    <>
      <div className="section-head usage-storage">
        <span className="small">Database size: <strong>{formatBytes(size)}</strong> / {formatBytes(storage.databaseLimit)} (free plan limit per database; {formatBytes(storage.accountLimit)} per account)</span>
      </div>
      <div className={`usage-bar ${state}`}><span style={{ width: `${share * 100}%` }} /></div>
      <p className="muted small">
        {storage.scans.toLocaleString()} stored scans take {formatBytes(storage.scanBytes)}, of which {formatBytes(storage.pinnedBytes)} are pinned maps kept for good.
        Hourly history of finished games moves to GitHub and is then removed here, so this shrinks again.
      </p>
    </>
  );
}
