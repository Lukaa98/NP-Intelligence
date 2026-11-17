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
  const [form, setForm] = useState({ username: "", password: "", lockedGame: "" });
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
      const { user } = await api.createUser({ username: form.username.trim(), password: form.password, lockedGame: form.lockedGame.trim() });
      setForm({ username: "", password: "", lockedGame: "" });
      return `Created ${user.username}${user.lockedGame ? `, locked to game ${user.lockedGame}` : ""}. Send them the site link with their username and password.`;
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
          <p className="muted">Create a login, optionally lock it to one game, and see how it's being used. Testers only see their own games. Their games are never copied to GitHub and are erased 24 hours after the game ends or they delete it.</p>
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
            <span>Only this game (optional)</span>
            <input inputMode="numeric" value={form.lockedGame} onChange={(event) => setForm({ ...form, lockedGame: event.target.value })} placeholder="9079" />
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

  function changeGame() {
    const value = window.prompt(`Lock ${user.username} to which game number? Leave empty to allow any game.`, user.lockedGame || "");
    if (value === null) return;
    run("Updating game lock", () => api.updateUser(user.id, { lockedGame: value.trim() }).then(() => (value.trim() ? `${user.username} can only add game ${value.trim()}.` : `${user.username} can add any game.`)));
  }

  return (
    <article className={`game-card user-card${user.disabled ? " archived" : ""}`}>
      <div className="game-main">
        <div className="name-row">
          <span className="name">{user.username}</span>
          <span className="pill">{isAdmin ? "admin" : "tester"}</span>
          {user.disabled && <span className="pill danger">switched off</span>}
          {user.lockedGame && <span className="pill">game {user.lockedGame} only</span>}
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
            <button type="button" className="ghost" disabled={busy} onClick={changeGame}>Game lock</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => run(user.disabled ? "Switching on" : "Switching off", () => api.updateUser(user.id, { disabled: !user.disabled }).then(() => (user.disabled ? `${user.username} can log in again.` : `${user.username} is logged out and can't log in; their games stop scanning.`)))}>
              {user.disabled ? "Switch on" : "Switch off"}
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
