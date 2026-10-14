/**
 * Enregistreur du flux AIS direct, pour le rejouer le jour de l'exposition.
 *
 * Format : NDJSON compressé, une ligne par message {"t": ms, "m": <message aisstream>},
 * un fichier par heure (dir/AAAA-MM-JJ/HH.ndjson.gz). Les positions sont sous-échantillonnées
 * (une par navire toutes les `minIntervalSec` secondes) ; les messages statiques sont gardés.
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { createGzip, type Gzip } from 'node:zlib';

export class Recorder {
  private gzip: Gzip | null = null;
  private out: WriteStream | null = null;
  private currentKey = '';
  private readonly lastPos = new Map<number, number>();
  currentFile: string | null = null;
  /** Désactivable à chaud depuis la configuration. */
  enabled = true;

  constructor(
    private readonly dir: string,
    private minIntervalSec: number,
  ) {}

  setMinInterval(sec: number): void {
    this.minIntervalSec = sec;
  }

  private rotate(tMs: number): void {
    const d = new Date(tMs);
    const day = d.toISOString().slice(0, 10);
    const hour = d.toISOString().slice(11, 13);
    const key = `${day}/${hour}`;
    if (key === this.currentKey && this.gzip) return;
    this.close();
    mkdirSync(join(this.dir, day), { recursive: true });
    this.currentFile = join(this.dir, day, `${hour}.ndjson.gz`);
    this.gzip = createGzip();
    // Ajout en fin de fichier : un redémarrage dans la même heure ajoute un membre gzip, ce qui reste lisible.
    this.out = createWriteStream(this.currentFile, { flags: 'a' });
    this.gzip.pipe(this.out);
    this.currentKey = key;
    this.lastPos.clear();
  }

  /** Enregistre un message brut aisstream reçu à `tMs`. */
  write(msg: { MessageType?: string; MetaData?: { MMSI?: number } }, tMs: number): void {
    if (!this.enabled) return;
    this.rotate(tMs); // avant le filtre : un changement d'heure réinitialise la mémoire des positions
    const isPosition = msg.MessageType?.includes('Position') ?? false;
    if (isPosition) {
      const mmsi = msg.MetaData?.MMSI;
      if (mmsi !== undefined) {
        const last = this.lastPos.get(mmsi);
        if (last !== undefined && tMs - last < this.minIntervalSec * 1000) return;
        this.lastPos.set(mmsi, tMs);
      }
    }
    this.gzip!.write(JSON.stringify({ t: tMs, m: msg }) + '\n');
  }

  close(): void {
    this.gzip?.end();
    this.gzip = null;
    this.out = null;
    this.currentKey = '';
  }
}
