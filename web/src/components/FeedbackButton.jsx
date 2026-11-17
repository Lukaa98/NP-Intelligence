import React, { useState } from "react";
import { api } from "../api.js";

// Lets testers tell the admin what they think, from any page.
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api.sendFeedback(message.trim(), window.location.hash || "#/");
      setMessage("");
      setStatus("Thanks! Sent.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="ghost" onClick={() => { setOpen(true); setStatus(""); }}>💬 Feedback</button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal card" role="dialog" aria-label="Feedback" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h2>Feedback</h2>
              <button type="button" className="ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
            <p className="muted small">What's useful, confusing, broken or missing? The page you're on is sent along with it.</p>
            <textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Anything goes" autoFocus />
            <div className="actions">
              <button type="button" className="primary" disabled={busy || !message.trim()} onClick={send}>Send</button>
            </div>
            {status && <p className="status">{status}</p>}
          </div>
        </div>
      )}
    </>
  );
}
