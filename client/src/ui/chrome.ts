/**
 * Interface de la carte libre (écran et page web ; jamais sur le dôme) : titre et phrase d'état, commande
 * principale « avec / sans navires », visite guidée, vue (globe ou carte, zoom), son, pastille « on entend »,
 * calques et écran d'accueil.
 *
 * L'état vit dans la configuration : les touches du clavier, le panneau de réglages et ces commandes modifient
 * les mêmes champs. `update()` relit cet état à chaque image et ne touche au DOM que s'il a changé.
 */
import type { Config } from '@vacarme/shared';

import { h, icon } from './dom.ts';
import { NOISE_STYLES, noShips } from './scenario.ts';

export interface Listening {
  /** Ce qu'on entend, en clair : « Baie de Monterey », « Rorqual commun ». */
  label: string;
  /** Part du son qui passe malgré les navires (0 à 1) ; 1 en océan sans navires. */
  clarity: number;
}

export interface ChromeHooks {
  cfg(): Config;
  setShips(mode: Config['source']['ships']): void;
  zoom(factor: number): void;
  storyPlaying(): boolean;
  toggleStory(): void;
  muted(): boolean;
  toggleMute(): void;
  listening(): Listening | null;
  openMethod(): void;
}

const STYLE_NAMES: Record<Config['noise']['style'], string> = { brume: 'Brume', isophones: 'Lignes d\'égal niveau', meteo: 'Paliers', encre: 'Encre', fronts: 'Fronts bruts du modèle' };
const SHIPS_NAMES: Record<Config['source']['ships'], string> = { mixed: 'Suivis et estimés', real: 'Suivis par AIS', estimated: 'Estimés' };

/** Deux boutons exclusifs ; renvoie le groupe et la fonction qui marque le choix courant. */
function segmented<T extends string>(label: string, options: [T, string][], pick: (v: T) => void): { el: HTMLElement; set(v: T): void } {
  const buttons = options.map(([value, text]) => h('button', { type: 'button', 'data-value': value, onclick: () => pick(value) }, text));
  const el = h('div', { class: 'ui-seg', role: 'group', 'aria-label': label }, ...buttons);
  return { el, set: (v) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === v))) };
}

export class Chrome {
  private readonly title = h('p', { class: 'ui-etat' });
  private readonly header = h('header', { id: 'titre' }, h('h1', {}, 'La carte du vacarme'), this.title);
  private readonly scenario = segmented<Config['scenario']>('Trafic maritime', [['actuel', 'Avec navires'], ['sans-navires', 'Sans navires']], (v) => { this.hooks.cfg().scenario = v; });
  private readonly story = h('button', { type: 'button', class: 'ui-primaire', 'data-action': 'story', onclick: () => this.hooks.toggleStory() });
  private readonly bar = h('nav', { id: 'toolbar', 'aria-label': 'Commandes principales' }, this.scenario.el, this.story);
  private readonly mode = segmented<'globe' | 'flat'>('Vue', [['globe', 'Globe'], ['flat', 'Carte']], (v) => { this.hooks.cfg().display.mode = v; });
  private readonly view = h('div', { id: 'vue' }, this.mode.el,
    h('button', { type: 'button', class: 'ui-rond', 'aria-label': 'Zoomer', onclick: () => this.hooks.zoom(1.5) }, icon('plus')),
    h('button', { type: 'button', class: 'ui-rond', 'aria-label': 'Dézoomer', onclick: () => this.hooks.zoom(1 / 1.5) }, icon('moins')));
  private readonly heard = h('div', { id: 'ecoute', hidden: true, 'aria-live': 'polite' });
  private readonly sound = h('button', { type: 'button', class: 'ui-rond', onclick: () => this.hooks.toggleMute() });
  private readonly layers = h('div', { id: 'calques', hidden: true, role: 'dialog', 'aria-label': 'Calques' });
  private readonly layersButton = h('button', { type: 'button', class: 'ui-pilule', 'aria-expanded': 'false', onclick: () => this.toggleLayers() }, icon('calques'), 'Calques');
  private readonly tools = h('div', { id: 'outils' }, this.heard, this.sound, this.layersButton, this.layers);
  private welcome: HTMLElement | null = null;
  /** Légende affichée : en permanence sur un grand écran, à la demande sur un téléphone. */
  private legend = innerWidth >= 860;
  private key = '';
  private heardKey = '';

