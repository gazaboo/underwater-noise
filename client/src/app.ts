/**
 * Orchestration du client : configuration, flux de navires, simulation d'ondes, rendu,
 * HUD et panneau de réglage.
 */
import * as THREE from 'three';
import { deepMerge, naturalLevel, resolveForTarget, type Config, type DisplayTarget, type SourceStatus, type ShipSnapshot, PhysicalSteps } from '@vacarme/shared';
import { loadOceanGrid, loadOrnaments, loadWorldAssets, loadVolcanoes, type Volcano, type WorldAssets } from './assets.ts';
import { ShipStream, type StreamEvents } from './net/ship-stream.ts';
import { LocalShipStream } from './net/local-stream.ts';
import { computeFlatTransform, FlatView, screenToGeo, worldTransform, type FlatTransform } from './render/flat-view.ts';
import { GlobeController, GlobeView, globeCamera, pixelToGeo, viewToEarth, type GlobeMode } from './render/globe-view.ts';
import { VolcanoLayer } from './render/volcanoes.ts';
import { OrnamentLayer } from './render/ornaments.ts';
import { displayPxPerDeg } from './render/screen-projection.ts';
import { hexToVec3 } from './render/fullscreen.ts';
import type { WhaleDrawOptions } from './whales/render.ts';
import { ShipLayer } from './render/ships.ts';
import { PhysicsField, calibrate, type CalibrationResult } from './sim/physics-sim.ts';
import { Whales } from './whales/whales.ts';
import { FieldReader } from './whales/field-reader.ts';
import { AudioEngine, flatListener, globeListener } from './audio/engine.ts';
import { cycleNoise, noiseLabel, noShips, scenarioLabel, toggleScenario } from './ui/scenario.ts';
import { SpeciesCardPanel } from './ui/card.ts';
import { LieuLayer } from './lieux/lieux.ts';
import { StoryPlayer } from './story/story.ts';
import { distanceM } from './whales/agents.ts';
import { SceneClock } from './sim/scene-clock.ts';
import { GpuTimer, Hud } from './ui/hud.ts';
import { FlatNavigator } from './ui/navigation.ts';
import { Panel } from './ui/panel.ts';
import { SciencePanel } from './ui/science.ts';
import { Legend } from './ui/legend.ts';
import { Toolbar } from './ui/toolbar.ts';
import { dataUrl, STANDALONE } from './data-url.ts';

const SCENE_STEP_SEC = 0.1;
/** Pas de préchauffage par image (≈ 330 pas pour 20 min de scène sur la grille de 39 km). */
const WARMUP_STEPS_PER_FRAME = 40;
/**
 * Calibration mesurée sur la Radeon 780M (25 oct. 2026, grille 256², 1200/C pas) [C] : K et écart à la loi
 * en 1/r. Le schéma numérique ne dépend pas de l'appareil ; refaire la mesure si STEP_FRAG change
 * (scripts/verify-propagation.mjs compare toujours la calibration complète).
 */
const WEB_CALIBRATION: CalibrationResult = { K: 307.71153686770907, maxDeviationDb: 0.38, range: [18, 96], curve: [] };
/** Clé des réglages du panneau enregistrés dans le navigateur (web autonome). */
const LOCAL_SETTINGS = 'vacarme-web-settings';

