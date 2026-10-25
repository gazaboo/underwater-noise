/**
 * Mode web autonome : les sources de navires du serveur, exécutées dans un Web Worker. Mêmes règles que
 * server/src/sources/manager.ts, sans le direct (pas de clé AIS dans une page publique) : replay de l'AIS
 * enregistré s'il est fourni, sinon simulation par routes ; navires estimés (densité GFW) et mode mixte.
 * Les messages envoyés sont les mêmes instantanés binaires que le WebSocket du serveur.
 */
import { encodeCoverage, encodeShips, type Config, type ShipRecord, type SourceStatus } from '@vacarme/shared';
import { COVERAGE_H, COVERAGE_W, CoverageMap } from '@vacarme/shared/ships/coverage.ts';
import { DensityGrid, type DensityFile } from '@vacarme/shared/ships/density.ts';
import { EstimatedSource } from '@vacarme/shared/ships/estimated.ts';
import { OceanBytes } from '@vacarme/shared/ships/ocean.ts';
import type { RegistryOptions } from '@vacarme/shared/ships/registry.ts';
import { SimulationSource, type RoutesData } from '@vacarme/shared/ships/simulation.ts';
import type { ShipSource } from '@vacarme/shared/ships/source.ts';
import { WebReplaySource } from './web-replay.ts';

export type ToWorker = { type: 'init'; config: Config; dataBase: string } | { type: 'config'; config: Config };
export type FromWorker =
  | { type: 'ships'; buf: ArrayBuffer }
  | { type: 'coverage'; buf: ArrayBuffer }
  | { type: 'status'; status: SourceStatus }
  | { type: 'error'; message: string };

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

async function decodePng(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch((e: Error) => {
    throw new Error(`${url} : ${e.message}`);
  });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return { width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

async function json<T>(url: string): Promise<T | null> {
  const res = await fetch(url).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
}

const registryOptions = (cfg: Config): RegistryOptions => ({ ...cfg.live, bands: cfg.bands });

class WebSourceManager {
  private active: 'replay' | 'simulation';
  private readonly fullCoverage = new CoverageMap(1);
  private readonly simCoverage = new CoverageMap(1);
  private region: 'world' | 'uncovered' | null = null;
  private lastRegion = -Infinity;
  private timelineKey = '';
  private timelineCounter = Math.floor(Math.random() * 0xffffffff);

  constructor(
    private cfg: Config,
    private readonly simulation: SimulationSource,
    private readonly estimated: EstimatedSource | null,
    readonly replay: WebReplaySource,
  ) {
    this.active = this.choose();
  }

  private choose(): 'replay' | 'simulation' {
    return this.cfg.source.mode !== 'simulation' && this.replay.available ? 'replay' : 'simulation';
  }

  configure(cfg: Config): void {
    this.cfg = cfg;
    this.simulation.configure({ ...cfg.simulation, timeScale: cfg.playback.timeScale, bands: cfg.bands });
    this.estimated?.configure({ ...cfg.estimated, timeScale: cfg.playback.timeScale, bands: cfg.bands });
    this.replay.configure(registryOptions(cfg), cfg.coverage);
    this.replay.setSpeed(cfg.playback.timeScale);
    const next = this.choose();
    if (next !== this.active) {
      if (next === 'replay') this.replay.restart();
      this.active = next;
    }
    this.region = null;
  }

  get shipsMode(): Config['source']['ships'] {
    return this.estimated ? this.cfg.source.ships : 'real';
  }

  private get mixing(): boolean {
    return this.shipsMode === 'mixed' && this.active !== 'simulation';
  }

  private get real(): ShipSource {
    return this.active === 'replay' ? this.replay : this.simulation;
  }

  get current(): ShipSource {
    return this.shipsMode === 'estimated' ? this.estimated! : this.real;
  }

  get timelineId(): number {
    const key = `${this.current.name}/${this.shipsMode}/${this.current.name === 'replay' ? this.replay.revision : 0}`;
    if (key !== this.timelineKey) {
      this.timelineKey = key;
      this.timelineCounter = (this.timelineCounter + 1) >>> 0;
    }
    return this.timelineCounter;
  }

  tick(realDtSec: number): void {
    const now = Date.now();
    if (this.active === 'replay') this.replay.tick(realDtSec);
    else this.simulation.tick(realDtSec);
    const est = this.estimated;
    if (!est) return;
    if (this.shipsMode === 'estimated') {
      if (this.region !== 'world') {
        est.setRegion(null);
        this.region = 'world';
      }
      est.tick(realDtSec);
    } else if (this.mixing) {
      if (this.region !== 'uncovered' || now - this.lastRegion > 10_000) {
        const cov = this.replay.coverage;
        const th = this.cfg.source.coverageThreshold;
        const allowed = new Uint8Array(COVERAGE_W * COVERAGE_H);
        for (let i = 0; i < allowed.length; i++) allowed[i] = cov.data[i] < th ? 1 : 0;
        est.setRegion(allowed);
        this.region = 'uncovered';
        this.lastRegion = now;
      }
      est.advance(realDtSec * this.current.timeScale());
    }
  }

  ships(): readonly ShipRecord[] {
    if (this.shipsMode === 'estimated') return this.estimated!.ships();
    const ships = this.real.ships();
    return this.mixing ? [...ships, ...this.estimated!.ships()] : ships;
  }

  get coverage(): CoverageMap {
    if (this.shipsMode === 'estimated' || this.mixing) return this.fullCoverage;
    return this.active === 'replay' ? this.replay.coverage : this.simCoverage;
  }

  status(shipCount: number): SourceStatus {
    return {
      mode: this.cfg.source.mode,
      active: this.active,
      shipsMode: this.shipsMode,
      ships: shipCount,
      estimated: {
        available: this.estimated !== null,
        ships: this.shipsMode === 'estimated' || this.mixing ? this.estimated!.count : 0,
        capped: this.estimated?.capped ?? false,
        period: this.estimated?.density.meta.period ?? null,
      },
      live: { configured: false, connected: false, messagesPerSec: 0, lastMessageAgoSec: null, ships: 0, error: null },
      replay: { available: this.replay.available, file: this.replay.currentFile, speed: this.replay.timeScale() },
      recorder: { enabled: false, file: null },
    };
  }
}

let manager: WebSourceManager | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = performance.now();
let lastCoverage = -Infinity;
let lastActive = '';

function send(): void {
  if (!manager) return;
  const ships = manager.ships();
  const src = manager.current;
  const buf = encodeShips(ships, src.simTimeMs(), src.timeScale(), manager.timelineId);
  post({ type: 'ships', buf }, [buf]);
  const now = performance.now();
  if (src.name !== lastActive || now - lastCoverage > 10_000) {
    lastActive = src.name;
    lastCoverage = now;
    const cov = encodeCoverage(COVERAGE_W, COVERAGE_H, manager.coverage.toBytes());
    post({ type: 'coverage', buf: cov }, [cov]);
  }
  post({ type: 'status', status: manager.status(ships.length) });
}

function start(cfg: Config): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    const now = performance.now();
    manager!.tick((now - last) / 1000);
    last = now;
    send();
  }, 1000 / cfg.server.snapshotHz);
}

