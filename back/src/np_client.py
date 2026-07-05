import httpx

NP_API_URL = 'https://np.ironhelmet.com/api'


class NeptuneApiError(Exception):
    pass


async def fetch_scan(game_number: str, code: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            NP_API_URL,
            params={'game_number': game_number, 'code': code},
            headers={'Accept': 'application/json', 'User-Agent': 'NP-Intelligence backend'},
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise NeptuneApiError(f'NP API returned non-JSON response ({response.status_code}).') from exc

    if response.status_code >= 400 or 'scanning_data' not in payload:
        message = payload.get('error') or payload.get('message') or payload.get('reason') or f'NP API status {response.status_code}'
        raise NeptuneApiError(message)

    return payload['scanning_data']
