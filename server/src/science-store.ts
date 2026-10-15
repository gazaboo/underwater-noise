import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { SCIENTIFIC_PROFILE_ID, validationSummarySchema, type Config, type ScienceStatus, type ValidationSummary } from '@vacarme/shared';

/** Résumé de validation publié (écarts mesurés), relu quand le fichier change ; jamais inventé. */
export class ScienceStore {
  private key = '';
  private data: ValidationSummary | null = null;
  private error = 'Aucun résumé de validation publié.';
  constructor(private readonly root: string) {}

  read(cfg: Config): ValidationSummary | null {
    const base = resolve(this.root, 'data', 'science');
    const path = resolve(this.root, cfg.science.validationSummary);
    if (!path.startsWith(base + sep)) { this.data = null; this.error = 'Le résumé de validation doit se trouver dans data/science.'; return null; }
    try {
      const stat = statSync(path);
      const key = `${path}|${stat.mtimeMs}|${stat.size}`;
      if (this.key !== key) {
        this.key = key;
        this.data = null;
        const summary = validationSummarySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        // Un résumé d'un autre profil ne décrit pas les niveaux affichés.
        if (summary.profileId !== this.profileId(cfg)) throw new Error('profil');
        this.data = summary;
        this.error = '';
      }
    } catch (e) {
      this.key = '';
      this.data = null;
      const code = (e as NodeJS.ErrnoException).code;
      this.error = code === 'ENOENT' ? 'Aucun résumé de validation publié.' : (e as Error).message === 'profil' ? 'Résumé de validation d’un autre profil physique : ignoré.' : 'Résumé de validation invalide : ignoré.';
    }
    return this.data;
  }

  private profileId(cfg: Config): string {
    return cfg.science.mode === 'reference' ? SCIENTIFIC_PROFILE_ID : 'experimental';
  }

  status(cfg: Config): ScienceStatus {
    const data = this.read(cfg);
    return {
      profileId: this.profileId(cfg), mode: cfg.science.mode, validationAvailable: !!data,
      message: data ? `Écarts mesurés publiés (${data.protocol}) ; hors des zones mesurées : non validé.` : `${this.error} Niveaux non validés.`,
    };
  }
}
