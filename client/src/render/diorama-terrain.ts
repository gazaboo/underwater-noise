/** Diorama du globe entier (d'après le pilote de Codex) : géographie ETOPO/NE, volumes et matières artistiques. */
import * as THREE from 'three';
import { earthDirection, sampleSurface, type SurfaceGrid } from './terrain-geometry.ts';

/** Toute la Terre ; au-delà de 84° N, il n'y a que la banquise (pas de terre à dresser). */
export const DIORAMA_REGION = { west: -180, east: 180, south: -90, north: 84 } as const;
export const DIORAMA_VIEWS = {
  overview: { label: 'Ensemble', lon: -40, lat: 12, zoom: 0.8 },
  grazing: { label: 'Vue rasante', lon: -105, lat: -10, zoom: 1.05 },
  detail: { label: 'Détail', lon: -74, lat: -11, zoom: 2.2 },
} as const;
export type DioramaView = keyof typeof DIORAMA_VIEWS;
const smooth = THREE.MathUtils.smoothstep;
/** Poids du relief : 1 partout (le pilote régional raccordait ses bords au rendu du reste du monde). */
export function pilotWeight(_lon: number, _lat: number): number {
  return 1;
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
  // Globe entier : socle et massifs plus modérés que dans le pilote régional (vus de loin, ils formaient
  // des palissades au limbe) ; les calottes glaciaires (≈ 3 000 m de glace) sont abaissées. Artistique.
  const polar=1-.7*smooth(Math.abs(lat),60,68);
  const massif=.2*Math.min(1.25,(alt/6000)**1.1)*(.95+.08*ridge**3)*(.96+.04*valley)*polar;
  return pilotWeight(lon,lat)*relief*(.05+massif);
}
export function groundPoint(grid: SurfaceGrid, lon:number,lat:number,relief:number): THREE.Vector3 {
  return earthDirection(lon,lat).multiplyScalar(1.0005+dioramaHeight(grid,lon,lat,relief));
}

interface Vertex { id: number; lon: number; lat: number; land: number }

/** Pas de la grille (degrés) : ≈ 28 km en expo, 39 km en léger. Artistique (compromis détail / GPU). */
export function dioramaStep(quality: 'expo'|'light'): number { return quality==='light'?.35:.25; }