export interface UrlOverrides {
  target?: DisplayTarget;
  quality?: Config['display']['quality'];
  hud?: boolean;
  scene?: string;
  mode?: Config['display']['mode'];
  theme?: Config['display']['theme'];
  parcours?: string;
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
  private readonly science: SciencePanel;
  private readonly legend: Legend;
  private readonly card: SpeciesCardPanel;
  private readonly lieux = new LieuLayer();
  private readonly story: StoryPlayer;
  /** Dernier geste du visiteur (boucle d'attraction). */
  private lastInput = performance.now();
  /** Web autonome : sources de navires dans un worker du navigateur. */
  private local: LocalShipStream | null = null;
  private readonly nav: FlatNavigator;
  private readonly gpu: GpuTimer;
  private readonly flat: FlatView;
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
  private readonly sceneClock = new SceneClock();
  private readonly physicsSteps = new PhysicalSteps();
  private readonly sceneSteps = new PhysicalSteps();
  private clockRevision = -1;
  private sceneOriginMs = 0;
  private sceneTicks = 0;
  private sceneAgeSec = 0;
  /** Pas de préchauffage restants / prévus, et instant des positions des navires utilisées. */
  private warmupLeft = 0;
  private warmupTotal = 0;
  private warmupTimeMs = 0;
  private timeWriteTimer: number | undefined;
  private desiredTimeScale: number | null = null;
  private writingTimeScale: number | null = null;
  private connected = false;
  private panelSourceKnown = false;
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
    this.flat = new FlatView(assets);
    this.science = new SciencePanel();
    this.legend = new Legend();
    this.card = new SpeciesCardPanel();
    this.audio.places = this.lieux;
    this.story = new StoryPlayer({
      cfg: () => this.cfg,
      flyTo: (lon, lat, zoom, sec) => {
        if (this.cfg.display.mode === 'flat') this.nav.goTo(lon, lat, zoom);
        else this.globeCtl.flyTo(this.cfg, lon, lat, Math.min(4, Math.max(0.8, Math.sqrt(zoom))), sec);
      },
      hold: (on) => { this.globeCtl.hold = on; },
      lieu: (id) => this.lieux.lieux.find((l) => l.id === id),
      openLieu: (l) => this.card.openLieu(l, this.cfg),
      openSpecies: (id) => {
        const c = this.lastGlobe ? { lat: this.globeCtl.facingLatFor(this.cfg), lon: this.globeCtl.facingLon } : this.lastView ? { lat: this.lastView.centerLat, lon: this.lastView.centerLon } : null;
        const g = c && this.whales?.nearestOf(id, c.lat, c.lon);
        if (g) this.card.open(g, this.cfg);
      },
      closeCard: () => this.card.close(),
    });
    this.volcanoes = new VolcanoLayer(volcanoes);
    this.ornaments = ornaments ? new OrnamentLayer(ornaments.data, ornaments.atlas, ornaments.image) : null;
    // Calibration du champ physique (source unique, loi en 1/r) puis grille mondiale. Web autonome : la
    // constante mesurée (même schéma numérique) évite ~3 s de calcul sur un téléphone ; ?calibrate la refait.
    const t0 = performance.now();
    this.calibration = STANDALONE && !new URLSearchParams(location.search).has('calibrate') ? WEB_CALIBRATION : calibrate(this.renderer);
    console.info(
      `[physique] calibration en ${(performance.now() - t0).toFixed(0)} ms : K = ${this.calibration.K.toExponential(3)}, ` +
        `écart max ${this.calibration.maxDeviationDb.toFixed(2)} dB sur r = ${this.calibration.range[0]}–${this.calibration.range[1]} cellules`,
    );
    this.physics = this.makePhysics(physicsOcean);
    this.panel = new Panel(
      () => this.cfg,
      (path) => this.onPanelChange(path),
      () => this.save(),
      () => this.sourceStatus,
    );
    this.applyConfig();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.installKeys();
    this.nav = new FlatNavigator(canvas, () => this.cfg);
    this.globeCtl = new GlobeController(this.cfg);
    this.globeCtl.install(canvas, () => this.cfg.display.mode === 'globe');
    this.installPicking(canvas);
    this.installStory();
    if (overrides.parcours) this.story.start(overrides.parcours);
    if (overrides.hud) this.hud.toggle(true);

    this.speciesKey = JSON.stringify(this.cfg.whales.species);
    void Whales.create(this.cfg, dataUrl(`grid/ocean_1024.png`), assets.elevationLinear, (lat, lon) => this.coverageAt(lat, lon), overrides.scene).then((w) => {
      this.whales = w;
      if (overrides.scene === 'duo') this.nav.goTo(8.1, 43.4, 22);
    }, (e) => console.error('[cétacés] initialisation impossible :', e));

