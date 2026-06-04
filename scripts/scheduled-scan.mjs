import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffSnapshots, strategicIntel, summarize } from '../src/intel.js';

const outputDir = process.env.NP_SCAN_OUTPUT_DIR || 'output/np-scans';
const historyDir = join(outputDir, 'history');
const latestDir = join(outputDir, 'latest-run');
const startedAt = new Date().toISOString();

let targets = [];
let targetConfigError = '';
try {
  targets = parseTargets(process.env.NP_SCAN_TARGETS || process.env.NP_SCAN_TARGET || '');
} catch (error) {
  targetConfigError = error.message;
}

await mkdir(historyDir, { recursive: true });
await mkdir(latestDir, { recursive: true });

const results = [];

if (targetConfigError) {
  results.push({ ok: false, label: 'Configuration', gameNumber: '', error: targetConfigError });
}

if (!targetConfigError && targets.length === 0) {
  results.push({
    ok: false,
    label: 'Configuration',
    gameNumber: '',
    error: 'No scan targets configured. Set NP_SCAN_TARGETS to JSON like [{"game_number":"7744","code":"..."}].',
  });
}

for (const target of targets) {
  const gameNumber = String(target.game_number ?? target.gameNumber ?? target.game ?? '').trim();
  const code = String(target.code ?? target.apiKey ?? target.api_key ?? '').trim();
  const label = String(target.name ?? target.label ?? `Game ${gameNumber}`).trim();

  if (!gameNumber || !code) {
    results.push({ label, gameNumber, ok: false, error: 'Target is missing game_number/gameNumber or code/apiKey.' });
    continue;
  }

  try {
    const current = await fetchScan({ gameNumber, code, label });
    const previous = await readPreviousSnapshot(gameNumber);
    const events = previous ? diffSnapshots(previous, current) : [];
    const insights = strategicIntel(summarize(current), events);
    const gameDir = join(historyDir, safeFileName(gameNumber));
    await mkdir(gameDir, { recursive: true });
    await writeJson(join(gameDir, 'latest.json'), current);
    await writeJson(join(latestDir, `${safeFileName(gameNumber)}.json`), {
      current,
      previousTick: previous?.tick ?? null,
      events,
      insights,
    });

    results.push({
      ok: true,
      label,
      gameNumber,
      gameName: current.gameName,
      playerUid: current.playerUid,
      tick: current.tick,
      previousTick: previous?.tick ?? null,
      events,
      insights,
      keyPreview: maskKey(code),
    });
  } catch (error) {
    results.push({
      ok: false,
      label,
      gameNumber,
      error: error.message,
      keyPreview: maskKey(code),
    });
  }
}

const summary = buildMarkdownSummary(results);
await writeFile(join(latestDir, 'summary.md'), summary, 'utf8');
await writeJson(join(latestDir, 'summary.json'), { startedAt, results });
console.log(summary);

if (process.env.NP_SCAN_WEBHOOK_URL) {
  await sendWebhook(process.env.NP_SCAN_WEBHOOK_URL, { startedAt, results });
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

function parseTargets(raw) {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    throw new Error(`NP_SCAN_TARGETS must be valid JSON: ${error.message}`);
  }
}

async function fetchScan({ gameNumber, code, label }) {
  const url = new URL('https://np.ironhelmet.com/api');
  url.searchParams.set('game_number', gameNumber);
  url.searchParams.set('code', code);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'NP-Intelligence scheduled scan worker',
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`NP API returned non-JSON for ${label} (${response.status}).`);
  }

  if (!response.ok || !body.scanning_data) {
    const message = body.error || body.message || body.reason || `NP API status ${response.status}`;
    throw new Error(`Could not fetch ${label}: ${message}`);
  }

  const scanningData = body.scanning_data;
  return {
    id: `${gameNumber}-${scanningData.tick ?? 'unknown'}-${Date.now()}`,
    gameNumber,
    source: 'github-actions',
    capturedAt: startedAt,
    tick: Number(scanningData.tick ?? 0),
    productionCounter: Number(scanningData.productionCounter ?? 0),
    productionRate: Number(scanningData.productionRate ?? 0),
    playerUid: Number(scanningData.playerUid ?? 0),
    gameName: scanningData.name || scanningData.config?.name || label,
    data: scanningData,
  };
}

async function readPreviousSnapshot(gameNumber) {
  try {
    const raw = await readFile(join(historyDir, safeFileName(gameNumber), 'latest.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildMarkdownSummary(scanResults) {
  const lines = [`# NP Intelligence scheduled scan`, '', `Run started: ${startedAt}`, ''];
  for (const result of scanResults) {
    lines.push(`## ${result.label || result.gameName || `Game ${result.gameNumber}`}`);
    if (!result.ok) {
      lines.push('', `- Status: failed`, `- Game: ${result.gameNumber || 'unknown'}`, `- Key: ${result.keyPreview || 'not set'}`, `- Error: ${result.error}`, '');
      continue;
    }
    lines.push(
      '',
      `- Status: ok`,
      `- Game: ${result.gameName} (#${result.gameNumber})`,
      `- Tick: ${result.tick}`,
      `- Previous tick: ${result.previousTick ?? 'none cached yet'}`,
      `- Player UID: ${result.playerUid}`,
      `- Key: ${result.keyPreview}`,
      '',
      `### Strategic intel`,
      '',
    );
    for (const insight of result.insights.slice(0, 8)) {
      lines.push(`- **${insight.title}** ${insight.detail}`);
    }
    lines.push('', `### Events`, '');
    if (result.events.length === 0) {
      lines.push('- No comparison events yet. The first scheduled run only seeds the cache.');
    } else {
      for (const event of result.events.slice(0, 20)) {
        lines.push(`- ${event.message}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function sendWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    console.error(`Webhook failed with status ${response.status}.`);
    process.exitCode = 1;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function maskKey(key = '') {
  if (!key) return '';
  if (key.length <= 6) return '••••';
  return `${key.slice(0, 3)}••••${key.slice(-3)}`;
}

function safeFileName(value) {
  return String(value).replace(/[^a-z0-9._-]/gi, '_');
}