export function buildDioramaTerrain(grid:SurfaceGrid,quality:'expo'|'light',relief:number): { ground:THREE.BufferGeometry; cliffs:THREE.BufferGeometry; coast: Array<[number,number]> } {
  const r=DIORAMA_REGION,step=dioramaStep(quality);
  const cols=Math.round((r.east-r.west)/step),rows=Math.round((r.north-r.south)/step);
  const lonOf=(x:number)=>r.west+x/cols*(r.east-r.west),latOf=(y:number)=>r.north-y/rows*(r.north-r.south);
  const positions:number[]=[],colors:number[]=[],uv:number[]=[],indices:number[]=[],sides:number[]=[],sideColors:number[]=[],sideUv:number[]=[];
  const coast:Array<[number,number]>=[];
  const green=new THREE.Color(),sand=new THREE.Color(.63,.49,.28),stone=new THREE.Color(.38,.35,.3),snow=new THREE.Color(.85,.87,.83),deep=new THREE.Color(.13,.25,.045);
  const colorAt=(lon:number,lat:number)=>{
    const s=sampleSurface(grid,lon,lat),alt=Math.max(0,s.altitude),n=naturalNoise(lon*2.1,lat*2.8);
    // Pentes sur une distance fixe au sol (les degrés de longitude raccourcissent vers les pôles).
    const k=.14/Math.max(.2,Math.cos(lat*Math.PI/180));
    const dx=sampleSurface(grid,lon+k,lat).altitude-sampleSurface(grid,lon-k,lat).altitude;
    const dy=sampleSurface(grid,lon,lat+.14).altitude-sampleSurface(grid,lon,lat-.14).altitude;
    const slope=Math.hypot(dx,dy);
    green.setRGB(.27+n*.09,.34+n*.08,.105+n*.04);
    green.lerp(deep,Math.min(1,s.forest)*.65);
    green.lerp(sand,(1-smooth(alt,70,650))*(1-s.forest)*.8);
    green.lerp(stone,Math.max(smooth(slope,180,900)*.85,smooth(alt,2300,4100)*.9));
    // Neiges : limite d'ordre de grandeur selon la latitude (≈ 5 000 m sous les tropiques, glaces polaires).
    const snowline=4900*Math.max(0,1-(Math.abs(lat)/70)**2)+150;
    green.lerp(snow,smooth(alt+250*n,snowline-300,snowline+900)*.92);
    if(Math.abs(lat)>60&&s.forest<.05)green.lerp(snow,smooth(Math.abs(lat),60,68)*.85);
    const valley=1-smooth(slope,80,650);green.multiplyScalar(.9+.13*n-.08*valley);
    return green;
  };
  let count=0;
  const addVertex=(lon:number,lat:number)=>{
    const p=groundPoint(grid,lon,lat,relief),c=colorAt(lon,lat);
    positions.push(p.x,p.y,p.z);colors.push(c.r,c.g,c.b);uv.push((lon+180)/360,(90-lat)/180);
    return count++;
  };
  // Un sommet par nœud (longitude bouclée : la couture de l'antiméridien est soudée), un par arête coupée.
  const nodeVertex=new Int32Array((rows+1)*cols).fill(-1);
  const edgeVertex=new Map<number,number>();
  const vertexOf=(v:Vertex)=>{
    if(v.id>=0){if(nodeVertex[v.id]<0)nodeVertex[v.id]=addVertex(v.lon,v.lat);return nodeVertex[v.id];}
    const key=-v.id;let i=edgeVertex.get(key);if(i===undefined){i=addVertex(v.lon,v.lat);edgeVertex.set(key,i);}return i;
  };
  const wall=(a:Vertex,b:Vertex)=>{
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
        sides.push(ps[k].x,ps[k].y,ps[k].z);sideColors.push(.41*band,.32*band,.205*band);
        const v=k<2||k===4?a:b;sideUv.push((v.lon+180)/360,(90-v.lat)/180);
      }
    }
  };
  const N=(rows+1)*cols;
  const clip=(triangle:Vertex[])=>{
    if(triangle[0].land<.5&&triangle[1].land<.5&&triangle[2].land<.5)return;
    if(triangle[0].land>=.5&&triangle[1].land>=.5&&triangle[2].land>=.5){indices.push(vertexOf(triangle[0]),vertexOf(triangle[1]),vertexOf(triangle[2]));return;}
    const polygon:Vertex[]=[];
    for(let i=0;i<3;i++){
      const a=triangle[i],b=triangle[(i+1)%3],inside=a.land>=.5,next=b.land>=.5;
      if(inside)polygon.push(a);
      if(inside!==next){
        const t=(.5-a.land)/(b.land-a.land);
        // Longitude interpolée sans traverser l'antiméridien à l'envers.
        let dl=b.lon-a.lon;if(dl>180)dl-=360;if(dl<-180)dl+=360;
        const lo=a.lon+dl*t;
        polygon.push({id:-(Math.min(a.id,b.id)*N+Math.max(a.id,b.id)+1),lon:lo>180?lo-360:lo<-180?lo+360:lo,lat:a.lat+(b.lat-a.lat)*t,land:.5});
      }
    }
    for(let i=1;i<polygon.length-1;i++)indices.push(vertexOf(polygon[0]),vertexOf(polygon[i]),vertexOf(polygon[i+1]));
    for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if(a.land===.5&&b.land===.5)wall(a,b)}
  };
  const nodes:Vertex[]=new Array(N);
  for(let y=0;y<=rows;y++)for(let x=0;x<cols;x++){
    const id=y*cols+x,lon=lonOf(x),lat=latOf(y);
    nodes[id]={id,lon,lat,land:sampleSurface(grid,lon,lat).land};
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const x1=(x+1)%cols,a=nodes[y*cols+x],b=nodes[y*cols+x1],c=nodes[(y+1)*cols+x],d=nodes[(y+1)*cols+x1];
    clip([a,c,b]);clip([b,c,d]);
  }
  const ground=new THREE.BufferGeometry();
  ground.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));ground.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));ground.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  ground.setIndex(count>65535?new THREE.Uint32BufferAttribute(indices,1):new THREE.Uint16BufferAttribute(indices,1));
  ground.computeVertexNormals();ground.computeBoundingSphere();
  const cliffs=new THREE.BufferGeometry();
  cliffs.setAttribute('position',new THREE.Float32BufferAttribute(sides,3));cliffs.setAttribute('color',new THREE.Float32BufferAttribute(sideColors,3));cliffs.setAttribute('uv',new THREE.Float32BufferAttribute(sideUv,2));
  cliffs.computeVertexNormals();cliffs.computeBoundingSphere();
  return {ground,cliffs,coast};
}
