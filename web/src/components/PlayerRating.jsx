import React, { useEffect, useState } from "react";

// 👍 / 👎 toggles plus a note editor for one player alias. `game` records which
// game the rating came from so the Players page can list where you met them.
export default function PlayerRating({ alias, notes, game, compact = false }) {
  const existing = notes.byAlias[String(alias).toLowerCase()];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(existing?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) setDraft(existing?.note || "");
  }, [existing?.note, editing]);

  async function save(patch) {
    setBusy(true);
    setError("");
    try {
      await notes.save({
        alias,
        rating: patch.rating ?? existing?.rating ?? 0,
        note: patch.note ?? existing?.note ?? "",
        game
      });
      return true;
    } catch (saveError) {
      setError(saveError.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const rating = existing?.rating || 0;

  return (
    <div className={`rating${compact ? " compact" : ""}`} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`rate up${rating > 0 ? " on" : ""}`}
        title={rating > 0 ? "Remove thumbs up" : "Good player to work with"}
        disabled={busy}
        onClick={() => save({ rating: rating > 0 ? 0 : 1 })}
      >👍</button>
      <button
        type="button"
        className={`rate down${rating < 0 ? " on" : ""}`}
        title={rating < 0 ? "Remove thumbs down" : "Bad player to work with"}
        disabled={busy}
        onClick={() => save({ rating: rating < 0 ? 0 : -1 })}
      >👎</button>
      <button
        type="button"
        className={`rate note${existing?.note ? " on" : ""}`}
        title={existing?.note ? existing.note : "Add a note"}
        disabled={busy}
        onClick={() => setEditing((value) => !value)}
      >📝</button>
      {editing && (
        <div className="note-editor">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            placeholder={`Notes on ${alias}: kept their word? backstabbed? active?`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="actions">
            <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await save({ note: draft })) setEditing(false);
              }}
            >Save note</button>
          </div>
        </div>
      )}
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
