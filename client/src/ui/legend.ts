import { SOUND_SPEED_M_S, type Config } from '@vacarme/shared';

import { h } from './dom.ts';

/**
 * Légende à trois niveaux de lecture. (1) Toujours visible : les paliers du bruit et la couleur de chaque
 * espèce, en mots simples. (2) « Comprendre la carte » : la bande, le dessin de la nappe, les hachures, l'origine
 * des sons, le statut de chaque information [C]/[E]/[A] et l'état de l'histoire acoustique. (3) « Méthode et
 * fiabilité » : le panneau des niveaux calculés et de la validation (ui/science.ts).
 * Chaque information passe aussi par le texte ou la forme, jamais par la couleur seule.
 * Masquée dans les modes de projection (demi-sphère, équirect, fisheye) : ses coins tomberaient hors du dôme.
 */
export class Legend {
  private readonly element = document.createElement('aside');
  private readonly title = document.createElement('div');
  private readonly band = document.createElement('div');
  private readonly steps = document.createElement('div');
  private readonly style = document.createElement('div');
  private readonly unknown = document.createElement('div');
  private readonly species = document.createElement('div');
  private readonly tags = document.createElement('div');
  /** Origine des sons et transformations (crédits des enregistrements). */
  private readonly sound = document.createElement('div');
  /** État de l'histoire acoustique (contrôlé par la vérification de propagation). */
  private readonly status = document.createElement('div');
  private readonly more = h('div', { class: 'lg-more' });
  private readonly expand = h('button', { type: 'button', class: 'ui-lien', 'aria-expanded': 'false', onclick: () => this.toggle() }, 'Comprendre la carte');
  private key = '';

  /** `onMethod` : ouvre le troisième niveau (méthode et fiabilité). */
  constructor(onMethod: () => void) {
    this.element.id = 'legend';
    this.status.id = 'propagation';
    this.title.className = 'lg-title';
    this.title.textContent = 'Bruit ajouté par les navires';
    this.band.className = 'lg-sub';
    this.steps.className = 'lg-steps';
    this.style.className = 'lg-note';
    this.unknown.className = 'lg-row';
    this.species.className = 'lg-species';
    this.tags.className = 'lg-tags';
    this.sound.className = 'lg-note';
    this.tags.textContent = 'Forme et niveaux : calculés [C], non validés en mer · paliers, couleurs, mouvement : choix graphiques [A]';
    this.more.append(this.band, this.style, this.unknown, this.sound, this.tags, this.status);
    this.element.append(this.title, this.steps, this.species, this.more,
      h('div', { class: 'lg-pied' }, this.expand, h('button', { type: 'button', class: 'ui-lien', onclick: onMethod }, 'Méthode et fiabilité')));
    this.element.classList.add('collapsed');
    document.body.append(this.element);
  }

  /** Replie (premier niveau) ou déplie (deuxième niveau) la légende ; renvoie vrai si elle est dépliée. */
  toggle(force?: boolean): boolean {
    const open = !this.element.classList.toggle('collapsed', force === undefined ? undefined : !force);
    this.expand.textContent = open ? 'Réduire' : 'Comprendre la carte';
    this.expand.setAttribute('aria-expanded', String(open));
    return open;
  }

  /** `cfg` déjà thématisé (palette du jour appliquée) ; `ageSec` : histoire simulée après le préchauffage. */
  update(cfg: Config, scale: number, ageSec: number, warmupMin: number, warmupDone: boolean, stale: boolean): void {
    const mode = cfg.display.mode;
    this.element.hidden = mode === 'hemisphere' || mode === 'equirect' || mode === 'fisheye';
    this.element.classList.toggle('projector', cfg.display.target === 'projector');
    this.element.classList.toggle('day', cfg.display.theme === 'day');
    const n = cfg.noise;
    const p = cfg.palette;
    const key = JSON.stringify([n.style, n.visible, cfg.scenario, n.steps, n.lineStepDb, cfg.waves.band, p.noiseLow, p.noiseMid, p.noiseHigh, p.fog, cfg.whales.species.map(s => [s.enabled, s.color, s.name, s.band]), cfg.audio.enabled, cfg.audio.whales.source, cfg.audio.whales.transpose]);
    if (key !== this.key) {
      this.key = key;
      this.build(cfg);
    }
    const warm = warmupMin > 0 ? (warmupDone ? `${warmupMin} min de régime établi supposé [E] + ` : 'calcul du régime établi supposé [E]… · ') : '';
    this.status.textContent = `Temps ×${scale} · c ≈ ${(SOUND_SPEED_M_S / 1000).toLocaleString('fr-FR')} km/s · Historique acoustique incomplet : ${warm}${Math.floor(ageSec / 60)} min simulées${stale ? ' · données interrompues, scène arrêtée' : ''} · sombre ≠ silence${cfg.physics.enabled ? '' : ' · champ désactivé'}`;
  }

