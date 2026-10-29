import React, { useMemo, useState } from "react";
import PlayerRating from "../components/PlayerRating.jsx";
import { formatDateTime } from "../format.js";

const FILTERS = [
  ["all", "All"],
  ["good", "👍 Good"],
  ["bad", "👎 Bad"],
  ["noted", "📝 Notes only"]
];

export default function PlayersPage({ notes, reload }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notes.list
      .filter((item) => filter === "all"
        || (filter === "good" && item.rating > 0)
        || (filter === "bad" && item.rating < 0)
        || (filter === "noted" && !item.rating))
      .filter((item) => !needle || item.alias.toLowerCase().includes(needle) || item.note.toLowerCase().includes(needle));
  }, [notes.list, filter, query]);

  const counts = {
    good: notes.list.filter((item) => item.rating > 0).length,
    bad: notes.list.filter((item) => item.rating < 0).length
  };

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">Your player book</p>
          <h1>Rated players</h1>
          <p className="muted">Everyone you gave a 👍, 👎 or a note, across all games. Rate players from a game's intel list or from the galaxy map.</p>
        </div>
        <div className="pills big">
          <span className="pill success">👍 {counts.good}</span>
          <span className="pill danger">👎 {counts.bad}</span>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div className="actions">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" className={`ghost${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
          <div className="actions">
            <input className="search" placeholder="Search alias or note" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="button" className="ghost" onClick={reload}>Refresh</button>
          </div>
        </div>

        {notes.error && <p className="error">{notes.error}</p>}
        {!visible.length ? <p className="muted">No players match.</p> : (
          <div className="player-book">
            {visible.map((item) => (
              <article key={item.aliasKey} className={`book-row${item.rating > 0 ? " good" : item.rating < 0 ? " bad" : ""}`}>
                <div className="book-main">
                  <div className="name">{item.alias}</div>
                  {item.note ? <p className="note-text">{item.note}</p> : <p className="muted small">No note.</p>}
                  <div className="meta">
                    {item.games.length ? (
                      <>Seen in {item.games.map((game, index) => (
                        <React.Fragment key={game.gameNumber}>
                          {index ? ", " : ""}<a href={`#/game/${game.gameNumber}`}>{game.gameName}</a>
                        </React.Fragment>
                      ))}</>
                    ) : "No game recorded"}
                    {" · updated "}{formatDateTime(item.updatedAt)}
                  </div>
                </div>
                <div className="book-actions">
                  <PlayerRating alias={item.alias} notes={notes} />
                  <button
                    type="button"
                    className="ghost danger-text"
                    onClick={() => window.confirm(`Forget ${item.alias}?`) && notes.remove(item.alias)}
                  >Forget</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
