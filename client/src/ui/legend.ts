import { SOUND_SPEED_M_S, type Config } from '@vacarme/shared';

/**
 * Légende permanente, lisible de loin : ce que montre la nappe de bruit (bande, paliers, lignes), ce que
 * signifient les hachures, la couleur de chaque espèce, et l'état de l'histoire acoustique.
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
  /** État de l'histoire acoustique (contrôlé par la vérification de propagation). */
  private readonly status = document.createElement('div');
  private key = '';

  constructor() {
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
    this.tags.textContent = 'Forme et niveaux : calculés [C], non validés en mer · paliers, couleurs, mouvement : choix graphiques [A]';
    this.element.append(this.title, this.band, this.steps, this.style, this.unknown, this.species, this.tags, this.status);
    document.body.append(this.element);
  }

  /** `cfg` déjà thématisé (palette du jour appliquée) ; `ageSec` : histoire simulée après le préchauffage. */
  update(cfg: Config, scale: number, ageSec: number, warmupMin: number, warmupDone: boolean, stale: boolean): void {
    const mode = cfg.display.mode;
    this.element.hidden = mode === 'hemisphere' || mode === 'equirect' || mode === 'fisheye';
    this.element.classList.toggle('projector', cfg.display.target === 'projector');
    this.element.classList.toggle('day', cfg.display.theme === 'day');
    const n = cfg.noise;
    const p = cfg.palette;
    const key = JSON.stringify([n.style, n.steps, n.lineStepDb, cfg.waves.band, p.noiseLow, p.noiseMid, p.noiseHigh, p.fog, cfg.whales.species.map(s => [s.enabled, s.color, s.name, s.band])]);
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
    const swatch = (color: string, label: string, sub: string) => `<span class="lg-step"><i style="background:${color}"></i><b>+${label} dB</b><small>${sub}</small></span>`;
    this.steps.innerHTML = n.style === 'fronts'
      ? `<span class="lg-step"><i style="background:${p.wave}"></i><b>fronts</b><small>visibles de +1 à +10 dB</small></span>`
      : swatch(p.noiseLow, String(a), energy(a)) + swatch(p.noiseMid, String(b), energy(b)) + swatch(p.noiseHigh, String(c), energy(c));
    this.style.textContent = {
      isophones: `Lignes : une tous les ${n.lineStepDb} dB (énergie ×${(10 ** (n.lineStepDb / 10)).toFixed(1).replace('.', ',')}). Leur défilement montre le sens de propagation, pas sa vitesse.`,
      meteo: 'Traits : limites des paliers. Carte immobile, moyenne lissée.',
      encre: 'Traînées d\'encre émises par les navires : elles descendent la pente du bruit.',
      fronts: 'Fronts bruts du modèle : leur espacement (≈ 234 km) est numérique, sans signification acoustique.',
    }[n.style];
    this.unknown.innerHTML = `<i class="lg-hatch" style="--c:${p.fog}"></i>Hachures : jamais observé par l'AIS, bruit sous-estimé`;
    this.species.innerHTML = cfg.whales.species.filter(s => s.enabled).map(s => {
      const sb = cfg.bands.find(x => x.id === s.band)!;
      return `<span><i style="background:${s.color ?? cfg.whales.color}"></i>${s.name} <small>${sb.fMin}–${sb.fMax} Hz</small></span>`;
    }).join('');
  }
}
