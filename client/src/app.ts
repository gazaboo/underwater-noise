/**
 * Orchestration du client : configuration, flux de navires, simulation d'ondes, rendu,
 * HUD et panneau de réglage.
 */
import * as THREE from 'three';
import { deepMerge, resolveForTarget, type Config, type DisplayTarget } from '@vacarme/shared';
import { loadOceanGrid, loadWorldAssets, type WorldAssets } from './assets.ts';
import { ShipStream } from './net/ship-stream.ts';
import { computeFlatTransform, FlatView } from './render/flat-view.ts';
import { ShipLayer } from './render/ships.ts';
import { WaveSim } from './sim/wave-sim.ts';
import { GpuTimer, Hud } from './ui/hud.ts';
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
  private readonly gpu: GpuTimer;
  private wave: WaveSim;
  private readonly flat: FlatView;
  private clock = 0;
  private connected = false;
  private lastFrame = performance.now();
  private rebuilding = false;

  private constructor(
    raw: Config,
    private readonly overrides: UrlOverrides,
    private assets: WorldAssets,
    canvas: HTMLCanvasElement,
  ) {
    this.raw = raw;
    this.cfg = this.resolve(raw);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // composition faite à la main (voir hexToVec3)
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.wave = new WaveSim(assets.oceanWidth, assets.ocean);
    this.wave.clear(this.renderer);
    this.flat = new FlatView(assets);
    this.panel = new Panel(
      () => this.cfg,
      (path) => this.onPanelChange(path),
      () => this.save(),
    );
    this.applyConfig();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.installKeys();
    if (overrides.hud) this.hud.toggle(true);

    new ShipStream({
      onSnapshot: (snap, at) => this.ships.update(snap, at, this.cfg),
      onConfig: (c) => this.onServerConfig(c),
      onStatus: (ok) => (this.connected = ok),
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  static async create(canvas: HTMLCanvasElement, overrides: UrlOverrides): Promise<App> {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`configuration indisponible (HTTP ${res.status}) — le serveur est-il lancé ?`);
    const raw = (await res.json()) as Config;
    const quality = overrides.quality ?? raw.display.quality;
    const assets = await loadWorldAssets(raw.qualityProfiles[quality].visualSimWidth);
    return new App(raw, overrides, assets, canvas);
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

  private applyConfig(): void {
    this.wave.setParams(this.cfg.waves);
    this.ships.recomputeAmplitudes(this.cfg);
  }

  private onServerConfig(c: Config): void {
    this.raw = c;
    this.cfg = this.resolve(c, this.cfg.display.target);
    this.afterConfigChange();
    this.panel.refresh();
  }

  private onPanelChange(path: string): void {
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
    if (this.profile.visualSimWidth !== this.wave.width) void this.rebuildSim();
  }

  private async rebuildSim(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      const width = this.profile.visualSimWidth;
      const ocean = await loadOceanGrid(width);
      this.assets = { ...this.assets, ocean, oceanWidth: width };
      this.wave.dispose();
      this.wave = new WaveSim(width, ocean);
      this.wave.clear(this.renderer);
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
      targets: { [c.display.target]: { render: c.render, view: c.view } },
    };
    const res = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? `enregistré (${new Date().toLocaleTimeString()})` : `erreur : ${await res.text()}`;
  }

  // ------------------------------------------------------------ entrées

  private installKeys(): void {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === 'p') this.panel.toggle();
      else if (k === 'd') this.hud.toggle();
      else if (k === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
    });
    // Curseur masqué après 2 s d'immobilité.
    let idle: number | undefined;
    addEventListener('mousemove', () => {
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
    for (let s = 0; s < steps; s++) {
      this.ships.inject(r, this.wave.sourceTarget, now, this.clock, cfg, this.wave.courant, steps * NOMINAL_FPS);
      this.wave.step(r);
      this.clock = (this.clock + 1) % CLOCK_WRAP;
    }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const view = computeFlatTransform(cfg, size.x, size.y);
    this.flat.render(r, this.wave.texture, { x: this.wave.width, y: this.wave.height }, view, cfg, now / 1000);
    this.ships.draw(r, now, view, cfg, r.getPixelRatio());
    this.gpu.end();

    this.hud.frame(dt, performance.now() - t0, this.gpu.lastMs, () => ({
      source: 'simulation',
      connected: this.connected,
      ships: this.ships.shipCount,
      simTime: new Date(this.ships.simTimeMs(now)),
      timeScale: cfg.simulation.timeScale,
      simSize: `${this.wave.width}×${this.wave.height}`,
      steps,
      canvas: `${size.x}×${size.y}`,
      target: cfg.display.target,
      quality: cfg.display.quality,
    }));
  }
}
