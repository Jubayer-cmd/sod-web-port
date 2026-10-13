// Tiny static server for dist/ (ES modules can't load from file://).
// `--root docs` serves the GitHub Pages site instead (the upload-your-own-JAR player).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const rootArg = process.argv.indexOf('--root');
const root = join(fileURLToPath(new URL('.', import.meta.url)), rootArg > 0 ? process.argv[rootArg + 1] : 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const port = Number(process.env.PORT) || 8240;
// Local-only by default. `node serve.mjs --lan` also listens on your Wi-Fi so a phone on the
// same network can open it (anyone on that network could, so only use it on a trusted one).
const lan = process.argv.includes('--lan');
const host = lan ? '0.0.0.0' : '127.0.0.1';

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, host, () => {
  console.log(`Soul of Darkness: http://localhost:${port}/`);
  if (lan) {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  on your phone:  http://${a.address}:${port}/`);
      }
    }
  }
});
