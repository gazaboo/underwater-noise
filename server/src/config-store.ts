/**
 * Chargement, fusion, validation et surveillance de la configuration.
 * default.json5 ← expo.json5 (si VACARME_MODE=expo) ← local.json5 (écrit par le panneau).
 */
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSON5 from 'json5';
import { configSchema, deepMerge, type Config } from '@vacarme/shared';

export class ConfigStore extends EventEmitter {
  private current: Config;
  private readonly files: string[];
  private readonly localFile: string;
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(private readonly dir: string) {
    super();
    const expo = process.env.VACARME_MODE === 'expo';
    this.localFile = join(dir, 'local.json5');
    this.files = [join(dir, 'default.json5'), ...(expo ? [join(dir, 'expo.json5')] : []), this.localFile];
    this.current = this.load();
  }

  get config(): Config {
    return this.current;
  }

  /** Charge et valide ; lève une erreur lisible si un fichier est invalide. */
  private load(): Config {
    let merged: unknown = {};
    for (const f of this.files) {
      if (!existsSync(f)) continue;
      try {
        merged = deepMerge(merged, JSON5.parse(readFileSync(f, 'utf8')));
      } catch (e) {
        throw new Error(`Configuration illisible (${f}) : ${(e as Error).message}`);
      }
    }
    const parsed = configSchema.safeParse(merged);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`).join('\n');
      throw new Error(`Configuration invalide :\n${issues}`);
    }
    return parsed.data;
  }

  /** Surveille le dossier et recharge à chaud ; une erreur garde l'ancienne configuration. */
  watch(): void {
    watch(this.dir, () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        try {
          this.current = this.load();
          this.emit('change', this.current);
          console.log('[config] rechargée');
        } catch (e) {
          console.error(`[config] ${(e as Error).message}\n[config] l'ancienne configuration est conservée`);
        }
      }, 150);
    });
  }

  /** Fusionne `patch` dans local.json5 (après validation de l'ensemble). */
  saveLocal(patch: unknown): void {
    const existing = existsSync(this.localFile) ? JSON5.parse(readFileSync(this.localFile, 'utf8')) : {};
    const nextLocal = deepMerge(existing, patch);
    // Valider le résultat complet avant d'écrire.
    const full = configSchema.safeParse(deepMerge(this.current, patch));
    if (!full.success) throw new Error(full.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join('; '));
    const header = '// Réglages locaux, écrits par le panneau (touche P). Ignoré par git.\n';
    writeFileSync(this.localFile, header + JSON.stringify(nextLocal, null, 2) + '\n');
  }
}
