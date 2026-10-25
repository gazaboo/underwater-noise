/** Numerical constants shared by the solver, rendering and verification tools. */
export const SOUND_SPEED_M_S = 1500;
export const PHYS_POLAR_CAP_DEG = 79;
// Fourth-order stencil: (4/3) C² (1 + sec² latitude) < 1 on ±79°.
// A single C preserves the same physical velocity at every latitude.
export const PHYS_COURANT = 0.14;
export const WAVE_VISIBLE_DB = 1;
export const WAVE_FULL_DB = 10;

export function physicsStepSeconds(cellMeters: number): number {
  return PHYS_COURANT * cellMeters / SOUND_SPEED_M_S;
}

/** Display convention, applied BEFORE brightness. This is not a biological threshold. */
export function waveVisibility(excessDb: number): number {
  const t = Math.max(0, Math.min(1, (excessDb - WAVE_VISIBLE_DB) / (WAVE_FULL_DB - WAVE_VISIBLE_DB)));
  return t * t * (3 - 2 * t);
}

/** Fixed physical steps: the remainder is retained, never discarded by a frame-rate cap. */
export class PhysicalSteps {
  private remainder = 0;
  reset(): void { this.remainder = 0; }
  get fraction(): number { return this.remainder; }
  advance(seconds: number, stepSeconds: number, step: (offsetSeconds: number) => void): number {
    this.remainder += Math.max(0, seconds);
    let count = 0;
    while (this.remainder + 1e-9 >= stepSeconds) {
      this.remainder = Math.max(0, this.remainder - stepSeconds);
      step(seconds - this.remainder);
      count++;
    }
    return count;
  }
}
