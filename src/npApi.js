export class NpApiError extends Error {
  constructor(message, { status = 0, payload, needsFreshKey = false } = {}) {
    super(message);
    this.name = 'NpApiError';
    this.status = status;
    this.payload = payload;
    this.needsFreshKey = needsFreshKey;
  }
}

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
    const message = payload?.error || `NP API proxy returned HTTP ${response.status}`;
    throw new NpApiError(message, {
      status: response.status,
      payload,
      needsFreshKey: isCredentialFailure(response.status, payload, message),
    });
  }
  if (!payload?.scanning_data) {
    const message = payload?.error || payload?.message || 'Response did not include scanning_data.';
    throw new NpApiError(message, {
      status: response.status,
      payload,
      needsFreshKey: isCredentialFailure(response.status, payload, message),
    });
  }

  return payload.scanning_data;
}

function isCredentialFailure(status, payload, message = '') {
  if (status === 401 || status === 403) return true;
  const text = `${message} ${JSON.stringify(payload || {})}`.toLowerCase();
  return /invalid|expired|unauthorized|forbidden|bad\s*(code|key)|api\s*(code|key)|access\s*denied/.test(text);
}
