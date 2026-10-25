/** Simulation par routes (logique partagée avec le navigateur) ; lecture de data/routes.json ici. */
import { readFileSync } from 'node:fs';
import { SimulationSource as SimulationCore, type RoutesData, type SimulationOptions } from '@vacarme/shared/ships/simulation.ts';
import type { OceanLookup } from '@vacarme/shared/ships/ocean.ts';

export * from '@vacarme/shared/ships/simulation.ts';

export class SimulationSource extends SimulationCore {
  constructor(routesPath: string, grid: OceanLookup, opts: SimulationOptions) {
    super(JSON.parse(readFileSync(routesPath, 'utf8')) as RoutesData, grid, opts);
  }
}
