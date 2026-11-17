import React, { useCallback, useEffect, useState } from "react";
import { api, session } from "../api.js";
import { formatDateTime } from "../format.js";

const EVENT_LABELS = {
  login: "logins",
  add_game: "games added",
  scan: "manual scans",
  capture: "captures",
  "page:games": "games list",
  "page:game": "game page",
  "page:map": "map",
  "page:players": "players page",
  player_panel: "player panels",
  timeline_play: "timeline plays",
  alerts_open: "alert bell"
};

// Testers: create, lock to a game, switch off, view as. Plus usage and feedback.
export default function AdminPage({ me }) {
  const [users, setUsers] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [form, setForm] = useState({ username: "", password: "", games: "" });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [userList, notes] = await Promise.all([api.adminUsers(), api.feedback()]);
      setUsers(userList);
      setFeedback(notes);
    } catch (error) {
      setStatus(error.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(label, action) {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus((await action()) || `${label}: done.`);
      await load();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function createUser(event) {
    event.preventDefault();
    run("Creating user", async () => {
      const { user } = await api.createUser({ username: form.username.trim(), password: form.password, assignedGames: form.games });
      setForm({ username: "", password: "", games: "" });
      return `Created ${user.username}${user.assignedGames.length ? ` with game ${user.assignedGames.join(", ")}` : ""}. Send them the site link with their username and password.`;
    });
  }

  function viewAs(user) {
    session.setViewAs(user.id === me.id ? "" : user.id);
    window.location.hash = "#/";
    window.location.reload();
  }

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Testers</h1>
          <p className="muted">Create a login, assign the game(s) they may use, and see how it's being used. A tester with assigned games only sees those games and only needs to paste their API code; without any they can add any game. Their games are never copied to GitHub and are erased 24 hours after the game ends or they delete it.</p>
        </div>
      </section>

      <form className="card" onSubmit={createUser}>
        <h2>New tester</h2>
        <div className="form-grid">
          <label className="field">
            <span>Username</span>
            <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="bob" />
          </label>
          <label className="field">
            <span>Password</span>
            <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="bobpass" />
          </label>
          <label className="field">
            <span>Assigned game(s), comma-separated</span>
            <input value={form.games} onChange={(event) => setForm({ ...form, games: event.target.value })} placeholder="9079" />
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !form.username.trim() || !form.password}>Create user</button>
        </div>
      </form>

      {status && <p className="status banner">{status}</p>}

      <section className="card">
        <h2>Users <span className="muted">({users.length})</span></h2>
        <div className="game-list">
          {users.map((user) => (
            <UserCard key={user.id} user={user} isMe={user.id === me.id} busy={busy} run={run} onViewAs={() => viewAs(user)} />
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Feedback <span className="muted">({feedback.length})</span></h2>
        {!feedback.length ? <p className="muted">Nothing yet.</p> : (
          <div className="feedback-list">
            {feedback.map((item) => (
              <article key={item.id} className="feedback-item">
                <div className="meta"><strong>{item.username}</strong> · {formatDateTime(item.createdAt)} · <a href={item.page}>{item.page}</a></div>
                <p className="feedback-text">{item.message}</p>
                <button type="button" className="ghost small" disabled={busy} onClick={() => run("Removing feedback", () => api.deleteFeedback(item.id).then(() => "Removed."))}>Remove</button>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function UserCard({ user, isMe, busy, run, onViewAs }) {
  const totals = Object.entries(user.usage?.totals || {}).sort((left, right) => right[1] - left[1]);
  const isAdmin = user.role === "admin";

  function changePassword() {
    const password = window.prompt(`New password for ${user.username}:`);
    if (!password) return;
    run("Changing password", () => api.updateUser(user.id, { password }).then(() => `${user.username}'s password changed. Their old login stops working.`));
  }

  const [newGame, setNewGame] = useState("");

  function addGame(event) {
    event.preventDefault();
    const number = newGame.trim();
    if (!number) return;
    run("Assigning game", () => api.updateUser(user.id, { assignedGames: [...user.assignedGames, number] })
      .then(() => { setNewGame(""); return `Game ${number} assigned to ${user.username}.`; }));
  }

  function removeGame(number) {
    const connected = user.games.some((game) => game.npNumber === number);
    if (!window.confirm(`Take game ${number} away from ${user.username}?${connected ? " Their copy of it is erased." : ""}`)) return;
    run("Removing game", () => api.updateUser(user.id, { assignedGames: user.assignedGames.filter((game) => game !== number) })
      .then(() => `Game ${number} removed from ${user.username}.`));
  }

  return (
    <article className={`game-card user-card${user.disabled ? " archived" : ""}`}>
      <div className="game-main">
        <div className="name-row">
          <span className="name">{user.username}</span>
          <span className="pill">{isAdmin ? "admin" : "tester"}</span>
          {user.disabled && <span className="pill danger">login blocked</span>}
        </div>
        <div className="meta">created {formatDateTime(user.createdAt)} · last login {formatDateTime(user.lastLoginAt)}</div>
        <div className="meta">
          {user.games.length ? user.games.map((game) => (
            <span key={game.gameNumber} className="user-game">
              {game.title} #{game.npNumber} · tick {game.lastTick ?? "?"}{game.finished ? " · finished" : ""}{game.deleted ? " · deleted" : ""}{game.keyStatus === "needs_fresh_key" ? " · key failing" : ""}
            </span>
          )) : "no games"}
        </div>
        {!isAdmin && (
          <form className="assign-row" onSubmit={addGame}>
            <span className="meta">Assigned games:</span>
            {user.assignedGames.length ? user.assignedGames.map((number) => {
              const game = user.games.find((item) => item.npNumber === number);
              return (
                <span key={number} className="assign-chip" title={game ? "Connected" : "Not connected yet"}>
                  {number}{game ? " ✓" : ""}
                  <button type="button" className="ghost" disabled={busy} onClick={() => removeGame(number)} aria-label={`Remove game ${number}`}>✕</button>
                </span>
              );
            }) : <span className="meta">none (can add any game)</span>}
            <input inputMode="numeric" value={newGame} onChange={(event) => setNewGame(event.target.value)} placeholder="game #" aria-label="Game number to assign" />
            <button type="submit" className="ghost small" disabled={busy || !newGame.trim()}>+ Add</button>
          </form>
        )}
        {!isAdmin && (
          <div className="meta">
            {user.usage?.activeDays
              ? <>Last 30 days: active {user.usage.activeDays} day{user.usage.activeDays === 1 ? "" : "s"}, last on {user.usage.lastActiveDay} · {totals.map(([event, count]) => `${count} ${EVENT_LABELS[event] || event}`).join(" · ")}</>
              : "No activity yet."}
          </div>
        )}
      </div>
      <div className="game-actions">
        {!isMe && <button type="button" className="secondary" onClick={onViewAs}>View as</button>}
        <button type="button" className="ghost" disabled={busy} onClick={changePassword}>Password</button>
        {!isAdmin && (
          <>
            <button type="button" className="ghost" disabled={busy} title="Logs them out and stops their scans; nothing is deleted" onClick={() => run(user.disabled ? "Unblocking" : "Blocking login", () => api.updateUser(user.id, { disabled: !user.disabled }).then(() => (user.disabled ? `${user.username} can log in again.` : `${user.username} is logged out and can't log in; their games stop scanning. Nothing was deleted.`)))}>
              {user.disabled ? "Unblock" : "Block login"}
            </button>
            <button type="button" className="ghost danger-text" disabled={busy || !user.games.length} onClick={() => {
              if (!window.confirm(`Erase all of ${user.username}'s games now?`)) return;
              run("Erasing games", () => api.deleteUserGames(user.id).then((result) => `Erased ${result.erased} game(s) of ${user.username}.`));
            }}>Erase games</button>
            <button type="button" className="ghost danger-text" disabled={busy} onClick={() => {
              if (!window.confirm(`Delete ${user.username} with all their games and notes?`)) return;
              run("Deleting user", () => api.deleteUser(user.id).then(() => `${user.username} deleted.`));
            }}>Delete user</button>
          </>
        )}
      </div>
    </article>
  );
}
