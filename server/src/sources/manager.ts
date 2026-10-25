/**
 * Choix de la source de navires et bascule automatique.
 *
 * Mode « auto » (défaut, pensé pour l'exposition) :
 *   direct (aisstream) s'il est en bonne santé → sinon replay (fichiers) → sinon simulation.
 * Le direct est « en bonne santé » s'il a reçu des messages depuis moins de `liveSilenceSec` et
 * suit au moins `liveMinShips` navires (une déconnexion brève est tolérée). Pour éviter les allers-retours, on n'y revient qu'après
 * `liveRecoverSec` de bonne santé continue. Le direct reste connecté en arrière-plan pendant
 * le replay, pour pouvoir reprendre la main.
 *
 * Navires affichés (`source.ships`) :
 *   real      : la source ci-dessus ;
 *   estimated : uniquement les navires estimés (densité Global Fishing Watch, voir estimated.ts) ;
 *   mixed     : la source réelle, complétée par des navires estimés dans les cellules de 1° mal couvertes.
 * En modes estimés et mixte, la couverture envoyée au client est pleine : plus de terra incognita.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, ShipRecord, SourceStatus } from '@vacarme/shared';
import type { RegistryOptions } from '../ais/registry.ts';
import { COVERAGE_H, COVERAGE_W, CoverageMap } from '../coverage.ts';
import { Recorder } from '../recorder.ts';
import { AisStreamSource } from './aisstream.ts';
import type { EstimatedSource } from './estimated.ts';
import { ReplaySource } from './replay.ts';
import type { SimulationSource } from './simulation.ts';
import type { ShipSource } from './source.ts';

type Active = SourceStatus['active'];

export function registryOptions(cfg: Config): RegistryOptions {
  return { ...cfg.live, bands: cfg.bands };
}

export class SourceManager {
  readonly live: AisStreamSource | null;
  readonly replay: ReplaySource;
  private readonly recorder: Recorder;
  private readonly liveCoverage: CoverageMap;
  private readonly simCoverage: CoverageMap;
  private readonly fullCoverage = new CoverageMap(1);
  /** Mode mixte : dernière mise à jour de la zone des navires estimés. */
  private lastRegion = -Infinity;
  private region: 'world' | 'uncovered' | null = null;
  private timelineKey = '';
  private timelineCounter = Math.floor(Math.random() * 0xffffffff);
  private active: Active = 'simulation';
  private liveHealthySince: number | null = null;
  private lastCoverageSave = Date.now();

  constructor(
    private cfg: Config,
    private readonly root: string,
    private readonly simulation: SimulationSource,
    private readonly estimated: EstimatedSource | null,
    apiKey: string | undefined,
  ) {
    const covOpts = cfg.coverage;
    this.liveCoverage = CoverageMap.load(this.coveragePath) ?? new CoverageMap(0);
    this.simCoverage = new CoverageMap(1);
    this.recorder = new Recorder(this.resolvePath(cfg.recorder.dir), cfg.recorder.minIntervalSec);
    this.recorder.enabled = cfg.recorder.enabled;
    this.live = apiKey ? new AisStreamSource(cfg.live.url, apiKey, registryOptions(cfg), this.liveCoverage, covOpts, this.recorder) : null;
    // Le replay part de la couverture réelle connue (s'il y en a une), sinon de « tout observé ».
    const replayCoverage = new CoverageMap(existsSync(this.coveragePath) ? 0 : 1);
    if (existsSync(this.coveragePath)) replayCoverage.copyFrom(this.liveCoverage);
    this.replay = new ReplaySource(this.resolvePath(cfg.replay.path), cfg.playback.timeScale, cfg.replay.loop, registryOptions(cfg), replayCoverage, covOpts);
    this.applySimCoverage();
    if (this.live && cfg.source.mode !== 'replay' && cfg.source.mode !== 'simulation') this.live.start();
    this.active = this.choose(Date.now());
    console.log(
      `[sources] mode ${cfg.source.mode} — direct : ${this.live ? 'clé trouvée' : 'pas de clé (AISSTREAM_API_KEY)'} ; replay : ${this.replay.available ? 'fichiers trouvés' : 'aucun fichier'} ; source active : ${this.active}`,
    );
  }

  private get coveragePath(): string {
    return join(this.root, 'data', 'coverage.png');
  }

  private resolvePath(p: string): string {
    return p.startsWith('/') ? p : join(this.root, p);
  }

  private applySimCoverage(): void {
    if (this.cfg.coverage.simulation === 'recorded' && existsSync(this.coveragePath)) this.simCoverage.copyFrom(this.liveCoverage);
    else this.simCoverage.data.fill(1);
  }

  configure(cfg: Config): void {
    if (JSON.stringify([this.cfg.simulation.shipCount, this.cfg.simulation.seed, this.cfg.simulation.fishingFraction, this.cfg.estimated.seed]) !==
        JSON.stringify([cfg.simulation.shipCount, cfg.simulation.seed, cfg.simulation.fishingFraction, cfg.estimated.seed])) this.timelineKey = '';
    this.cfg = cfg;
    const reg = registryOptions(cfg);
    this.live?.configure(reg, cfg.coverage);
    this.live?.setUrl(cfg.live.url);
    this.replay.configure(reg, cfg.coverage);
    this.replay.setOptions(this.resolvePath(cfg.replay.path), cfg.playback.timeScale, cfg.replay.loop);
    this.recorder.setMinInterval(cfg.recorder.minIntervalSec);
    this.recorder.enabled = cfg.recorder.enabled;
    this.applySimCoverage();
    this.region = null; // zone des navires estimés recalculée au prochain pas
  }

  private liveHealthy(now: number): boolean {
    if (!this.live) return false;
    const h = this.live.health();
    // On ne regarde pas l'état de la connexion : une coupure brève (reconnexion en quelques
    // secondes) ne doit pas faire quitter le direct, les navires étant extrapolés entre-temps.
    return h.lastMessageAt !== null && now - h.lastMessageAt < this.cfg.source.liveSilenceSec * 1000 && this.live.registry.size >= this.cfg.source.liveMinShips;
  }

  private choose(now: number): Active {
    const mode = this.cfg.source.mode;
    if (mode === 'live') return this.live ? 'live' : 'simulation';
    if (mode === 'replay') return this.replay.available ? 'replay' : 'simulation';
    if (mode === 'simulation') return 'simulation';
    // auto
    const healthy = this.liveHealthy(now);
    if (healthy) this.liveHealthySince ??= now;
    else this.liveHealthySince = null;
    const recovered = this.liveHealthySince !== null && now - this.liveHealthySince >= this.cfg.source.liveRecoverSec * 1000;
    if (this.active === 'live' ? healthy : recovered) return 'live';
    return this.replay.available ? 'replay' : 'simulation';
  }

  private source(a: Active): ShipSource {
    if (a === 'live' && this.live) return this.live;
    if (a === 'replay') return this.replay;
    return this.simulation;
  }

  /** Source qui donne le temps des instantanés : les navires estimés en mode « estimés », sinon la source réelle. */
  get current(): ShipSource {
    return this.shipsMode === 'estimated' ? this.estimated! : this.source(this.active);
  }

  /** Included in the binary snapshot: no ordering dependency on JSON status messages. */
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
    this.live?.tick();
    const next = this.choose(now);
    if (next !== this.active) {
      console.log(`[sources] bascule : ${this.active} → ${next}`);
      if (next === 'replay') this.replay.restart();
      this.active = next;
    }
    if (this.active === 'replay') this.replay.tick(realDtSec);
    if (this.active === 'simulation') this.simulation.tick(realDtSec);
    this.tickEstimated(now, realDtSec);
    if (this.live && now - this.lastCoverageSave > 5 * 60_000) {
      this.liveCoverage.save(this.coveragePath);
      this.lastCoverageSave = now;
    }
  }

  /** Navires affichés, selon `source.ships` ; 'real' si les navires estimés sont indisponibles. */
  get shipsMode(): Config['source']['ships'] {
    return this.estimated ? this.cfg.source.ships : 'real';
  }

  /** Le mode mixte n'ajoute rien quand la source réelle est déjà la simulation (tout est « observé »). */
  private get mixing(): boolean {
    return this.shipsMode === 'mixed' && this.active !== 'simulation';
  }

  private tickEstimated(now: number, realDtSec: number): void {
    const est = this.estimated;
    if (!est) return;
    if (this.shipsMode === 'estimated') {
      if (this.region !== 'world') {
        est.setRegion(null);
        this.region = 'world';
      }
      est.tick(realDtSec);
    } else if (this.mixing) {
      // La couverture évolue lentement : zone recalculée toutes les 10 s (ou à l'entrée dans le mode).
      if (this.region !== 'uncovered' || now - this.lastRegion > 10_000) {
        const cov = this.coverageOf(this.active);
        const th = this.cfg.source.coverageThreshold;
        const allowed = new Uint8Array(COVERAGE_W * COVERAGE_H);
        for (let i = 0; i < allowed.length; i++) allowed[i] = cov.data[i] < th ? 1 : 0;
        est.setRegion(allowed);
        this.region = 'uncovered';
        this.lastRegion = now;
      }
      // Même rythme que la source réelle (temps réel en direct, vitesse du replay).
      est.advance(realDtSec * this.current.timeScale());
    }
  }

  /** Navires de la source active, ou estimés, ou les deux (voir `source.ships`). */
  ships(): readonly ShipRecord[] {
    if (this.shipsMode === 'estimated') return this.estimated!.ships();
    const ships = this.source(this.active).ships();
    return this.mixing ? [...ships, ...this.estimated!.ships()] : ships;
  }

  private coverageOf(a: Active): CoverageMap {
    if (a === 'live' && this.live) return this.live.coverage;
    if (a === 'replay') return this.replay.coverage;
    return this.simCoverage;
  }

  get coverage(): CoverageMap {
    if (this.shipsMode === 'estimated' || this.mixing) return this.fullCoverage;
    return this.coverageOf(this.active);
  }

  status(shipCount: number): SourceStatus {
    const now = Date.now();
    const h = this.live?.health();
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
      live: {
        configured: this.live !== null,
        connected: h?.connected ?? false,
        messagesPerSec: h?.messagesPerSec ?? 0,
        lastMessageAgoSec: h?.lastMessageAt ? (now - h.lastMessageAt) / 1000 : null,
        ships: this.live?.registry.size ?? 0,
        error: h?.error ?? null,
      },
      replay: { available: this.replay.available, file: this.replay.currentFile, speed: this.replay.playbackSpeed },
      recorder: { enabled: this.cfg.recorder.enabled && this.live !== null, file: this.recorder.currentFile },
    };
  }

  shutdown(): void {
    this.live?.stop();
    this.recorder.close();
    if (this.live) this.liveCoverage.save(this.coveragePath);
  }
}
