/**
 * Lecteur de parcours (prototypes de l'issue #4, data/parcours) : il applique les étapes (caméra, scénario, nappe,
 * fiche), affiche une légende courte lisible de loin, et rend la main au premier geste du visiteur en restaurant
 * l'état d'avant. En boucle d'attraction, il démarre seul après un temps d'inactivité (config `parcours`).
 */
import { parcours as parcoursSchema, parcoursIndex, STATUS_LABELS, type Config, type Lieu, type Parcours, type ParcoursStep } from '@vacarme/shared';
import { dataUrl } from '../data-url.ts';

export interface StoryHooks {
  cfg(): Config;
  /** Caméra vers un point ; `zoom` est celui de la carte plate (1 = carte entière). */
  flyTo(lon: number, lat: number, zoom: number, flySec: number): void;
  /** Rotation automatique du globe suspendue pendant le parcours. */
  hold(on: boolean): void;
  lieu(id: string): Lieu | undefined;
  openLieu(l: Lieu): void;
  /** Ouvre la fiche du groupe de l'espèce le plus proche du centre de la vue. */
  openSpecies(id: string): void;
  closeCard(): void;
}

interface Saved {
  scenario: Config['scenario'];
  noise: boolean;
  mode: Config['display']['mode'];
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class StoryPlayer {
  readonly element = document.createElement('div');
  private list: Parcours[] = [];
  private story: Parcours | null = null;
  private index = 0;
  private t = 0;
  private saved: Saved | null = null;
  private next = 0;
  private pending: string | null = null;

  constructor(private readonly hooks: StoryHooks) {
    this.element.id = 'recit';
    this.element.hidden = true;
    document.body.append(this.element);
    void this.load();
  }

  get playing(): boolean {
    return this.story !== null;
  }

  get ids(): string[] {
    return this.list.map((p) => p.id);
  }

  private async load(): Promise<void> {
    try {
      const index = parcoursIndex.parse(await fetch(dataUrl('parcours/liste.json')).then((r) => r.json()));
      const all = await Promise.all(index.parcours.map((id) =>
        fetch(dataUrl(`parcours/${id}.json`)).then((r) => r.json()).then((j) => parcoursSchema.parse(j)).catch(() => null)));
      this.list = all.filter((p): p is Parcours => !!p);
    } catch {
      this.list = [];
    }
    if (this.pending) this.start(this.pending);
  }

  /** Démarre un parcours (id), ou le suivant de la liste. */
  start(id?: string): void {
    if (!this.list.length) {
      this.pending = id ?? null;
      return;
    }
    this.pending = null;
    const story = id ? this.list.find((p) => p.id === id) : this.list[this.next++ % this.list.length];
    if (!story) return;
    if (!this.story) {
      const cfg = this.hooks.cfg();
      this.saved = { scenario: cfg.scenario, noise: cfg.noise.visible, mode: cfg.display.mode };
    }
    this.story = story;
    // Les légendes du parcours remplacent la légende permanente, qui revient quand le visiteur reprend la main.
    document.body.classList.add('recit-on');
    this.index = 0;
    this.t = 0;
    this.hooks.hold(true);
    this.enter(story.steps[0]);
  }

  /** Arrête le parcours et restaure l'état d'avant ; `keepCard` laisse la fiche ouverte (le visiteur la lit). */
  stop(keepCard = false): void {
    if (!this.story) return;
    this.story = null;
    this.element.hidden = true;
    document.body.classList.remove('recit-on');
    this.hooks.hold(false);
    if (!keepCard) this.hooks.closeCard();
    const cfg = this.hooks.cfg();
    if (this.saved) {
      cfg.scenario = this.saved.scenario;
      cfg.noise.visible = this.saved.noise;
      cfg.display.mode = this.saved.mode;
    }
    this.saved = null;
  }

  update(dtSec: number): void {
    const story = this.story;
    if (!story) return;
    this.t += dtSec;
    const step = story.steps[this.index];
    if (this.t < step.duration) return;
    this.t = 0;
    this.index++;
    if (this.index >= story.steps.length) {
      if (!story.loop) return this.stop();
      this.index = 0;
    }
    this.enter(story.steps[this.index]);
  }

  private enter(step: ParcoursStep): void {
    const cfg = this.hooks.cfg();
    // Le dôme garde son mode ; à l'écran et sur le web, une étape peut demander la carte ou le globe.
    if (step.mode && (cfg.display.mode === 'flat' || cfg.display.mode === 'globe')) cfg.display.mode = step.mode;
    if (step.scenario) cfg.scenario = step.scenario;
    if (step.noise !== undefined) cfg.noise.visible = step.noise;
    if (step.camera) {
      const l = step.camera.lieu ? this.hooks.lieu(step.camera.lieu) : undefined;
      const lon = l?.center.lon ?? step.camera.lon!;
      const lat = l?.center.lat ?? step.camera.lat!;
      this.hooks.flyTo(lon, lat, step.camera.zoom, step.camera.flySec);
    }
    // Sur le dôme, une fiche (panneau HTML) tomberait hors du disque : les légendes portent l'essentiel.
    const dome = cfg.display.mode === 'hemisphere' || cfg.display.mode === 'fisheye' || cfg.display.mode === 'equirect';
    if (step.open === 'fermer' || (dome && step.open)) this.hooks.closeCard();
    else if (step.open?.startsWith('lieu:')) {
      const l = this.hooks.lieu(step.open.slice(5));
      if (l) this.hooks.openLieu(l);
    } else if (step.open?.startsWith('espece:')) this.hooks.openSpecies(step.open.slice(7));
    this.render(step);
  }

  private render(step: ParcoursStep): void {
    const story = this.story!;
    const cfg = this.hooks.cfg();
    const dome = cfg.display.mode === 'hemisphere' || cfg.display.mode === 'fisheye';
    this.element.classList.toggle('dome', dome);
    this.element.classList.toggle('projector', cfg.display.target === 'projector');
    const badge = step.status
      ? ` <span class="rc-badge" title="${esc(`${STATUS_LABELS[step.status]}${step.source ? ` — ${step.source}` : ''}`)}">${step.status}</span>`
      : '';
    this.element.innerHTML = `${step.caption ? `<p class="rc-caption">${esc(step.caption)}${badge}</p>` : ''}
      <p class="rc-meta">${esc(story.title)} · ${this.index + 1}/${story.steps.length} · touchez ou appuyez sur une touche pour reprendre la main</p>`;
    this.element.hidden = false;
  }
}
