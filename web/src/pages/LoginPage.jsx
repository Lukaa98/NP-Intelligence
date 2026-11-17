import React, { useEffect, useState } from "react";
import { api, getSettings, session } from "../api.js";

// Login, or on the very first visit, creating the admin account.
export default function LoginPage({ onLoggedIn }) {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ username: "", password: "", writeToken: getSettings().writeToken });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus().then(setStatus).catch((problem) => setError(`Could not reach the backend: ${problem.message}`));
  }, []);

  const setup = status?.needsSetup;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = setup
        ? await api.setup({ username: form.username.trim(), password: form.password, writeToken: form.writeToken.trim() })
        : await api.login(form.username.trim(), form.password);
      session.set(result.ticket);
      onLoggedIn(result.user);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <p className="eyebrow">Neptune's Pride intel</p>
        <h1>{setup ? "Create your admin login" : "Log in"}</h1>
        {setup && <p className="muted small">First visit since accounts were added. Pick the username and password you will use from now on. Your existing games and notes become yours.</p>}
        <label className="field">
          <span>Username</span>
          <input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete={setup ? "new-password" : "current-password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </label>
        {setup && status?.setupNeedsToken && (
          <label className="field">
            <span>Write token (proves you own this site)</span>
            <input type="password" value={form.writeToken} onChange={(event) => setForm({ ...form, writeToken: event.target.value })} placeholder="The token from Settings" />
          </label>
        )}
        {error && <p className="error small">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !status || !form.username || !form.password}>
            {setup ? "Create admin login" : "Log in"}
          </button>
        </div>
      </form>
    </div>
  );
}
