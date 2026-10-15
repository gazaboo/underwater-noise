import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { DEFAULT_BANDS, FLAG_STALE, SHIP_CLASS_INDEX, haversine } from '@vacarme/shared';
import { parseAisMessage } from '../src/ais/parse.ts';
import { ShipRegistry, type RegistryOptions } from '../src/ais/registry.ts';
import { CoverageMap } from '../src/coverage.ts';
import { Recorder } from '../src/recorder.ts';
import { AisStreamSource } from '../src/sources/aisstream.ts';
import { ReplaySource } from '../src/sources/replay.ts';

const REG: RegistryOptions = { staleAfterMin: 10, maxExtrapolateMin: 30, evictAfterMin: 180, includeMoored: false, bands: DEFAULT_BANDS };
const COV = { halfLifeHours: 12, gainPerMessage: 0.25 };

const position = (mmsi: number, lat: number, lon: number, sog = 12, cog = 90) => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, latitude: lat, longitude: lon },
  Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lon, Sog: sog, Cog: cog, TrueHeading: 511 } },
});
const staticData = (mmsi: number, type: number, a: number, b: number) => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi },
  Message: { ShipStaticData: { UserID: mmsi, Type: type, Dimension: { A: a, B: b, C: 5, D: 5 } } },
});

describe('lecture des messages aisstream', () => {
  it('position de classe A', () => {
    expect(parseAisMessage(position(227000001, 48.1, -5.2, 13.4, 271.5))).toEqual([
      { kind: 'position', mmsi: 227000001, lat: 48.1, lon: -5.2, sog: 13.4, cog: 271.5 },
    ]);
  });

  it('valeurs « non disponible » ignorées (vitesse 102,3 ; cap 360 → cap vrai)', () => {
    const m = position(1, 10, 10, 102.3, 360);
    (m.Message.PositionReport as Record<string, number>).TrueHeading = 45;
    expect(parseAisMessage(m)).toEqual([{ kind: 'position', mmsi: 1, lat: 10, lon: 10, sog: undefined, cog: 45 }]);
  });

  it('vitesse aberrante (> 60 nœuds) ignorée', () => {
    expect(parseAisMessage(position(1, 10, 10, 97.5, 90))[0]).toMatchObject({ sog: undefined, cog: 90 });
  });

  it('position invalide (91, 181) rejetée', () => {
    expect(parseAisMessage(position(1, 91, 181))).toEqual([]);
  });

  it('données statiques : type et longueur A+B', () => {
    expect(parseAisMessage(staticData(5, 71, 250, 44))).toEqual([{ kind: 'static', mmsi: 5, aisType: 71, lengthM: 294 }]);
  });

  it('rapport statique de classe B (partie B)', () => {
    const msg = {
      MessageType: 'StaticDataReport',
      MetaData: { MMSI: 9 },
      Message: { StaticDataReport: { UserID: 9, PartNumber: true, ReportB: { Valid: true, ShipType: 37, Dimension: { A: 8, B: 4, C: 2, D: 2 } } } },
    };
    expect(parseAisMessage(msg)).toEqual([{ kind: 'static', mmsi: 9, aisType: 37, lengthM: 12 }]);
  });

  it('message inconnu ou mal formé : rien', () => {
    expect(parseAisMessage({ MessageType: 'BaseStationReport', Message: {} })).toEqual([]);
    expect(parseAisMessage(null)).toEqual([]);
  });
});

describe('registre des navires', () => {
  it('fusionne statique (reçu avant) et position ; calcule la classe J-E', () => {
    const r = new ShipRegistry(REG);
    const t = Date.UTC(2026, 0, 1);
    for (const ev of parseAisMessage(staticData(42, 71, 250, 44))) r.apply(ev, t);
    for (const ev of parseAisMessage(position(42, 50, -20, 18))) r.apply(ev, t);
    const [s] = r.snapshot(t);
    expect(s.classIndex).toBe(SHIP_CLASS_INDEX.container);
    expect(s.lengthM).toBe(294);
    expect(s.slBroad).toBeGreaterThan(180);
  });

  it('extrapole à l\'estime, marque « ancien », puis immobilise et oublie', () => {
    const r = new ShipRegistry(REG);
    const t = Date.UTC(2026, 0, 1);
    for (const ev of parseAisMessage(position(7, 0, 0.5, 10, 90))) r.apply(ev, t);
    const after5 = r.snapshot(t + 5 * 60_000)[0];
    // 10 nœuds pendant 5 min ≈ 1,54 km vers l'est
    expect(haversine(0, 0.5, after5.lat, after5.lon)).toBeCloseTo(1543, -1);
    expect(after5.flags & FLAG_STALE).toBe(0);
    const after20 = r.snapshot(t + 20 * 60_000)[0];
    expect(after20.flags & FLAG_STALE).toBe(FLAG_STALE);
    const after60 = r.snapshot(t + 60 * 60_000)[0];
    expect(after60.sog).toBe(0); // au-delà de 30 min : figé
    expect(haversine(0, 0.5, after60.lat, after60.lon)).toBeCloseTo(1852 * 5, -2);
    expect(r.snapshot(t + 200 * 60_000)).toHaveLength(0);
    expect(r.size).toBe(0);
  });

  it('ignore les navires à quai et les positions plus anciennes', () => {
    const r = new ShipRegistry(REG);
    const t = Date.UTC(2026, 0, 1);
    for (const ev of parseAisMessage(position(1, 10, 10, 0.1))) r.apply(ev, t);
    expect(r.snapshot(t)).toHaveLength(0);
    for (const ev of parseAisMessage(position(2, 10, 10, 12))) r.apply(ev, t);
    for (const ev of parseAisMessage(position(2, 20, 20, 12))) r.apply(ev, t - 1000);
    expect(r.snapshot(t)[0].lat).toBe(10);
  });
});

