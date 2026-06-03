export async function fetchScanningData({ gameNumber, apiKey }) {
  const url = new URL('https://np.ironhelmet.com/api');
  url.searchParams.set('game_number', gameNumber.trim());
  url.searchParams.set('code', apiKey.trim());

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`NP API returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.scanning_data) {
    throw new Error('Response did not include scanning_data.');
  }

  return payload.scanning_data;
}
