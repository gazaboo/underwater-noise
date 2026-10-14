// Faux serveur aisstream.io, pour tester le mode direct sans clé ni réseau.
// Rediffuse un fichier de replay (.ndjson.gz) comme un flux en direct, à vitesse accélérée.
// Usage : node scripts/mock-aisstream.mjs [fichier] [port] [vitesse]
//   puis, dans .env : AISSTREAM_API_KEY=test   et dans config/local.json5 : { live: { url: 'ws://localhost:9999' } }
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { WebSocketServer } from 'ws';

const [file = 'data/replays/dma-2025-02-26.ndjson.gz', port = '9999', speed = '20'] = process.argv.slice(2);
const wss = new WebSocketServer({ port: +port, perMessageDeflate: true });
console.log(`[mock-aisstream] ws://localhost:${port} — ${file} ×${speed}`);

wss.on('connection', (ws) => {
  ws.once('message', async (d) => {
    const sub = JSON.parse(d.toString());
    if (!sub.APIKey) return ws.close(1008, 'clé manquante');
    console.log('[mock-aisstream] abonnement reçu', JSON.stringify(sub.BoundingBoxes));
    for (;;) {
      const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()) });
      let t0 = null;
      const start = Date.now();
      for await (const line of rl) {
        if (ws.readyState !== ws.OPEN) return;
        const { t, m } = JSON.parse(line);
        t0 ??= t;
        const due = start + (t - t0) / +speed;
        if (due > Date.now()) await new Promise((r) => setTimeout(r, due - Date.now()));
        ws.send(JSON.stringify(m));
      }
    }
  });
});
