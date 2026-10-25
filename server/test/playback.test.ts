import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSON5 from 'json5';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '@vacarme/shared';
import { OceanGrid } from '../src/ocean-grid.ts';
import { SimulationSource } from '../src/sources/simulation.ts';
import { SourceManager } from '../src/sources/manager.ts';

const dirs: string[] = [];
const managers: SourceManager[] = [];
function setup(scale: number, live = false) {
  const root = mkdtempSync(join(tmpdir(), 'vacarme-playback-')); dirs.push(root);
  mkdirSync(join(root, 'data'));
  const cfg = configSchema.parse(JSON5.parse(readFileSync(new URL('../../config/default.json5', import.meta.url), 'utf8')));
  cfg.source.mode = 'simulation'; cfg.recorder.enabled = false; cfg.simulation.shipCount = 20; cfg.playback.timeScale = scale;
  const data = new URL('../../data/', import.meta.url);
  const sim = new SimulationSource(new URL('routes.json', data).pathname, new OceanGrid(new URL('grid/ocean_1024.png', data).pathname),
    {...cfg.simulation, timeScale: cfg.playback.timeScale, bands: cfg.bands});
  // With mode=simulation, even the optional dummy live source never opens a connection.
  const manager = new SourceManager(cfg, root, sim, null, live ? 'unused-test-key' : undefined);
  managers.push(manager);
  return {cfg, sim, manager};
}
afterEach(() => {
  for (const manager of managers.splice(0)) { manager.shutdown(); manager.replay.restart(); }
  for (const root of dirs.splice(0)) rmSync(root, {recursive:true, force:true});
  vi.useRealTimers();
});

describe('facteur temporel de la source active', () => {
  it('change de vitesse sans changer les niveaux sources ni la chronologie', () => {
    const {cfg, sim, manager} = setup(1);
    const id = manager.timelineId;
    const t = manager.current.simTimeMs();
    const sources = sim.ships().map(s => s.slBroad);
    manager.tick(1);
    expect(manager.current.simTimeMs() - t).toBe(1000);
    cfg.playback.timeScale = 10;
    sim.configure({...cfg.simulation, timeScale:cfg.playback.timeScale, bands:cfg.bands});
    manager.configure(cfg);
    manager.tick(1);
    expect(manager.current.simTimeMs() - t).toBe(11000);
    expect(manager.current.timeScale()).toBe(10);
    expect(manager.timelineId).toBe(id);
    expect(sim.ships().map(s => s.slBroad)).toEqual(sources);
  });
  it('retrouve les mêmes trajectoires et niveaux après la même durée à ×1 et ×10', () => {
    const one=setup(1), ten=setup(10);
    for(let i=0;i<600;i++) one.manager.tick(.1);
    for(let i=0;i<60;i++) ten.manager.tick(.1);
    expect(ten.sim.ships()).toEqual(one.sim.ships());
  });
  it('limite le direct à ×1 et signale une nouvelle chronologie à la bascule', () => {
    const {cfg, manager} = setup(100, true);
    const id = manager.timelineId;
    // Switch selection without starting a WebSocket: the clock of the real source is what is under test.
    cfg.source.mode = 'live'; manager.tick(.1);
    expect(manager.current.name).toBe('live');
    expect(manager.current.timeScale()).toBe(1);
    expect(manager.timelineId).not.toBe(id);
    expect(cfg.playback.timeScale).toBe(100);
  });
  it('donne un nouvel identifiant au replay lorsqu’il recommence', () => {
    const {cfg, manager} = setup(10);
    cfg.replay.path = new URL('../../data/replays', import.meta.url).pathname;
    manager.configure(cfg); cfg.source.mode = 'replay'; manager.tick(0);
    expect(manager.current.name).toBe('replay');
    const id = manager.timelineId;
    manager.replay.restart();
    expect(manager.timelineId).not.toBe(id);
  });
});
