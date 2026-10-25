import type { ShipSnapshot } from '@vacarme/shared';

/** The server's source clock drives ships, physics and animals alike. */
export class SceneClock {
  private anchorMs = 0;
  private receivedAt = 0;
  private rate = 1;
  private timelineId: number | null = null;
  private snapshotMs = 0;
  private lastReadMs = 0;
  private lastFrameAt: number | null = null;
  private available = false;
  private restart = true;
  /** Changes whenever histories must be cleared (replay loop, source change, reconnection). */
  revision = 0;

  constructor(private readonly maxExtrapolateMs = 5000) {}

  sync(snap: Pick<ShipSnapshot, 'simTimeMs' | 'timeScale' | 'timelineId'>, at: number): void {
    const predicted = this.timeAt(at);
    // Detect source discontinuities from SOURCE intervals, not the varying latency of a packet.
    const sourceInterval = snap.simTimeMs - this.snapshotMs;
    const expectedInterval = Math.max(0, at - this.receivedAt) * this.rate;
    const jump = sourceInterval < -1 || Math.abs(sourceInterval - expectedInterval) >
      Math.max(2000, this.maxExtrapolateMs * Math.max(this.rate, snap.timeScale));
    const reset = this.restart || snap.timelineId !== this.timelineId || jump || at - this.receivedAt > this.maxExtrapolateMs;
    if (reset) {
      this.revision++;
      this.lastReadMs = snap.simTimeMs;
      this.lastFrameAt = null;
    }
    // Keep a continuous derivative between real timeline changes. Snapping to every packet
    // would turn network jitter into accelerated wave motion, especially at ×100.
    this.anchorMs = reset ? snap.simTimeMs : Math.max(this.lastReadMs, predicted);
    this.snapshotMs = snap.simTimeMs;
    this.receivedAt = at;
    this.rate = snap.timeScale;
    this.timelineId = snap.timelineId;
    this.available = true;
    this.restart = false;
  }

  disconnect(): void {
    this.anchorMs = this.lastReadMs;
    this.available = false;
    this.restart = true;
  }

  private timeAt(at: number): number {
    return this.anchorMs + (this.available ? Math.max(0, Math.min(at - this.receivedAt, this.maxExtrapolateMs)) * this.rate : 0);
  }

  read(at: number): { timeMs: number; dtSec: number; scale: number; stale: boolean } {
    // Resuming a suspended tab is a discontinuity, not thousands of retroactive animal steps.
    if (this.lastFrameAt !== null && at - this.lastFrameAt > this.maxExtrapolateMs) {
      this.disconnect();
      this.revision++;
    }
    const timeMs = Math.max(this.lastReadMs, this.timeAt(at));
    const dtSec = this.available ? Math.max(0, (timeMs - this.lastReadMs) / 1000) : 0;
    this.lastReadMs = timeMs;
    this.lastFrameAt = at;
    return { timeMs, dtSec, scale: this.rate, stale: !this.available || at - this.receivedAt >= this.maxExtrapolateMs };
  }
}
