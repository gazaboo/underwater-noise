import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDioramaTerrain, dioramaHeight, pilotWeight, DIORAMA_VIEWS } from '../src/render/diorama-terrain.ts';
import { sceneStyleIndex, supportsStyle } from '../src/render/scene-style.ts';
import type { SurfaceGrid } from '../src/render/terrain-geometry.ts';
import type { Config } from '@vacarme/shared';
const grid=(land=1):SurfaceGrid=>({width:4,height:2,altitude:new Float32Array(8).fill(5000),land:new Float32Array(8).fill(land),forest:new Float32Array(8).fill(.5)});
describe('pilote diorama',()=>{
  it('raccorde le relief à la limite et exagère les massifs au cœur du pilote',()=>{
    expect(pilotWeight(-88,-12)).toBe(0);expect(pilotWeight(-70,-12)).toBe(1);
    expect(dioramaHeight(grid(),-70,-12,.7)).toBeGreaterThan(.2);
    expect(dioramaHeight(grid(),-88,-12,.7)).toBe(0);
    expect(dioramaHeight(grid(),-70,-12,0)).toBe(0);
  });
  it('réserve le pilote au globe sans modifier les autres projections',()=>{
    expect(supportsStyle('diorama','globe')).toBe(true);
    for(const mode of ['flat','hemisphere','fisheye','equirect'] as const){
      expect(supportsStyle('diorama',mode)).toBe(false);
      expect(sceneStyleIndex({scene:{style:'diorama'},display:{mode}} as Config)).toBe(0);
    }
    expect(DIORAMA_VIEWS.grazing.lon).not.toBe(DIORAMA_VIEWS.overview.lon);
  });
  it('ne crée aucune terre ni falaise dans une zone entièrement marine',()=>{
    const g=buildDioramaTerrain(grid(0),'light',.7);
    expect(g.ground.getAttribute('position').count).toBe(0);expect(g.cliffs.getAttribute('position').count).toBe(0);
    g.ground.dispose();g.cliffs.dispose();
  });
  it('produit une géométrie soudée avec normales orientées vers l’extérieur',()=>{
    const g=buildDioramaTerrain(grid(),'light',.7),p=g.ground.getAttribute('position'),n=g.ground.getAttribute('normal');
    let index=0,max=0;for(let i=0;i<p.count;i++){const radius=Math.hypot(p.getX(i),p.getY(i),p.getZ(i));if(radius>max){max=radius;index=i}}
    const v=new THREE.Vector3().fromBufferAttribute(p,index),normal=new THREE.Vector3().fromBufferAttribute(n,index);
    expect(v.length()).toBeGreaterThan(1.05);expect(v.dot(normal)).toBeGreaterThan(0);
    expect(g.ground.getIndex()).not.toBeNull();
    g.ground.dispose();g.cliffs.dispose();
  });
});
