import React, { useState } from "react";
import { api, getSettings, saveSettings } from "../api.js";

export default function SettingsDialog({ onClose }) {
  const initial = getSettings();
  const [backendUrl, setBackendUrl] = useState(initial.backendUrl);
  const [writeToken, setWriteToken] = useState(initial.writeToken);
  const [status, setStatus] = useState("");

  async function test() {
    saveSettings({ backendUrl, writeToken });
    try {
      const health = await api.health();
      setStatus(health.writeTokenRequired
        ? "Connected. This backend requires a write token for changes."
        : "Connected. This backend accepts changes without a token.");
    } catch (error) {
      setStatus(`Could not reach backend: ${error.message}`);
    }
  }

  function save() {
    saveSettings({ backendUrl, writeToken });
    // Every page reads settings on load, so a reload applies them everywhere.
    window.location.reload();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-label="Settings" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <h2>Settings</h2>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </div>
        <label className="field">
          <span>Backend (Cloudflare Worker) URL</span>
          <input value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} placeholder={initial.defaultBackendUrl} />
        </label>
        <label className="field">
          <span>Write token (only if the Worker has ADMIN_TOKEN set)</span>
          <input type="password" value={writeToken} onChange={(event) => setWriteToken(event.target.value)} placeholder="Leave empty if not used" />
        </label>
        <p className="muted small">Stored only in this browser.</p>
        <div className="actions">
          <button type="button" className="secondary" onClick={test}>Test connection</button>
          <button type="button" className="primary" onClick={save}>Save</button>
        </div>
        {status && <p className="status">{status}</p>}
      </div>
    </div>
  );
}
