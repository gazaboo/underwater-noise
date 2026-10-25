/**
 * Source « replay » : rejoue des fichiers NDJSON compressés ({"t": ms, "m": message aisstream}),
 * produits par l'enregistreur du serveur ou par tools/convert_ais.py.
 *
 * Lecture en flux (les fichiers d'une journée peuvent être volumineux) : une boucle asynchrone
 * lit les lignes et attend que l'horloge de replay atteigne leur date avant de les appliquer.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { RegistryOptions } from '../ais/registry.ts';
import { CoverageMap } from '../coverage.ts';
import { AisSourceBase, type CoverageOptions } from './ais-base.ts';

/** Liste les fichiers .ndjson.gz d'un chemin (fichier ou dossier, récursif), triés. */
export function listReplayFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return path.endsWith('.ndjson.gz') ? [path] : [];
  const out: string[] = [];
  for (const name of readdirSync(path).sort()) {
    out.push(...listReplayFiles(join(path, name)));
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ReplaySource extends AisSourceBase {
  readonly name = 'replay' as const;
  private files: string[];
  private fileIndex = 0;
  private clockMs: number | null = null;
  private running = false;
  private generation = 0;
  private readonly initialCoverage: CoverageMap;
  currentFile: string | null = null;

  constructor(
    path: string,
    private speed: number,
    private loop: boolean,
    registryOptions: RegistryOptions,
    coverage: CoverageMap,
    coverageOptions: CoverageOptions,
  ) {
    super(registryOptions, coverage, coverageOptions);
    this.files = listReplayFiles(path);
    this.initialCoverage = new CoverageMap();
    this.initialCoverage.copyFrom(coverage);
  }

  get revision(): number { return this.generation; }

  get available(): boolean {
    return this.files.length > 0;
  }

  get playbackSpeed(): number {
    return this.speed;
  }

  setOptions(path: string, speed: number, loop: boolean): void {
    this.speed = speed;
    this.loop = loop;
    const files = listReplayFiles(path);
    if (files.join('|') !== this.files.join('|')) {
      this.files = files;
      this.restart();
    }
  }

  /** Repart du début (nouvelle génération : la boucle de lecture précédente s'arrête). */
  restart(): void {
    this.generation++;
    this.running = false;
    this.fileIndex = 0;
    this.clockMs = null;
    this.registry.clear();
    this.coverage.copyFrom(this.initialCoverage);
  }

  private async pump(gen: number): Promise<void> {
    while (gen === this.generation && this.fileIndex < this.files.length) {
      const file = this.files[this.fileIndex];
      this.currentFile = basename(file);
      const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
      try {
        for await (const line of rl) {
          if (gen !== this.generation) break;
          if (!line) continue;
          let rec: { t: number; m: unknown };
          try {
            rec = JSON.parse(line);
          } catch {
            continue;
          }
          if (this.clockMs === null) {
            this.clockMs = rec.t;
            this.simMs = rec.t;
          }
          while (rec.t > this.clockMs! && gen === this.generation) await sleep(50);
          this.ingest(rec.m, rec.t);
        }
      } catch (e) {
        console.error(`[replay] ${file} : ${(e as Error).message}`);
      } finally {
        rl.close();
      }
      if (gen !== this.generation) return;
      this.fileIndex++;
      if (this.fileIndex >= this.files.length && this.loop) {
        console.log('[replay] fin des fichiers — reprise au début');
        this.restart();
        this.running = true;
        gen = this.generation;
      }
    }
  }

  tick(realDtSec: number): void {
    if (!this.available) return;
    if (!this.running) {
      this.running = true;
      void this.pump(this.generation);
    }
    if (this.clockMs !== null) {
      this.clockMs += realDtSec * 1000 * this.speed;
      this.simMs = this.clockMs;
    }
  }

  timeScale(): number {
    return this.speed;
  }
}