  constructor(private readonly hooks: ChromeHooks, welcome: boolean) {
    document.body.append(this.header, this.tools, this.bar, this.view);
    this.buildLayers();
    if (welcome) this.showWelcome();
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.toggleLayers(false); });
    addEventListener('pointerdown', (e) => {
      if (!this.layers.hidden && e.target instanceof Node && !this.tools.contains(e.target)) this.toggleLayers(false);
    }, { capture: true });
  }

  /** Vrai tant que l'écran d'accueil est affiché. */
  get welcoming(): boolean {
    return this.welcome !== null;
  }

  private showWelcome(): void {
    const leave = (tour: boolean) => {
      this.welcome?.remove();
      this.welcome = null;
      document.body.classList.remove('accueil-on');
      if (tour && !this.hooks.storyPlaying()) this.hooks.toggleStory();
    };
    this.welcome = h('section', { id: 'accueil', 'aria-label': 'Accueil' },
      h('div', { class: 'ac-texte' },
        h('h1', {}, 'La carte du vacarme'),
        h('p', { class: 'ac-accroche' }, 'Sous la surface, les baleines se parlent à des dizaines, parfois des centaines de kilomètres. Le bruit des navires couvre leurs voix.'),
        h('div', { class: 'ac-choix' },
          h('button', { type: 'button', class: 'ui-primaire', 'data-action': 'visite', onclick: () => leave(true) }, icon('lecture', 18), 'Commencer la visite'),
          h('button', { type: 'button', class: 'ui-secondaire', 'data-action': 'explorer', onclick: () => leave(false) }, 'Explorer librement')),
        h('p', { class: 'ac-note' }, 'Le son démarre avec votre choix. Casque ou enceintes conseillés.')));
    document.body.classList.add('accueil-on');
    document.body.append(this.welcome);
  }

  private toggleLayers(force?: boolean): void {
    const open = force ?? this.layers.hidden;
    this.layers.hidden = !open;
    this.layersButton.setAttribute('aria-expanded', String(open));
  }

  /** Interrupteur : case à cocher native, libellé explicite. */
  private check(label: string, hint: string, read: (c: Config) => boolean, write: (c: Config, on: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox', onchange: () => write(this.hooks.cfg(), input.checked) });
    this.sync.push((c) => { input.checked = read(c); });
    return h('label', { class: 'cq-ligne' }, input, h('span', {}, label, hint ? h('small', {}, hint) : null));
  }

  private select<T extends string>(label: string, names: Record<T, string>, order: T[], read: (c: Config) => T, write: (c: Config, v: T) => void): HTMLElement {
    const sel = h('select', { onchange: () => write(this.hooks.cfg(), sel.value as T) }, ...order.map((v) => h('option', { value: v }, names[v])));
    this.sync.push((c) => { sel.value = read(c); });
    return h('label', { class: 'cq-choix' }, h('span', {}, label), sel);
  }

  private readonly sync: ((c: Config) => void)[] = [];

  private buildLayers(): void {
    this.layers.append(
      h('h2', {}, 'Calques'),
      this.check('Bruit des navires', 'Masqué, il reste calculé : les baleines l\'entendent toujours.', (c) => c.noise.visible, (c, on) => { c.noise.visible = on; }),
      this.check('Légende', '', () => this.legend, (_, on) => { this.legend = on; if (on) this.toggleLayers(false); }),
      this.check('Lieux à écouter', '', (c) => c.lieux.enabled, (c, on) => { c.lieux.enabled = on; }),
      this.check('Palette de jour', 'La nuit est celle de l\'installation projetée.', (c) => c.display.theme === 'day', (c, on) => { c.display.theme = on ? 'day' : 'night'; }),
      h('h3', {}, 'Réglages avancés'),
      this.select('Dessin du bruit', STYLE_NAMES, NOISE_STYLES, (c) => c.noise.style, (c, v) => { c.noise.style = v; }),
      this.select('Navires', SHIPS_NAMES, ['mixed', 'real', 'estimated'], (c) => c.source.ships, (_, v) => this.hooks.setShips(v)),
      h('button', { type: 'button', class: 'ui-lien', onclick: () => { this.toggleLayers(false); this.hooks.openMethod(); } }, 'Méthode et fiabilité'),
    );
  }

  /** À chaque image : met le DOM à jour si l'état a changé (clavier, panneau, parcours ou commandes). */
  update(): void {
    const c = this.hooks.cfg();
    const dome = c.display.mode !== 'flat' && c.display.mode !== 'globe';
    const playing = this.hooks.storyPlaying();
    const muted = this.hooks.muted();
    const key = [dome, c.display.target, c.scenario, c.display.mode, c.display.theme, c.noise.visible, c.noise.style, c.lieux.enabled, c.source.ships, playing, muted, this.legend].join('|');
    if (key !== this.key) {
      this.key = key;
      document.body.classList.toggle('dome', dome || c.display.target === 'projector');
      document.body.classList.toggle('legende-off', !this.legend);
      this.scenario.set(c.scenario);
      if (!dome) this.mode.set(c.display.mode as 'globe' | 'flat');
      this.title.textContent = noShips(c) ? 'Océan sans navires, calculé par le modèle' : `Aujourd'hui, avec le trafic maritime${c.noise.visible ? '' : ' · bruit masqué'}`;
      this.story.replaceChildren(icon(playing ? 'fermer' : 'lecture', 18), playing ? 'Quitter la visite' : 'Visite guidée');
      this.sound.replaceChildren(icon(muted ? 'muet' : 'son'));
      this.sound.setAttribute('aria-label', muted ? 'Rétablir le son' : 'Couper le son');
      this.sound.setAttribute('aria-pressed', String(muted));
      for (const s of this.sync) s(c);
    }
    const l = muted || this.welcome ? null : this.hooks.listening();
    const bars = l ? Math.max(0, Math.min(5, Math.round(l.clarity * 5))) : 0;
    const heardKey = l ? `${l.label}|${bars}` : '';
    if (heardKey === this.heardKey) return;
    this.heardKey = heardKey;
    this.heard.hidden = !l;
    if (!l) return;
    const meter = h('span', { class: 'ec-jauge', role: 'img', 'aria-label': `Clarté : ${bars} sur 5` }, ...Array.from({ length: 5 }, (_, i) => h('i', { class: i < bars ? 'on' : '' })));
    this.heard.replaceChildren(icon('son', 18), h('span', { class: 'ec-quoi' }, h('small', {}, 'On entend'), l.label), meter,
      h('small', { class: 'ec-etat' }, bars >= 5 ? 'clair' : bars >= 3 ? 'voilé par les navires' : 'étouffé par les navires'));
  }
}
