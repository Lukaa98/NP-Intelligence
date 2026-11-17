import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { formatDateTime, gameFacts, gameTitle } from "../format.js";
import KnownPlayers from "../components/KnownPlayers.jsx";

const npGameUrl = (number) => `https://np.ironhelmet.com/game/${encodeURIComponent(number)}`;

// A tester's home page: only the games the admin assigned to them. Each one
// either asks for the API code or, once connected, opens like any game.
export default function AssignedGames({ assigned }) {
  const [games, setGames] = useState([]);
  const [threatCounts, setThreatCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [known, setKnown] = useState(null);

  const load = useCallback(async () => {
    try {
      setGames(await api.listGames());
      api.threatCounts().then(setThreatCounts).catch(() => {});
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">Neptune's Pride intel</p>
          <h1>Your game{assigned.length === 1 ? "" : "s"}</h1>
          <p className="muted">Connect your game with its API code and it is scanned every 10 minutes: who is allied or at war, who is AFK, a replayable map, and the 🔔 lights up when an enemy fleet is launched at one of your stars. Only you and the site admin can see it, and it is erased 24 hours after the game ends. Use 💬 Feedback to say what you think.</p>
        </div>
      </section>

      {status && <p className="status banner">{status}</p>}

      {known && <KnownPlayers title={`You've met players in ${known.title} before`} players={known.players} onDismiss={() => setKnown(null)} />}

      <section className="card">
        <h2>Assigned to you</h2>
        {loading ? <p className="muted">Loading…</p> : (
          <div className="game-list">
            {assigned.map((number) => {
              const game = games.find((item) => item.npNumber === number);
              return game
                ? <ConnectedGame key={number} game={game} incoming={threatCounts[game.gameNumber]} onChanged={load} setStatus={setStatus} />
                : <ConnectGame key={number} number={number} onConnected={(payload) => {
                  if (payload.knownPlayers?.length) setKnown({ title: gameTitle(payload.game), players: payload.knownPlayers });
                  setStatus(`Connected ${gameTitle(payload.game)}. First scan stored at tick ${payload.snapshot.tick}.`);
                  load();
                }} />;
            })}
          </div>
        )}
      </section>
    </>
  );
}

function ConnectGame({ number, onConnected, failing = false }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onConnected(await api.saveGame({ game_number: number, code: code.trim(), name: "" }));
      setCode("");
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={failing ? "connect-form" : "game-card connect-card"} onSubmit={connect} onClick={(event) => event.stopPropagation()}>
      {!failing && (
        <div className="game-main">
          <a className="name" href={npGameUrl(number)} target="_blank" rel="noreferrer">Game #{number} ↗</a>
          <div className="meta">Not connected yet. In Neptune's Pride open this game, go to Options → API, copy your API code and paste it here.</div>
        </div>
      )}
      <div className="connect-row">
        <input type="password" value={code} onChange={(event) => setCode(event.target.value)} placeholder={failing ? "New API code" : "Your API code"} aria-label={`API code for game ${number}`} />
        <button type="submit" className="primary" disabled={busy || !code.trim()}>{busy ? "Checking…" : failing ? "Update code" : "Connect"}</button>
      </div>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}

function ConnectedGame({ game, incoming, onChanged, setStatus }) {
  const [busy, setBusy] = useState(false);
  const failing = game.keyStatus === "needs_fresh_key";

  async function act(label, action) {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(await action());
      onChanged();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="game-card" onClick={() => navigate(`/game/${game.gameNumber}`)}>
      <div className="game-main">
        <span className="name">{gameTitle(game)}</span>
        <div className="meta">{gameFacts(game)} · <a href={npGameUrl(game.npNumber)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>open in Neptune's Pride ↗</a></div>
        <div className="meta">tick {game.lastTick ?? 0} · new tick seen {formatDateTime(game.lastSyncAt)}</div>
        <div className="pills">
          {!!incoming && <span className="pill danger">🚨 {incoming} incoming</span>}
          {game.finishedAt && <span className="pill">finished · erased 24h after it ended</span>}
          <span className={`pill ${failing ? "danger" : "success"}`}>{failing ? "API code failing" : "connected"}</span>
        </div>
        {failing && <ConnectGame number={game.npNumber} failing onConnected={() => { setStatus("API code updated."); onChanged(); }} />}
      </div>
      <div className="game-actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="primary" onClick={() => navigate(`/game/${game.gameNumber}`)}>Open</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => act("Scanning", async () => {
          const payload = await api.scanGame(game.gameNumber);
          return payload.unchanged ? `No new tick yet (still tick ${payload.snapshot.tick}).` : `Scanned. Latest tick ${payload.snapshot.tick}.`;
        })}>Scan</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => act("Capturing", async () => {
          const payload = await api.captureGame(game.gameNumber);
          navigate(`/snapshot/${payload.snapshot.id}`);
          return "";
        })}>Capture state</button>
      </div>
    </article>
  );
}
