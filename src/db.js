const DB_NAME = 'np-intelligence';
const DB_VERSION = 1;
const GAMES = 'games';
const SNAPSHOTS = 'snapshots';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GAMES)) {
        db.createObjectStore(GAMES, { keyPath: 'gameNumber' });
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS)) {
        const store = db.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
        store.createIndex('by_game', 'gameNumber');
        store.createIndex('by_game_tick', ['gameNumber', 'tick']);
      }
    };
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function upsertGame(game) {
  const db = await openDb();
  const tx = db.transaction(GAMES, 'readwrite');
  tx.objectStore(GAMES).put(game);
  await txDone(tx);
}

export async function listGames() {
  const db = await openDb();
  return req(db.transaction(GAMES).objectStore(GAMES).getAll());
}

export async function getGame(gameNumber) {
  if (!gameNumber) return undefined;
  const db = await openDb();
  return req(db.transaction(GAMES).objectStore(GAMES).get(String(gameNumber)));
}

export async function saveSnapshot({ gameNumber, apiKey, scanningData, source = 'api' }) {
  const normalizedGameNumber = String(gameNumber);
  const db = await openDb();
  const existingGame = await req(db.transaction(GAMES).objectStore(GAMES).get(normalizedGameNumber));
  const savedApiKey = apiKey || existingGame?.apiKey || '';
  const snapshot = {
    id: `${normalizedGameNumber}-${scanningData.tick ?? 'unknown'}-${Date.now()}`,
    gameNumber: normalizedGameNumber,
    apiKeyPreview: maskKey(savedApiKey),
    source,
    capturedAt: new Date().toISOString(),
    tick: Number(scanningData.tick ?? 0),
    productionCounter: Number(scanningData.productionCounter ?? 0),
    productionRate: Number(scanningData.productionRate ?? 0),
    playerUid: Number(scanningData.playerUid ?? 0),
    gameName: scanningData.name || scanningData.config?.name || `Game ${gameNumber}`,
    data: scanningData,
  };

  const tx = db.transaction([GAMES, SNAPSHOTS], 'readwrite');
  tx.objectStore(GAMES).put({
    ...existingGame,
    gameNumber: normalizedGameNumber,
    apiKey: savedApiKey,
    apiKeyPreview: maskKey(savedApiKey),
    keyStatus: savedApiKey ? 'valid' : 'missing',
    keyStatusMessage: savedApiKey ? 'Saved key worked on the last successful scan.' : 'No API key saved for this game yet.',
    name: snapshot.gameName,
    playerUid: snapshot.playerUid,
    lastTick: snapshot.tick,
    lastSyncAt: snapshot.capturedAt,
    lastErrorAt: '',
  });
  tx.objectStore(SNAPSHOTS).put(snapshot);
  await txDone(tx);
  return snapshot;
}

export async function listSnapshots(gameNumber) {
  const db = await openDb();
  const index = db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).index('by_game');
  const snapshots = await req(index.getAll(String(gameNumber)));
  return snapshots.sort((a, b) => b.tick - a.tick || Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

export async function markGameKeyProblem({ gameNumber, message }) {
  const db = await openDb();
  const existingGame = await req(db.transaction(GAMES).objectStore(GAMES).get(String(gameNumber)));
  const tx = db.transaction(GAMES, 'readwrite');
  tx.objectStore(GAMES).put({
    ...existingGame,
    gameNumber: String(gameNumber),
    name: existingGame?.name || `Game ${gameNumber}`,
    apiKey: existingGame?.apiKey || '',
    apiKeyPreview: maskKey(existingGame?.apiKey || ''),
    keyStatus: 'needs_fresh_key',
    keyStatusMessage: message || 'The saved API key did not work. Generate a fresh NP key and save it here.',
    lastErrorAt: new Date().toISOString(),
  });
  await txDone(tx);
}

export async function clearAllData() {
  const db = await openDb();
  const tx = db.transaction([GAMES, SNAPSHOTS], 'readwrite');
  tx.objectStore(GAMES).clear();
  tx.objectStore(SNAPSHOTS).clear();
  await txDone(tx);
}

function maskKey(key = '') {
  if (!key) return '';
  if (key.length <= 6) return '••••';
  return `${key.slice(0, 3)}••••${key.slice(-3)}`;
}
