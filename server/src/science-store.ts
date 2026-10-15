import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { SCIENTIFIC_PROFILE_ID, scientificDatasetSchema, type Config, type ScienceStatus, type ScientificDataset } from '@vacarme/shared';

export class ScienceStore {
  private key = '';
  private data: ScientificDataset | null = null;
  private error = 'Aucun pré-calcul régional disponible.';
  constructor(private readonly root: string) {}

  read(cfg: Config): ScientificDataset | null {
    const base = resolve(this.root, 'data', 'science');
    const path = resolve(this.root, cfg.science.dataset);
    if (!path.startsWith(base + sep)) { this.data = null; this.error = 'Le pré-calcul doit se trouver dans data/science.'; return null; }
    try {
      const stat = statSync(path);
      const key = `${path}|${stat.mtimeMs}|${stat.size}`;
      if (this.key !== key) {
        this.key = key;
        this.data = null;
        this.data = scientificDatasetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        this.error = '';
      }
    } catch (e) {
      this.key = '';
      this.data = null;
      this.error = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Aucun pré-calcul régional disponible.' : 'Pré-calcul régional invalide : vérifier le fichier et ses métadonnées.';
    }
    return this.data;
  }

  status(cfg: Config): ScienceStatus {
    const data = this.read(cfg);
    return {
      profileId: cfg.science.mode === 'reference' ? SCIENTIFIC_PROFILE_ID : 'experimental', mode: cfg.science.mode,
      regionalAvailable: !!data, numericalStatus: data?.numerical.maxDifferenceDb !== null && data?.numerical.maxDifferenceDb !== undefined && data.numerical.maxDifferenceDb <= 1 ? 'convergence-checked' : 'not-verified',
      observationalStatus: 'not-validated',
      message: data ? 'Pré-calcul RAM disponible ; validation sur mesures non réalisée. Carte mondiale : estimation simplifiée non validée.' : `${this.error} Carte mondiale : estimation simplifiée non validée.`,
    };
  }
}
