import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 5173);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function safePath(url) {
  const pathname = new URL(url, `http://localhost:${port}`).pathname;
  const decoded = decodeURIComponent(pathname);
  const filePath = normalize(join(root, decoded === '/' ? 'index.html' : decoded));
  if (!filePath.startsWith(root)) return join(root, 'index.html');
  return filePath;
}

async function proxyNeptunesPrideScan(requestUrl, res) {
  const incoming = new URL(requestUrl, `http://localhost:${port}`);
  const gameNumber = incoming.searchParams.get('game_number')?.trim();
  const code = incoming.searchParams.get('code')?.trim();

  if (!gameNumber || !code) {
    sendJson(res, 400, { error: 'Missing game_number or code.' });
    return;
  }

  const upstreamUrl = new URL('https://np.ironhelmet.com/api');
  upstreamUrl.searchParams.set('game_number', gameNumber);
  upstreamUrl.searchParams.set('code', code);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'NP-Intelligence local dev proxy',
      },
    });
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, { error: `Could not reach Neptune's Pride API: ${error.message}` });
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', `http://localhost:${port}`).pathname;
  if (pathname === '/api/np-scan') {
    await proxyNeptunesPrideScan(req.url || '/', res);
    return;
  }

  try {
    const filePath = safePath(req.url || '/');
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'text/plain' });
    res.end(body);
  } catch {
    const body = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  }
}).listen(port, () => {
  console.log(`NP Intelligence running at http://localhost:${port}`);
});
