import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, session } from "./api.js";
import GamesPage from "./pages/GamesPage.jsx";
import GamePage from "./pages/GamePage.jsx";
import MapPage from "./pages/MapPage.jsx";
import PlayersPage from "./pages/PlayersPage.jsx";
import SettingsDialog from "./components/SettingsDialog.jsx";
import FeedbackButton from "./components/FeedbackButton.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";

// Hash routes keep deep links working on GitHub Pages without a 404 fallback:
//   #/                     games
//   #/game/:gameNumber     game intel + captures
//   #/snapshot/:id         galaxy map for one snapshot
//   #/players              rated players
//   #/admin                testers, usage and feedback (admin only)
function parseRoute() {
  const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "game" && parts[1]) return { name: "game", gameNumber: parts[1], threatKey: params.get("threat") };
  if (parts[0] === "snapshot" && parts[1]) return { name: "snapshot", snapshotId: parts[1], playerUid: params.get("player"), starUid: params.get("star"), fleetUid: params.get("fleet") };
  if (parts[0] === "players") return { name: "players" };
  if (parts[0] === "admin") return { name: "admin" };
  return { name: "games" };
}

// Checks the saved login first; shows the login page until there is one.
export default function App() {
  const [auth, setAuth] = useState({ state: session.get() ? "checking" : "out" });

  useEffect(() => {
    const onLoggedOut = () => setAuth({ state: "out" });
    window.addEventListener("np-intel:logged-out", onLoggedOut);
    if (session.get()) {
      api.me()
        .then(({ user, viewingAs }) => setAuth({ state: "in", user, viewingAs }))
        .catch((error) => setAuth(session.get() ? { state: "error", message: error.message } : { state: "out" }));
    }
    return () => window.removeEventListener("np-intel:logged-out", onLoggedOut);
  }, []);

  if (auth.state === "checking") return <div className="login-wrap"><p className="muted">Loading…</p></div>;
  if (auth.state === "error") return <div className="login-wrap"><p className="error">Could not reach the backend: {auth.message}</p></div>;
  if (auth.state === "out") {
    return <LoginPage onLoggedIn={() => window.location.reload()} />;
  }
  return <Shell me={auth.user} viewingAs={auth.viewingAs} />;
}

function logOut() {
  session.set("");
  session.setViewAs("");
  window.location.hash = "#/";
  window.location.reload();
}

function stopViewing() {
  session.setViewAs("");
  window.location.hash = "#/admin";
  window.location.reload();
}

const PAGE_EVENTS = { games: "page:games", game: "page:game", snapshot: "page:map", players: "page:players" };

function Shell({ me, viewingAs }) {
  const [route, setRoute] = useState(parseRoute);
  const user = viewingAs || me;
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

  // Usage stats for the admin page (the backend ignores the admin's own use).
  useEffect(() => {
    if (!me.isAdmin && PAGE_EVENTS[route.name]) api.track(PAGE_EVENTS[route.name]);
  }, [me.isAdmin, route.name, route.gameNumber, route.snapshotId]);

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
      {viewingAs && (
        <div className="view-as-banner">
          Viewing as <strong>{viewingAs.username}</strong>{viewingAs.assignedGames?.length ? ` (game ${viewingAs.assignedGames.join(", ")})` : ""}: you see exactly what they see.
          <button type="button" className="ghost small" onClick={stopViewing}>Back to my view</button>
        </div>
      )}
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text">NP Intelligence</span>
        </a>
        <nav>
          <a className={route.name === "games" || route.name === "game" ? "active" : ""} href="#/">Games</a>
          <a className={route.name === "players" ? "active" : ""} href="#/players">Players</a>
          {me.isAdmin && !viewingAs && <a className={route.name === "admin" ? "active" : ""} href="#/admin">Admin</a>}
          {!me.isAdmin && <FeedbackButton />}
          {me.isAdmin && <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>Settings</button>}
          <button type="button" className="ghost" onClick={logOut} title={`Logged in as ${me.username}`}>Log out</button>
        </nav>
      </header>

      <main className={fullBleed ? "page page-full" : "page"}>
        {route.name === "games" && <GamesPage user={user} isAdmin={me.isAdmin && !viewingAs} />}
        {route.name === "game" && <GamePage key={route.gameNumber} gameNumber={route.gameNumber} threatKey={route.threatKey} notes={notes} />}
        {route.name === "snapshot" && <MapPage key={route.snapshotId} snapshotId={route.snapshotId} playerUid={route.playerUid} starUid={route.starUid} fleetUid={route.fleetUid} notes={notes} />}
        {route.name === "players" && <PlayersPage notes={notes} reload={reloadNotes} />}
        {route.name === "admin" && (me.isAdmin ? <AdminPage me={me} /> : <p className="muted">Admin only.</p>)}
      </main>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
