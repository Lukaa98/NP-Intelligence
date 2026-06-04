import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearAllData, getGame, listGames, listSnapshots, markGameKeyProblem, saveSnapshot } from './db.js';
import { diffSnapshots, strategicIntel, summarize } from './intel.js';
import { fetchScanningData } from './npApi.js';

const h = React.createElement;
const AUTO_FETCH_MS = 60 * 60 * 1000;
const AUTO_REFRESH_STORAGE_KEY = 'np-intelligence-auto-refresh';

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
  const [autoStatus, setAutoStatus] = useState('Hourly auto scan is on while this tab is open.');
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => isAutoRefreshEnabled());
  const [schedulerStatus, setSchedulerStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    refreshGames();
    const startupDelay = setTimeout(() => autoFetchDueGames('startup'), 5000);
    const hourlyInterval = setInterval(() => autoFetchDueGames('hourly'), AUTO_FETCH_MS);
    window.__npAutoRefreshTimers = { startupDelay, hourlyInterval };
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
  const intelItems = useMemo(() => strategicIntel(summary, events), [summary, events]);
  const selectedGameMeta = games.find((game) => game.gameNumber === selectedGame);
  const schedulerTargets = useMemo(() => buildSchedulerTargets(games), [games]);
  const schedulerTargetsJson = useMemo(() => JSON.stringify(schedulerTargets, null, 2), [schedulerTargets]);

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

  async function autoFetchDueGames(reason) {
    if (!isAutoRefreshEnabled()) return;

    const trackedGames = await listGames();
    const dueGames = trackedGames.filter((game) => game.apiKey && game.keyStatus !== 'needs_fresh_key' && isAutoFetchDue(game));
    if (!dueGames.length) {
      setAutoStatus('Hourly auto scan is on. No tracked games are due yet.');
      return;
    }

    setAutoStatus(`Auto scan checking ${dueGames.length} due game${dueGames.length === 1 ? '' : 's'}...`);
    let savedCount = 0;
    for (const game of dueGames) {
      try {
        const data = await fetchScanningData({ gameNumber: game.gameNumber, apiKey: game.apiKey });
        await saveSnapshot({ gameNumber: game.gameNumber, apiKey: game.apiKey, scanningData: data, source: 'auto' });
        savedCount += 1;
      } catch (error) {
        if (error.needsFreshKey) {
          await markGameKeyProblem({ gameNumber: game.gameNumber, message: error.message });
        } else {
          console.warn(`Auto scan failed for game ${game.gameNumber}`, error);
        }
      }
    }

    await refreshGames();
    setAutoStatus(`Auto scan ${reason} finished: saved ${savedCount} new snapshot${savedCount === 1 ? '' : 's'}.`);
  }

  function toggleAutoRefresh() {
    const nextValue = !autoRefreshEnabled;
    setAutoRefreshEnabled(nextValue);
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, nextValue ? 'on' : 'off');
    setAutoStatus(nextValue ? 'Hourly auto scan is on while this tab is open.' : 'Hourly auto scan is paused.');
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

  async function copySchedulerTargets() {
    try {
      await navigator.clipboard.writeText(schedulerTargetsJson);
      setSchedulerStatus(`Copied ${schedulerTargets.length} scheduler target${schedulerTargets.length === 1 ? '' : 's'} for the NP_SCAN_TARGETS GitHub secret.`);
    } catch (error) {
      setSchedulerStatus(`Could not copy automatically: ${error.message}. Select and copy the JSON manually.`);
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
        h('div', { className: 'auto-row' },
          h('button', { className: `secondary ${autoRefreshEnabled ? 'active' : ''}`, onClick: toggleAutoRefresh }, autoRefreshEnabled ? 'Hourly auto scan: on' : 'Hourly auto scan: off'),
          h('span', null, autoStatus)
        ),
        h('p', { className: `key-status ${selectedGameMeta?.keyStatus === 'needs_fresh_key' ? 'warning' : 'ok'}` }, keyStatusText(selectedGameMeta)),
        h('p', { className: 'hint' }, "Local dev proxy avoids browser CORS. Enter an API key once per game; after a successful scan it is saved in this browser's IndexedDB and reused while this tab is open.")
      ),
      h('div', { className: 'card' },
        h('h2', null, 'Postman / CORS fallback'),
        h('textarea', { value: pasteJson, onChange: (event) => setPasteJson(event.target.value), placeholder: 'Paste { "scanning_data": ... } here' }),
        h('button', { disabled: loading || !pasteJson.trim(), onClick: savePastedJson }, 'Save pasted JSON as snapshot'),
        h('p', { className: 'status' }, status)
      )
    ),
    h('section', { className: 'card scheduler-card' },
      h('div', null,
        h('h2', null, 'GitHub hourly scheduler'),
        h('p', { className: 'hint' }, 'The workflow stays static. It scans every saved game listed in the NP_SCAN_TARGETS secret, so one hourly run can handle 1 game or 10 games without rewriting YAML.'),
        h('p', { className: 'hint' }, 'A browser-only UI cannot safely update GitHub secrets by itself. Copy this generated JSON into Settings → Secrets and variables → Actions → NP_SCAN_TARGETS, or later we can add a real backend/GitHub OAuth flow to update it automatically.')
      ),
      h('pre', { className: 'scheduler-json' }, schedulerTargets.length ? schedulerTargetsJson : '[]'),
      h('div', { className: 'auto-row' },
        h('button', { className: 'secondary', disabled: schedulerTargets.length === 0, onClick: copySchedulerTargets }, `Copy NP_SCAN_TARGETS (${schedulerTargets.length})`),
        h('span', null, schedulerTargets.length === 0 ? 'Fetch at least one game successfully to save a scheduler target.' : schedulerStatus || 'Paste this into the GitHub Actions secret after adding/updating games.')
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
          h('h2', null, 'Strategic intel'),
          h('p', { className: 'hint' }, 'Less scoreboard, more interpretation: captures, pressure, combat losses, investment focus, tech shifts, and visible war signals.'),
          h('div', { className: 'intel-grid' }, intelItems.map((item, index) => h(IntelCard, { key: `${item.type}-${index}`, item })))
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

function buildSchedulerTargets(games) {
  return games
    .filter((game) => game.apiKey && game.keyStatus !== 'needs_fresh_key')
    .map((game) => ({
      game_number: game.gameNumber,
      code: game.apiKey,
      name: game.name || `Game ${game.gameNumber}`,
    }));
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

function IntelCard({ item }) {
  return h('article', { className: `intel-card ${item.tone}` },
    h('span', null, item.type),
    h('strong', null, item.title),
    h('p', null, item.detail)
  );
}

function isAutoRefreshEnabled() {
  return localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) !== 'off';
}

function isAutoFetchDue(game) {
  if (!game.lastSyncAt) return true;
  return Date.now() - Date.parse(game.lastSyncAt) >= AUTO_FETCH_MS;
}

function Stat({ label, value }) {
  return h('div', { className: 'stat' }, h('span', null, label), h('strong', null, value));
}

createRoot(document.getElementById('root')).render(h(App));
