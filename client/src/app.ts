/**
 * Orchestration du client : configuration, flux de navires, simulation d'ondes, rendu,
 * HUD et panneau de réglage.
 */
import * as THREE from 'three';
import { deepMerge, resolveForTarget, type Config, type DisplayTarget, type SourceStatus } from '@vacarme/shared';
import { loadOceanGrid, loadWorldAssets, type WorldAssets } from './assets.ts';
import { ShipStream } from './net/ship-stream.ts';
import { computeFlatTransform, FlatView, screenToGeo, type FlatTransform } from './render/flat-view.ts';
import { ShipLayer } from './render/ships.ts';
import { DetailWaves } from './sim/detail.ts';
import { PhysicsField, calibrate, type CalibrationResult } from './sim/physics-sim.ts';
import { WaveSim } from './sim/wave-sim.ts';
import { GpuTimer, Hud } from './ui/hud.ts';
import { FlatNavigator } from './ui/navigation.ts';
import { Panel } from './ui/panel.ts';

const CLOCK_WRAP = 1 << 20;
const NOMINAL_FPS = 60;

export interface UrlOverrides {
  target?: DisplayTarget;
  quality?: Config['display']['quality'];
  hud?: boolean;
}

export class App {
  /** Configuration telle que reçue du serveur. */
  private raw: Config;
  /** Configuration effective (cible appliquée), éditée en direct par le panneau. */
  cfg: Config;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ships = new ShipLayer();
  private readonly hud = new Hud();
  private readonly panel: Panel;
  private readonly nav: FlatNavigator;
  private readonly gpu: GpuTimer;
  private wave: WaveSim;
  private readonly flat: FlatView;
  private readonly detail: DetailWaves;
  private physics: PhysicsField;
  private physicsClock = 0;
  private readonly calibration: CalibrationResult;
  /** Position du curseur (pixels du tampon, y vers le haut) et niveaux lus dessous. */
  private mouse: { x: number; y: number } | null = null;
  private cursorInfo = '';
  private lastCursorRead = 0;
  private lastView: FlatTransform | null = null;
  private clock = 0;
  private connected = false;
  private sourceStatus: SourceStatus | null = null;
  /** Carte de couverture AIS (360 × 180, ligne 0 au nord). Pleine tant que le serveur n'a rien envoyé. */
  private readonly coverage = new THREE.DataTexture(new Uint8Array(360 * 180).fill(255), 360, 180, THREE.RedFormat, THREE.UnsignedByteType);
  private lastFrame = performance.now();
  private rebuilding = false;

