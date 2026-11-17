const NP_API_URL = "https://np.ironhelmet.com/api";

export class NeptuneApiError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = "NeptuneApiError";
    this.status = status;
  }
}

export async function fetchScan(gameNumber, code) {
  const url = new URL(NP_API_URL);
  // A tester's copy is stored as "<number>~<user>"; NP only knows the number.
  url.searchParams.set("game_number", String(gameNumber).split("~")[0].trim());
  url.searchParams.set("code", String(code).trim());

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "NP-Intelligence-Worker"
    }
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new NeptuneApiError(`NP API returned non-JSON response (${response.status}).`, { status: response.status });
  }

  if (!response.ok || !payload?.scanning_data) {
    const message = payload?.error || payload?.message || payload?.reason || `NP API status ${response.status}`;
    throw new NeptuneApiError(message, { status: response.status });
  }

  return payload.scanning_data;
}

// NP reports the end of a game with a game_over flag; accept both spellings
// since the payload has shipped in snake_case and camelCase variants.
export function isGameOver(scanningData) {
  const value = scanningData?.gameOver ?? scanningData?.game_over;
  return Boolean(value) && value !== "0";
}
