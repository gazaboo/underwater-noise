import * as THREE from 'three';
import { acousticComponents, scientificCellAt, scientificDatasetSchema, type AcousticMetric, type Config, type ScientificDataset, type SourceStatus, type ScienceStatus } from '@vacarme/shared';

/** Readouts always describe the displayed dataset, never silently substitute the live field. */
export class SciencePanel {
  readonly element = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly message = document.createElement('p');
  private readonly provenance = document.createElement('p');
  private readonly reading = document.createElement('pre');
  private readonly layer = document.createElement('select');
  private readonly band = document.createElement('select');
  private readonly metric = document.createElement('select');
  private readonly minute = document.createElement('select');
  private readonly legend = document.createElement('p');
  private data: ScientificDataset | null = null;
  private texture: THREE.DataTexture | null = null;
  private request = 0;
  private regional = false;
  constructor(private readonly onLayer: (texture: THREE.DataTexture | null, grid: ScientificDataset['grid'] | null, excess: boolean, enabled: boolean) => void) {
    this.element.id = 'science';
    this.summary.textContent = 'Fiabilité : estimation non validée';
    this.element.append(this.summary, this.message);
    const select = (el: HTMLSelectElement, label: string, options: [string, string][]) => {
      const row = document.createElement('label'); row.textContent = label;
      for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; el.append(option); }
      row.append(el); this.element.append(row);
    };
    select(this.layer, 'Carte ', [['artistic', 'Installation mondiale'], ['regional', 'Calcul RAM — mer du Nord']]);
    select(this.band, 'Bande ', [['0', '63 Hz'], ['1', '125 Hz']]);
    select(this.metric, 'Valeur ', [['total', 'Total estimé'], ['ships', 'Navires seuls'], ['excess', 'Augmentation sur le fond naturel']]);
    select(this.minute, 'Période ', []);
    this.element.append(this.legend, this.provenance, this.reading);
    const reload = document.createElement('button'); reload.textContent = 'Recharger les pré-calculs'; reload.type = 'button';
    reload.addEventListener('click', () => { void this.reload(); }); this.element.append(reload);
    for (const el of [this.layer, this.band, this.metric, this.minute]) el.addEventListener('change', () => this.rebuild());
    for (const event of ['pointerdown', 'wheel', 'keydown']) this.element.addEventListener(event, e => e.stopPropagation());
    document.body.append(this.element);
    void this.reload();
  }
  get active(): boolean { return this.regional; }
  get wantsLevels(): boolean { return this.element.open; }
  async reload(): Promise<void> {
    const request = ++this.request;
    try {
      const res = await fetch('/api/science');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { status: ScienceStatus; dataset: unknown };
      const data = result.dataset ? scientificDatasetSchema.parse(result.dataset) : null;
      if (request !== this.request) return;
      this.data = data;
      this.message.textContent = result.status.message;
      this.minute.replaceChildren();
      for (const [i, frame] of (this.data?.frames ?? []).entries()) {
        const option = document.createElement('option'); option.value = String(i); option.textContent = `${frame.start.replace('T', ' ')} UTC`; this.minute.append(option);
      }
      this.rebuild();
    } catch {
      if (request !== this.request) return;
      this.data = null;
      this.message.textContent = 'Données scientifiques indisponibles ; aucune validation sur mesures.';
      this.rebuild();
    }
  }
  private rebuild(): void {
    this.regional = this.layer.value === 'regional';
    this.texture?.dispose(); this.texture = null;
    this.band.disabled = this.metric.disabled = !this.regional;
    this.minute.disabled = !this.regional || !this.data;
    const excess = this.metric.value === 'excess';
    this.legend.textContent = this.regional ? (excess ? 'Échelle : 0 → 30 dB d’augmentation.' : 'Échelle : 40 → 140 dB re 1 µPa (RMS).') + ' Hachures : données absentes. Cellules sans interpolation.' : 'Ondes et lueur : représentation artistique. Les niveaux ci-dessous sont calculés séparément.';
    this.reading.textContent = this.regional ? 'Survoler une cellule pour lire son estimation.' : 'Survoler l’océan pour lire les niveaux estimés.';
    const d = this.data;
    this.provenance.textContent = this.regional && d ? `${d.profileId} · ${d.method} · source à 6 m · moyenne énergétique 60 s · ${d.depthMode === 'depth-mean' ? 'moyenne sur la profondeur' : 'profondeur du récepteur'}\nEnvironnement : ${d.provenance.environment}\nTrafic : ${d.provenance.traffic}\nVent : ${d.provenance.wind}\nHypothèses : ${d.provenance.assumptions.join(' ; ')}\nValidation sur mesures non réalisée.` : this.regional ? 'Aucun pré-calcul régional chargé. Aucun niveau RAM disponible.' : 'Monde : propagation simplifiée ; profondeur de réception non définie ; précision absolue non établie.';
    if (this.regional && d) {
      const band = Number(this.band.value);
      const cells = d.frames[Number(this.minute.value) || 0].cells;
      const pixels = new Float32Array(cells.length * 4);
      for (const [i, cell] of cells.entries()) {
        if (!cell) continue;
        const values = acousticComponents(cell.shipsDb[band], cell.ambientDb[band]);
        const db = this.metric.value === 'ships' ? values.shipsDb : this.metric.value === 'excess' ? values.excessDb : values.totalDb;
        pixels[i * 4] = db ?? -300; // exact zero ship energy: below scale, not missing data
        pixels[i * 4 + 1] = 1;
      }
      this.texture = new THREE.DataTexture(pixels, d.grid.width, d.grid.height, THREE.RGBAFormat, THREE.FloatType);
      this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
      this.texture.needsUpdate = true;
    }
    this.onLayer(this.texture, d?.grid ?? null, excess, this.regional);
  }
  update(geo: { lat: number; lon: number } | null, world: number[] | null, cfg: Config, source: SourceStatus | null): void {
    this.summary.textContent = `Fiabilité : ${cfg.science.mode === 'experimental' && !this.regional ? 'profil expérimental' : 'estimation non validée'}`;
    if (!this.element.open || !geo) return;
    const position = `${geo.lat.toFixed(2)}°, ${geo.lon.toFixed(2)}°`;
    const format = (ships: number | null, ambient: number) => {
      const c = acousticComponents(ships, ambient);
      return `navires ${ships === null ? 'énergie nulle' : `${ships.toFixed(0)} dB`} · fond ${ambient.toFixed(0)} dB\ntotal ${c.totalDb.toFixed(0)} dB re 1 µPa · augmentation ${c.excessDb.toFixed(1)} dB`;
    };
    if (this.regional) {
      const d = this.data, frame = d?.frames[Number(this.minute.value) || 0];
      const sample = d && frame ? scientificCellAt(d, geo.lat, geo.lon, Date.parse(frame.start)) : null;
      const b = Number(this.band.value);
      this.reading.textContent = sample ? `${position} · ${this.band.selectedOptions[0].text}\n${format(sample.cell.shipsDb[b], sample.cell.ambientDb[b])}${sample.cell.receiverDepthM === null ? '' : `\nRécepteur : ${sample.cell.receiverDepthM} m`}` : `${position} : données régionales absentes.`;
    } else {
      const traffic = !source ? 'Source de trafic inconnue.' : source.shipsMode === 'estimated' ? 'Trafic synthétique estimé (GFW).' : source.shipsMode === 'mixed' ? 'AIS + trafic synthétique estimé.' : source.active === 'simulation' ? 'Trafic simulé.' : source.active === 'replay' ? 'AIS historique en replay.' : 'AIS observé ; couverture incomplète, positions éventuellement extrapolées.';
      this.reading.textContent = `${position}\n${world ? cfg.bands.map((b, i) => `${b.fMin}–${b.fMax} Hz : ${format(world[i * 2] === -Infinity ? null : world[i * 2], world[i * 2 + 1])}`).join('\n') : 'Niveaux indisponibles (terre, hors domaine ou champ désactivé).'}\nMoyenne exponentielle τ = ${cfg.physics.energyTauSec} s (temps d’affichage).\nVent uniforme : ${cfg.ambient.windSpeedMs} m/s, scénario.\n${traffic}`;
    }
  }
}