  private constructor(
    raw: Config,
    private readonly overrides: UrlOverrides,
    private assets: WorldAssets,
    canvas: HTMLCanvasElement,
    physicsOcean: THREE.Texture,
  ) {
    this.raw = raw;
    this.cfg = this.resolve(raw);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // composition faite à la main (voir hexToVec3)
    this.coverage.magFilter = this.coverage.minFilter = THREE.LinearFilter;
    this.coverage.wrapS = THREE.RepeatWrapping;
    this.coverage.needsUpdate = true;
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.wave = new WaveSim(assets.oceanWidth, assets.ocean);
    this.wave.clear(this.renderer);
    this.flat = new FlatView(assets);
    this.detail = new DetailWaves(assets);
    // Calibration du champ physique (source unique, loi en 1/r) puis grille mondiale.
    const t0 = performance.now();
    this.calibration = calibrate(this.renderer);
    console.info(
      `[physique] calibration en ${(performance.now() - t0).toFixed(0)} ms : K = ${this.calibration.K.toExponential(3)}, ` +
        `écart max ${this.calibration.maxDeviationDb.toFixed(2)} dB sur r = ${this.calibration.range[0]}–${this.calibration.range[1]} cellules`,
    );
    this.physics = this.makePhysics(physicsOcean);
    this.panel = new Panel(
      () => this.cfg,
      (path) => this.onPanelChange(path),
      () => this.save(),
    );
    this.applyConfig();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.installKeys();
    this.nav = new FlatNavigator(canvas, () => this.cfg);
    if (overrides.hud) this.hud.toggle(true);

    new ShipStream({
      onSnapshot: (snap, at) => this.ships.update(snap, at, this.cfg),
      onConfig: (c) => this.onServerConfig(c),
      onCoverage: (w, h, data) => this.onCoverage(w, h, data),
      onSourceStatus: (st) => (this.sourceStatus = st),
      onStatus: (ok) => (this.connected = ok),
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  static async create(canvas: HTMLCanvasElement, overrides: UrlOverrides): Promise<App> {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`configuration indisponible (HTTP ${res.status}) — le serveur est-il lancé ?`);
    const raw = (await res.json()) as Config;
    const quality = overrides.quality ?? raw.display.quality;
    const profile = raw.qualityProfiles[quality];
    const [assets, physicsOcean] = await Promise.all([loadWorldAssets(profile.visualSimWidth), loadOceanGrid(profile.physicsSimWidth)]);
    return new App(raw, overrides, assets, canvas, physicsOcean);
  }

  private resolve(raw: Config, target?: DisplayTarget): Config {
    const t = target ?? this.overrides.target ?? raw.display.target;
    const withQuality = this.overrides.quality ? deepMerge(raw, { display: { quality: this.overrides.quality } }) : raw;
    // Copie profonde : le panneau modifie cet objet en place.
    return structuredClone(resolveForTarget(withQuality, t));
  }

  private get profile() {
    return this.cfg.qualityProfiles[this.cfg.display.quality];
  }

  // ------------------------------------------------------------ configuration

  private makePhysics(ocean: THREE.Texture): PhysicsField {
    const f = new PhysicsField(this.profile.physicsSimWidth, ocean);
    f.calibrationK = this.calibration.K;
    f.configure(this.cfg);
    f.clear(this.renderer);
    this.flat.setLevels(f.levels.texture, f.width, f.height);
    return f;
  }

  private applyConfig(): void {
    this.physics?.configure(this.cfg);
    this.wave.setParams(this.cfg.waves);
    this.detail?.sim?.setParams(this.cfg.waves);
    this.ships.recomputeAmplitudes(this.cfg);
  }

  private onServerConfig(c: Config): void {
    this.raw = c;
    this.cfg = this.resolve(c, this.cfg.display.target);
    this.afterConfigChange();
    this.panel.refresh();
  }

  private onPanelChange(path: string): void {
    if (path === 'view' || path === 'display') this.nav.forget();
    if (path === 'display') {
      // Changement de cible : on repart de la configuration serveur pour cette cible,
      // en conservant les réglages artistiques communs en cours d'édition.
      const keep = { palette: this.cfg.palette, waves: this.cfg.waves, ships: this.cfg.ships, display: this.cfg.display };
      const scale = this.cfg.render.renderScale;
      const prevTarget = this.raw.display.target;
      this.cfg = this.resolve(deepMerge(this.raw, keep), this.cfg.display.target);
      if (this.cfg.display.target === prevTarget) this.cfg.render.renderScale = scale;
      this.panel.refresh();
    }
    this.afterConfigChange();
  }

  private afterConfigChange(): void {
    this.applyConfig();
    this.resize();
    if (this.profile.visualSimWidth !== this.wave.width || this.profile.physicsSimWidth !== this.physics.width) void this.rebuildSim();
  }

  private async rebuildSim(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      const width = this.profile.visualSimWidth;
      if (width !== this.wave.width) {
        const ocean = await loadOceanGrid(width);
        this.assets = { ...this.assets, ocean, oceanWidth: width };
        this.wave.dispose();
        this.wave = new WaveSim(width, ocean);
        this.wave.clear(this.renderer);
      }
      if (this.profile.physicsSimWidth !== this.physics.width) {
        const ocean = await loadOceanGrid(this.profile.physicsSimWidth);
        this.physics.dispose();
        this.physics = this.makePhysics(ocean);
      }
      this.applyConfig();
    } finally {
      this.rebuilding = false;
    }
  }

  /** Enregistre : réglages communs à la racine, rendu et cadrage dans la cible courante. */
  private async save(): Promise<string> {
    const c = this.cfg;
    const body = {
      display: { quality: c.display.quality },
      palette: c.palette,
      waves: c.waves,
      ships: c.ships,
      accumulation: c.accumulation,
      incognita: c.incognita,
      targets: { [c.display.target]: { render: c.render, view: c.view } },
    };
    const res = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? `enregistré (${new Date().toLocaleTimeString()})` : `erreur : ${await res.text()}`;
  }

  private onCoverage(w: number, h: number, data: Uint8Array): void {
    const img = this.coverage.image as { data: Uint8Array; width: number; height: number };
    if (img.width !== w || img.height !== h) return;
    img.data.set(data);
    this.coverage.needsUpdate = true;
  }

  /** Niveaux de bruit sous le curseur (lecture d'un pixel du champ physique). */
  private readCursor(): string {
    if (!this.mouse || !this.lastView || !this.cfg.physics.enabled) return '';
    const [lon0, lat] = screenToGeo(this.lastView, this.mouse.x, this.mouse.y);
    const lon = ((((lon0 + 180) % 360) + 360) % 360) - 180;
    if (lat < this.lastView.latMin || lat > this.lastView.latMax) return '';
    const lv = this.physics.readLevels(this.renderer, lat, lon);
    const pos = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'O'}`;
    if (!lv) return pos;
    return `curseur ${pos} : accumulé ${lv[0].toFixed(0)} dB · basse ${lv[1].toFixed(0)} · moyenne ${lv[2].toFixed(0)} · haute ${lv[3].toFixed(0)} dB re 1 µPa`;
  }

  // ------------------------------------------------------------ entrées

  private installKeys(): void {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === 'p') this.panel.toggle();
      else if (k === 'b') this.flat.debugField = (this.flat.debugField + 1) % 5;
      else if (k === 'd') this.hud.toggle();
      else if (k === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
    });
    // Curseur masqué après 2 s d'immobilité.
    let idle: number | undefined;
    addEventListener('mousemove', (e) => {
      const c = this.renderer.domElement;
      const ratio = c.width / Math.max(1, c.clientWidth);
      this.mouse = { x: e.clientX * ratio, y: c.height - e.clientY * ratio };
      document.body.classList.remove('idle');
      clearTimeout(idle);
      idle = window.setTimeout(() => document.body.classList.add('idle'), 2000);
    });
  }

  private resize(): void {
    const ratio = Math.min(devicePixelRatio * this.cfg.render.renderScale, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  // ------------------------------------------------------------ boucle

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    const t0 = performance.now();
    const cfg = this.cfg;
    const r = this.renderer;
    const steps = this.profile.visualSimSteps;

    this.gpu.begin();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const view = computeFlatTransform(cfg, size.x, size.y, this.nav.update(dt));
    const detail = this.detail.update(r, view, this.nav.zoom, cfg, now);
    const splat = 3 * (this.wave.width / 2048);
    for (let s = 0; s < steps; s++) {
      this.ships.inject(r, this.wave.sourceTarget, this.wave.domain, splat, now, this.clock, cfg, this.wave.courant, steps * NOMINAL_FPS);
      this.wave.step(r);
      if (detail) {
        this.ships.inject(r, detail.sourceTarget, detail.domain, 3, now, this.clock, cfg, detail.courant, steps * NOMINAL_FPS);
        detail.step(r);
      }
      this.clock = (this.clock + 1) % CLOCK_WRAP;
    }
    // Champ physique : un pas par image, moyenne d'énergie, conversion en dB et accumulation.
    if (cfg.physics.enabled) {
      const ph = this.physics;
      this.ships.injectPhysics(r, ph.sourceTarget, ph.domain, ph.ocean, now, this.physicsClock);
      ph.step(r);
      ph.updateEnergy(r, 1 - Math.exp(-dt / 1000 / cfg.physics.energyTauSec));
      ph.accumulate(r, Math.min(dt, 250) / 1000, cfg);
      this.physicsClock = (this.physicsClock + 1) % CLOCK_WRAP;
      this.flat.setLevels(ph.levels.texture, ph.width, ph.height);
    } else {
      this.flat.setLevels(null);
    }
    this.lastView = view;
    this.flat.render(r, this.wave.texture, { x: this.wave.width, y: this.wave.height }, this.coverage, view, cfg, now / 1000, detail ? { sim: detail, weight: this.detail.weight } : undefined);
    // Les points grossissent un peu quand on zoome, pour rester lisibles.
    this.ships.draw(r, now, view, cfg, r.getPixelRatio() * Math.min(3, this.nav.zoom ** 0.35));
    this.gpu.end();

    if (this.hud.visible && now - this.lastCursorRead > 250) {
      this.lastCursorRead = now;
      this.cursorInfo = this.readCursor();
    }
    this.hud.frame(dt, performance.now() - t0, this.gpu.lastMs, () => ({
      calibration: `calibration ${this.calibration.maxDeviationDb.toFixed(1)} dB d'écart à la loi en 1/r${cfg.physics.enabled ? '' : ' (champ physique désactivé)'}   B : champ ${['rendu', 'accumulé', 'basse', 'moyenne', 'haute'][this.flat.debugField]}`,
      cursor: this.cursorInfo,
      status: this.sourceStatus,
      connected: this.connected,
      ships: this.ships.shipCount,
      simTime: new Date(this.ships.simTimeMs(now)),
      timeScale: this.ships.currentTimeScale,
      simSize: `${this.wave.width}×${this.wave.height}${this.detail.sim ? ` + détail ${this.detail.sim.width}×${this.detail.sim.height} (${(this.detail.sim.domain.lonSpan / this.detail.sim.width * 111).toFixed(1)} km/cellule)` : ''}`,
      steps,
      canvas: `${size.x}×${size.y}   zoom ×${this.nav.zoom.toFixed(1)} (${view.centerLon.toFixed(1)}°, ${view.centerLat.toFixed(1)}°)`,
      target: cfg.display.target,
      quality: cfg.display.quality,
    }));
  }
}
