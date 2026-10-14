/**
 * Serveur local de « La carte du vacarme ».
 *
 *  - HTTP : /api/config (lecture, écriture des réglages locaux), /data/* (grilles, routes),
 *           et, en production, le client compilé (client/dist).
 *  - WebSocket /ws : configuration et état des sources (texte JSON), instantanés binaires des
 *    navires (1 Hz) et carte de couverture AIS (toutes les 10 s).
 *  - Sources : AIS direct (aisstream.io), replay de fichiers, simulation — voir sources/manager.ts.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { encodeCoverage, encodeShips, type Config } from '@vacarme/shared';
import { ConfigStore } from './config-store.ts';
import { OceanGrid } from './ocean-grid.ts';
import { COVERAGE_H, COVERAGE_W } from './coverage.ts';
import { SourceManager } from './sources/manager.ts';
import { SimulationSource, type SimulationOptions } from './sources/simulation.ts';

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

// Clé aisstream et autres secrets : .env à la racine (jamais commité).
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  /* pas de .env : le direct sera désactivé */
}

const store = new ConfigStore(join(ROOT, 'config'));
store.watch();

function simOptions(cfg: Config): SimulationOptions {
  return { ...cfg.simulation, bands: cfg.bands };
}

const grid = new OceanGrid(join(DATA_DIR, 'grid', 'ocean_1024.png'));
const simulation = new SimulationSource(join(DATA_DIR, 'routes.json'), grid, simOptions(store.config));
const sources = new SourceManager(store.config, ROOT, simulation, process.env.AISSTREAM_API_KEY?.trim() || undefined);

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

function shipsBuffer(): { buf: ArrayBuffer; count: number } {
  const ships = sources.ships();
  const src = sources.current;
  return { buf: encodeShips(ships, src.simTimeMs(), src.timeScale()), count: ships.length };
}

function coverageBuffer(): ArrayBuffer {
  return encodeCoverage(COVERAGE_W, COVERAGE_H, sources.coverage.toBytes());
}

wss.on('connection', (ws) => {
  sendConfig(ws);
  const { buf, count } = shipsBuffer();
  sendSnapshot(ws, buf);
  ws.send(coverageBuffer());
  ws.send(JSON.stringify({ type: 'status', status: sources.status(count) }));
});

store.on('change', (cfg: Config) => {
  simulation.configure(simOptions(cfg));
  sources.configure(cfg);
  for (const ws of wss.clients) sendConfig(ws);
  restartTicker();
});

// ---------------------------------------------------------------- Boucle

let ticker: NodeJS.Timeout | null = null;
let last = performance.now();
let lastCoverage = 0;
let lastActive = sources.current.name;

function restartTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    const now = performance.now();
    sources.tick((now - last) / 1000);
    last = now;
    const { buf, count } = shipsBuffer();
    const status = JSON.stringify({ type: 'status', status: sources.status(count) });
    // Couverture : toutes les 10 s, ou immédiatement après une bascule de source.
    const switched = sources.current.name !== lastActive;
    lastActive = sources.current.name;
    const cov = switched || now - lastCoverage > 10_000 ? coverageBuffer() : null;
    if (cov) lastCoverage = now;
    for (const ws of wss.clients) {
      sendSnapshot(ws, buf);
      if (cov && ws.readyState === ws.OPEN) ws.send(cov);
      if (ws.readyState === ws.OPEN) ws.send(status);
    }
  }, 1000 / store.config.server.snapshotHz);
}

restartTicker();
const port = Number(process.env.PORT ?? store.config.server.port);
server.listen(port, () => {
  console.log(`[vacarme] serveur sur http://localhost:${port}`);
});

// Arrêt propre : ferme l'enregistrement en cours et sauvegarde la couverture.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    sources.shutdown();
    process.exit(0);
  });
}
