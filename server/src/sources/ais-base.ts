/** Socle commun des sources fondées sur des messages AIS (direct et replay). */
import type { ShipRecord } from '@vacarme/shared';
import { parseAisMessage } from '../ais/parse.ts';
import { ShipRegistry, type RegistryOptions } from '../ais/registry.ts';
import { CoverageMap } from '../coverage.ts';
import type { ShipSource } from './source.ts';

export interface CoverageOptions {
  halfLifeHours: number;
  gainPerMessage: number;
}

export abstract class AisSourceBase implements ShipSource {
  abstract readonly name: 'live' | 'replay';
  readonly registry: ShipRegistry;
  protected simMs = Date.now();
  private cache: { at: number; ships: ShipRecord[] } | null = null;

  constructor(
    registryOptions: RegistryOptions,
    readonly coverage: CoverageMap,
    protected coverageOptions: CoverageOptions,
  ) {
    this.registry = new ShipRegistry(registryOptions);
  }

  configure(registryOptions: RegistryOptions, coverageOptions: CoverageOptions): void {
    this.registry.configure(registryOptions);
    this.coverageOptions = coverageOptions;
    this.cache = null;
  }

  /** Intègre un message aisstream reçu (ou rejoué) au temps `tMs`. */
  ingest(msg: unknown, tMs: number): void {
    for (const ev of parseAisMessage(msg)) {
      this.registry.apply(ev, tMs);
      if (ev.kind === 'position') this.coverage.observe(ev.lat, ev.lon, this.coverageOptions.gainPerMessage);
    }
  }

  abstract tick(realDtSec: number): void;

  ships(): readonly ShipRecord[] {
    // Un seul calcul par pas de temps, même si plusieurs consommateurs le demandent.
    if (!this.cache || this.cache.at !== this.simMs) {
      this.coverage.decay(this.simMs, this.coverageOptions.halfLifeHours);
      this.cache = { at: this.simMs, ships: this.registry.snapshot(this.simMs) };
    }
    return this.cache.ships;
  }

  simTimeMs(): number {
    return this.simMs;
  }

  abstract timeScale(): number;
}
