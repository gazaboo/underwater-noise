/**
 * Flux de navires depuis le serveur local (WebSocket /ws), avec reconnexion automatique.
 * Reçoit aussi la configuration (messages texte) quand elle change côté serveur.
 */
import { MSG_COVERAGE, MSG_SHIPS, decodeCoverage, decodeHeader, messageType, type Config, type ShipSnapshot, type SourceStatus, type ScienceStatus } from '@vacarme/shared';

export interface StreamEvents {
  onSnapshot(snap: ShipSnapshot, receivedAt: number): void;
  onConfig(cfg: Config): void;
  onCoverage(width: number, height: number, data: Uint8Array): void;
  onSourceStatus(status: SourceStatus): void;
  onStatus(connected: boolean): void;
  onScienceStatus?(status: ScienceStatus): void;
}

export class ShipStream {
  private ws: WebSocket | null = null;
  private retryMs = 500;
  private closed = false;

  constructor(private readonly events: StreamEvents) {
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 500;
      this.events.onStatus(true);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as { type: string; config?: Config; status?: SourceStatus; science?: ScienceStatus };
        if (msg.type === 'config' && msg.config) this.events.onConfig(msg.config);
        else if (msg.type === 'status' && msg.status) this.events.onSourceStatus(msg.status);
        else if (msg.type === 'science' && msg.science) this.events.onScienceStatus?.(msg.science);
        return;
      }
      const buf = ev.data as ArrayBuffer;
      const type = messageType(buf);
      if (type === MSG_SHIPS) {
        const snap = decodeHeader(buf);
        if (snap) this.events.onSnapshot(snap, performance.now());
      } else if (type === MSG_COVERAGE) {
        const cov = decodeCoverage(buf);
        if (cov) this.events.onCoverage(cov.width, cov.height, cov.data);
      }
    };
    ws.onclose = () => {
      this.events.onStatus(false);
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 8000);
    };
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
