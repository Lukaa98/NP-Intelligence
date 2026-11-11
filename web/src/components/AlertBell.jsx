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
// Same rule as the backend: ignore fleets under 5% of the defence there.
const negligible = (threat) => threat.defenders > 0 && threat.ships < threat.defenders * 0.05;

// 🔔 In-app attack notifications: one per launched enemy fleet heading at
// your stars, across all games. Counted as new until you have seen it.
// On a game (or one of its maps) the bell is scoped to that game, with a
// toggle to see every game; elsewhere it lists alerts grouped by game.
export default function AlertBell({ gameNumber = null }) {
  const [allThreats, setThreats] = useState([]);
  const [showAll, setShowAll] = useState(false);
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

  useEffect(() => {
    setShowAll(false);
    setOpen(false);
  }, [gameNumber]);

  const relevant = allThreats.filter((threat) => !negligible(threat));
  const scoped = Boolean(gameNumber) && !showAll;
  const threats = scoped ? relevant.filter((threat) => String(threat.gameNumber) === String(gameNumber)) : relevant;
  const elsewhere = relevant.length - threats.length;
  const unseen = threats.filter((threat) => !seen.has(idOf(threat)));
  const groups = [];
  for (const threat of threats) {
    let group = groups.find((item) => item.gameNumber === threat.gameNumber);
    if (!group) {
      group = { gameNumber: threat.gameNumber, title: threat.gameTitle, threats: [] };
      groups.push(group);
    }
    group.threats.push(threat);
  }

  const markSeen = (list) => {
    const next = new Set(seen);
    list.forEach((threat) => next.add(idOf(threat)));
    setSeen(next);
    writeSeen(next);
  };

  const openThreat = (threat) => {
    markSeen([threat]);
    setOpen(false);
    // Open the game with this alert's mini map expanded.
    navigate(`/game/${threat.gameNumber}?threat=${encodeURIComponent(threat.key)}`);
  };

  return (
    <div className="alert-bell" ref={rootRef}>
      <button type="button" className={`ghost bell${unseen.length ? " ringing" : ""}`} onClick={() => setOpen(!open)} title="Incoming attacks">
        🔔{unseen.length > 0 && <span className="bell-count">{unseen.length}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="section-head">
            <strong>{scoped ? "Incoming attacks in this game" : "Incoming attacks"}</strong>
            {!!unseen.length && <button type="button" className="ghost small" onClick={() => markSeen(threats)}>Mark all seen</button>}
          </div>
          {!threats.length && <p className="muted small">No enemy fleets heading at your stars{scoped ? " in this game" : ""}.</p>}
          {groups.map((group) => (
            <div key={group.gameNumber} className="bell-group">
              {!scoped && (
                <a className="bell-game" href={`#/game/${group.gameNumber}`} onClick={() => setOpen(false)}>
                  {group.title} <span className="muted small">({group.threats.length})</span>
                </a>
              )}
            <ul className="bell-list">
              {group.threats.map((threat) => {
                const minutes = Math.max(0, (threat.etaTick - threat.gameTick) * 60);
                const eta = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
                return (
                  <li key={idOf(threat)}>
                    <button type="button" className={`bell-item${seen.has(idOf(threat)) ? "" : " new"}`} onClick={() => openThreat(threat)}>
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
            </div>
          ))}
          {gameNumber && (elsewhere > 0 || showAll) && (
            <button type="button" className="ghost small" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Only this game" : `Show all games (${elsewhere} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
