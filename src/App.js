import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearAllData, getGame, listGames, listSnapshots, markGameKeyProblem, saveSnapshot } from './db.js';
import { diffSnapshots, summarize } from './intel.js';
import { fetchScanningData } from './npApi.js';

const h = React.createElement;

function App() {
  const [gameNumber, setGameNumber] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [pasteJson, setPasteJson] = useState('');
  const [games, setGames] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedGame, setSelectedGame] = useState('');
  const [compareFromId, setCompareFromId] = useState('');
  const [compareToId, setCompareToId] = useState('');
  const [status, setStatus] = useState('Ready. Add a game number and API key, then fetch a scan.');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    refreshGames();
  }, []);

  useEffect(() => {
    if (selectedGame) refreshSnapshots(selectedGame);
  }, [selectedGame]);

  useEffect(() => {
    if (!snapshots.length) {
      setCompareFromId('');
      setCompareToId('');
      return;
    }

    const currentExists = snapshots.some((snapshot) => snapshot.id === compareToId);
    const previousExists = snapshots.some((snapshot) => snapshot.id === compareFromId);
    const nextCurrent = currentExists ? compareToId : snapshots[0]?.id || '';
    const nextPrevious = previousExists ? compareFromId : defaultPreviousSnapshot(snapshots, nextCurrent)?.id || '';

    if (nextCurrent !== compareToId) setCompareToId(nextCurrent);
    if (nextPrevious !== compareFromId) setCompareFromId(nextPrevious);
  }, [snapshots]);

  const latest = snapshots[0];
  const summary = useMemo(() => summarize(latest), [latest]);
  const compareCurrent = snapshots.find((snapshot) => snapshot.id === compareToId) || snapshots[0];
  const comparePrevious = snapshots.find((snapshot) => snapshot.id === compareFromId) || defaultPreviousSnapshot(snapshots, compareCurrent?.id);
  const events = useMemo(() => diffSnapshots(comparePrevious, compareCurrent), [comparePrevious, compareCurrent]);
  const selectedGameMeta = games.find((game) => game.gameNumber === selectedGame);

  async function refreshGames() {
    const nextGames = await listGames();
    const sortedGames = nextGames.sort((a, b) => Date.parse(b.lastSyncAt || 0) - Date.parse(a.lastSyncAt || 0));
    setGames(sortedGames);
    if (!selectedGame && sortedGames[0]) selectGame(sortedGames[0]);
  }

  async function refreshSnapshots(nextGame = selectedGame) {
    if (!nextGame) return;
    setSnapshots(await listSnapshots(nextGame));
  }

  function selectGame(game) {
    const nextGameNumber = typeof game === 'string' ? game : game.gameNumber;
    const nextGame = typeof game === 'string' ? games.find((item) => item.gameNumber === game) : game;
    setSelectedGame(nextGameNumber);
    setGameNumber(nextGameNumber);
    if (nextGame?.apiKey) setApiKey(nextGame.apiKey);
  }

  async function fetchAndStore() {
    const targetGameNumber = gameNumber || selectedGame;
    const savedGame = selectedGameMeta?.gameNumber === targetGameNumber ? selectedGameMeta : await getGame(targetGameNumber);
    const keyToUse = apiKey || savedGame?.apiKey || '';

    if (!targetGameNumber || !keyToUse) {
      setStatus('Pick a game and enter an API key once. After a successful scan, NP Intelligence will reuse the saved key for that game.');
      return;
    }

    setLoading(true);
    try {
      const data = await fetchScanningData({ gameNumber: targetGameNumber, apiKey: keyToUse });
      const snapshot = await saveSnapshot({ gameNumber: targetGameNumber, apiKey: keyToUse, scanningData: data });
      setSelectedGame(targetGameNumber);
      setGameNumber(targetGameNumber);
      setApiKey(keyToUse);
      await refreshGames();
      await refreshSnapshots(targetGameNumber);
      setStatus(`Saved scan for ${snapshot.gameName}, tick ${snapshot.tick}. Saved key ${snapshot.apiKeyPreview} will be reused next time.`);
    } catch (error) {
      if (error.needsFreshKey) {
        await markGameKeyProblem({ gameNumber: targetGameNumber, message: error.message });
        await refreshGames();
        setStatus(`The saved API key for game #${targetGameNumber} looks expired or invalid. Generate a fresh NP key, paste it here, and fetch again. (${error.message})`);
      } else {
        setStatus(`${error.message} If the browser blocks CORS, paste the Postman JSON below and save it.`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function savePastedJson() {
    setLoading(true);
    try {
      const parsed = JSON.parse(pasteJson);
      const scanningData = parsed.scanning_data || parsed;
      const snapshot = await saveSnapshot({ gameNumber: gameNumber || String(scanningData.config?.gameNumber || 'manual'), apiKey, scanningData, source: 'paste' });
      setSelectedGame(snapshot.gameNumber);
      await refreshGames();
      await refreshSnapshots(snapshot.gameNumber);
      setPasteJson('');
      setStatus(`Saved pasted scan for ${snapshot.gameName}, tick ${snapshot.tick}.`);
    } catch (error) {
      setStatus(`Could not save pasted JSON: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function resetData() {
    await clearAllData();
    setGames([]);
    setSnapshots([]);
    setSelectedGame('');
    setGameNumber('');
    setApiKey('');
    setStatus('Local IndexedDB data cleared.');
  }

  return h('main', { className: 'app-shell' },
    h('section', { className: 'hero card' },
      h('div', null,
        h('p', { className: 'eyebrow' }, "Neptune's Pride 4 local intel"),
        h('h1', null, 'NP Intelligence'),
        h('p', { className: 'subtle' }, 'Store each tick scan in IndexedDB, compare snapshots, and spot who is growing, fighting, or changing strategy.')
      ),
      h('div', { className: 'hero-stats' },
        h(Stat, { label: 'Current tick', value: summary.tick || '—' }),
        h(Stat, { label: 'Snapshots', value: snapshots.length }),
        h(Stat, { label: 'Players', value: summary.players.length || '—' })
      )
    ),
    h('nav', { className: 'game-tabs card' },
      h('span', { className: 'tab-label' }, 'Games'),
      games.length === 0 ? h('span', { className: 'empty' }, 'No games saved yet.') : games.map((game) => h('button', { className: `tab-button ${selectedGame === game.gameNumber ? 'active' : ''}`, key: game.gameNumber, onClick: () => selectGame(game) },
        h('strong', null, game.name || `Game ${game.gameNumber}`),
        h('span', null, `#${game.gameNumber} · ${gameKeyLabel(game)}`)
      ))
    ),
    h('section', { className: 'grid two' },
      h('div', { className: 'card' },
        h('h2', null, selectedGameMeta ? `Refresh ${selectedGameMeta.name}` : 'Add / refresh game'),
        h('label', null, 'Game number'),
        h('input', { value: gameNumber, onChange: (event) => setGameNumber(event.target.value), placeholder: '7744' }),
        h('label', null, 'API key'),
        h('input', { value: apiKey, onChange: (event) => setApiKey(event.target.value), placeholder: 'YOUR_GAME_API_KEY', type: 'text', spellCheck: 'false', autoComplete: 'off' }),
        h('button', { disabled: loading || !(gameNumber || selectedGame) || !(apiKey || selectedGameMeta?.apiKey), onClick: fetchAndStore }, selectedGameMeta?.apiKey && !apiKey ? 'Refresh with saved key' : 'Fetch NP scan'),
        h('p', { className: `key-status ${selectedGameMeta?.keyStatus === 'needs_fresh_key' ? 'warning' : 'ok'}` }, keyStatusText(selectedGameMeta)),
        h('p', { className: 'hint' }, "Local dev proxy avoids browser CORS. Enter an API key once per game; after a successful scan it is saved in this browser's IndexedDB and reused for future refreshes.")
      ),
      h('div', { className: 'card' },
        h('h2', null, 'Postman / CORS fallback'),
        h('textarea', { value: pasteJson, onChange: (event) => setPasteJson(event.target.value), placeholder: 'Paste { "scanning_data": ... } here' }),
        h('button', { disabled: loading || !pasteJson.trim(), onClick: savePastedJson }, 'Save pasted JSON as snapshot'),
        h('p', { className: 'status' }, status)
      )
    ),
    h('section', { className: 'grid sidebar-layout' },
      h('aside', { className: 'card' },
        h('h2', null, 'Tracked games'),
        games.length === 0 ? h('p', { className: 'empty' }, 'No local games yet.') : games.map((game) => h('button', { className: `game-button ${selectedGame === game.gameNumber ? 'active' : ''}`, key: game.gameNumber, onClick: () => selectGame(game) },
          h('strong', null, game.name || `Game ${game.gameNumber}`),
          h('span', null, `#${game.gameNumber} · tick ${game.lastTick}`),
          h('span', { className: game.keyStatus === 'needs_fresh_key' ? 'needs-key' : '' }, gameKeyLabel(game))
        )),
        h('button', { className: 'danger', onClick: resetData }, 'Clear local data')
      ),
      h('div', { className: 'stack' },
        h('section', { className: 'card' },
          h('h2', null, 'Growth and diplomacy radar'),
          h('div', { className: 'table-wrap' },
            h('table', null,
              h('thead', null, h('tr', null, ['Player', 'Stars', 'Ships', 'Eco', 'Ind', 'Sci', 'Weapons', 'War info'].map((head) => h('th', { key: head }, head)))),
              h('tbody', null, summary.players.map((player) => h(PlayerRow, { key: player.uid, player })))
            )
          )
        ),
        h('section', { className: 'grid two' },
          h('div', { className: 'card' },
            h('h2', null, 'Snapshot comparison / notifications'),
            h('p', { className: 'hint' }, 'Pick two saved scans for this game. The app turns the difference into event-style notifications.'),
            h('div', { className: 'compare-controls' },
              h(SnapshotSelect, { label: 'From', value: compareFromId, snapshots, onChange: setCompareFromId }),
              h(SnapshotSelect, { label: 'To', value: compareToId, snapshots, onChange: setCompareToId })
            ),
            h('p', { className: 'compare-summary' }, comparisonLabel(comparePrevious, compareCurrent)),
            renderEvents(events, comparePrevious, compareCurrent)
          ),
          h('div', { className: 'card' },
            h('h2', null, 'Snapshot history'),
            snapshots.length === 0 ? h('p', { className: 'empty' }, 'No snapshots for selected game.') : snapshots.map((snapshot) => h('div', { className: 'snapshot', key: snapshot.id },
              h('strong', null, `Tick ${snapshot.tick}`),
              h('span', null, `${new Date(snapshot.capturedAt).toLocaleString()} · ${snapshot.source}`)
            ))
          )
        )
      )
    )
  );
}

function keyStatusText(game) {
  if (!game) return 'No saved game selected yet.';
  if (game.keyStatus === 'needs_fresh_key') {
    return `Saved key ${game.apiKeyPreview || 'unknown'} failed. Paste a fresh generated key for this game.`;
  }
  if (game.apiKeyPreview) return `Saved key for this game: ${game.apiKeyPreview}. You can refresh without pasting it again.`;
  return 'No key saved for this game yet. Paste a key once, then fetch successfully to save it.';
}

function gameKeyLabel(game) {
  if (game.keyStatus === 'needs_fresh_key') return `Key needs refresh · ${game.apiKeyPreview || 'no saved key'}`;
  if (game.apiKeyPreview) return `Saved key ${game.apiKeyPreview}`;
  return 'No saved key';
}

function defaultPreviousSnapshot(snapshots, currentId) {
  if (snapshots.length < 2) return undefined;
  const current = snapshots.find((snapshot) => snapshot.id === currentId) || snapshots[0];
  return snapshots.find((snapshot) => snapshot.id !== current.id && snapshot.tick !== current.tick)
    || snapshots.find((snapshot) => snapshot.id !== current.id);
}

function SnapshotSelect({ label, value, snapshots, onChange }) {
  return h('label', { className: 'compact-label' },
    label,
    h('select', { value, onChange: (event) => onChange(event.target.value) },
      snapshots.map((snapshot) => h('option', { key: snapshot.id, value: snapshot.id }, snapshotOption(snapshot)))
    )
  );
}

function snapshotOption(snapshot) {
  return `Tick ${snapshot.tick} · ${new Date(snapshot.capturedAt).toLocaleTimeString()} · ${snapshot.source}`;
}

function comparisonLabel(previous, current) {
  if (!previous || !current) return 'Save at least two snapshots for this game to compare changes.';
  return `Comparing tick ${previous.tick} (${new Date(previous.capturedAt).toLocaleString()}) → tick ${current.tick} (${new Date(current.capturedAt).toLocaleString()}).`;
}

function renderEvents(events, previous, current) {
  if (!previous || !current) return h('p', { className: 'empty' }, 'Need at least two snapshots to show deltas.');
  if (previous.id === current.id) return h('p', { className: 'empty' }, 'Choose two different snapshots.');
  if (events.length === 0) {
    return h('p', { className: 'empty' }, 'No changes detected between these two snapshots. If both are tick 110, that is normal: NP only updates most strategic stats once the game advances.');
  }

  return events.map((item, index) => h('div', { className: `event ${item.tone}`, key: `${item.type}-${index}` }, item.message));
}

function PlayerRow({ player }) {
  const weapons = player.tech?.[5]?.level ?? '—';
  const warCount = Object.entries(player.war || {}).filter(([, value]) => Number(value) > 0).length;
  return h('tr', null,
    h('td', null, h('strong', null, player.alias || `Player ${player.uid}`)),
    h('td', null, player.totalStars ?? '—'),
    h('td', null, player.totalStrength ?? '—'),
    h('td', null, player.totalEconomy ?? '—'),
    h('td', null, player.totalIndustry ?? '—'),
    h('td', null, player.totalScience ?? '—'),
    h('td', null, weapons),
    h('td', null, warCount ? `${warCount} visible wars` : 'No direct war data')
  );
}

function Stat({ label, value }) {
  return h('div', { className: 'stat' }, h('span', null, label), h('strong', null, value));
}

createRoot(document.getElementById('root')).render(h(App));
