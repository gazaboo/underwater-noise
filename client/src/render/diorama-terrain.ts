/** Pilote : géographie ETOPO/NE, volumes et matières artistiques. */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { earthDirection, sampleSurface, type SurfaceGrid } from './terrain-geometry.ts';

export const DIORAMA_REGION = { west: -88, east: -48, south: -30, north: 5 } as const;
export const DIORAMA_VIEWS = {
  overview: { label: 'Ensemble', lon: -69, lat: -12, zoom: 1.05 },
  grazing: { label: 'Vue rasante', lon: -105, lat: -10, zoom: 1.05 },
  detail: { label: 'Détail', lon: -74, lat: -11, zoom: 2.2 },
} as const;
export type DioramaView = keyof typeof DIORAMA_VIEWS;
const smooth = THREE.MathUtils.smoothstep;
export function pilotWeight(lon: number, lat: number): number {
  const r = DIORAMA_REGION;
  return smooth(Math.min(lon-r.west,r.east-lon,lat-r.south,r.north-lat),0,4);
}
export function naturalNoise(x: number, y: number): number {
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const h=(a:number,b:number)=>{const v=Math.sin(a*127.1+b*311.7)*43758.5453;return v-Math.floor(v)};
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(ix,iy),h(ix+1,iy),u),THREE.MathUtils.lerp(h(ix,iy+1),h(ix+1,iy+1),u),v);
}
export function dioramaHeight(grid: SurfaceGrid, lon: number, lat: number, relief: number): number {
  const s=sampleSurface(grid,lon,lat),alt=Math.max(0,s.altitude);
  const ridge=1-Math.abs(naturalNoise(lon*.85+lat*.3,lat*1.1)*2-1);
  const valley=naturalNoise(lon*1.9-lat*.5,lat*2.1);
  // Le socle et les sommets ont une échelle distincte ; ce n'est pas une altitude métrique.
  const massif=.39*Math.min(1.25,(alt/6000)**1.15)*(.95+.08*ridge**3)*(.96+.04*valley);
  return pilotWeight(lon,lat)*relief*(.095+massif);
}
export function groundPoint(grid: SurfaceGrid, lon:number,lat:number,relief:number): THREE.Vector3 {
  return earthDirection(lon,lat).multiplyScalar(1.0005+dioramaHeight(grid,lon,lat,relief));
}

interface Vertex { lon: number; lat: number; land: number }
export function buildDioramaTerrain(grid:SurfaceGrid,quality:'expo'|'light',relief:number): { ground:THREE.BufferGeometry; cliffs:THREE.BufferGeometry; coast: Array<[number,number]> } {
  const r=DIORAMA_REGION,step=quality==='light'?.15:.1;
  const cols=Math.ceil((r.east-r.west)/step),rows=Math.ceil((r.north-r.south)/step);
  const positions:number[]=[],colors:number[]=[],uv:number[]=[],sides:number[]=[],sideColors:number[]=[],sideUv:number[]=[];
  const coast:Array<[number,number]>=[];
  const green=new THREE.Color(),sand=new THREE.Color(.63,.49,.28),stone=new THREE.Color(.38,.35,.3),snow=new THREE.Color(.85,.87,.83);
  const colorAt=(lon:number,lat:number)=>{
    const s=sampleSurface(grid,lon,lat),alt=Math.max(0,s.altitude),n=naturalNoise(lon*2.1,lat*2.8);
    const dx=sampleSurface(grid,lon+.14,lat).altitude-sampleSurface(grid,lon-.14,lat).altitude;
    const dy=sampleSurface(grid,lon,lat+.14).altitude-sampleSurface(grid,lon,lat-.14).altitude;
    const slope=Math.hypot(dx,dy);
    green.setRGB(.27+n*.09,.34+n*.08,.105+n*.04);
    green.lerp(new THREE.Color(.13,.25,.045),Math.min(1,s.forest)*.65);
    green.lerp(sand,(1-smooth(alt,70,650))*(1-s.forest)*.8);
    green.lerp(stone,Math.max(smooth(slope,180,900)*.85,smooth(alt,2300,4100)*.9));
    green.lerp(snow,smooth(alt+250*n,4200,5600)*.92);
    const valley=1-smooth(slope,80,650);green.multiplyScalar(.9+.13*n-.08*valley);
    return green;
  };
  const append=(v:Vertex)=>{
    const p=groundPoint(grid,v.lon,v.lat,relief),c=colorAt(v.lon,v.lat);
    positions.push(p.x,p.y,p.z);colors.push(c.r,c.g,c.b);uv.push((v.lon+180)/360,(90-v.lat)/180);
  };
  const wall=(a:Vertex,b:Vertex)=>{
    if(Math.min(pilotWeight(a.lon,a.lat),pilotWeight(b.lon,b.lat))<.01)return;
    coast.push([(a.lon+b.lon)/2,(a.lat+b.lat)/2]);
    const levels=[1,.77,.52,.28,0];
    const point=(v:Vertex,l:number)=>{
      const h=dioramaHeight(grid,v.lon,v.lat,relief);
      const ledge=l===0?0:Math.sin(l*13+v.lon*5+v.lat*4)*.0003*relief;
      return earthDirection(v.lon,v.lat).multiplyScalar(1.0003+h*l+ledge);
    };
    for(let j=0;j<levels.length-1;j++){
      const ps=[point(a,levels[j]),point(a,levels[j+1]),point(b,levels[j]),point(b,levels[j]),point(a,levels[j+1]),point(b,levels[j+1])];
      const band=j%2?.75:1;
      for(let k=0;k<6;k++){
        sides.push(...ps[k].toArray());sideColors.push(.41*band,.32*band,.205*band);
        const v=k<2||k===4?a:b;sideUv.push((v.lon+180)/360,(90-v.lat)/180);
      }
    }
  };
  const clip=(triangle:Vertex[])=>{
    const polygon:Vertex[]=[];
    for(let i=0;i<3;i++){
      const a=triangle[i],b=triangle[(i+1)%3],inside=a.land>=.5,next=b.land>=.5;
      if(inside)polygon.push(a);
      if(inside!==next){const t=(.5-a.land)/(b.land-a.land);polygon.push({lon:a.lon+(b.lon-a.lon)*t,lat:a.lat+(b.lat-a.lat)*t,land:.5})}
    }
    for(let i=1;i<polygon.length-1;i++){append(polygon[0]);append(polygon[i]);append(polygon[i+1])}
    for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if(a.land===.5&&b.land===.5)wall(a,b)}
  };
  const nodes:Vertex[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
    const lon=r.west+x/cols*(r.east-r.west),lat=r.north-y/rows*(r.north-r.south);
    nodes.push({lon,lat,land:sampleSurface(grid,lon,lat).land});
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const i=y*(cols+1)+x;clip([nodes[i],nodes[i+cols+1],nodes[i+1]]);clip([nodes[i+1],nodes[i+cols+1],nodes[i+cols+2]]);
  }
  const geometry=(p:number[],c:number[],t:number[])=>{
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(t,2));
    g.computeVertexNormals();g.computeBoundingSphere();return g;
  };
  // Sommets soudés pour des massifs continus ; le grain reste dans la matière.
  const raw=geometry(positions,colors,uv);raw.deleteAttribute('normal');
  const ground=mergeVertices(raw,1e-5);raw.dispose();ground.computeVertexNormals();
  return {ground,cliffs:geometry(sides,sideColors,sideUv),coast};
}
