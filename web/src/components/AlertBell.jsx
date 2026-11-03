import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { navigate } from "../router.js";

const SEEN_KEY = "np-intel.seenThreats";
const POLL_MS = 2 * 60 * 1000;

function readSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeSeen(seen) {
  try {
    // Only open threats matter; cap the list so it can't grow forever.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  } catch {
    // Storage blocked: alerts just show as new again next visit.
  }
}

const idOf = (threat) => `${threat.gameNumber}:${threat.key}`;

// 🔔 In-app attack notifications: one per launched enemy fleet heading at
// your stars, across all games. Counted as new until you have seen it.
export default function AlertBell() {
  const [threats, setThreats] = useState([]);
  const [seen, setSeen] = useState(readSeen);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const load = useCallback(() => api.openThreats().then(setThreats).catch(() => {}), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => !rootRef.current?.contains(event.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const unseen = threats.filter((threat) => !seen.has(idOf(threat)));

  const markSeen = (list) => {
    const next = new Set(seen);
    list.forEach((threat) => next.add(idOf(threat)));
    setSeen(next);
    writeSeen(next);
  };

  const openThreat = (threat) => {
    markSeen([threat]);
    setOpen(false);
    navigate(threat.snapshotId
      ? `/snapshot/${threat.snapshotId}?star=${threat.targetUid}&fleet=${threat.fleetUid}`
      : `/game/${threat.gameNumber}`);
  };

  return (
    <div className="alert-bell" ref={rootRef}>
      <button type="button" className={`ghost bell${unseen.length ? " ringing" : ""}`} onClick={() => setOpen(!open)} title="Incoming attacks">
        🔔{unseen.length > 0 && <span className="bell-count">{unseen.length}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="section-head">
            <strong>Incoming attacks</strong>
            {!!unseen.length && <button type="button" className="ghost small" onClick={() => markSeen(threats)}>Mark all seen</button>}
          </div>
          {!threats.length ? <p className="muted small">No enemy fleets heading at your stars.</p> : (
            <ul className="bell-list">
              {threats.map((threat) => {
                const minutes = Math.max(0, (threat.etaTick - threat.gameTick) * 60);
                const eta = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
                return (
                  <li key={idOf(threat)}>
                    <button type="button" className={`bell-item${seen.has(idOf(threat)) ? "" : " new"}`} onClick={() => openThreat(threat)}>
                      <span className="muted small">{threat.gameTitle}</span>
                      <span>🚨 <strong>{threat.ownerAlias}</strong> · {threat.ships} ships → <strong>{threat.targetName}</strong></span>
                      <span className="muted small">
                        in ~{eta} · you have {threat.defenders} there
                        {threat.verdict === "likely_falls" && " · likely to fall"}
                        {threat.verdict === "undefended" && " · undefended"}
                        {threat.kind === "heading" && " · route hidden"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
