import { acousticComponents, validationRegionAt, validationSummarySchema, type Config, type ScienceStatus, type SourceStatus, type ValidationSummary } from '@vacarme/shared';

/**
 * Panneau « Fiabilité » : niveaux calculés par le moteur mondial au curseur (navires, fond naturel,
 * total, augmentation) et, seulement dans une zone mesurée, l'écart publié par la validation.
 * Les lectures ne dépendent ni de la lueur, ni de sa mémoire, ni des pondérations artistiques.
 */
export class SciencePanel {
  readonly element = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly message = document.createElement('p');
  private readonly reading = document.createElement('pre');
  private readonly validation = document.createElement('p');
  private data: ValidationSummary | null = null;
  private request = 0;
  constructor() {
    this.element.id = 'science';
    this.summary.textContent = 'Fiabilité';
    const note = document.createElement('p');
    note.textContent = 'Fronts et niveaux [C] : même champ acoustique estimé, non validé en mer. Espacement des anneaux, visibilité et lueur [A] : conventions graphiques ; aucun seuil biologique. Domaine ±79°, grille de référence ≈ 39 km. Historique acoustique initial incomplet.';
    this.element.append(this.summary, this.message, note, this.reading, this.validation);
    for (const event of ['pointerdown', 'wheel', 'keydown']) this.element.addEventListener(event, e => e.stopPropagation());
    document.body.append(this.element);
    void this.reload();
  }
  get wantsLevels(): boolean { return this.element.open; }
  async reload(): Promise<void> {
    const request = ++this.request;
    try {
      const res = await fetch('/api/science');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { status: ScienceStatus; validation: unknown };
      if (request !== this.request) return;
      this.data = result.validation ? validationSummarySchema.parse(result.validation) : null;
      this.message.textContent = result.status.message;
    } catch {
      if (request !== this.request) return;
      this.data = null;
      this.message.textContent = 'Résumé de validation indisponible : niveaux non validés.';
    }
  }
  update(geo: { lat: number; lon: number } | null, world: number[] | null, cfg: Config, source: SourceStatus | null): void {
    this.summary.textContent = `Fiabilité : ${cfg.science.mode === 'experimental' ? 'profil expérimental' : this.data ? 'non validé · résultats historiques' : 'non validé'}`;
    if (!this.element.open || !geo) return;
    const position = `${geo.lat.toFixed(2)}°, ${geo.lon.toFixed(2)}°`;
    const format = (ships: number | null, ambient: number) => {
      const c = acousticComponents(ships, ambient);
      return `navires ${ships === null ? 'énergie nulle' : `${ships.toFixed(0)} dB`} · fond ${ambient.toFixed(0)} dB\n  total ${c.totalDb.toFixed(0)} dB · augmentation ${c.excessDb.toFixed(1)} dB`;
    };
    const traffic = !source ? 'Source de trafic inconnue.' : source.shipsMode === 'estimated' ? 'Trafic synthétique estimé (GFW).' : source.shipsMode === 'mixed' ? 'AIS + trafic synthétique estimé.' : source.active === 'simulation' ? 'Trafic simulé.' : source.active === 'replay' ? 'AIS historique en replay.' : 'AIS observé ; couverture incomplète, positions éventuellement extrapolées.';
    this.reading.textContent = `${position}\n${world ? cfg.bands.map((b, i) => `${b.fMin}–${b.fMax} Hz : ${format(world[i * 2] === -Infinity ? null : world[i * 2], world[i * 2 + 1])}`).join('\n') : 'Niveaux indisponibles (terre, hors domaine ou champ désactivé).'}\nMoyenne exponentielle τ = ${cfg.physics.energyTauSec} s (temps de la scène). Vent uniforme : ${cfg.ambient.windSpeedMs} m/s [E], scénario.\n${traffic}`;
    this.validation.textContent = 'Comparaisons historiques de la loi au point ; elles ne valident pas les fronts ni ce champ GPU.\n' + validationText(this.data, geo, cfg.science.mode, source);
  }
}

function signed(x: number): string {
  return `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
}

/** Résultats historiques, avec garde contre leur application à un trafic non testé. */
export function validationText(data: ValidationSummary | null, geo: { lat: number; lon: number }, mode: Config['science']['mode'], source: Pick<SourceStatus, 'shipsMode' | 'active'> | null): string {
  if (mode !== 'reference') return 'Profil expérimental : niveaux non validés.';
  if (!source) return 'Source de trafic inconnue : niveaux non validés.';
  if (source.shipsMode !== 'real' || source.active === 'simulation') return 'Trafic synthétique ou mixte : niveaux non validés pour ce trafic. Les résultats publiés concernent uniquement l’AIS observé.';
  const region = validationRegionAt(data, geo.lat, geo.lon);
  if (!region) return 'Hors des points mesurés : niveaux non validés (extrapolation du modèle).';
  return `Station mesurée — ${region.label} (${region.stations.length} station(s), ${region.days} jour(s) [C]) :\n${region.bands.map(b => `${Math.round(b.fMinHz)}–${Math.round(b.fMaxHz)} Hz : médiane prédite − mesurée [C] de ${signed(b.diffL50Db.min)} à ${signed(b.diffL50Db.max)} dB, ${Math.round(100 * b.within3DbFraction)} % à ±3 dB`).join('\n')}\n${region.statement}`;
}
