export async function registerBackendGame({ backendUrl, gameNumber, apiKey, name }) {
  const base = normalizeBackendUrl(backendUrl);
  const response = await fetch(`${base}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game_number: gameNumber, code: apiKey, name }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Backend returned ${response.status}`);
  }
  return payload;
}

export async function checkBackendHealth(backendUrl) {
  const base = normalizeBackendUrl(backendUrl);
  const response = await fetch(`${base}/health`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Backend returned ${response.status}`);
  return payload;
}

export function normalizeBackendUrl(backendUrl) {
  const trimmed = String(backendUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Backend URL is required.');
  return trimmed;
}
