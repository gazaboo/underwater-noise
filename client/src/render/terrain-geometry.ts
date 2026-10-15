/** Géographie sourcée ; hauteur et simplification des volumes purement artistiques. */
import * as THREE from 'three';

export interface SurfaceGrid {
  width: number;
  height: number;
  altitude: Float32Array;
  land: Float32Array;
  forest: Float32Array;
}

export function sampleSurface(grid: SurfaceGrid, lon: number, lat: number): { altitude: number; land: number; forest: number } {
  const x = ((lon+180)/360*grid.width-0.5), y = (90-Math.max(-90,Math.min(90,lat)))/180*grid.height-0.5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x-ix, fy = y-iy;
  const index = (a: number, b: number) => Math.max(0,Math.min(grid.height-1,b))*grid.width+((a%grid.width)+grid.width)%grid.width;
  const read = (array: Float32Array) => THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(array[index(ix,iy)],array[index(ix+1,iy)],fx),
    THREE.MathUtils.lerp(array[index(ix,iy+1)],array[index(ix+1,iy+1)],fx),fy);
  return { altitude: read(grid.altitude), land: read(grid.land), forest: read(grid.forest) };
}

export function terrainHeight(altitude: number, land: number): number {
  // Plateau continental surélevé + montagnes : aucune équivalence métrique revendiquée.
  return THREE.MathUtils.smoothstep(land,0.35,0.85)*(0.022+0.095*(Math.max(0,Math.min(8500,altitude))/8500)**0.7);
}
export function earthDirection(lon: number, lat: number): THREE.Vector3 {
  const la = lat*Math.PI/180, lo = lon*Math.PI/180;
  return new THREE.Vector3(Math.cos(la)*Math.sin(lo),Math.sin(la),Math.cos(la)*Math.cos(lo));
}

export function buildTerrainGeometry(grid: SurfaceGrid, columns: number, rows: number, relief: number): THREE.BufferGeometry {
  const positions: number[] = [], uv: number[] = [], heights: number[] = [], indices: number[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const lon = x/columns*360-180, lat = 90-y/rows*180;
    const s = sampleSurface(grid,lon,lat), h = terrainHeight(s.altitude,s.land);
    positions.push(...earthDirection(lon,lat).multiplyScalar(1+h*relief).toArray());
    heights.push(h); uv.push(x/columns,y/rows);
    if (x < columns && y < rows) {
      const i = y*(columns+1)+x;
      indices.push(i,i+columns+1,i+1, i+1,i+columns+1,i+columns+2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('height',new THREE.Float32BufferAttribute(heights,1));
  g.setIndex(indices); updateTerrainRelief(g,relief,columns,rows); return g;
}
export function updateTerrainRelief(g: THREE.BufferGeometry, relief: number, columns: number, rows: number): void {
  const p = g.getAttribute('position'), h = g.getAttribute('height'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p,i).normalize().multiplyScalar(1+h.getX(i)*relief);
    p.setXYZ(i,v.x,v.y,v.z);
  }
  p.needsUpdate = true; g.computeVertexNormals();
  // Les deux copies de l'antiméridien partagent une normale ; les pôles restent radiaux.
  const n = g.getAttribute('normal');
  for (let y = 0; y <= rows; y++) {
    const a = y*(columns+1), b = a+columns;
    v.set(n.getX(a)+n.getX(b),n.getY(a)+n.getY(b),n.getZ(a)+n.getZ(b)).normalize();
    n.setXYZ(a,v.x,v.y,v.z); n.setXYZ(b,v.x,v.y,v.z);
  }
  for (let x = 0; x <= columns; x++) { n.setXYZ(x,0,1,0); n.setXYZ(rows*(columns+1)+x,0,-1,0); }
  n.needsUpdate = true; g.computeBoundingSphere();
}
