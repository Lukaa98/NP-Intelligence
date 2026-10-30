import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { shapeSvg } from "../map/mapViewer.js";

const NP_COLORS = ["#0000ff", "#009fdf", "#40c000", "#ffc000", "#df5f00", "#c00000", "#c000c0", "#6000c0"];
const NP_SHAPES = ["circle", "square", "hexagon", "triangle", "cross", "diamond", "star", "pill"];

// Labels say how the relation was inferred, because only formal alliances in
// your own data are certain.
export const STATUS_LABELS = {
  allied: "Allied (fleets parked at each other's stars)",
  possible_allies: "Probably cooperating",
  former_allies: "Former allies",
  war: "At war",
  tension: "Tension",
  peaceful: "Not fighting · maybe a NAP"
};

export const STATUS_HINTS = {
  allied: "Near-certain: NP4 fleets fight at enemy stars, so fleets sitting at each other's stars mean a formal alliance.",
  possible_allies: "Some evidence (a fleet visit or likely tech trades), not proof of an alliance.",
  peaceful: "Weak: neighbours who never fight. Could be a non-aggression deal, or just busy elsewhere.",
  tension: "Fleets flying at each other's stars, no captures yet.",
  former_allies: "Were allied, then fought or the alliance ended.",
  war: "Stars captured between them."
};

// Clicking any player name on the game page calls this with the player's uid
// (the page opens that player's row in the player list).
export const PickPlayer = createContext(null);

// Loads diplomacy for a game and analyses any scans not processed yet.
export function useDiplomacy(gameNumber, refreshKey) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
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
  return { data, error, progress, players };
}

// The big picture: likely teams and wars. Everything else is per player, in
// the player list on the game page.
export default function Diplomacy({ diplomacy }) {
  const { data, error, progress, players } = diplomacy;

  if (error) return <section className="card"><h2>Diplomacy</h2><p className="error">{error}</p></section>;
  if (!data) return <section className="card"><h2>Diplomacy</h2><p className="muted">Loading…</p></section>;

  const conflicts = data.conflicts || [];
  const name = (uid) => players.get(uid)?.alias || `Player ${uid}`;

  return (
    <section className="card diplomacy">
      <div className="section-head">
        <h2>Diplomacy</h2>
        <span className="muted small">
          Based on {data.coverage.snapshotsProcessed} scans{data.coverage.latestTick ? ` up to tick ${data.coverage.latestTick}` : ""}.
          {" "}Click any name to open that player: their map, allies, enemies and trades.
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
                  <span key={uid} className="member">
                    <PlayerBadge player={players.get(uid)} uid={uid} />
                    <span className="muted small">{players.get(uid)?.totalStars ?? 0}★</span>
                  </span>
                ))}
              </div>
              <div className="meta">{team.stars} stars · {team.ships.toLocaleString()} ships · {team.links} of {team.members.length * (team.members.length - 1) / 2} pairs directly linked</div>

            </article>
          ))}
        </div>
      )}

      <div>
        <div>
          <h3>Wars</h3>
          {!conflicts.length ? <p className="muted">No star captures between players recorded yet.</p> : (
            <ul className="relation-list compact">
              {conflicts.slice(0, 20).map((conflict, index) => (
                <li key={index} className="war conflict">
                  <div className="relation-head">
                    <Side uids={conflict.side} players={players} />
                    <span className="versus">⚔</span>
                    {conflict.enemies.map((enemy, enemyIndex) => (
                      <React.Fragment key={enemyIndex}>
                        {enemyIndex > 0 && <span className="muted">+</span>}
                        <Side uids={enemy.members} players={players} />
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
      </div>
    </section>
  );
}

// One side of a war: a single player, or a detected team shown as "A & B".
function Side({ uids, players }) {
  return (
    <span className={`side${uids.length > 1 ? " team" : ""}`}>
      {uids.map((uid, index) => (
        <React.Fragment key={uid}>
          {index > 0 && <span className="muted">&</span>}
          <PlayerBadge player={players.get(uid)} uid={uid} />
        </React.Fragment>
      ))}
    </span>
  );
}

export function PlayerBadge({ player, uid }) {
  const pick = useContext(PickPlayer);
  const color = typeof player?.color === "number" ? NP_COLORS[player.color % 8] : NP_COLORS[uid % 8];
  const shape = typeof player?.shape === "number" ? NP_SHAPES[player.shape % 8] : NP_SHAPES[Math.floor(uid / 8) % 8];
  const content = (
    <>
      <span dangerouslySetInnerHTML={{ __html: shapeSvg(shape, color, 18) }} />
      {player?.alias || `Player ${uid}`}
    </>
  );
  if (!pick) {
    return <span className={`player-badge${player?.conceded ? " out" : ""}`}>{content}</span>;
  }
  return (
    <button
      type="button"
      className={`player-badge link-button${player?.conceded ? " out" : ""}`}
      title="Open this player"
      onClick={(event) => {
        event.stopPropagation();
        pick(uid);
      }}
    >{content}</button>
  );
}

// One line of evidence, phrased from the focused player's point of view.
export function describePair(pair, focus, name) {
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

export function verdictText(item, name) {
  const [first, second] = item.sides;
  const who = name(item.middle);
  switch (item.verdict) {
    case "leans_first": return `${who} leans towards ${name(first.uid)}.`;
    case "leans_second": return `${who} leans towards ${name(second.uid)}.`;
    case "helping_both": return `${who} is helping both sides, maybe letting them wear each other down.`;
    case "attacking_one": {
      const victim = first.attacks ? first : second;
      return `${who} has taken stars from ${name(victim.uid)}: likely picking a side or switching.`;
    }
    case "fighting_both": return `${who} has taken stars from both: friendly on paper only.`;
    default: return `${who} is staying out of it (no tech, fleets or reinforcements seen for either).`;
  }
}

export function groupTrades(events) {
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
