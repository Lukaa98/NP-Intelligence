import React from "react";

// "You've met these players before": your rating and note plus how each one
// related to you in your other tracked games.
export default function KnownPlayers({ players, title = "Players you know", onPick, onDismiss }) {
  if (!players?.length) return null;
  // Full rows only for players with something to say (rated, allied or fought
  // with you); everyone else you merely shared a game with fits on one line.
  const notable = players.filter((player) => player.note || player.games.some((game) => game.wasAlly || game.youTook || game.theyTook));
  const others = players.filter((player) => !notable.includes(player));
  const nameOf = (player) => (onPick
    ? <button type="button" className="link-button known-name" onClick={() => onPick(player.uid)}>{player.alias}</button>
    : <strong className="known-name">{player.alias}</strong>);
  return (
    <section className="card known-players">
      <div className="section-head">
        <h2>{title} <span className="muted">({players.length})</span></h2>
        {onDismiss && <button type="button" className="ghost" onClick={onDismiss}>Dismiss</button>}
      </div>
      <ul className="relation-list compact">
        {notable.map((player) => (
          <li key={player.alias} className={player.note?.rating > 0 ? "allied" : player.note?.rating < 0 ? "war" : ""}>
            <div className="relation-head">
              {player.note?.rating > 0 && <span>👍</span>}
              {player.note?.rating < 0 && <span>👎</span>}
              {nameOf(player)}
              {!!player.games.length && <span className="muted small">{player.games.length} earlier game{player.games.length === 1 ? "" : "s"} together</span>}
            </div>
            {player.note?.note && <div className="note-text">📝 {player.note.note}</div>}
            {player.games.map((game) => (
              <div key={game.gameNumber} className="meta">
                <a href={`#/game/${game.gameNumber}`}>{game.title}</a>: {historyText(game)}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {!!others.length && (
        <p className="known-others">
          <span className="muted small">Also in your earlier games ({others.length}): </span>
          {others.map((player, index) => (
            <React.Fragment key={player.alias}>{index > 0 && ", "}{nameOf(player)}</React.Fragment>
          ))}
        </p>
      )}
    </section>
  );
}

export function historyText(game) {
  const parts = [];
  if (game.wasAlly) parts.push("was your formal ally");
  if (game.youTook || game.theyTook) parts.push(`you took ${game.youTook} of their stars, they took ${game.theyTook} of yours`);
  if (!parts.length) parts.push("in the same game, no direct alliance or fighting recorded");
  if (!game.over) parts.push("(still running)");
  return parts.join(" · ");
}
