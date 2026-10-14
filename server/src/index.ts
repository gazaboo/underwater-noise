/**
 * Serveur local de « La carte du vacarme ».
 *
 *  - HTTP : /api/config (lecture, écriture des réglages locaux), /data/* (grilles, routes),
 *           et, en production, le client compilé (client/dist).
 *  - WebSocket /ws : configuration (texte JSON) et instantanés binaires des navires.
 *
 * J1 : source « simulation » uniquement. Les sources AIS en direct et replay arrivent au J2.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { encodeShips, type Config } from '@vacarme/shared';
import { ConfigStore } from './config-store.ts';
import { OceanGrid } from './ocean-grid.ts';
import { SimulationSource, type SimulationOptions } from './sources/simulation.ts';
import type { ShipSource } from './sources/source.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DATA_DIR = join(ROOT, 'data');
const CLIENT_DIST = join(ROOT, 'client', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const store = new ConfigStore(join(ROOT, 'config'));
store.watch();

function simOptions(cfg: Config): SimulationOptions {
  return { ...cfg.simulation, bands: cfg.bands };
}

const grid = new OceanGrid(join(DATA_DIR, 'grid', 'ocean_1024.png'));
const simulation = new SimulationSource(join(DATA_DIR, 'routes.json'), grid, simOptions(store.config));
let source: ShipSource = simulation;

// ---------------------------------------------------------------- HTTP

/** Sert un fichier sous `base` en refusant toute sortie du dossier. */
function serveFile(res: ServerResponse, base: string, rel: string): boolean {
  const path = normalize(join(base, rel));
  if (!path.startsWith(base + sep) && path !== base) return false;
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(path).pipe(res);
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, ko) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c;
      if (body.length > 1e6) ko(new Error('corps trop volumineux'));
    });
    req.on('end', () => ok(body));
    req.on('error', ko);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify(store.config));
      return;
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      store.saveLocal(JSON.parse(await readBody(req)));
      res.writeHead(204).end();
      return;
    }
    if (url.pathname.startsWith('/data/') && serveFile(res, DATA_DIR, decodeURIComponent(url.pathname.slice(6)))) return;
    if (existsSync(CLIENT_DIST)) {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (serveFile(res, CLIENT_DIST, rel) || serveFile(res, CLIENT_DIST, 'index.html')) return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('introuvable');
  } catch (e) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end((e as Error).message);
  }
});

// ---------------------------------------------------------------- WebSocket

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

function sendConfig(ws: WebSocket): void {
  ws.send(JSON.stringify({ type: 'config', config: store.config }));
}

function sendSnapshot(ws: WebSocket, buf: ArrayBuffer): void {
  // On saute un envoi si le client est en retard plutôt que d'empiler les instantanés.
  if (ws.readyState === ws.OPEN && ws.bufferedAmount < 4 * buf.byteLength) ws.send(buf);
}

wss.on('connection', (ws) => {
  sendConfig(ws);
  sendSnapshot(ws, encodeShips(source.ships(), source.simTimeMs(), source.timeScale()));
});

store.on('change', (cfg: Config) => {
  simulation.configure(simOptions(cfg));
  for (const ws of wss.clients) sendConfig(ws);
  restartTicker();
});

// ---------------------------------------------------------------- Boucle

let ticker: NodeJS.Timeout | null = null;
let last = performance.now();

function restartTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    const now = performance.now();
    source.tick((now - last) / 1000);
    last = now;
    const buf = encodeShips(source.ships(), source.simTimeMs(), source.timeScale());
    for (const ws of wss.clients) sendSnapshot(ws, buf);
  }, 1000 / store.config.server.snapshotHz);
}

restartTicker();
const port = Number(process.env.PORT ?? store.config.server.port);
server.listen(port, () => {
  console.log(`[vacarme] serveur sur http://localhost:${port} — source : ${source.name}, ${source.ships().length} navires`);
});

// Évite que source soit vue comme constante : elle deviendra commutable au J2.
export function setSource(s: ShipSource): void {
  source = s;
}
