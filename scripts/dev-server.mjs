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

createServer(async (req, res) => {
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
