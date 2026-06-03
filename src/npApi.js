export async function fetchScanningData({ gameNumber, apiKey }) {
  const url = new URL('/api/np-scan', window.location.origin);
  url.searchParams.set('game_number', gameNumber.trim());
  url.searchParams.set('code', apiKey.trim());

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new Error(payload?.error || `NP API proxy returned HTTP ${response.status}`);
  }
  if (!payload?.scanning_data) {
    throw new Error('Response did not include scanning_data.');
  }

  return payload.scanning_data;
}
