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
 * Mode hybride (optionnel) : des navires simulés complètent les zones mal couvertes.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG_SYNTHETIC, type Config, type ShipRecord, type SourceStatus } from '@vacarme/shared';
import type { RegistryOptions } from '../ais/registry.ts';
import { CoverageMap } from '../coverage.ts';
import { Recorder } from '../recorder.ts';
import { AisStreamSource } from './aisstream.ts';
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
  private active: Active = 'simulation';
  private liveHealthySince: number | null = null;
  private lastCoverageSave = Date.now();

  constructor(
    private cfg: Config,
    private readonly root: string,
    private readonly simulation: SimulationSource,
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
    this.replay = new ReplaySource(this.resolvePath(cfg.replay.path), cfg.replay.speed, cfg.replay.loop, registryOptions(cfg), replayCoverage, covOpts);
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
    this.cfg = cfg;
    const reg = registryOptions(cfg);
    this.live?.configure(reg, cfg.coverage);
    this.live?.setUrl(cfg.live.url);
    this.replay.configure(reg, cfg.coverage);
    this.replay.setOptions(this.resolvePath(cfg.replay.path), cfg.replay.speed, cfg.replay.loop);
    this.recorder.setMinInterval(cfg.recorder.minIntervalSec);
    this.recorder.enabled = cfg.recorder.enabled;
    this.applySimCoverage();
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
    if (mode === 'live') return 'live';
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

  get current(): ShipSource {
    return this.source(this.active);
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
    if (this.active === 'simulation' || this.cfg.source.hybrid) this.simulation.tick(realDtSec);
    if (this.live && now - this.lastCoverageSave > 5 * 60_000) {
      this.liveCoverage.save(this.coveragePath);
      this.lastCoverageSave = now;
    }
  }

  /** Navires de la source active, complétés en mode hybride. */
  ships(): readonly ShipRecord[] {
    const src = this.current;
    const ships = src.ships();
    if (!this.cfg.source.hybrid || this.active === 'simulation') return ships;
    const cov = this.coverage;
    const th = this.cfg.source.hybridCoverageThreshold;
    const fill = this.simulation.ships().filter((s) => cov.value(s.lat, s.lon) < th);
    return [...ships, ...fill.map((s) => ({ ...s, flags: s.flags | FLAG_SYNTHETIC }))];
  }

  get coverage(): CoverageMap {
    if (this.active === 'live' && this.live) return this.live.coverage;
    if (this.active === 'replay') return this.replay.coverage;
    return this.simCoverage;
  }

  status(shipCount: number): SourceStatus {
    const now = Date.now();
    const h = this.live?.health();
    return {
      mode: this.cfg.source.mode,
      active: this.active,
      hybrid: this.cfg.source.hybrid,
      ships: shipCount,
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
