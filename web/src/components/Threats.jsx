import React, { useEffect, useRef, useState } from "react";
import { navigate } from "../router.js";
import ThreatMap from "./ThreatMap.jsx";

const VERDICT = {
  undefended: ["undefended", "danger"],
  likely_falls: ["likely to fall", "danger"],
  likely_holds: ["should hold", "success"]
};
const OUTCOME = { fell: "star fell", held: "attack held / landed", gone: "turned away or left view" };

function formatMinutes(minutes) {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

// 🚨 Enemy fleets heading at your stars, newest information first. Each row
// opens the map zoomed on the star and the incoming fleet.
export default function Threats({ threats, currentTick, tickMinutes = 60, onPickPlayer, initialOpenKey = null }) {
  const [showClosed, setShowClosed] = useState(false);
  // The alert whose mini map is open (one at a time). Links from the bell
  // open one straight away.
  const [openKey, setOpenKey] = useState(initialOpenKey);
  const sectionRef = useRef(null);

  useEffect(() => {
    if (!initialOpenKey) return;
    setOpenKey(initialOpenKey);
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [initialOpenKey, threats.length]);
  const open = threats.filter((threat) => threat.status === "open" && !(threat.defenders > 0 && threat.ships < threat.defenders * 0.05));
  const closed = threats.filter((threat) => threat.status !== "open");
  if (!threats.length) return null;

  const fullMap = (threat) => threat.snapshotId && navigate(`/snapshot/${threat.snapshotId}?star=${threat.targetUid}&fleet=${threat.fleetUid}`);

  return (
    <section ref={sectionRef} className={`card threats${open.length ? " live" : ""}`}>
      <div className="section-head">
        <h2>{open.length ? `🚨 Incoming (${open.length})` : "Incoming attacks"}</h2>
        {!!closed.length && (
          <button type="button" className="ghost" onClick={() => setShowClosed((value) => !value)}>
            {showClosed ? "Hide finished" : `Finished (${closed.length})`}
          </button>
        )}
      </div>
      {!open.length && <p className="muted small">No enemy fleets heading at your stars right now.</p>}
      <ul className="relation-list compact">
        {[...open, ...(showClosed ? closed : [])].map((threat) => {
          const remaining = Math.max(0, (threat.etaTick - currentTick) * tickMinutes);
          const arrival = new Date(Date.now() + remaining * 60 * 1000);
          const [verdict, tone] = VERDICT[threat.verdict] || [threat.verdict, ""];
          return (
            <li key={threat.key} className={`${threat.status === "open" ? "war" : ""}${openKey === threat.key ? " expanded" : ""}`}>
              <div className="relation-head threat-head" onClick={() => setOpenKey(openKey === threat.key ? null : threat.key)}>
                <button type="button" className="link-button known-name" onClick={(event) => { event.stopPropagation(); onPickPlayer?.(threat.ownerUid); }}>{threat.ownerAlias}</button>
                <strong>{threat.ships} ships → {threat.targetName}</strong>
                {threat.status === "open"
                  ? <span className={`pill ${tone}`}>{verdict}</span>
                  : <span className="pill">{OUTCOME[threat.outcome] || threat.outcome}</span>}
                {threat.kind === "heading" && <span className="pill" title="No visible route; judged from its direction of travel.">route hidden</span>}
                <button type="button" className="ghost small" onClick={(event) => { event.stopPropagation(); setOpenKey(openKey === threat.key ? null : threat.key); }}>
                  {openKey === threat.key ? "Hide map ▴" : "Show map ▾"}
                </button>
              </div>
              <div className="meta">
                {threat.status === "open"
                  ? <>arrives tick {threat.etaTick} · in ~{formatMinutes(remaining)} ({arrival.toLocaleString([], remaining > 20 * 60 ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" })}) · you have {threat.defenders} ships there · first seen tick {threat.firstTick}</>
                  : <>target tick {threat.etaTick} · first seen tick {threat.firstTick}</>}
              </div>
              {openKey === threat.key && (
                <div className="threat-map-wrap">
                  <ThreatMap
                    threat={threat}
                    label={`${threat.ships} ships${threat.status === "open" ? ` · ~${formatMinutes(remaining)}` : ""}`}
                  />
                  <button type="button" className="ghost small full-map-link" onClick={() => fullMap(threat)}>Full map ↗</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
