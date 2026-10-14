import type { ShipRecord } from '@vacarme/shared';

/** Une source de navires : AIS en direct, replay ou simulation. */
export interface ShipSource {
  readonly name: string;
  /** Avance l'état de `realDtSec` secondes réelles. */
  tick(realDtSec: number): void;
  /** Navires courants. */
  ships(): readonly ShipRecord[];
  /** Temps simulé courant (ms depuis l'époque Unix). */
  simTimeMs(): number;
  /** Temps simulé / temps réel. */
  timeScale(): number;
}
