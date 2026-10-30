import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { shapeSvg } from "../map/mapViewer.js";

const NP_COLORS = ["#0000ff", "#009fdf", "#40c000", "#ffc000", "#df5f00", "#c00000", "#c000c0", "#6000c0"];
const NP_SHAPES = ["circle", "square", "hexagon", "triangle", "cross", "diamond", "star", "pill"];

// Labels say how the relation was inferred, because only formal alliances in
// your own data are certain.
const STATUS_LABELS = {
  allied: "Allied (fleets parked at each other's stars)",
  possible_allies: "Probably cooperating",
  former_allies: "Former allies",
  war: "At war",
  tension: "Tension",
  peaceful: "Not fighting · maybe a NAP"
};

const STATUS_HINTS = {
  allied: "Near-certain: NP4 fleets fight at enemy stars, so fleets sitting at each other's stars mean a formal alliance.",
  possible_allies: "Some evidence (a fleet visit or likely tech trades), not proof of an alliance.",
  peaceful: "Weak: neighbours who never fight. Could be a non-aggression deal, or just busy elsewhere.",
  tension: "Fleets flying at each other's stars, no captures yet.",
  former_allies: "Were allied, then fought or the alliance ended.",
  war: "Stars captured between them."
};

// Who is with whom, who fights whom, and who trades tech, inferred from every
// stored scan. Automatically analyses scans that haven't been processed yet.
export default function Diplomacy({ gameNumber, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [focusUid, setFocusUid] = useState(null);
  const [openMember, setOpenMember] = useState(null);
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
  const teamIndex = new Map();
  data.teams.forEach((team, index) => team.members.forEach((uid) => teamIndex.set(uid, index)));
  const sameTeam = (pair) => teamIndex.has(pair.a) && teamIndex.get(pair.a) === teamIndex.get(pair.b);
  const friendly = (pair) => ["allied", "possible_allies", "peaceful"].includes(pair.status);
  // Allied pairs split across teams: someone is friendly with a rival bloc.
  const doubleTies = data.pairs.filter((pair) => pair.status === "allied" && teamIndex.has(pair.a) && teamIndex.has(pair.b) && !sameTeam(pair));
  const forming = data.pairs
    .filter((pair) => friendly(pair) && pair.status !== "allied" && !sameTeam(pair))
    .sort((x, y) => y.allyScore - x.allyScore)
    .slice(0, 15);
  const trades = groupTrades(data.events.filter((event) => event.kind === "tech_trade"));
  const captureTicks = groupByTick(data.events.filter((event) => event.kind === "capture")).slice(0, 24);
  const name = (uid) => players.get(uid)?.alias || `Player ${uid}`;

  return (
    <section className="card diplomacy">
      <div className="section-head">
        <h2>Diplomacy</h2>
        <span className="muted small">
          Based on {data.coverage.snapshotsProcessed} scans{data.coverage.latestTick ? ` up to tick ${data.coverage.latestTick}` : ""}.
          {" "}Only your own formal alliances are certain; everything else is inferred (hover a label to see how sure).
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
                  <button
                    key={uid}
                    type="button"
                    className={`member${openMember === uid ? " open" : ""}`}
                    onClick={() => setOpenMember(openMember === uid ? null : uid)}
                  >
                    <PlayerBadge player={players.get(uid)} uid={uid} />
                    <span className="muted small">{players.get(uid)?.totalStars ?? 0}★</span>
                  </button>
                ))}
              </div>
              <div className="meta">{team.stars} stars · {team.ships.toLocaleString()} ships · {team.links} of {team.members.length * (team.members.length - 1) / 2} pairs directly linked</div>
              {team.members.includes(openMember) && (
                <MemberRelations
                  uid={openMember}
                  pairs={data.pairs.filter((pair) => pair.a === openMember || pair.b === openMember)}
                  teamIndex={teamIndex}
                  ownTeam={index}
                  players={players}
                  name={name}
                />
              )}
            </article>
          ))}
        </div>
      )}

      {!!doubleTies.length && (
        <>
          <h3>⚠ Double ties</h3>
          <p className="muted small">Players who look allied with someone in a rival team (the two teams are at war somewhere).</p>
          <ul className="relation-list compact">
            {doubleTies.map((pair) => (
              <li key={`${pair.a}:${pair.b}`} className="tension">
                <div className="relation-head">
                  <PlayerBadge player={players.get(pair.a)} uid={pair.a} />
                  <span className="muted">↔</span>
                  <PlayerBadge player={players.get(pair.b)} uid={pair.b} />
                  <span className="status allied">{pair.confirmed ? "Allied (formal)" : "Allied"}</span>
                </div>
                <div className="meta">{describePair(pair, pair.a, name)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {!!data.middlemen?.length && (
        <>
          <h3>Caught in the middle</h3>
          <p className="muted small">Friendly with two players who are at war with each other, and who they actually help: tech sent, fleets parked at their stars, fleets flying to them.</p>
          <ul className="relation-list compact">
            {data.middlemen.slice(0, 15).map((item) => {
              const [first, second] = item.sides;
              return (
                <li key={`${item.middle}:${first.uid}:${second.uid}`} className="trade">
                  <div className="relation-head">
                    <PlayerBadge player={players.get(item.middle)} uid={item.middle} />
                    <span className="muted small">between</span>
                    <PlayerBadge player={players.get(first.uid)} uid={first.uid} />
                    <span className="versus">⚔</span>
                    <PlayerBadge player={players.get(second.uid)} uid={second.uid} />
                    {item.warActive && <span className="pill danger">war active</span>}
                  </div>
                  <div className="verdict">{verdictText(item, name)}</div>
                  <div className="support-grid">
                    {[first, second].map((side) => (
                      <div key={side.uid} className="meta">
                        to <strong>{name(side.uid)}</strong>: tech {side.tech || 0} · fleets parked {side.fleets} scans · fleets sent {side.routes} scans
                        {side.attacks ? <span className="pill danger">took {side.attacks} of their stars</span> : null}
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3>Alliances forming</h3>
      {!forming.length ? <p className="muted">Nothing yet. Pairs that start visiting each other's stars, trading tech, or sharing a border without fighting show up here.</p> : (
        <ul className="relation-list compact">
          {forming.map((pair) => (
            <li key={`${pair.a}:${pair.b}`} className={pair.status}>
              <div className="relation-head">
                <PlayerBadge player={players.get(pair.a)} uid={pair.a} />
                <span className="muted">+</span>
                <PlayerBadge player={players.get(pair.b)} uid={pair.b} />
                <span className={`status ${pair.status}`} title={pair.confirmed ? "From your own game data." : STATUS_HINTS[pair.status]}>{STATUS_LABELS[pair.status]}</span>
              </div>
              <div className="meta">{describePair(pair, pair.a, name)}</div>
            </li>
          ))}
        </ul>
      )}

      <h3>Any player's relations</h3>
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
                  <span className={`status ${pair.status}`} title={pair.confirmed ? "From your own game data." : STATUS_HINTS[pair.status]}>{pair.confirmed ? "Allied (formal, certain)" : STATUS_LABELS[pair.status]}</span>
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
          <details className="capture-log">
          <summary>Star capture log (every star that changed owner, by tick)</summary>
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
          </details>
        </>
      )}
    </section>
  );
}

// A team member's relations, shown inside their team card. Friendly ties to
// players outside the team are the interesting part, so they come first.
function MemberRelations({ uid, pairs, teamIndex, ownTeam, players, name }) {
  const other = (pair) => (pair.a === uid ? pair.b : pair.a);
  const outside = (pair) => teamIndex.get(other(pair)) !== ownTeam;
  const order = { allied: 0, possible_allies: 1, war: 2, former_allies: 3, tension: 4, peaceful: 5 };
  const sorted = pairs
    .filter((pair) => outside(pair) || pair.status !== "allied")
    .sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9) || y.allyScore + y.warScore - (x.allyScore + x.warScore));
  if (!sorted.length) {
    return <p className="member-relations muted small">{name(uid)} has no relations outside this team on record.</p>;
  }
  return (
    <ul className="member-relations relation-list compact">
      {sorted.slice(0, 12).map((pair) => {
        const them = other(pair);
        const friendlyOutside = ["allied", "possible_allies"].includes(pair.status) && outside(pair);
        return (
          <li key={`${pair.a}:${pair.b}`} className={pair.status}>
            <div className="relation-head">
              <PlayerBadge player={players.get(them)} uid={them} />
              <span className={`status ${pair.status}`} title={pair.confirmed ? "From your own game data." : STATUS_HINTS[pair.status]}>{pair.confirmed ? "Allied (formal, certain)" : STATUS_LABELS[pair.status]}</span>
              {friendlyOutside && <span className="pill">⚠ outside team</span>}
              {pair.warActive && <span className="pill danger">active</span>}
            </div>
            <div className="meta">{describePair(pair, uid, name)}</div>
          </li>
        );
      })}
    </ul>
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

function verdictText(item, name) {
  const [first, second] = item.sides;
  const who = name(item.middle);
  switch (item.verdict) {
    case "leans_first": return `${who} leans towards ${name(first.uid)}.`;
    case "leans_second": return `${who} leans towards ${name(second.uid)}.`;
    case "helping_both": return `${who} is helping both sides, maybe letting them wear each other down.`;
    case "attacking_one": return `${who} has taken stars from one of them: likely picking a side or switching.`;
    default: return `${who} is staying out of it (no tech, fleets or reinforcements seen for either).`;
  }
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
