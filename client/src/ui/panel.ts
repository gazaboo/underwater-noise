/**
 * Panneau de réglage caché (touche P), construit avec Tweakpane.
 * Les réglages s'appliquent en direct ; « Enregistrer » les écrit dans config/local.json5
 * via le serveur (ils survivent donc au redémarrage).
 */
import { Pane, type FolderApi } from 'tweakpane';
import type { Config } from '@vacarme/shared';

export class Panel {
  private pane: Pane | null = null;
  private visible = false;

  /**
   * @param getConfig configuration éditable (objet vivant, modifié en place)
   * @param onChange appelé après chaque modification
   * @param onSave enregistre les réglages ; renvoie un message d'état
   */
  constructor(
    private readonly getConfig: () => Config,
    private readonly onChange: (path: string) => void,
    private readonly onSave: () => Promise<string>,
  ) {}

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) this.build();
    else this.destroy();
  }

  /** Reconstruit le panneau (par exemple après un rechargement de la configuration). */
  refresh(): void {
    if (this.visible) {
      this.destroy();
      this.build();
    }
  }

  private destroy(): void {
    this.pane?.dispose();
    this.pane = null;
  }

  private build(): void {
    const cfg = this.getConfig();
    const pane = new Pane({ title: 'La carte du vacarme — réglages' });
    this.pane = pane;
    const on = (f: FolderApi | Pane, path: string) => f.on('change', () => this.onChange(path));

    const disp = pane.addFolder({ title: 'Affichage' });
    disp.addBinding(cfg.display, 'target', { label: 'cible', options: { 'écran du portable': 'screen', projecteur: 'projector' } });
    disp.addBinding(cfg.display, 'quality', { label: 'profil', options: { expo: 'expo', léger: 'light' } });
    disp.addBinding(cfg.render, 'renderScale', { label: 'échelle de rendu', min: 0.25, max: 2, step: 0.05 });
    on(disp, 'display');

    const waves = pane.addFolder({ title: 'Ondes' });
    waves.addBinding(cfg.waves, 'courant', { label: 'vitesse', min: 0.05, max: 0.67, step: 0.01 });
    waves.addBinding(cfg.waves, 'damping', { label: 'amortissement', min: 0, max: 0.05, step: 0.0005 });
    waves.addBinding(cfg.waves, 'coastDamping', { label: 'absorption côtes', min: 0, max: 1, step: 0.01 });
    waves.addBinding(cfg.waves.pulse, 'wavelengthCells', { label: 'longueur d\'onde', min: 3, max: 40, step: 0.5 });
    waves.addBinding(cfg.waves.pulse, 'cycles', { label: 'cycles / impulsion', min: 0.5, max: 6, step: 0.1 });
    waves.addBinding(cfg.waves.pulse, 'rate', { label: 'impulsions / s', min: 0.02, max: 3, step: 0.01 });
    waves.addBinding(cfg.waves.pulse, 'gain', { label: 'gain', min: 0, max: 10, step: 0.05 });
    waves.addBinding(cfg.waves.amplitude, 'slMin', { label: 'SL min (dB)', min: 120, max: 200, step: 1 });
    waves.addBinding(cfg.waves.amplitude, 'slMax', { label: 'SL max (dB)', min: 140, max: 220, step: 1 });
    waves.addBinding(cfg.waves.amplitude, 'gamma', { label: 'compression', min: 0.1, max: 5, step: 0.05 });
    waves.addBinding(cfg.waves, 'brightness', { label: 'luminosité', min: 0, max: 20, step: 0.1 });
    waves.addBinding(cfg.waves, 'relief', { label: 'relief / reflets', min: 0, max: 1, step: 0.01 });
    waves.addBinding(cfg.waves, 'shallowSpeed', { label: 'réfraction (plateaux)', min: 0.2, max: 1, step: 0.01 });
    on(waves, 'waves');

    const acc = pane.addFolder({ title: 'Accumulation (bruit durable)' });
    acc.addBinding(cfg.accumulation, 'quietDb', { label: 'seuil du noir (dB)', min: 80, max: 130, step: 0.5 });
    acc.addBinding(cfg.accumulation, 'saturationDb', { label: 'saturation (dB)', min: 90, max: 150, step: 0.5 });
    acc.addBinding(cfg.accumulation, 'gamma', { min: 0.2, max: 5, step: 0.05 });
    acc.addBinding(cfg.accumulation, 'strength', { label: 'intensité', min: 0, max: 4, step: 0.01 });
    acc.addBinding(cfg.accumulation, 'riseMinutes', { label: 'montée (min)', min: 0.05, max: 60, step: 0.05 });
    acc.addBinding(cfg.accumulation, 'fallMinutes', { label: 'décrue (min)', min: 0.05, max: 240, step: 0.5 });
    acc.addBinding(cfg.accumulation.bandWeights, 'low', { label: 'poids bande basse', min: 0, max: 1, step: 0.01 });
    acc.addBinding(cfg.accumulation.bandWeights, 'mid', { label: 'poids bande moyenne', min: 0, max: 1, step: 0.01 });
    acc.addBinding(cfg.accumulation.bandWeights, 'high', { label: 'poids bande haute', min: 0, max: 1, step: 0.01 });
    acc.addBinding(cfg.palette, 'glow', { label: 'couleur', view: 'color' });
    on(acc, 'accumulation');

    const inc = pane.addFolder({ title: 'Terra incognita', expanded: false });
    inc.addBinding(cfg.palette, 'unknownDim', { label: 'luminosité', min: 0, max: 1, step: 0.01 });
    inc.addBinding(cfg.incognita, 'fog', { label: 'brouillard', min: 0, max: 1, step: 0.01 });
    inc.addBinding(cfg.incognita, 'scaleDeg', { label: 'échelle (°)', min: 0.5, max: 60, step: 0.5 });
    inc.addBinding(cfg.incognita, 'drift', { label: 'dérive', min: 0, max: 5, step: 0.05 });
    inc.addBinding(cfg.incognita, 'grain', { min: 0, max: 1, step: 0.01 });
    inc.addBinding(cfg.incognita, 'waveKeep', { label: 'ondes dans l\'ombre', min: 0, max: 1, step: 0.01 });
    inc.addBinding(cfg.palette, 'fog', { label: 'couleur', view: 'color' });
    on(inc, 'incognita');

    const wh = pane.addFolder({ title: 'Cétacés', expanded: false });
    wh.addBinding(cfg.whales, 'enabled', { label: 'visibles' });
    wh.addBinding(cfg.whales, 'color', { label: 'couleur', view: 'color' });
    wh.addBinding(cfg.whales.space, 'fill', { label: 'remplissage', min: 0, max: 1, step: 0.01 });
    wh.addBinding(cfg.whales.space, 'contour', { label: 'contour', min: 0, max: 1, step: 0.01 });
    wh.addBinding(cfg.whales.space, 'softnessDb', { label: 'douceur (dB)', min: 0.5, max: 40, step: 0.5 });
    wh.addBinding(cfg.whales.space, 'markerSize', { label: 'taille des groupes', min: 0, max: 12, step: 0.1 });
    wh.addBinding(cfg.whales, 'timeScale', { label: 'vitesse de nage ×', min: 0, max: 300, step: 1 });
    wh.addBinding(cfg.whales.links, 'enabled', { label: 'liens' });
    wh.addBinding(cfg.whales.links, 'intensity', { label: 'intensité des fils', min: 0, max: 4, step: 0.01 });
    wh.addBinding(cfg.whales.links, 'ghost', { label: 'trace fantôme', min: 0, max: 1, step: 0.01 });
    wh.addBinding(cfg.whales.links, 'pulseSpeed', { label: 'vitesse des appels', min: 0.02, max: 3, step: 0.01 });
    wh.addBinding(cfg.whales.links, 'breakSec', { label: 'rupture (s)', min: 0.5, max: 60, step: 0.5 });
    wh.addBinding(cfg.whales.links, 'reknitSec', { label: 'reconnexion (s)', min: 0.5, max: 120, step: 0.5 });
    for (const sp of cfg.whales.species) {
      const f = wh.addFolder({ title: sp.name, expanded: false });
      f.addBinding(sp, 'enabled', { label: 'présente' });
      f.addBinding(sp, 'groups', { label: 'groupes', min: 0, max: 200, step: 1 });
      f.addBinding(sp, 'sl', { label: 'niveau source (dB)', min: 120, max: 200, step: 1 });
      f.addBinding(sp, 'dt', { label: 'seuil de détection (dB)', min: -10, max: 30, step: 0.5 });
      f.addBinding(sp, 'visualScale', { label: 'exagération visuelle', min: 1, max: 100, step: 1 });
    }
    on(wh, 'whales');

    const au = pane.addFolder({ title: 'Son', expanded: false });
    au.addBinding(cfg.audio, 'enabled', { label: 'actif' });
    au.addBinding(cfg.audio, 'master', { label: 'volume général', min: 0, max: 1, step: 0.01 });
    au.addBinding(cfg.audio.ships, 'volume', { label: 'navires', min: 0, max: 1, step: 0.01 });
    au.addBinding(cfg.audio.ships, 'voices', { label: 'voix de navires', min: 0, max: 32, step: 1 });
    au.addBinding(cfg.audio.ships, 'transposeOctaves', { label: 'transposition (octaves)', min: -1, max: 4, step: 0.5 });
    au.addBinding(cfg.audio.ships, 'edgeAttenuationDb', { label: 'centre / bord (dB)', min: 0, max: 60, step: 1 });
    au.addBinding(cfg.audio.bed, 'volume', { label: 'nappe', min: 0, max: 1, step: 0.01 });
    au.addBinding(cfg.audio.whales, 'volume', { label: 'cétacés', min: 0, max: 1, step: 0.01 });
    au.addBinding(cfg.audio.whales, 'voices', { label: 'appels simultanés', min: 0, max: 16, step: 1 });
    on(au, 'audio');

    const pal = pane.addFolder({ title: 'Palette', expanded: false });
    for (const k of ['background', 'oceanShallow', 'oceanDeep', 'land', 'coast', 'wave', 'ship'] as const) {
      pal.addBinding(cfg.palette, k, { view: 'color' });
    }
    pal.addBinding(cfg.palette, 'bathyRelief', { label: 'relief du fond', min: 0, max: 1, step: 0.01 });
    pal.addBinding(cfg.palette, 'coastOpacity', { label: 'trait de côte', min: 0, max: 1, step: 0.01 });
    on(pal, 'palette');

    const rnd = pane.addFolder({ title: 'Rendu', expanded: false });
    rnd.addBinding(cfg.render, 'exposure', { label: 'exposition', min: 0, max: 4, step: 0.01 });
    rnd.addBinding(cfg.render, 'gamma', { min: 0.5, max: 3, step: 0.01 });
    rnd.addBinding(cfg.render, 'blackLift', { label: 'plancher de noir', min: 0, max: 0.2, step: 0.002 });
    rnd.addBinding(cfg.render, 'vignette', { label: 'vignettage', min: 0, max: 1, step: 0.01 });
    rnd.addBinding(cfg.render, 'dither', { label: 'tramage' });
    on(rnd, 'render');

    const view = pane.addFolder({ title: 'Cadrage', expanded: false });
    view.addBinding(cfg.view.flat, 'centerLon', { label: 'longitude centrale', min: -180, max: 180, step: 1 });
    view.addBinding(cfg.view.flat, 'latMin', { label: 'latitude min', min: -90, max: 0, step: 1 });
    view.addBinding(cfg.view.flat, 'latMax', { label: 'latitude max', min: 0, max: 90, step: 1 });
    view.addBinding(cfg.view.flat, 'fit', { label: 'ajustement', options: { remplir: 'cover', contenir: 'contain' } });
    on(view, 'view');

    const ships = pane.addFolder({ title: 'Navires', expanded: false });
    ships.addBinding(cfg.ships, 'visible', { label: 'visibles' });
    ships.addBinding(cfg.ships, 'pointSize', { label: 'taille', min: 0, max: 6, step: 0.1 });
    ships.addBinding(cfg.ships, 'opacity', { label: 'opacité', min: 0, max: 1, step: 0.01 });
    on(ships, 'ships');

    pane.addBlade({ view: 'separator' });
    const status = { état: '' };
    pane.addButton({ title: 'Enregistrer (config/local.json5)' }).on('click', async () => {
      status.état = await this.onSave();
      pane.refresh();
    });
    pane.addBinding(status, 'état', { readonly: true });
  }
}
