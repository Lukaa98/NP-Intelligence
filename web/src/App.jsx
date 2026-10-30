import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import GamesPage from "./pages/GamesPage.jsx";
import GamePage from "./pages/GamePage.jsx";
import MapPage from "./pages/MapPage.jsx";
import PlayersPage from "./pages/PlayersPage.jsx";
import SettingsDialog from "./components/SettingsDialog.jsx";

// Hash routes keep deep links working on GitHub Pages without a 404 fallback:
//   #/                     games
//   #/game/:gameNumber     game intel + captures
//   #/snapshot/:id         galaxy map for one snapshot
//   #/players              rated players
function parseRoute() {
  const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "game" && parts[1]) return { name: "game", gameNumber: parts[1] };
  if (parts[0] === "snapshot" && parts[1]) return { name: "snapshot", snapshotId: parts[1], playerUid: params.get("player") };
  if (parts[0] === "players") return { name: "players" };
  return { name: "games" };
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerNotes, setPlayerNotes] = useState([]);
  const [notesError, setNotesError] = useState("");

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const reloadNotes = useCallback(async () => {
    try {
      setPlayerNotes(await api.listPlayers());
      setNotesError("");
    } catch (error) {
      setNotesError(error.message);
    }
  }, []);

  useEffect(() => {
    reloadNotes();
  }, [reloadNotes]);

  const notesByAlias = useMemo(
    () => Object.fromEntries(playerNotes.map((note) => [note.aliasKey, note])),
    [playerNotes]
  );

  const saveNote = useCallback(async ({ alias, rating, note, game }) => {
    const saved = await api.savePlayer({ alias, rating, note, game });
    setPlayerNotes((current) => [saved, ...current.filter((item) => item.aliasKey !== saved.aliasKey)]);
    return saved;
  }, []);

  const deleteNote = useCallback(async (alias) => {
    await api.deletePlayer(alias);
    setPlayerNotes((current) => current.filter((item) => item.aliasKey !== alias.toLowerCase()));
  }, []);

  const notes = { list: playerNotes, byAlias: notesByAlias, save: saveNote, remove: deleteNote, error: notesError };
  const fullBleed = route.name === "snapshot";

  return (
    <div className={`app${fullBleed ? " full-bleed" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">NP Intelligence</span>
        </a>
        <nav>
          <a className={route.name === "games" || route.name === "game" ? "active" : ""} href="#/">Games</a>
          <a className={route.name === "players" ? "active" : ""} href="#/players">Players</a>
          <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>Settings</button>
        </nav>
      </header>

      <main className={fullBleed ? "page page-full" : "page"}>
        {route.name === "games" && <GamesPage />}
        {route.name === "game" && <GamePage key={route.gameNumber} gameNumber={route.gameNumber} notes={notes} />}
        {route.name === "snapshot" && <MapPage key={route.snapshotId} snapshotId={route.snapshotId} playerUid={route.playerUid} notes={notes} />}
        {route.name === "players" && <PlayersPage notes={notes} reload={reloadNotes} />}
      </main>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
