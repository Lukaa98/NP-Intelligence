import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { formatDateTime } from "../format.js";

export default function GamesPage() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ gameNumber: "", code: "", name: "" });

  const load = useCallback(async () => {
    try {
      setGames(await api.listGames());
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

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
      setForm({ gameNumber: "", code: "", name: "" });
      setFormOpen(false);
      return `Saved ${payload.game.name}. First scan stored at tick ${payload.snapshot.tick}.`;
    });
  }

  const active = games.filter((game) => !game.archivedAt);
  const deleted = games.filter((game) => game.archivedAt);

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">Neptune's Pride intel</p>
          <h1>Your games</h1>
          <p className="muted">The backend scans tracked games every 6 hours and keeps every snapshot, so finished games stay viewable after Neptune's Pride deletes them.</p>
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
              <span>Name (optional)</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Kappa Pollux" />
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy === "save"}>Save and scan</button>
          </div>
        </form>
      )}

      {status && <p className="status banner">{status}</p>}

      <section className="card">
        <div className="section-head">
          <h2>Tracked games</h2>
          <button type="button" className="ghost" onClick={load}>Refresh</button>
        </div>
        {loading ? <p className="muted">Loading…</p> : !active.length ? (
          <p className="muted">No tracked games. Use “Track a game” to add one.</p>
        ) : (
          <div className="game-list">
            {active.map((game) => (
              <article key={game.gameNumber} className="game-card" onClick={() => navigate(`/game/${game.gameNumber}`)}>
                <div className="game-main">
                  <div className="name">{game.name || `Game ${game.gameNumber}`}</div>
                  <div className="meta">
                    #{game.gameNumber} · tick {game.lastTick ?? 0} · last scan {formatDateTime(game.lastSyncAt)}
                  </div>
                  <div className="pills">
                    {game.finishedAt && <span className="pill">finished</span>}
                    <span className={`pill ${game.keyStatus === "needs_fresh_key" ? "danger" : "success"}`}>
                      {game.keyStatus === "needs_fresh_key" ? "key failing" : "key ok"}
                    </span>
                  </div>
                </div>
                <div className="game-actions" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="secondary" disabled={!!busy} onClick={() => run(game.gameNumber, `Scanning ${game.name}`, async () => {
                    const payload = await api.scanGame(game.gameNumber);
                    return `Scanned ${game.name}. Latest tick ${payload.snapshot.tick}.`;
                  })}>Scan</button>
                  <button type="button" className="primary" disabled={!!busy} onClick={() => run(game.gameNumber, `Capturing ${game.name}`, async () => {
                    const payload = await api.captureGame(game.gameNumber);
                    navigate(`/snapshot/${payload.snapshot.id}`);
                    return "";
                  })}>Capture state</button>
                  <button type="button" className="ghost danger-text" disabled={!!busy} onClick={() => run(game.gameNumber, `Deleting ${game.name}`, async () => {
                    await api.archiveGame(game.gameNumber);
                    return `${game.name} moved to Deleted games. Its history is kept.`;
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
        <p className="muted small">Deleted games are no longer scanned, but their snapshots, captures and maps stay available.</p>
        {!deleted.length ? <p className="muted">Nothing here yet.</p> : (
          <div className="game-list">
            {deleted.map((game) => (
              <article key={game.gameNumber} className="game-card archived" onClick={() => navigate(`/game/${game.gameNumber}`)}>
                <div className="game-main">
                  <div className="name">{game.name || `Game ${game.gameNumber}`}</div>
                  <div className="meta">#{game.gameNumber} · final tick {game.lastTick ?? 0} · deleted {formatDateTime(game.archivedAt)}</div>
                </div>
                <div className="game-actions" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="secondary" onClick={() => navigate(`/game/${game.gameNumber}`)}>History</button>
                  <button type="button" className="ghost" disabled={!!busy} onClick={() => run(game.gameNumber, `Restoring ${game.name}`, async () => {
                    await api.restoreGame(game.gameNumber);
                    return `${game.name} is tracked again.`;
                  })}>Restore</button>
                  <button type="button" className="ghost danger-text" disabled={!!busy} onClick={() => {
                    if (!window.confirm(`Permanently erase ${game.name} and all of its snapshots? This cannot be undone.`)) return;
                    run(game.gameNumber, `Erasing ${game.name}`, async () => {
                      await api.purgeGame(game.gameNumber);
                      return `${game.name} erased.`;
                    });
                  }}>Erase forever</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
