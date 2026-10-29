import React, { useState } from "react";
import { api } from "../api.js";

// Inline editor for your own name for a game. Empty clears it back to the NP name.
export default function RenameGame({ game, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(game.nickname || "");
  const [error, setError] = useState("");

  async function save(event) {
    event?.preventDefault();
    try {
      const { game: updated } = await api.renameGame(game.gameNumber, value);
      setEditing(false);
      setError("");
      onRenamed?.(updated);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="icon-button"
        title="Rename (only for you)"
        onClick={(event) => {
          event.stopPropagation();
          setValue(game.nickname || "");
          setEditing(true);
        }}
      >✎</button>
    );
  }

  return (
    <form className="rename-form" onClick={(event) => event.stopPropagation()} onSubmit={save}>
      <input
        autoFocus
        value={value}
        maxLength={120}
        placeholder={game.name || "Your name for this game"}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && setEditing(false)}
      />
      <button type="submit" className="primary">Save</button>
      <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}
