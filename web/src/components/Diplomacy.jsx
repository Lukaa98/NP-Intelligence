import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { shapeSvg } from "../map/mapViewer.js";

const NP_COLORS = ["#0000ff", "#009fdf", "#40c000", "#ffc000", "#df5f00", "#c00000", "#c000c0", "#6000c0"];
const NP_SHAPES = ["circle", "square", "hexagon", "triangle", "cross", "diamond", "star", "pill"];

const STATUS_LABELS = {
  allied: "Allied",
  possible_allies: "Possibly allied",
  former_allies: "Former allies",
  war: "At war",
  tension: "Tension",
  peaceful: "Peaceful neighbours"
};

// Who is with whom, who fights whom, and who trades tech, inferred from every
// stored scan. Automatically analyses scans that haven't been processed yet.
export default function Diplomacy({ gameNumber, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [focusUid, setFocusUid] = useState(null);
  const analysing = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await api.diplomacy(gameNumber));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [gameNumber]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const analyse = useCallback(async () => {
    if (analysing.current) return;
    analysing.current = true;
    try {
      let remaining = data?.pendingSnapshots ?? 1;
      const total = remaining;
      while (remaining > 0) {
        const result = await api.processRelations(gameNumber);
        remaining = result.remaining;
        setProgress({ done: total - remaining, total });
        if (!result.processed) break;
      }
      await load();
    } catch (analyseError) {
      setError(analyseError.message);
    } finally {
      analysing.current = false;
      setProgress(null);
    }
  }, [data?.pendingSnapshots, gameNumber, load]);

  useEffect(() => {
    if (data?.pendingSnapshots > 0 && !analysing.current) analyse();
  }, [data?.pendingSnapshots, analyse]);

  const players = useMemo(() => new Map((data?.players || []).map((player) => [player.uid, player])), [data]);
  const active = useMemo(() => [...players.values()]
    .filter((player) => !player.conceded && player.totalStars > 0)
    .sort((left, right) => right.totalStars - left.totalStars), [players]);

  if (error) return <section className="card"><h2>Diplomacy</h2><p className="error">{error}</p></section>;
  if (!data) return <section className="card"><h2>Diplomacy</h2><p className="muted">Loading…</p></section>;

  const focus = focusUid ?? data.viewerUid ?? active[0]?.uid;
  const focusPairs = data.pairs.filter((pair) => pair.a === focus || pair.b === focus);
  const conflicts = data.conflicts || [];
  const trades = groupTrades(data.events.filter((event) => event.kind === "tech_trade"));
  const captureTicks = groupByTick(data.events.filter((event) => event.kind === "capture")).slice(0, 24);
  const name = (uid) => players.get(uid)?.alias || `Player ${uid}`;

  return (
    <section className="card diplomacy">
      <div className="section-head">
        <h2>Diplomacy</h2>
        <span className="muted small">
          Based on {data.coverage.snapshotsProcessed} scans{data.coverage.latestTick ? ` up to tick ${data.coverage.latestTick}` : ""}.
          {" "}Inferred from fleets, captures and tech, except your own alliances.
        </span>
      </div>

      {(progress || data.pendingSnapshots > 0) && (
        <div className="progress">
          <span>Analysing stored scans… {progress ? `${progress.done}/${progress.total}` : `${data.pendingSnapshots} to go`}</span>
          <div className="bar"><div style={{ width: `${progress ? (progress.done / Math.max(progress.total, 1)) * 100 : 0}%` }} /></div>
        </div>
      )}

      <h3>Likely teams</h3>
      {!data.teams.length ? <p className="muted">No alliances detected yet. They show up once allied fleets visit each other's stars or trade tech.</p> : (
        <div className="team-grid">
          {data.teams.map((team, index) => (
            <article key={index} className={`team-card${team.members.includes(data.viewerUid) ? " mine" : ""}`}>
              <div className="team-head">
                <strong>Team of {team.members.length}</strong>
                <span className={`pill ${team.confidence >= 0.8 ? "success" : ""}`}>
                  {team.confirmed && team.members.includes(data.viewerUid) ? "includes your alliance" : `${Math.round(team.confidence * 100)}% confident`}
                </span>
              </div>
              <div className="team-members">
                {team.members.map((uid) => (
                  <button key={uid} type="button" className="member" onClick={() => setFocusUid(uid)}>
                    <PlayerBadge player={players.get(uid)} uid={uid} />
                    <span className="muted small">{players.get(uid)?.totalStars ?? 0}★</span>
                  </button>
                ))}
              </div>
              <div className="meta">{team.stars} stars · {team.ships.toLocaleString()} ships · {team.links} of {team.members.length * (team.members.length - 1) / 2} pairs directly linked</div>
            </article>
          ))}
        </div>
      )}

      <h3>Player relations</h3>
      <div className="chip-row">
        {active.map((player) => (
          <button key={player.uid} type="button" className={`chip${player.uid === focus ? " active" : ""}`} onClick={() => setFocusUid(player.uid)}>
            <PlayerBadge player={player} uid={player.uid} />
          </button>
        ))}
      </div>
      {!focusPairs.length ? <p className="muted">No relations recorded for {name(focus)} yet.</p> : (
        <ul className="relation-list">
          {focusPairs.map((pair) => {
            const other = pair.a === focus ? pair.b : pair.a;
            return (
              <li key={`${pair.a}:${pair.b}`} className={pair.status}>
                <div className="relation-head">
                  <PlayerBadge player={players.get(other)} uid={other} />
                  <span className={`status ${pair.status}`}>{pair.confirmed ? "Allied (formal)" : STATUS_LABELS[pair.status]}</span>
                  {pair.warActive && <span className="pill danger">active</span>}
                </div>
                <div className="meta">{describePair(pair, focus, name)}</div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="two-col">
        <div>
          <h3>Wars</h3>
          {!conflicts.length ? <p className="muted">No star captures between players recorded yet.</p> : (
            <ul className="relation-list compact">
              {conflicts.slice(0, 20).map((conflict, index) => (
                <li key={index} className="war conflict">
                  <div className="relation-head">
                    <Side uids={conflict.side} players={players} onPick={setFocusUid} />
                    <span className="versus">⚔</span>
                    {conflict.enemies.map((enemy, enemyIndex) => (
                      <React.Fragment key={enemyIndex}>
                        {enemyIndex > 0 && <span className="muted">+</span>}
                        <Side uids={enemy.members} players={players} onPick={setFocusUid} />
                      </React.Fragment>
                    ))}
                    {conflict.active && <span className="pill danger">active</span>}
                  </div>
                  <div className="meta">
                    {conflict.side.length > 1 ? "Team" : name(conflict.side[0])} took {conflict.took} · lost {conflict.lost}
                    {conflict.lastTick >= 0 && ` · last capture tick ${conflict.lastTick}`}
                  </div>
                  {conflict.enemies.length > 1 && (
                    <ul className="front-list">
                      {conflict.enemies.map((enemy, enemyIndex) => (
                        <li key={enemyIndex}>
                          vs {enemy.members.map(name).join(" + ")}: took {enemy.took}, lost {enemy.lost}
                          {enemy.active ? <span className="pill danger">active</span> : <span className="muted"> · quiet since tick {enemy.lastTick}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Suspected tech trades</h3>
          {!trades.length ? <p className="muted">None spotted yet. A 2+ level jump in one hour, or reaching a level only one or two others had, gets flagged here.</p> : (
            <ul className="relation-list compact">
              {trades.slice(0, 25).map((trade) => (
                <li key={trade.key} className="trade">
                  <div className="relation-head">
                    <span className="muted small">tick {trade.tick}</span>
                    <PlayerBadge player={players.get(trade.receiver)} uid={trade.receiver} />
                    <span className="small">{trade.detail}</span>
                  </div>
                  <div className="meta">
                    likely from {trade.sources.map((uid, index) => (
                      <React.Fragment key={uid}>{index ? " or " : ""}<strong>{name(uid)}</strong></React.Fragment>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!!captureTicks.length && (
        <>
          <h3>Star captures by tick</h3>
          <p className="muted small">Every star that changed owner, per scan. Battles where the defender held aren't shown here.</p>
          <ul className="relation-list compact">
            {captureTicks.map(({ tick, events }) => (
              <li key={tick} className="war">
                <div className="relation-head">
                  <strong>tick {tick}</strong>
                  <span className="muted small">{events.length} capture{events.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="front-list">
                  {summariseCaptures(events).map((line) => (
                    <li key={line.key}>
                      <strong>{name(line.a)}</strong> took {line.stars.join(", ")} from <strong>{name(line.b)}</strong>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// One side of a war: a single player, or a detected team shown as "A & B".
function Side({ uids, players, onPick }) {
  return (
    <span className={`side${uids.length > 1 ? " team" : ""}`}>
      {uids.map((uid, index) => (
        <React.Fragment key={uid}>
          {index > 0 && <span className="muted">&</span>}
          <button type="button" className="link-button" onClick={() => onPick(uid)}>
            <PlayerBadge player={players.get(uid)} uid={uid} />
          </button>
        </React.Fragment>
      ))}
    </span>
  );
}

function PlayerBadge({ player, uid }) {
  const color = typeof player?.color === "number" ? NP_COLORS[player.color % 8] : NP_COLORS[uid % 8];
  const shape = typeof player?.shape === "number" ? NP_SHAPES[player.shape % 8] : NP_SHAPES[Math.floor(uid / 8) % 8];
  return (
    <span className={`player-badge${player?.conceded ? " out" : ""}`}>
      <span dangerouslySetInnerHTML={{ __html: shapeSvg(shape, color, 18) }} />
      {player?.alias || `Player ${uid}`}
    </span>
  );
}

// One line of evidence, phrased from the focused player's point of view.
function describePair(pair, focus, name) {
  const e = pair.evidence;
  const other = pair.a === focus ? pair.b : pair.a;
  const mine = (ab, ba) => (pair.a === focus ? [ab, ba] : [ba, ab]);
  const parts = [];
  if (pair.confirmed) parts.push("formal alliance in your game data");
  const [guestOut, guestIn] = mine(e.guestAB, e.guestBA);
  if (guestOut || guestIn) {
    parts.push(`fleets parked at each other's stars (${name(focus)} → ${name(other)}: ${guestOut} scans, back: ${guestIn})`);
  }
  const [tradeOut, tradeIn] = mine(e.tradeAB, e.tradeBA);
  if (tradeOut || tradeIn) parts.push(`tech possibly traded (score ${Math.round((tradeOut + tradeIn) * 10) / 10})`);
  const [captured, lost] = mine(e.capturesAB, e.capturesBA);
  if (captured || lost) parts.push(`stars taken: ${captured} by ${name(focus)}, ${lost} by ${name(other)}`);
  const [routeOut, routeIn] = mine(e.routeAB, e.routeBA);
  if ((routeOut || routeIn) && !pair.allied) parts.push(`fleets heading at each other (${routeOut} / ${routeIn} scans)`);
  if (e.contact && !captured && !lost) parts.push(`neighbours for ${e.contact} scans without fighting`);
  return parts.join(" · ") || "Weak signal.";
}

function groupByTick(events) {
  const ticks = new Map();
  for (const event of events) {
    if (!ticks.has(event.tick)) ticks.set(event.tick, []);
    ticks.get(event.tick).push(event);
  }
  return [...ticks.entries()].sort((x, y) => y[0] - x[0]).map(([tick, list]) => ({ tick, events: list }));
}

// "A took S1, S2 from B" instead of one line per star.
function summariseCaptures(events) {
  const lines = new Map();
  for (const event of events) {
    const key = `${event.a}:${event.b}`;
    const line = lines.get(key) || { key, a: event.a, b: event.b, stars: [] };
    line.stars.push(event.detail);
    lines.set(key, line);
  }
  return [...lines.values()].sort((x, y) => y.stars.length - x.stars.length);
}

function groupTrades(events) {
  const grouped = new Map();
  for (const event of events) {
    const detail = event.detail.replace(/ \(1 of \d+ possible sources\)$/, "");
    const key = `${event.tick}:${event.a}:${detail}`;
    const entry = grouped.get(key) || { key, tick: event.tick, receiver: event.a, detail, sources: [] };
    entry.sources.push(event.b);
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}
