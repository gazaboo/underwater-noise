/**
 * Fiche ouverte au clic (ou au toucher) : sur un groupe de cétacés, photo, faits étiquetés, portée de
 * communication du groupe choisi ; sur un lieu, son texte et sa paire de contraste. Dans les deux cas, les vrais
 * enregistrements avec leur spectrogramme, et les crédits.
 *
 * Données : data/fiches/especes.json et data/media/catalog.json (schémas dans shared/src/media-schema.ts).
 * Chaque valeur affiche son statut ([S], [S-r], [C]…) ; la source est dans l'infobulle et en bas de fiche.
 */
import { FACT_LABELS, STATUS_LABELS, type Config, type Lieu, type MediaItem, type SoundItem, type SpeciesCard as CardData, type ValueStatus } from '@vacarme/shared';
import { dataUrl } from '../data-url.ts';
import type { WhaleGroup } from '../whales/agents.ts';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const badge = (status: ValueStatus, source = ''): string =>
  `<span class="fc-badge" title="${esc(`${STATUS_LABELS[status]}${source ? ` — ${source}` : ''}`)}">${status}</span>`;
const km = (m: number): string => `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10_000 ? 1 : 0 })} km`;

export class SpeciesCardPanel {
  readonly element = document.createElement('aside');
  private cards = new Map<string, CardData>();
  private media = new Map<string, MediaItem>();
  private group: WhaleGroup | null = null;
  private range: HTMLElement | null = null;
  private player: HTMLAudioElement | null = null;
  private raf = 0;

  constructor() {
    this.element.id = 'fiche';
    this.element.hidden = true;
    this.element.setAttribute('aria-live', 'polite');
    for (const event of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'dblclick']) this.element.addEventListener(event, (e) => e.stopPropagation());
    document.body.append(this.element);
    void this.load();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  private async load(): Promise<void> {
    try {
      const [cards, catalog] = await Promise.all([
        fetch(dataUrl('fiches/especes.json')).then((r) => (r.ok ? r.json() : null)),
        fetch(dataUrl('media/catalog.json')).then((r) => (r.ok ? r.json() : null)),
      ]);
      for (const c of (cards?.species ?? []) as CardData[]) this.cards.set(c.id, c);
      for (const m of (catalog?.items ?? []) as MediaItem[]) this.media.set(m.id, m);
    } catch {
      /* fiches indisponibles : le clic n'ouvre rien */
    }
  }

  /** Ouvre la fiche d'un groupe ; renvoie faux si l'espèce n'a pas de fiche. */
  open(group: WhaleGroup, cfg: Config): boolean {
    const card = this.cards.get(group.species.id);
    if (!card) return false;
    this.stopSound();
    this.group = group;
    const photo = card.photos.map((id) => this.media.get(id)).find((m) => m?.kind === 'photo');
    const sounds = card.sounds.map((id) => this.media.get(id)).filter((m): m is SoundItem => m?.kind === 'son');
    const facts = (Object.keys(FACT_LABELS) as (keyof typeof FACT_LABELS)[])
      .filter((k) => card.facts[k])
      .map((k) => {
        const f = card.facts[k];
        return `<dt>${FACT_LABELS[k]}</dt><dd>${esc(String(f.value))}${f.unit ? ` ${esc(f.unit)}` : ''} ${badge(f.status, f.source)}</dd>`;
      })
      .join('');
    const color = group.species.color ?? cfg.whales.color;
    const transpose = cfg.audio.whales.transpose[group.species.id] ?? 1;
    const sources = [...new Set(Object.values(card.facts).map((f) => f.source))];
    this.element.style.setProperty('--sp', color);
    this.element.innerHTML = `
      <button type="button" class="fc-close" aria-label="Fermer la fiche">×</button>
      ${photo && photo.kind === 'photo' ? `<figure><img src="${dataUrl(`media/${photo.files.image}`)}" width="${photo.width}" height="${photo.height}" alt="${esc(photo.title)}"><figcaption>${esc(photo.credit)}</figcaption></figure>` : ''}
      <h2>${esc(card.name)} <small>${esc(card.latin)}</small></h2>
      <p class="fc-note">Un groupe affiché est une présence plausible, pas un animal suivi : une vraie espèce, dans un habitat où on la sait présente, près d'endroits où elle a été vue ${badge('A', 'docs/REPRESENTATION.md, « Ce que représentent les cétacés »')}</p>
      <section class="fc-range"></section>
      <dl>${facts}</dl>
      ${soundsHtml(sounds, transpose)}
      <details class="fc-credits"><summary>Sources et crédits</summary>
        <ul>${[...sources, ...sounds.map((s) => s.credit), ...(photo ? [photo.credit] : [])].map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        <p>Statuts : ${(['S', 'S-r', 'C', 'A'] as ValueStatus[]).map((s) => `${badge(s)} ${STATUS_LABELS[s]}`).join(' · ')}</p>
      </details>`;
    this.range = this.element.querySelector('.fc-range');
    this.show(sounds, color, transpose);
    this.update();
    return true;
  }

