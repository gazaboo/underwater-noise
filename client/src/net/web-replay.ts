/**
 * Replay d'AIS enregistré, dans le navigateur (mode web autonome) : mêmes fichiers NDJSON compressés que
 * le serveur ({"t": ms, "m": message aisstream}), lus en flux (fetch → gunzip → lignes), avec la même
 * horloge que server/src/sources/replay.ts.
 */
import { AisSourceBase, type CoverageOptions } from '@vacarme/shared/ships/ais-base.ts';
import { CoverageMap } from '@vacarme/shared/ships/coverage.ts';
import type { RegistryOptions } from '@vacarme/shared/ships/registry.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PREFILL_MS = 15 * 60_000;

/** Lignes d'un fichier .ndjson.gz servi en HTTP. */
async function* lines(url: string): AsyncGenerator<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url} : HTTP ${res.status}`);
  // Selon l'hébergeur, le .gz arrive brut ou déjà décompressé (Content-Encoding) : on regarde l'en-tête gzip.
  const raw = res.body.getReader();
  const first = await raw.read();
  const head = first.value ?? new Uint8Array();
  const body = new ReadableStream<BufferSource>({
    start(c) { if (head.length) c.enqueue(head); if (first.done) c.close(); },
    async pull(c) { const { value, done } = await raw.read(); if (done) c.close(); else c.enqueue(value); },
  });
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  const reader = (gzipped ? body.pipeThrough(new DecompressionStream('gzip')) : body).pipeThrough(new TextDecoderStream()).getReader();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parts = (rest + value).split('\n');
    rest = parts.pop() ?? '';
    yield* parts;
  }
  if (rest) yield rest;
}

export class WebReplaySource extends AisSourceBase {
  readonly name = 'replay' as const;
  private fileIndex = 0;
  private clockMs: number | null = null;
  private running = false;
  private generation = 0;
  private readonly initialCoverage: CoverageMap;
  currentFile: string | null = null;
  /** Résolue quand le démarrage à chaud est fait (premières minutes du fichier ingérées). */
  readonly ready: Promise<void>;
  private markReady: () => void = () => {};

  constructor(
    private readonly files: string[],
    private speed: number,
    private readonly loop: boolean,
    registryOptions: RegistryOptions,
    coverage: CoverageMap,
    coverageOptions: CoverageOptions,
  ) {
    super(registryOptions, coverage, coverageOptions);
    this.initialCoverage = new CoverageMap();
    this.initialCoverage.copyFrom(coverage);
    this.ready = new Promise((resolve) => (this.markReady = resolve));
  }

  get revision(): number { return this.generation; }
  get available(): boolean { return this.files.length > 0; }

  setSpeed(speed: number): void { this.speed = speed; }

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
      this.currentFile = file.split('/').pop() ?? file;
      try {
        for await (const line of lines(file)) {
          if (gen !== this.generation) break;
          if (!line) continue;
          let rec: { t: number; m: unknown };
          try {
            rec = JSON.parse(line);
          } catch {
            continue;
          }
          if (this.clockMs === null) {
            // Démarrage à chaud [E] : les premières minutes du fichier sont ingérées d'un coup, pour que la
            // page s'ouvre sur un trafic déjà visible (à ×1, les positions AIS arrivent au compte-gouttes).
            this.clockMs = rec.t + PREFILL_MS;
            this.simMs = this.clockMs;
          }
          if (rec.t > this.clockMs!) this.markReady();
          while (rec.t > this.clockMs! && gen === this.generation) await sleep(50);
          this.ingest(rec.m, rec.t);
        }
      } catch (e) {
        console.error(`[replay] ${file} : ${(e as Error).message}`);
      }
      if (gen !== this.generation) return;
      this.fileIndex++;
      if (this.fileIndex >= this.files.length && this.loop) {
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
