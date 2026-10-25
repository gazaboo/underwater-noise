/**
 * Flux de navires du mode web autonome : même interface que ShipStream, mais les sources tournent dans
 * un Web Worker du navigateur (local-sources.worker.ts) au lieu du serveur.
 */
import { MSG_COVERAGE, MSG_SHIPS, decodeCoverage, decodeHeader, messageType, type Config } from '@vacarme/shared';
import { dataUrl } from '../data-url.ts';
import type { StreamEvents } from './ship-stream.ts';
import type { FromWorker, ToWorker } from './local-sources.worker.ts';

export class LocalShipStream {
  private readonly worker: Worker;

  constructor(config: Config, private readonly events: StreamEvents) {
    this.worker = new Worker(new URL('./local-sources.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    this.worker.onerror = (e) => console.error('[web autonome] sources :', e.message);
    // URL absolue : dans le worker, une adresse relative partirait du dossier du script (assets/).
    this.send({ type: 'init', config, dataBase: new URL(dataUrl(''), location.href).href });
    events.onStatus(true);
  }

  /** Nouvelle configuration (vitesse du temps, navires réels / estimés…), appliquée comme par le serveur. */
  configure(config: Config): void {
    this.send({ type: 'config', config: structuredClone(config) });
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  private receive(msg: FromWorker): void {
    if (msg.type === 'status') this.events.onSourceStatus(msg.status);
    else if (msg.type === 'error') console.error(`[web autonome] ${msg.message}`);
    else if (messageType(msg.buf) === MSG_SHIPS) {
      const snap = decodeHeader(msg.buf);
      if (snap) this.events.onSnapshot(snap, performance.now());
    } else if (messageType(msg.buf) === MSG_COVERAGE) {
      const cov = decodeCoverage(msg.buf);
      if (cov) this.events.onCoverage(cov.width, cov.height, cov.data);
    }
  }
}
