/**
 * Flux de navires depuis le serveur local (WebSocket /ws), avec reconnexion automatique.
 * Reçoit aussi la configuration (messages texte) quand elle change côté serveur.
 */
import { decodeHeader, type Config, type ShipSnapshot } from '@vacarme/shared';

export interface StreamEvents {
  onSnapshot(snap: ShipSnapshot, receivedAt: number): void;
  onConfig(cfg: Config): void;
  onStatus(connected: boolean): void;
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
        const msg = JSON.parse(ev.data) as { type: string; config?: Config };
        if (msg.type === 'config' && msg.config) this.events.onConfig(msg.config);
        return;
      }
      const snap = decodeHeader(ev.data as ArrayBuffer);
      if (snap) this.events.onSnapshot(snap, performance.now());
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
