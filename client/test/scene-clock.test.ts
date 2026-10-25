import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSON5 from 'json5';
import {configSchema, PhysicalSteps} from '@vacarme/shared';
import {WhaleAgents} from '../src/whales/agents.ts';
import type {OceanCpu} from '../src/whales/geo-grids.ts';
import { SceneClock } from '../src/sim/scene-clock.ts';

const snapshot = (simTimeMs: number, timeScale = 1, timelineId = 1) => ({ simTimeMs, timeScale, timelineId });

describe('horloge de la scène', () => {
  it('change de facteur sans saut de position et donne le même temps à 15, 60 et 120 images/s', () => {
    for (const fps of [15, 60, 120]) {
      const c = new SceneClock(); c.sync(snapshot(1000), 0); c.read(0);
      for (let i = 1; i <= fps; i++) c.read(i * 1000 / fps);
      const revision = c.revision;
      c.sync(snapshot(2000, 10), 1000);
      expect(c.revision).toBe(revision);
      expect(c.read(1000).timeMs).toBe(2000);
      expect(c.read(1100)).toMatchObject({ timeMs: 3000, dtSec: 1, scale: 10, stale: false });
    }
  });
  it('s’arrête après perte du flux et repart avec une nouvelle histoire à la reconnexion', () => {
    const c = new SceneClock(); c.sync(snapshot(1000, 10), 0); c.read(0);
    expect(c.read(5000).timeMs).toBe(51_000);
    expect(c.read(6000)).toMatchObject({ timeMs: 51_000, dtSec: 0, stale: true });
    const revision = c.revision;
    c.disconnect();
    expect(c.read(6500).timeMs).toBe(51_000);
    c.sync(snapshot(100_000, 1), 6600);
    expect(c.revision).toBeGreaterThan(revision);
    expect(c.read(6600).dtSec).toBe(0);
  });
  it('détecte une boucle de replay et une bascule de source même lorsque les dates se recouvrent', () => {
    const c = new SceneClock(); c.sync(snapshot(10000), 0); c.read(0);
    const revision = c.revision;
    c.sync(snapshot(10000, 1, 2), 100);
    expect(c.revision).toBe(revision + 1);
    expect(c.read(100).dtSec).toBe(0);
    c.sync(snapshot(1000, 1, 3), 200);
    expect(c.read(200).timeMs).toBe(1000);
  });
  it('ne rattrape pas brutalement le temps d’un onglet suspendu', () => {
    const c = new SceneClock(); c.sync(snapshot(1000, 100), 0); c.read(0);
    expect(c.read(60_000)).toMatchObject({ timeMs: 1000, dtSec: 0, stale: true });
  });
  it('ne transforme pas les variations de latence réseau en changements de vitesse', () => {
    const c=new SceneClock(); c.sync(snapshot(10000,10),0); c.read(0);
    const revision=c.revision;
    c.read(500);
    c.sync(snapshot(20000,10),1050);
    expect(c.read(1500).timeMs).toBe(25000);
    c.sync(snapshot(30000,10),2200);
    expect(c.read(2500).timeMs).toBe(35000);
    expect(c.revision).toBe(revision);
  });
});


describe('temps des cétacés', () => {
  it('conserve déplacements et cycles d’appel à durée simulée égale', () => {
    const cfg=configSchema.parse(JSON5.parse(readFileSync(new URL('../../config/default.json5',import.meta.url),'utf8')));
    cfg.whales.useSightings=false;
    cfg.whales.species=cfg.whales.species.map(s=>({...s,groups:2}));
    const ocean={isWater:()=>true,depth:()=>4000} as unknown as OceanCpu;
    const run=(scale:number,fps:number)=>{
      const agents=new WhaleAgents(ocean,new Map()); agents.populate(cfg);
      const steps=new PhysicalSteps();
      for(let i=0;i<60*fps/scale;i++) steps.advance(scale/fps,.1,()=>agents.move(cfg,.1));
      return agents.groups.map(g=>({lat:g.lat,lon:g.lon,phase:g.callPhase}));
    };
    const reference=run(1,60);
    expect(run(10,15)).toEqual(reference);
    expect(run(100,120)).toEqual(reference);
  });
});