async function init(cfg: Config, base: string): Promise<void> {
  const [ocean1024, routes, densityMeta, replayIndex, recorded] = await Promise.all([
    decodePng(`${base}grid/ocean_1024.png`),
    json<RoutesData>(`${base}routes.json`),
    json<DensityFile>(`${base}density/meta.json`),
    json<{ files: string[] }>(`${base}replays/manifest.json`),
    decodePng(`${base}coverage.png`).catch(() => null),
  ]);
  if (!routes) throw new Error('routes.json introuvable');
  const simulation = new SimulationSource(routes, new OceanBytes(ocean1024.width, ocean1024.height, ocean1024.data), {
    ...cfg.simulation, timeScale: cfg.playback.timeScale, bands: cfg.bands,
  });
  let estimated: EstimatedSource | null = null;
  if (densityMeta) {
    const pngs = new Map<string, Awaited<ReturnType<typeof decodePng>>>();
    await Promise.all(Object.values(densityMeta.groups).map(async (g) => pngs.set(g.file, await decodePng(`${base}density/${g.file}`))));
    const ocean2048 = await decodePng(`${base}grid/ocean_2048.png`);
    const density = DensityGrid.fromEncoded(densityMeta, (file) => pngs.get(file)!);
    estimated = new EstimatedSource(density, new OceanBytes(ocean2048.width, ocean2048.height, ocean2048.data), {
      ...cfg.estimated, timeScale: cfg.playback.timeScale, bands: cfg.bands,
    });
  }
  // Le replay part de la dernière couverture réelle enregistrée (data/coverage.png), sinon de « tout observé ».
  const coverage = new CoverageMap(recorded ? 0 : 1);
  if (recorded) for (let i = 0; i < coverage.data.length; i++) coverage.data[i] = recorded.data[4 * i] / 255;
  const files = (replayIndex?.files ?? []).map((f) => `${base}replays/${f}`);
  const replay = new WebReplaySource(files, cfg.playback.timeScale, cfg.replay.loop, registryOptions(cfg), coverage, cfg.coverage);
  manager = new WebSourceManager(cfg, simulation, estimated, replay);
  if (replay.available && cfg.source.mode !== 'simulation') {
    // Premier instantané après le démarrage à chaud : l'histoire acoustique part d'un trafic visible.
    replay.tick(0);
    await Promise.race([replay.ready, new Promise((r) => setTimeout(r, 15_000))]);
  }
  last = performance.now();
  manager.tick(0);
  send();
  start(cfg);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    init(msg.config, msg.dataBase).catch((e: Error) => post({ type: 'error', message: e.message }));
  } else if (msg.type === 'config' && manager) {
    // Même ordre que le serveur : fermer l'intervalle à l'ancienne vitesse, puis appliquer.
    const now = performance.now();
    manager.tick((now - last) / 1000);
    last = now;
    manager.configure(msg.config);
    manager.tick(0);
    send();
    start(msg.config);
  }
};