  /** Ouvre la fiche d'un lieu : texte, paire de contraste, vrais enregistrements, sources. */
  openLieu(lieu: Lieu, cfg: Config): void {
    this.stopSound();
    this.group = null;
    this.range = null;
    const sounds = lieu.sounds.map((id) => this.media.get(id)).filter((m): m is SoundItem => m?.kind === 'son');
    const order = lieu.contrast ? [lieu.contrast.quiet, lieu.contrast.noisy] : [];
    sounds.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
    const color = cfg.lieux.color;
    this.element.style.setProperty('--sp', color);
    this.element.innerHTML = `
      <button type="button" class="fc-close" aria-label="Fermer la fiche">×</button>
      <h2>${esc(lieu.title)} <small>${Math.abs(lieu.center.lat).toFixed(1)}° ${lieu.center.lat >= 0 ? 'N' : 'S'}, ${Math.abs(lieu.center.lon).toFixed(1)}° ${lieu.center.lon >= 0 ? 'E' : 'O'}</small></h2>
      <p>${esc(lieu.text)} ${badge(lieu.status, lieu.source)}</p>
      <p class="fc-note">On entend ce lieu en approchant le centre de la vue ; le bruit des navires au même endroit l'étouffe ou le hache ${badge('A', 'même métaphore que pour les appels des cétacés (docs/REVUE_SCIENTIFIQUE.md §8)')}</p>
      ${lieu.contrast ? `<section class="fc-contrast"><h3>Écouter la différence</h3><p class="fc-note">${esc(lieu.contrast.text)}</p></section>` : ''}
      ${soundsHtml(sounds, lieu.playbackRate ?? 1)}
      <details class="fc-credits"><summary>Sources et crédits</summary>
        <ul>${[lieu.source, ...new Set(sounds.map((s) => s.credit))].map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </details>`;
    this.show(sounds, color, lieu.playbackRate ?? 1);
  }

  private show(sounds: SoundItem[], color: string, transpose: number): void {
    this.element.querySelector('.fc-close')!.addEventListener('click', () => this.close());
    sounds.forEach((s, i) => {
      const canvas = this.element.querySelector<HTMLCanvasElement>(`[data-spectro="${i}"]`)!;
      void paintSpectrogram(canvas, dataUrl(`media/${s.spectrogram.file}`), color);
      this.element.querySelector<HTMLButtonElement>(`[data-sound="${i}"]`)!.addEventListener('click', (e) =>
        this.toggleSound(e.currentTarget as HTMLButtonElement, s, transpose, canvas.parentElement!.querySelector('i')!));
    });
    this.element.scrollTop = 0;
    this.element.hidden = false;
    document.body.classList.add('fiche-open');
  }

  close(): void {
    this.stopSound();
    this.element.hidden = true;
    this.group = null;
    document.body.classList.remove('fiche-open');
  }

  /** Portée du groupe choisi, mise à jour en continu (le bruit change). */
  update(): void {
    if (!this.group || !this.range || this.element.hidden) return;
    const g = this.group;
    const ratio = Math.max(0, Math.min(1, g.rangeM / Math.max(1, g.quietRangeM)));
    this.range.innerHTML = `
      <h3>Ce groupe s'entend jusqu'à</h3>
      <div class="fc-bar" role="img" aria-label="Portée actuelle : ${Math.round(100 * ratio)} % de la portée en océan calme"><i style="width:${(100 * ratio).toFixed(1)}%"></i></div>
      <p><b>${km(g.rangeM)}</b> avec le trafic actuel ${badge('C', 'équation du sonar, bruit du modèle au point du groupe')}
        · <b>${km(g.quietRangeM)}</b> en océan sans navires ${badge('C', 'même calcul, fond naturel seul')}</p>
      <p class="fc-note">Bornes hautes : le rapport entre les deux (${Math.round(100 * ratio)} %) est plus robuste que les distances elles-mêmes (docs/REVUE_SCIENTIFIQUE.md §6.4).${g.coverage < 0.2 ? ' Zone mal vue par l\'AIS : bruit sous-estimé.' : ''}</p>`;
  }

