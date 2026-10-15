import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTerrainGeometry, earthDirection, sampleSurface, terrainHeight, updateTerrainRelief, type SurfaceGrid } from '../src/render/terrain-geometry.ts';

function grid(): SurfaceGrid {
  return { width:4,height:2,altitude:new Float32Array(8).fill(4000),land:new Float32Array(8).fill(1),forest:new Float32Array(8).fill(0.7) };
}
describe('surface géographique et relief artistique',()=>{
  it('interpole après décodage, boucle en longitude et borne les pôles',()=>{
    const g=grid();g.altitude.set([0,100,200,300,0,100,200,300]);
    expect(sampleSurface(g,180,0)).toEqual(sampleSurface(g,-180,0));
    expect(sampleSurface(g,0,90)).toEqual(sampleSurface(g,0,100));
    expect(sampleSurface(g,0,0).altitude).toBeCloseTo(150);
  });
  it('garde les océans sur la sphère et soulève les montagnes',()=>{
    expect(terrainHeight(-4000,0)).toBe(0);
    expect(terrainHeight(6000,1)).toBeGreaterThan(terrainHeight(100,1));
    expect(earthDirection(0,0).toArray()).toEqual([0,0,1]);
    expect(earthDirection(90,0).x).toBeCloseTo(1);
  });
  it('déforme réellement la géométrie et retrouve une sphère au relief nul',()=>{
    const geometry=buildTerrainGeometry(grid(),16,8,1),position=geometry.getAttribute('position');
    const p=new THREE.Vector3().fromBufferAttribute(position,40);
    expect(p.length()).toBeGreaterThan(1.05);
    updateTerrainRelief(geometry,0,16,8);
    expect(new THREE.Vector3().fromBufferAttribute(position,40).length()).toBeCloseTo(1,6);
    geometry.dispose();
  });
  it('oriente les faces vers l’extérieur et ferme la couture',()=>{
    const geometry=buildTerrainGeometry(grid(),16,8,0.7),p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
    const ix=geometry.getIndex()!,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    a.fromBufferAttribute(p,ix.getX(96));b.fromBufferAttribute(p,ix.getX(97));c.fromBufferAttribute(p,ix.getX(98));
    expect(b.sub(a).cross(c.sub(a)).dot(a)).toBeGreaterThan(0);
    for(let y=0;y<=8;y++){
      a.fromBufferAttribute(p,y*17);b.fromBufferAttribute(p,y*17+16);expect(a.distanceTo(b)).toBeLessThan(1e-6);
      a.fromBufferAttribute(n,y*17);b.fromBufferAttribute(n,y*17+16);expect(a.distanceTo(b)).toBeLessThan(1e-6);
    }
    geometry.dispose();
  });
});
