/**
 * Orchestration du client : configuration, flux de navires, simulation d'ondes, rendu,
 * HUD et panneau de réglage.
 */
import * as THREE from 'three';
import { deepMerge, resolveForTarget, type Config, type DisplayTarget, type SourceStatus } from '@vacarme/shared';
import { loadOceanGrid, loadOrnaments, loadWorldAssets, loadVolcanoes, type Volcano, type WorldAssets } from './assets.ts';
import { ShipStream } from './net/ship-stream.ts';
import { computeFlatTransform, FlatView, screenToGeo, worldTransform, type FlatTransform } from './render/flat-view.ts';
import { GlobeController, GlobeView, globeCamera, pixelToGeo, viewToEarth, type GlobeMode } from './render/globe-view.ts';
import { VolcanoLayer } from './render/volcanoes.ts';
import { OrnamentLayer } from './render/ornaments.ts';
import { ShipLayer } from './render/ships.ts';
import { DetailWaves } from './sim/detail.ts';
import { PhysicsField, calibrate, type CalibrationResult } from './sim/physics-sim.ts';
import { Whales } from './whales/whales.ts';
import { FieldReader } from './whales/field-reader.ts';
import { AudioEngine, flatListener, globeListener } from './audio/engine.ts';
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
  scene?: string;
  mode?: Config['display']['mode'];
  theme?: Config['display']['theme'];
}

const MODES: Config['display']['mode'][] = ['flat', 'globe', 'hemisphere', 'equirect', 'fisheye'];
const SHIPS_MODES: Config['source']['ships'][] = ['real', 'estimated', 'mixed'];

export class App {
  /** Configuration telle que reçue du serveur. */
  private raw: Config;
  /** Configuration effective (cible appliquée), éditée en direct par le panneau. */
  cfg: Config;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ships = new ShipLayer();
  private readonly volcanoes: VolcanoLayer;
  private readonly ornaments: OrnamentLayer | null;
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
  private whales: Whales | null = null;
  /** Copie processeur du champ de bruit (cétacés, son). */
  private readonly field = new FieldReader();
  private readonly audio = new AudioEngine();
  private readonly globe = new GlobeView();
  private readonly globeCtl: GlobeController;
  private worldTarget: THREE.WebGLRenderTarget | null = null;
  /** Dernière projection globe (pour le curseur). */
  private lastGlobe: { mode: GlobeMode; cam: ReturnType<typeof globeCamera>; M: THREE.Matrix3; w: number; h: number } | null = null;
  private speciesKey = '';
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
    volcanoes: Volcano[],
    ornaments: Awaited<ReturnType<typeof loadOrnaments>> | null,
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
    this.volcanoes = new VolcanoLayer(volcanoes);
    this.ornaments = ornaments ? new OrnamentLayer(ornaments.data, ornaments.atlas, ornaments.image) : null;
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
    this.globeCtl = new GlobeController(this.cfg);
    this.globeCtl.install(canvas, () => this.cfg.display.mode === 'globe');
    if (overrides.hud) this.hud.toggle(true);