describe('carte de couverture', () => {
  it('observe, décroît avec la demi-vie, se sauvegarde', () => {
    const c = new CoverageMap(0);
    c.observe(43.3, 5.3, 1);
    expect(c.value(43.3, 5.3)).toBe(1);
    expect(c.value(43.3, 6.3)).toBeCloseTo(0.3, 5); // voisine
    expect(c.value(10, 100)).toBe(0);
    const t = Date.UTC(2026, 0, 1);
    c.decay(t, 12);
    c.decay(t + 12 * 3_600_000, 12);
    expect(c.value(43.3, 5.3)).toBeCloseTo(0.5, 5);
    const dir = mkdtempSync(join(tmpdir(), 'vacarme-'));
    c.save(join(dir, 'c.png'));
    expect(CoverageMap.load(join(dir, 'c.png'))!.value(43.3, 5.3)).toBeCloseTo(0.5, 1);
  });
});

describe('enregistreur', () => {
  it('écrit du NDJSON compressé par heure, sous-échantillonne les positions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vacarme-rec-'));
    const rec = new Recorder(dir, 30);
    const t = Date.UTC(2026, 9, 15, 14, 0, 0);
    rec.write(position(1, 1, 1), t);
    rec.write(position(1, 1, 1.01), t + 10_000); // trop tôt : ignoré
    rec.write(position(1, 1, 1.02), t + 40_000);
    rec.write(staticData(1, 70, 100, 20), t + 41_000);
    rec.close();
    await new Promise((r) => setTimeout(r, 100)); // fin d'écriture du flux compressé
    const files = readdirSync(join(dir, '2026-10-15'));
    expect(files).toEqual(['14.ndjson.gz']);
    const lines = gunzipSync(readFileSync(join(dir, '2026-10-15', '14.ndjson.gz'))).toString().trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).t).toBe(t);
  });
});

describe('replay', () => {
  it('rejoue le fichier d\'exemple (DMA) à vitesse accélérée', async () => {
    const replay = new ReplaySource(join(import.meta.dirname, '../../data/replays'), 600, false, REG, new CoverageMap(0), COV);
    expect(replay.available).toBe(true);
    for (let i = 0; i < 40; i++) {
      replay.tick(0.05);
      await new Promise((r) => setTimeout(r, 50));
    }
    const ships = replay.ships();
    expect(ships.length).toBeGreaterThan(100);
    // Eaux danoises.
    const s = ships[0];
    expect(s.lat).toBeGreaterThan(50);
    expect(s.lat).toBeLessThan(62);
    expect(replay.coverage.value(56, 11)).toBeGreaterThan(0);
    replay.restart();
  });
});

describe('aisstream (serveur factice)', () => {
  const servers: WebSocketServer[] = [];
  afterAll(() => servers.forEach((s) => s.close()));

  it('s\'abonne avec la clé, reçoit des messages, se reconnecte', async () => {
    const subscriptions: unknown[] = [];
    const wss = new WebSocketServer({ port: 0, perMessageDeflate: true });
    servers.push(wss);
    let connections = 0;
    wss.on('connection', (ws) => {
      connections++;
      ws.on('message', (d) => {
        subscriptions.push(JSON.parse(d.toString()));
        ws.send(JSON.stringify(staticData(1001, 80, 150, 30)));
        ws.send(JSON.stringify(position(1001, 36, -6, 12, 270)));
        if (connections === 1) setTimeout(() => ws.close(1011, 'test'), 50);
      });
    });
    await new Promise((r) => wss.once('listening', r));
    const port = (wss.address() as { port: number }).port;
    const live = new AisStreamSource(`ws://localhost:${port}`, 'CLE-TEST', REG, new CoverageMap(0), COV, null, 50);
    live.start();
    await new Promise((r) => setTimeout(r, 600));
    live.tick();
    expect(subscriptions.length).toBeGreaterThanOrEqual(1);
    const sub = subscriptions[0] as { APIKey: string; BoundingBoxes: number[][][]; FilterMessageTypes: string[] };
    expect(sub.APIKey).toBe('CLE-TEST');
    expect(sub.BoundingBoxes[0]).toEqual([
      [-90, -180],
      [90, 180],
    ]);
    expect(sub.FilterMessageTypes).toContain('PositionReport');
    expect(connections).toBeGreaterThanOrEqual(2); // reconnecté après la fermeture
    const ships = live.ships();
    expect(ships).toHaveLength(1);
    expect(ships[0].classIndex).toBe(SHIP_CLASS_INDEX.tanker);
    expect(live.health().lastMessageAt).not.toBeNull();
    live.stop();
  });
});