  private build(cfg: Config): void {
    const n = cfg.noise;
    const p = cfg.palette;
    const band = cfg.bands.find(b => b.id === cfg.waves.band)!;
    this.band.textContent = `${band.fMin}–${band.fMax} Hz, au-dessus du bruit naturel de la mer (vent ${cfg.ambient.windSpeedMs} m/s)`;
    const [a, b, c] = n.steps;
    const energy = (db: number) => `×${Math.round(10 ** (db / 10)).toLocaleString('fr-FR')}`;
    // En grand, ce que le visiteur peut se représenter (dix fois, cent fois plus d'énergie) ; les décibels en petit.
    const swatch = (color: string, label: string, sub: string) => `<span class="lg-step"><i style="background:${color}"></i><b>${sub}</b><small>+${label} dB</small></span>`;
    this.steps.innerHTML = n.style === 'fronts'
      ? `<span class="lg-step"><i style="background:${p.wave}"></i><b>fronts</b><small>visibles de +1 à +10 dB</small></span>`
      : swatch(p.noiseLow, String(a), energy(a)) + swatch(p.noiseMid, String(b), energy(b)) + swatch(p.noiseHigh, String(c), energy(c));
    this.style.textContent = {
      brume: 'Voile de plus en plus dense avec le bruit. Sous le premier palier, la mer reste telle quelle.',
      isophones: `Lignes : une tous les ${n.lineStepDb} dB (énergie ×${(10 ** (n.lineStepDb / 10)).toFixed(1).replace('.', ',')}). Leur défilement montre le sens de propagation, pas sa vitesse.`,
      meteo: 'Traits : limites des paliers. Carte immobile, moyenne lissée.',
      encre: 'Traînées d\'encre émises par les navires : elles descendent la pente du bruit.',
      fronts: 'Fronts bruts du modèle : leur espacement (≈ 234 km) est numérique, sans signification acoustique.',
    }[n.style];
    this.unknown.innerHTML = `<i class="lg-hatch" style="--c:${p.fog}"></i>Hachures : jamais observé par l'AIS, bruit sous-estimé`;
    this.title.textContent = 'Bruit ajouté par les navires';
    this.band.textContent += '. Paliers : énergie sonore multipliée par 10, 100, 1 000 par rapport à ce bruit naturel.';
    this.steps.hidden = false;
    this.unknown.hidden = cfg.scenario === 'sans-navires';
    if (cfg.scenario === 'sans-navires') {
      this.title.textContent = 'Océan sans navires (modèle)';
      this.band.textContent = `Même calcul, avec le seul bruit naturel de la mer (vent ${cfg.ambient.windSpeedMs} m/s) [C]`;
      this.steps.hidden = true;
      this.style.textContent = 'Les cétacés retrouvent leur portée en océan calme (bornes hautes, surtout pour les rorquals). Touche S : trafic actuel.';
    } else if (!n.visible) {
      this.title.textContent = 'Bruit ajouté par les navires : nappe masquée';
      this.steps.hidden = true;
      this.style.textContent = 'Le calcul continue : les cétacés entendent toujours les navires. Touche V : afficher la nappe.';
    }
    this.species.innerHTML = cfg.whales.species.filter(s => s.enabled).map(s => {
      const sb = cfg.bands.find(x => x.id === s.band)!;
      return `<span><i style="background:${s.color ?? cfg.whales.color}"></i>${s.name} <small>${sb.fMin}–${sb.fMax} Hz</small></span>`;
    }).join('');
    const transposed = cfg.whales.species.filter(s => s.enabled && (cfg.audio.whales.transpose[s.id] ?? 1) !== 1)
      .map(s => `${s.name.toLowerCase()} ×${cfg.audio.whales.transpose[s.id]}`).join(', ');
    this.sound.hidden = !cfg.audio.enabled;
    this.sound.textContent = cfg.audio.whales.source === 'recorded'
      ? `Sons : vrais enregistrements (MBARI, AWI, Orcasound)${transposed ? ` · accélérés pour être audibles : ${transposed} [A]` : ''} · appel étouffé ou haché : image de la portée perdue [A]`
      : 'Sons : appels synthétisés d\'après les fréquences réelles [A]';
  }
}