    const events: StreamEvents = {
      onSnapshot: (snap, at) => this.onSnapshot(snap, at),
      onConfig: (c) => this.onServerConfig(c),
      onCoverage: (w, h, data) => this.onCoverage(w, h, data),
      onSourceStatus: (st) => {
        const wasLive = this.sourceStatus?.active === 'live' && this.sourceStatus.shipsMode !== 'estimated';
        this.sourceStatus = st;
        if (wasLive !== (st.active === 'live' && st.shipsMode !== 'estimated') || !this.panelSourceKnown) this.panel.refresh();
        this.panelSourceKnown = true;
      },
      onStatus: (ok) => {
        this.connected = ok;
        if (!ok) this.sceneClock.disconnect();
      },
      onScienceStatus: () => { void this.science.reload(); },
    };
    // Web autonome : sources calculées dans le navigateur ; sinon, flux du serveur local.
    if (STANDALONE) {
      this.local = new LocalShipStream(this.cfg, events);
      this.installToolbar();
    } else new ShipStream(events);
    requestAnimationFrame((t) => this.frame(t));
  }

  static async create(canvas: HTMLCanvasElement, overrides: UrlOverrides): Promise<App> {
    const raw = await App.loadConfig();
    const quality = overrides.quality ?? raw.display.quality;
    const profile = raw.qualityProfiles[quality];
    // Ornements facultatifs : sans eux (données absentes), le monde illustré reste complet sans vignettes.
    const ornaments = loadOrnaments().catch((e: unknown) => {
      console.warn('[ornements] indisponibles :', e);
      return null;
    });
    const [assets, physicsOcean, volcanoes, orn] = await Promise.all([loadWorldAssets(profile.physicsSimWidth), loadOceanGrid(profile.physicsSimWidth), loadVolcanoes(), ornaments]);
    return new App(raw, overrides, assets, canvas, physicsOcean, volcanoes, orn);
  }

  /**
   * Configuration : celle du serveur local, ou, en web autonome, config.json copié à côté de la page
   * (build:web), complété par les réglages enregistrés dans ce navigateur.
   */
  private static async loadConfig(): Promise<Config> {
    if (STANDALONE) {
      // config.json du build web ; en développement (?standalone), la configuration du serveur local.
      const res = await fetch(`${import.meta.env.BASE_URL}config.json`).catch(() => null);
      const built = res?.ok && res.headers.get('content-type')?.includes('json') ? ((await res.json()) as Config) : null;
      const base = built ?? ((await (await fetch('/api/config')).json()) as Config);
      let saved: unknown = null;
      try { saved = JSON.parse(localStorage.getItem(LOCAL_SETTINGS) ?? 'null'); } catch { /* stockage indisponible */ }
      const cfg = saved ? deepMerge(base, saved) : base;
      return deepMerge(cfg, { display: { target: 'web' } });
    }
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`configuration indisponible (HTTP ${res.status}) — le serveur est-il lancé ?`);
    return (await res.json()) as Config;
  }

  private onSnapshot(snap: ShipSnapshot, at: number): void {
    this.sceneClock.sync(snap, at);
    this.ships.update(snap, at, this.cfg);
  }

  private resetHistory(timeMs: number): void {
    this.sceneOriginMs = timeMs;
    this.sceneAgeSec = 0;
    // Régime établi supposé [E] : on calcule `noise.warmupMinutes` de scène avant le début de l'histoire,
    // navires immobiles à leur position courante (en 20 min, un navire parcourt moins d'une cellule).
    // Sans navires (avant le premier instantané), rien à préchauffer : la nouvelle chronologie le refera.
    this.warmupLeft = this.ships.shipCount > 0 ? Math.ceil((this.cfg.noise.warmupMinutes * 60) / this.physics.stepSeconds) : 0;
    this.warmupTotal = this.warmupLeft;
    this.warmupTimeMs = timeMs;
    this.sceneTicks = 0;
    this.physicsClock = 0;
    this.physicsSteps.reset();
    this.sceneSteps.reset();
    this.physics.clear(this.renderer);
    this.physics.accumulate(this.renderer, 0, this.cfg);
    this.field.reset();
    this.whales?.repopulate(this.cfg);
    this.audio.reset();
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
    f.accumulate(this.renderer, 0, this.cfg);
    this.flat.setLevels(f.levels.texture, f.width, f.height);
    return f;
  }

  private applyConfig(): void {
    this.physics?.configure(this.cfg);
    this.whales?.configure(this.cfg);
    const key = JSON.stringify(this.cfg.whales.species);
    if (this.whales && key !== this.speciesKey) this.whales.repopulate(this.cfg);
    this.speciesKey = key;
    this.ships.recomputeAmplitudes(this.cfg);
  }

  private onServerConfig(c: Config): void {
    if (this.writingTimeScale === c.playback.timeScale) this.writingTimeScale = null;
    if (this.writingTimeScale === null && this.desiredTimeScale === c.playback.timeScale) this.desiredTimeScale = null;
    this.raw = c;
    this.cfg = this.resolve(c, this.cfg.display.target);
    if (this.desiredTimeScale !== null) this.cfg.playback.timeScale = this.desiredTimeScale;
    this.afterConfigChange();
    this.panel.refresh();
    if (this.writingTimeScale === null && this.desiredTimeScale !== null) this.queuePlayback();
  }

  /** Navires réels / estimés / mixtes : réglage du serveur, appliqué aussitôt (et enregistré dans config/local.json5). */
  private setShipsMode(mode: Config['source']['ships']): void {
    this.cfg.source.ships = mode;
    if (mode === this.raw.source.ships) return;
    if (this.local) {
      this.raw = deepMerge(this.raw, { source: { ships: mode } });
      this.local.configure(this.cfg);
      return;
    }
    void fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: { ships: mode } }) }).then(
      async (res) => res.ok || console.error(`[navires] ${await res.text()}`),
      (e: Error) => console.error(`[navires] ${e.message}`),
    );
  }

  private onPanelChange(path: string): void {
    if (path === 'ships') return this.setShipsMode(this.cfg.source.ships);
    if (path === 'playback') {
      this.desiredTimeScale = this.cfg.playback.timeScale;
      this.queuePlayback();
      return;
    }
    if (path === 'view' || path === 'display') this.nav.forget();
    if (path === 'display') {
      // Changement de cible : on repart de la configuration serveur pour cette cible,
      // en conservant les réglages artistiques communs en cours d'édition.
      const keep = { palette: this.cfg.palette, dayPalette: this.cfg.dayPalette, land: this.cfg.land, waves: this.cfg.waves, noise: this.cfg.noise, ships: this.cfg.ships, display: this.cfg.display };
      const scale = this.cfg.render.renderScale;
      const prevTarget = this.raw.display.target;
      this.cfg = this.resolve(deepMerge(this.raw, keep), this.cfg.display.target);
      if (this.cfg.display.target === prevTarget) this.cfg.render.renderScale = scale;
      this.panel.refresh();
    }
    this.afterConfigChange();
  }

  private queuePlayback(): void {
    clearTimeout(this.timeWriteTimer);
    this.timeWriteTimer = window.setTimeout(() => this.writePlayback(), 150);
  }

  private writePlayback(): void {
    if (this.writingTimeScale !== null) return;
    const scale = this.desiredTimeScale;
    if (scale === null || scale === this.raw.playback.timeScale) {
      this.desiredTimeScale = null;
      return;
    }
    if (this.local) {
      this.raw = deepMerge(this.raw, { playback: { timeScale: scale } });
      this.local.configure(this.cfg);
      this.desiredTimeScale = null;
      return;
    }
    this.writingTimeScale = scale;
    // Keep the write pending until the server config acknowledges it. A successful HTTP
    // response precedes the file watch/broadcast and must not allow a duplicate request.
    void fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playback: { timeScale: scale } }) })
      .then(async res => { if (!res.ok) throw new Error(await res.text()); })
      .catch(error => {
        this.writingTimeScale = null;
        if (this.desiredTimeScale === scale) this.desiredTimeScale = null;
        else if (this.desiredTimeScale !== null) this.queuePlayback();
        console.error('[temps]', error);
      });
  }

  private afterConfigChange(): void {
    this.applyConfig();
    this.resize();
    if (this.profile.physicsSimWidth !== this.physics.width) void this.rebuildSim();
  }

  private async rebuildSim(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      if (this.profile.physicsSimWidth !== this.physics.width) {
        const ocean = await loadOceanGrid(this.profile.physicsSimWidth);
        this.physics.dispose();
        this.physics = this.makePhysics(ocean);
        this.resetHistory(this.sceneClock.read(performance.now()).timeMs);
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
      noise: c.noise,
      playback: c.playback,
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
    if (this.local) {
      try {
        localStorage.setItem(LOCAL_SETTINGS, JSON.stringify(body));
        return `enregistré dans ce navigateur (${new Date().toLocaleTimeString()})`;
      } catch {
        return 'stockage du navigateur indisponible : réglages non enregistrés';
      }
    }
    const res = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? `enregistré (${new Date().toLocaleTimeString()})` : `erreur : ${await res.text()}`;
  }

  /** Configuration de rendu : en mode jour, la palette de jour remplace la palette champ par champ. */
  private themed(): Config {
    const c = this.cfg;
    return c.display.theme === 'day' ? { ...c, palette: { ...c.palette, ...c.dayPalette } } : c;
  }

  /**
   * Réglages de dessin des cétacés pour l'affichage courant : vue globale ou rapprochée selon les pixels
   * par degré à l'écran ; anneaux d'appel masqués quand le temps est très accéléré (ils clignoteraient).
   */
  private whaleOptions(cfg: Config, pxPerDeg: number, fbPerCss: number, timeScale: number, center: [number, number]): WhaleDrawOptions | null {
    const noise = this.flat.noiseTexture;
    if (!cfg.physics.enabled || !noise) return null;
    const lod = cfg.whales.lod;
    const wind = cfg.ambient.windSpeedMs;
    return {
      noise,
      natural: cfg.bands.map((b) => naturalLevel(b, wind)) as [number, number, number],
      close: THREE.MathUtils.smoothstep(pxPerDeg, lod.closePxPerDeg, lod.fullPxPerDeg),
      fbPerCss,
      rings: 1 - THREE.MathUtils.smoothstep(timeScale, 3, 10),
      lostTint: hexToVec3(cfg.palette.noiseMid),
      center,
      ships: noShips(cfg) ? 0 : 1,
    };
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
    return `curseur ${pos} : estimations non validées · basse ${lv[1].toFixed(0)} · moyenne ${lv[2].toFixed(0)} · haute ${lv[3].toFixed(0)} dB re 1 µPa${whale}`;
  }

  private cursorGeo(): { lat: number; lon: number } | null {
    return this.mouse ? this.geoAt(this.mouse.x, this.mouse.y) : null;
  }

  /** Point géographique sous un pixel du tampon (origine en bas à gauche), ou null hors du monde. */
  private geoAt(x: number, y: number): { lat: number; lon: number } | null {
    if (!this.lastView) return null;
    let point: [number, number] | null;
    if (this.lastGlobe) {
      const g = this.lastGlobe;
      const p = pixelToGeo(g.mode, g.cam, g.M, this.cfg, x, y, g.w, g.h);
      point = p ? [p[1], p[0]] : null;
    } else point = screenToGeo(this.lastView, x, y);
    if (!point || Math.abs(point[1]) > 90) return null;
    return { lat: point[1], lon: ((((point[0] + 180) % 360) + 360) % 360) - 180 };
  }

  // ------------------------------------------------------------ entrées

  /**
   * Fiche au toucher : un tap (moins de 6 px et 400 ms entre l'appui et le relâchement) ouvre la fiche du lieu ou
   * du groupe le plus proche, dans un rayon de 24 px à l'écran ; un tap dans le vide la ferme. Les glissés restent
   * à la navigation.
   */
  private installPicking(canvas: HTMLCanvasElement): void {
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 400) return;
      const ratio = canvas.width / Math.max(1, canvas.clientWidth);
      const x = e.clientX * ratio;
      const y = canvas.height - e.clientY * ratio;
      const geo = this.geoAt(x, y);
      const edge = this.geoAt(x + 24 * ratio, y);
      const tolKm = geo && edge ? Math.max(2, distanceM(geo.lat, geo.lon, edge.lat, edge.lon) / 1000) : 300;
      // Les lieux d'abord : leur marqueur est plus rare et ne bouge pas.
      const lieu = geo && this.cfg.lieux.enabled ? this.lieux.nearest(geo.lat, geo.lon, tolKm) : null;
      const g = !lieu && geo && this.cfg.whales.enabled ? this.whales?.nearest(geo.lat, geo.lon, tolKm) : null;
      if (lieu) this.card.openLieu(lieu, this.cfg);
      else if (g) this.card.open(g, this.cfg);
      else this.card.close();
    });
  }

  /**
   * Parcours : un geste du visiteur (toucher, molette, touche) le reprend en main ; un geste dans la fiche la laisse
   * ouverte. Les boutons de la barre d'outils ne l'interrompent pas (ils le pilotent). Boucle d'attraction : voir frame.
   */
  private installStory(): void {
    const interrupt = (e: Event) => {
      this.lastInput = performance.now();
      const target = e.target instanceof Element ? e.target : null;
      if (!this.story.playing || target?.closest('#toolbar')) return;
      if (e instanceof KeyboardEvent && e.key.toLowerCase() === 'h') return;
      this.story.stop(!!target?.closest('#fiche'));
    };
    for (const ev of ['pointerdown', 'wheel', 'keydown'] as const) addEventListener(ev, interrupt, { capture: true });
  }

  /** Web autonome : les touches G, V, S, J, N, M deviennent des boutons ; légende repliée sur petit écran. */
  private installToolbar(): void {
    const c = () => this.cfg;
    const SHIPS = { real: 'Navires AIS', estimated: 'Navires estimés', mixed: 'AIS + estimés' } as const;
    const labels = {
      view: () => (c().display.mode === 'flat' ? 'Carte' : 'Globe'),
      noise: () => noiseLabel(c().noise),
      scenario: () => scenarioLabel(c()),
      theme: () => (c().display.theme === 'day' ? 'Jour' : 'Nuit'),
      ships: () => SHIPS[c().source.ships],
      sound: () => (this.audio.muted ? 'Son coupé' : 'Son'),
      legend: () => 'Légende',
      story: () => (this.story.playing ? 'Arrêter la visite' : 'Visite guidée'),
    };
    new Toolbar({
      view: () => { c().display.mode = c().display.mode === 'flat' ? 'globe' : 'flat'; return labels.view(); },
      noise: () => { cycleNoise(c().noise); return labels.noise(); },
      scenario: () => { toggleScenario(c()); return labels.scenario(); },
      theme: () => { c().display.theme = c().display.theme === 'day' ? 'night' : 'day'; return labels.theme(); },
      ships: () => { this.setShipsMode(SHIPS_MODES[(SHIPS_MODES.indexOf(c().source.ships) + 1) % SHIPS_MODES.length]); return labels.ships(); },
      sound: () => { this.audio.toggleMute(); return labels.sound(); },
      legend: () => { this.legend.toggle(); return labels.legend(); },
      story: () => { if (this.story.playing) this.story.stop(); else this.story.start(); return labels.story(); },
    }, labels);
    if (innerWidth < 700) this.legend.toggle(false);
  }

  private installKeys(): void {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === 'p') this.panel.toggle();
      else if (k === 'b') this.flat.debugField = (this.flat.debugField + 1) % 5;
      else if (k === 'v') {
        cycleNoise(this.cfg.noise);
        this.panel.refresh();
      } else if (k === 's') {
        toggleScenario(this.cfg);
        this.panel.refresh();
      }
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
      else if (k === 'escape') this.card.close();
      else if (k === 'h') {
        if (this.story.playing) this.story.stop();
        else this.story.start();
      }
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
    this.story.update(Math.min(dt, 250) / 1000);
    const attract = this.cfg.parcours;
    if (attract.attract && !this.story.playing && now - this.lastInput > attract.idleSec * 1000) {
      this.lastInput = now;
      this.story.start(attract.attract);
    }
    this.lastFrame = now;
    const t0 = performance.now();
    const cfg = this.themed();
    const r = this.renderer;
    const scene = this.sceneClock.read(now);
    if (this.clockRevision !== this.sceneClock.revision) {
      this.clockRevision = this.sceneClock.revision;
      this.resetHistory(scene.timeMs - scene.dtSec * 1000);
    }
    let steps = 0;

    this.gpu.begin();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const mode = cfg.display.mode;
    const flatMode = mode === 'flat';
    this.nav.enabled = flatMode;
    const view = computeFlatTransform(cfg, size.x, size.y, flatMode ? this.nav.update(dt) : undefined);
    if (cfg.physics.enabled) {
      const ph = this.physics;
      if (this.warmupLeft > 0) {
        // Préchauffage réparti sur quelques images : l'océan se remplit sans figer l'affichage.
        this.ships.setTime(this.warmupTimeMs);
        for (let i = Math.min(this.warmupLeft, WARMUP_STEPS_PER_FRAME); i > 0; i--, this.warmupLeft--) {
          this.ships.injectPhysics(r, ph.sourceTarget, ph.domain, ph.ocean, now, this.physicsClock);
          ph.step(r);
          ph.updateEnergy(r, 1 - Math.exp(-ph.stepSeconds / cfg.physics.energyTauSec));
          ph.accumulate(r, ph.stepSeconds, cfg);
          this.physicsClock++;
        }
        this.field.capture(r, ph);
      }
      this.sceneSteps.advance(scene.dtSec, SCENE_STEP_SEC, () => {
        this.sceneTicks++;
        this.sceneAgeSec = this.sceneTicks * SCENE_STEP_SEC;
        const stepTimeMs = this.sceneOriginMs + this.sceneAgeSec * 1000;
        steps += this.physicsSteps.advance(SCENE_STEP_SEC, ph.stepSeconds, offset => {
          this.ships.setTime(stepTimeMs - (SCENE_STEP_SEC - offset) * 1000);
          this.ships.injectPhysics(r, ph.sourceTarget, ph.domain, ph.ocean, now, this.physicsClock);
          ph.step(r);
          ph.updateEnergy(r, 1 - Math.exp(-ph.stepSeconds / cfg.physics.energyTauSec));
          ph.accumulate(r, ph.stepSeconds, cfg);
          this.physicsClock++;
          this.field.capture(r, ph);
        });
        this.whales?.update(this.field, cfg, stepTimeMs, SCENE_STEP_SEC);
      });
      this.flat.setLevels(ph.levels.texture, ph.width, ph.height);
    } else {
      this.flat.setLevels(null);
    }
    this.ships.setTime(scene.timeMs);
    // Horloge murale pour tout ce qui est décoratif (défilement, brouillard, scintillements) : à ×100,
    // l'image reste calme ; les phénomènes du modèle suivent l'horloge de la scène.
    const wall = now / 1000;
    const interpolation = Math.min(1, this.physicsSteps.fraction / this.physics.stepSeconds);
    this.lastView = view;
    let listener = flatListener(view);
    if (flatMode) {
      this.lastGlobe = null;
      this.flat.pixelRatio = r.getPixelRatio();
      this.flat.render(r, this.physics, interpolation, this.coverage, view, cfg, wall);
      this.volcanoes.draw(r, view, cfg, wall);
      this.ornaments?.draw(r, { mode: 'flat', width: size.x, height: size.y, pixelRatio: r.getPixelRatio(), flat: view }, cfg, wall);
      // Les points grossissent un peu quand on zoome, pour rester lisibles.
      this.ships.draw(r, now, view, cfg, r.getPixelRatio() * Math.min(3, this.nav.zoom ** 0.35));
      const screen = { mode: 'flat' as const, width: size.x, height: size.y, pixelRatio: r.getPixelRatio(), flat: view };
      const opts = this.whaleOptions(cfg, displayPxPerDeg(screen, cfg), r.getPixelRatio(), scene.scale, [view.centerLat, view.centerLon]);
      if (opts) this.whales?.draw(r, view, cfg, opts, this.coverage, wall);
      if (cfg.physics.enabled) this.whales?.drawGlyphs(r, screen, cfg, wall);
      this.lieux.draw(r, screen, cfg, wall);
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
      this.globeCtl.update(cfg, Math.min(dt, 250) / 1000);
      const facingLat = this.globeCtl.facingLatFor(cfg);
      const M = viewToEarth(facingLat, this.globeCtl.facingLon);
      const gm = mode as GlobeMode;
      const cam = globeCamera(gm, cfg, size.x / size.y, this.globeCtl.zoom);
      const ornView = { mode: gm, width: size.x, height: size.y, pixelRatio: r.getPixelRatio(), cam, M };
      // Largeurs « à l'écran » du monde illustré (plages, ombres, lignes d'eau) : échelle de l'affichage final.
      this.flat.displayPxPerDeg = OrnamentLayer.pxPerDeg(ornView, cfg);
      this.flat.render(r, this.physics, interpolation, this.coverage, world, cfg, wall, this.worldTarget);
      this.ships.draw(r, now, world, cfg, 1, this.worldTarget);
      const opts = this.whaleOptions(cfg, this.flat.displayPxPerDeg, world.scale / this.flat.displayPxPerDeg, scene.scale, [facingLat, this.globeCtl.facingLon]);
      if (opts) this.whales?.draw(r, world, cfg, opts, this.coverage, wall, this.worldTarget);
      this.globe.render(r, this.worldTarget.texture, gm, cam, M, cfg, size.x, size.y, wall);
      if (!this.globe.calibration) {
        this.ornaments?.draw(r, ornView, cfg, wall);
        if (cfg.physics.enabled) this.whales?.drawGlyphs(r, ornView, cfg, wall);
        this.lieux.draw(r, ornView, cfg, wall);
      }
      this.lastGlobe = { mode: gm, cam, M, w: size.x, h: size.y };
      if (gm !== 'equirect') listener = globeListener(facingLat, this.globeCtl.facingLon);
    }
    this.gpu.end();

    this.audio.update(now, cfg, listener, this.ships, this.field, this.whales?.drainEvents() ?? [], scene.scale);
    if (now - this.lastCursorRead > 250) {
      this.lastCursorRead = now;
      if (this.hud.visible) this.cursorInfo = this.readCursor();
      const geo = this.cursorGeo();
      const world = geo && this.science.wantsLevels && cfg.physics.enabled ? this.physics.readComponents(r, geo.lat, geo.lon, cfg) : null;
      this.science.update(geo, world, cfg, this.sourceStatus);
      this.card.update();
      this.legend.update(cfg, scene.scale, this.sceneAgeSec, cfg.noise.warmupMinutes * Math.sign(this.warmupTotal), this.warmupLeft === 0, scene.stale);
    }
    this.hud.frame(dt, performance.now() - t0, this.gpu.lastMs, () => ({
      calibration: `vérification numérique ${this.calibration.maxDeviationDb.toFixed(1)} dB d'écart à la loi en 1/r (ne valide pas les niveaux en mer)${cfg.physics.enabled ? '' : ' (champ désactivé)'}   B : ${['rendu', 'indice visuel accumulé', 'basse', 'moyenne', 'haute'][this.flat.debugField]}`,
      cursor: this.cursorInfo,
      whales: this.whaleLine(),
      audio: this.audio.status,
      status: this.sourceStatus,
      connected: this.connected,
      ships: this.ships.shipCount,
      simTime: new Date(scene.timeMs),
      timeScale: scene.scale,
      simSize: `${this.physics.width}×${this.physics.height} · ${(this.physics.cellMeters / 1000).toFixed(1)} km/cellule · pas ${this.physics.stepSeconds.toFixed(2)} s simulées`,
      steps,
      canvas: flatMode
        ? `${size.x}×${size.y}   carte plate, zoom ×${this.nav.zoom.toFixed(1)} (${view.centerLon.toFixed(1)}°, ${view.centerLat.toFixed(1)}°)`
        : `${size.x}×${size.y}   ${mode} (texture monde ${this.profile.worldTextureWidth}), face au public ${this.globeCtl.facingLatFor(cfg).toFixed(0)}°, ${this.globeCtl.facingLon.toFixed(0)}°${this.globe.calibration ? '   MIRE' : ''}`,
      target: cfg.display.target,
      quality: cfg.display.quality,
    }));
  }
}