    this.speciesKey = JSON.stringify(this.cfg.whales.species);
    void Whales.create(this.cfg, `/data/grid/ocean_1024.png`, assets.elevationLinear, (lat, lon) => this.coverageAt(lat, lon), overrides.scene).then((w) => {
      this.whales = w;
      if (overrides.scene === 'duo') this.nav.goTo(8.1, 43.4, 22);
    }, (e) => console.error('[cétacés] initialisation impossible :', e));

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
    // Ornements facultatifs : sans eux (données absentes), le monde illustré reste complet sans vignettes.
    const ornaments = loadOrnaments().catch((e: unknown) => {
      console.warn('[ornements] indisponibles :', e);
      return null;
    });
    const [assets, physicsOcean, volcanoes, orn] = await Promise.all([loadWorldAssets(profile.visualSimWidth), loadOceanGrid(profile.physicsSimWidth), loadVolcanoes(), ornaments]);
    return new App(raw, overrides, assets, canvas, physicsOcean, volcanoes, orn);
  }

  private resolve(raw: Config, target?: DisplayTarget): Config {
    const t = target ?? this.overrides.target ?? raw.display.target;
    let withQuality = this.overrides.quality ? deepMerge(raw, { display: { quality: this.overrides.quality } }) : raw;
    if (this.overrides.mode) withQuality = deepMerge(withQuality, { display: { mode: this.overrides.mode } });
    if (this.overrides.theme) withQuality = deepMerge(withQuality, { display: { theme: this.overrides.theme } });
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
    this.whales?.configure(this.cfg);
    const key = JSON.stringify(this.cfg.whales.species);
    if (this.whales && key !== this.speciesKey) this.whales.repopulate(this.cfg);
    this.speciesKey = key;
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

  /** Navires réels / estimés / mixtes : réglage du serveur, appliqué aussitôt (et enregistré dans config/local.json5). */
  private setShipsMode(mode: Config['source']['ships']): void {
    this.cfg.source.ships = mode;
    void fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: { ships: mode } }) }).then(
      async (res) => res.ok || console.error(`[navires] ${await res.text()}`),
      (e: Error) => console.error(`[navires] ${e.message}`),
    );
  }

  private onPanelChange(path: string): void {
    if (path === 'ships') return this.setShipsMode(this.cfg.source.ships);
    if (path === 'view' || path === 'display') this.nav.forget();
    if (path === 'display') {
      // Changement de cible : on repart de la configuration serveur pour cette cible,
      // en conservant les réglages artistiques communs en cours d'édition.
      const keep = { palette: this.cfg.palette, dayPalette: this.cfg.dayPalette, land: this.cfg.land, waves: this.cfg.waves, ships: this.cfg.ships, display: this.cfg.display };
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
      display: { quality: c.display.quality, mode: c.display.mode, theme: c.display.theme },
      palette: c.palette,
      dayPalette: c.dayPalette,
      land: c.land,
      waves: c.waves,
      ships: c.ships,
      accumulation: c.accumulation,
      incognita: c.incognita,
      whales: c.whales,
      audio: c.audio,
      globe: c.globe,
      hemisphere: c.hemisphere,
      fisheye: c.fisheye,
      targets: { [c.display.target]: { render: c.render, view: c.view } },
    };
    const res = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? `enregistré (${new Date().toLocaleTimeString()})` : `erreur : ${await res.text()}`;
  }

  /** Configuration de rendu : en mode jour, la palette de jour remplace la palette champ par champ. */
  private themed(): Config {
    const c = this.cfg;
    return c.display.theme === 'day' ? { ...c, palette: { ...c.palette, ...c.dayPalette } } : c;
  }

  /** Couverture AIS (0–1) en un point. */
  private coverageAt(lat: number, lon: number): number {
    const img = this.coverage.image as { data: Uint8Array; width: number; height: number };
    const x = Math.min(img.width - 1, Math.floor(((((lon + 180) % 360) + 360) % 360) * (img.width / 360)));
    const y = Math.min(img.height - 1, Math.max(0, Math.floor((90 - lat) * (img.height / 180))));
    return img.data[y * img.width + x] / 255;
  }

  private onCoverage(w: number, h: number, data: Uint8Array): void {
    const img = this.coverage.image as { data: Uint8Array; width: number; height: number };
    if (img.width !== w || img.height !== h) return;
    img.data.set(data);
    this.coverage.needsUpdate = true;
  }

  /** Ligne du diagnostic consacrée aux cétacés. */
  private whaleLine(): string {
    if (!this.whales || !this.cfg.whales.enabled) return '';
    const st = this.whales.stats;
    const ranges = [...st.rangeRatio]
      .map(([id, r]) => `${this.cfg.whales.species.find((s) => s.id === id)?.name.toLowerCase() ?? id} ${(100 * r).toFixed(0)} %`)
      .join(', ');
    const pct = st.quietAlive ? ` (${((100 * st.alive) / st.quietAlive).toFixed(0)} % de l'océan sans navires)` : '';
    const c = this.whales.calls;
    const heard = c.answered + c.unanswered ? ` · appels entendus ${((100 * c.answered) / (c.answered + c.unanswered)).toFixed(0)} % (isolés compris)` : '';
    return `cétacés ${st.groups} groupes · liens vivants ${st.alive}/${st.quietAlive}${pct} · asymétriques ${st.asymmetric}${heard}\nportée d'écoute / océan calme : ${ranges}`;
  }

  /** Niveaux de bruit sous le curseur (lecture d'un pixel du champ physique). */
  private readCursor(): string {
    if (!this.mouse || !this.lastView || !this.cfg.physics.enabled) return '';
    let geo: [number, number] | null;
    if (this.lastGlobe) {
      const g = this.lastGlobe;
      const ll = pixelToGeo(g.mode, g.cam, g.M, this.cfg, this.mouse.x, this.mouse.y, g.w, g.h);
      geo = ll ? [ll[1], ll[0]] : null;
    } else geo = screenToGeo(this.lastView, this.mouse.x, this.mouse.y);
    if (!geo) return '';
    const [lon0, lat] = geo;
    const lon = ((((lon0 + 180) % 360) + 360) % 360) - 180;
    if (!this.lastGlobe && (lat < this.lastView.latMin || lat > this.lastView.latMax)) return '';
    const lv = this.physics.readLevels(this.renderer, lat, lon);
    const pos = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'O'}`;
    if (!lv) return pos;
    const g = this.whales?.nearest(lat, lon, 400 / Math.max(1, this.nav.zoom));
    const whale = g
      ? `\n${g.species.name} (${g.species.visualScale > 1 ? `distances ×${g.species.visualScale} à l'écran, ` : ''}bruit ${g.noiseCall.toFixed(0)} dB dans la bande de l'appel) : portée ${(g.rangeM / 1000).toFixed(g.rangeM < 10_000 ? 1 : 0)} km, océan calme ${(g.quietRangeM / 1000).toFixed(0)} km${g.coverage < 0.2 ? ' — zone non observée : bruit sous-estimé' : ''}`
      : '';
    return whale ? `curseur ${pos} : accumulé ${lv[0].toFixed(0)} dB · basse ${lv[1].toFixed(0)} · moyenne ${lv[2].toFixed(0)} · haute ${lv[3].toFixed(0)} dB re 1 µPa${whale}` : `curseur ${pos} : accumulé ${lv[0].toFixed(0)} dB · basse ${lv[1].toFixed(0)} · moyenne ${lv[2].toFixed(0)} · haute ${lv[3].toFixed(0)} dB re 1 µPa`;
  }

  // ------------------------------------------------------------ entrées

  private installKeys(): void {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === 'p') this.panel.toggle();
      else if (k === 'b') this.flat.debugField = (this.flat.debugField + 1) % 5;
      else if (k === 'm') this.audio.toggleMute();
      else if (k === 'g') this.cfg.display.mode = this.cfg.display.mode === 'flat' ? 'globe' : 'flat';
      else if (k === 'o') this.cfg.display.mode = MODES[(MODES.indexOf(this.cfg.display.mode) + 1) % MODES.length];
      else if (k === 'c') this.globe.calibration = !this.globe.calibration;
      else if (k === 'n') {
        this.setShipsMode(SHIPS_MODES[(SHIPS_MODES.indexOf(this.cfg.source.ships) + 1) % SHIPS_MODES.length]);
        this.panel.refresh();
      } else if (k === 'j') {
        this.cfg.display.theme = this.cfg.display.theme === 'day' ? 'night' : 'day';
        this.panel.refresh();
      }
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
    const cfg = this.themed();
    const r = this.renderer;
    const steps = this.profile.visualSimSteps;

    this.gpu.begin();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const mode = cfg.display.mode;
    const flatMode = mode === 'flat';
    this.nav.enabled = flatMode;
    const view = computeFlatTransform(cfg, size.x, size.y, flatMode ? this.nav.update(dt) : undefined);
    const detail = this.detail.update(r, view, flatMode ? this.nav.zoom : 1, cfg, now, this.wave);
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
      this.field.update(r, ph, now);
      this.whales?.update(this.field, cfg, now, Math.min(dt, 250) / 1000);
    } else {
      this.flat.setLevels(null);
    }
    this.lastView = view;
    const levels = this.physics.levels.texture;
    let listener = flatListener(view);
    if (flatMode) {
      this.lastGlobe = null;
      this.flat.pixelRatio = r.getPixelRatio();
      this.flat.render(r, this.wave.texture, { x: this.wave.width, y: this.wave.height }, this.coverage, view, cfg, now / 1000, detail ? { sim: detail, weight: this.detail.weight } : undefined);
      this.volcanoes.draw(r, view, cfg, now / 1000);
      this.ornaments?.draw(r, { mode: 'flat', width: size.x, height: size.y, pixelRatio: r.getPixelRatio(), flat: view }, cfg, now / 1000);
      // Les points grossissent un peu quand on zoome, pour rester lisibles.
      this.ships.draw(r, now, view, cfg, r.getPixelRatio() * Math.min(3, this.nav.zoom ** 0.35));
      if (cfg.physics.enabled) this.whales?.draw(r, view, cfg, levels, this.coverage, now / 1000, r.getPixelRatio());
    } else {
      // Texture « monde » : composition complète en équirectangulaire, puis reprojection.
      const W = this.profile.worldTextureWidth;
      if (!this.worldTarget || this.worldTarget.width !== W) {
        this.worldTarget?.dispose();
        this.worldTarget = new THREE.WebGLRenderTarget(W, W / 2, {
          type: THREE.HalfFloatType,
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
          magFilter: THREE.LinearFilter,
          wrapS: THREE.RepeatWrapping,
          wrapT: THREE.ClampToEdgeWrapping,
          depthBuffer: false,
        });
      }
      const world = worldTransform(W);
      // Largeurs « à l'écran » du monde illustré (plages, ombres, lignes d'eau) : échelle de l'affichage final.
      this.globeCtl.update(cfg, Math.min(dt, 250) / 1000);
      const facingLat = this.globeCtl.facingLatFor(cfg);
      const M = viewToEarth(facingLat, this.globeCtl.facingLon);
      const gm = mode as GlobeMode;
      const cam = globeCamera(gm, cfg, size.x / size.y, this.globeCtl.zoom);
      const ornView = { mode: gm, width: size.x, height: size.y, pixelRatio: r.getPixelRatio(), cam, M };
      this.flat.displayPxPerDeg = OrnamentLayer.pxPerDeg(ornView, cfg);
      this.flat.render(r, this.wave.texture, { x: this.wave.width, y: this.wave.height }, this.coverage, world, cfg, now / 1000, undefined, this.worldTarget);
      this.ships.draw(r, now, world, cfg, 1, this.worldTarget);
      if (cfg.physics.enabled) this.whales?.draw(r, world, cfg, levels, this.coverage, now / 1000, 1, this.worldTarget);
      this.globe.render(r, this.worldTarget.texture, gm, cam, M, cfg, size.x, size.y, now / 1000);
      if (!this.globe.calibration) this.ornaments?.draw(r, ornView, cfg, now / 1000);
      this.lastGlobe = { mode: gm, cam, M, w: size.x, h: size.y };
      if (gm !== 'equirect') listener = globeListener(facingLat, this.globeCtl.facingLon);
    }
    this.gpu.end();

    this.audio.update(now, cfg, listener, this.ships, this.field, this.whales?.drainEvents() ?? []);
    if (this.hud.visible && now - this.lastCursorRead > 250) {
      this.lastCursorRead = now;
      this.cursorInfo = this.readCursor();
    }
    this.hud.frame(dt, performance.now() - t0, this.gpu.lastMs, () => ({
      calibration: `calibration ${this.calibration.maxDeviationDb.toFixed(1)} dB d'écart à la loi en 1/r${cfg.physics.enabled ? '' : ' (champ physique désactivé)'}   B : champ ${['rendu', 'accumulé', 'basse', 'moyenne', 'haute'][this.flat.debugField]}`,
      cursor: this.cursorInfo,
      whales: this.whaleLine(),
      audio: this.audio.status,
      status: this.sourceStatus,
      connected: this.connected,
      ships: this.ships.shipCount,
      simTime: new Date(this.ships.simTimeMs(now)),
      timeScale: this.ships.currentTimeScale,
      simSize: `${this.wave.width}×${this.wave.height}${this.detail.sim ? ` + détail ${this.detail.sim.width}×${this.detail.sim.height} (${(this.detail.sim.domain.lonSpan / this.detail.sim.width * 111).toFixed(1)} km/cellule)` : ''}`,
      steps,
      canvas: flatMode
        ? `${size.x}×${size.y}   carte plate, zoom ×${this.nav.zoom.toFixed(1)} (${view.centerLon.toFixed(1)}°, ${view.centerLat.toFixed(1)}°)`
        : `${size.x}×${size.y}   ${mode} (texture monde ${this.profile.worldTextureWidth}), face au public ${this.globeCtl.facingLatFor(cfg).toFixed(0)}°, ${this.globeCtl.facingLon.toFixed(0)}°${this.globe.calibration ? '   MIRE' : ''}`,
      target: cfg.display.target,
      quality: cfg.display.quality,
    }));
  }
}
