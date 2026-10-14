/**
 * Source AIS en direct : aisstream.io (WebSocket).
 *
 * - connexion côté serveur uniquement (aisstream interdit les connexions depuis un navigateur) ;
 * - compression permessage-deflate (sans elle, débit limité depuis septembre 2026) ;
 * - abonnement mondial envoyé dans les 3 s suivant l'ouverture ;
 * - reconnexion avec délai croissant (1 s → 60 s).
 */
import WebSocket from 'ws';
import { SUBSCRIBED_TYPES } from '../ais/parse.ts';
import type { RegistryOptions } from '../ais/registry.ts';
import type { CoverageMap } from '../coverage.ts';
import type { Recorder } from '../recorder.ts';
import { AisSourceBase, type CoverageOptions } from './ais-base.ts';

export interface LiveHealth {
  connected: boolean;
  messagesPerSec: number;
  lastMessageAt: number | null;
  error: string | null;
}

export class AisStreamSource extends AisSourceBase {
  readonly name = 'live' as const;
  private ws: WebSocket | null = null;
  private retryMs: number;
  private stopped = false;
  private connected = false;
  private lastMessageAt: number | null = null;
  private error: string | null = null;
  private count = 0;
  private rate = 0;
  private rateWindowStart = Date.now();
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private url: string,
    private readonly apiKey: string,
    registryOptions: RegistryOptions,
    coverage: CoverageMap,
    coverageOptions: CoverageOptions,
    private readonly recorder: Recorder | null,
    private readonly minRetryMs = 1000,
  ) {
    super(registryOptions, coverage, coverageOptions);
    this.retryMs = minRetryMs;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  setUrl(url: string): void {
    if (url === this.url) return;
    this.url = url;
    this.ws?.close(); // la reconnexion utilisera la nouvelle adresse
  }

  private connect(): void {
    const ws = new WebSocket(this.url, { perMessageDeflate: true, handshakeTimeout: 15_000 });
    this.ws = ws;
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          APIKey: this.apiKey,
          BoundingBoxes: [
            [
              [-90, -180],
              [90, 180],
            ],
          ],
          FilterMessageTypes: SUBSCRIBED_TYPES,
        }),
      );
      this.connected = true;
      this.error = null;
      console.log(`[live] connecté à ${this.url}`);
    });
    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof msg.error === 'string') {
        this.error = msg.error;
        console.error(`[live] erreur aisstream : ${msg.error}`);
        return;
      }
      const now = Date.now();
      this.retryMs = this.minRetryMs; // on ne réinitialise le délai qu'après de vrais messages
      this.lastMessageAt = now;
      this.count++;
      this.ingest(msg, now);
      this.recorder?.write(msg as never, now);
    });
    ws.on('error', (e) => {
      this.error = e.message;
    });
    let openedAt = 0;
    let received = false;
    ws.on('open', () => {
      openedAt = Date.now();
    });
    ws.on('message', () => {
      received = true;
    });
    ws.on('close', (code, reason) => {
      this.connected = false;
      if (code !== 1000 && reason.length) this.error = reason.toString();
      // aisstream ferme sans explication quand la clé est refusée.
      else if (openedAt && !received && Date.now() - openedAt < 10_000) this.error = 'connexion fermée juste après l\'abonnement : clé AISSTREAM_API_KEY refusée ?';
      if (this.stopped) return;
      console.warn(`[live] déconnecté (${code}${reason.length ? ` ${reason}` : ''}) — nouvel essai dans ${this.retryMs / 1000} s`);
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 60_000);
    });
  }

  tick(): void {
    this.simMs = Date.now();
    const elapsed = (this.simMs - this.rateWindowStart) / 1000;
    if (elapsed >= 5) {
      this.rate = this.count / elapsed;
      this.count = 0;
      this.rateWindowStart = this.simMs;
    }
  }

  timeScale(): number {
    return 1;
  }

  health(): LiveHealth {
    return { connected: this.connected, messagesPerSec: this.rate, lastMessageAt: this.lastMessageAt, error: this.error };
  }
}
