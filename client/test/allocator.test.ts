import { describe, expect, it } from 'vitest';
import { allocate } from '../src/audio/allocator.ts';

const c = (id: number, score: number) => ({ id, score });

describe('attribution des voix', () => {
  it('prend les plus forts quand des voix sont libres', () => {
    expect([...allocate(new Set(), [c(1, 170), c(2, 185), c(3, 180)], 2, 3)].sort()).toEqual([2, 3]);
  });

  it('garde une voix existante face à un nouveau venu à peine plus fort (hystérésis)', () => {
    const r = allocate(new Set([1, 2]), [c(1, 180), c(2, 178), c(3, 180)], 2, 3);
    expect([...r].sort()).toEqual([1, 2]);
  });

  it('remplace la voix la plus faible par un nouveau venu nettement plus fort', () => {
    const r = allocate(new Set([1, 2]), [c(1, 180), c(2, 170), c(3, 186)], 2, 3);
    expect([...r].sort()).toEqual([1, 3]);
  });

  it('libère les voix des navires sortis de la vue', () => {
    expect([...allocate(new Set([1, 9]), [c(1, 180), c(2, 175)], 2, 3)].sort()).toEqual([1, 2]);
  });
});