  private toggleSound(button: HTMLButtonElement, s: SoundItem, transpose: number, cursor: HTMLElement): void {
    if (this.player) {
      const same = this.player.dataset.id === s.id;
      this.stopSound();
      if (same) return;
    }
    const audio = new Audio();
    const ogg = audio.canPlayType('audio/ogg; codecs="opus"') !== '';
    audio.src = dataUrl(`media/${ogg ? s.files.ogg : s.files.m4a}`);
    audio.dataset.id = s.id;
    // Transposition des infrasons : hauteur et durée ensemble, comme les appels de la carte.
    audio.preservesPitch = false;
    audio.playbackRate = transpose;
    audio.onended = () => this.stopSound();
    this.player = audio;
    button.textContent = '■ Arrêter';
    const tick = () => {
      if (this.player !== audio) return;
      // Ogg Opus en cours de chargement : Chrome annonce une durée infinie ; on prend celle du catalogue.
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : s.durationSec;
      cursor.style.left = `${Math.min(100, (100 * audio.currentTime) / duration)}%`;
      this.raf = requestAnimationFrame(tick);
    };
    void audio.play().then(tick, () => this.stopSound());
  }

  private stopSound(): void {
    cancelAnimationFrame(this.raf);
    if (this.player) {
      this.player.pause();
      this.player = null;
    }
    for (const b of this.element.querySelectorAll<HTMLButtonElement>('[data-sound]')) b.textContent = '▶ Écouter';
    for (const c of this.element.querySelectorAll<HTMLElement>('.fc-spectro i')) c.style.left = '0';
  }
}

/** Sons avec spectrogramme, curseur, provenance et transformations (dont celles faites par la source). */
function soundsHtml(sounds: SoundItem[], transpose: number): string {
  return sounds.map((s, i) => {
    const bySource = s.transforms.filter((x) => x.op === 'par la source').map((x) => x.detail);
    return `
        <section class="fc-sound">
          <button type="button" data-sound="${i}">▶ Écouter</button> <span>${esc(s.title)}</span>
          <div class="fc-spectro"><canvas width="640" height="160" data-spectro="${i}"></canvas><i></i>
            <small class="fc-axis">${s.spectrogram.fMaxHz.toLocaleString('fr-FR')} Hz</small><small class="fc-axis fc-low">${s.spectrogram.fMinHz} Hz · ${s.durationSec.toLocaleString('fr-FR')} s</small></div>
          <p class="fc-note">${esc(s.origin.place)}${s.origin.recordedAt ? `, ${esc(s.origin.recordedAt.slice(0, 10))}` : ''} · spectrogramme du fichier diffusé par la source ${badge('S', s.credit)}
          ${bySource.length ? `<br>${esc(bySource.join(' ; '))} ${badge('A', 'transformation faite par la source, avant nous')}` : ''}
          ${transpose !== 1 ? `<br>Lu ×${transpose} : plus aigu et plus court, pour être audible ${badge('A', 'transposition à la lecture (audio.whales.transpose ou playbackRate du lieu)')}` : ''}
          ${s.notes ? `<br>${esc(s.notes)}` : ''}</p>
        </section>`;
  }).join('');
}

/** Spectrogramme en niveaux de gris → teinte de l'espèce sur fond sombre. */
async function paintSpectrogram(canvas: HTMLCanvasElement, url: string, color: string): Promise<void> {
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  if (!img.naturalWidth) return;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const bg = [8, 16, 24];
  for (let i = 0; i < data.data.length; i += 4) {
    const v = data.data[i] / 255;
    const k = v * v; // contraste : le fond reste sombre
    for (let j = 0; j < 3; j++) data.data[i + j] = bg[j] + (c[j] - bg[j]) * k;
  }
  ctx.putImageData(data, 0, 0);
}
