/** Globe 3D : surface ETOPO, ornements instanciés, ombres et picking sur le relief réel. */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import type { WorldAssets, Volcano } from '../assets.ts';
import type { GlobeCamera } from './globe-view.ts';
import { buildTerrainGeometry, earthDirection, sampleSurface, terrainHeight, updateTerrainRelief, type SurfaceGrid } from './terrain-geometry.ts';

function pixels(image: ImageBitmap, width: number, height: number): Uint8ClampedArray {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false; ctx.drawImage(image,0,0,width,height);
  return ctx.getImageData(0,0,width,height).data;
}
export function readSurface(assets: WorldAssets, width = 1024): SurfaceGrid {
  const height = width / 2;
  const e = pixels(assets.elevationNearest.image as ImageBitmap,width,height);
  const c = pixels(assets.landcover.image as ImageBitmap,width,height);
  const altitude = new Float32Array(width*height), land = new Float32Array(width*height), forest = new Float32Array(width*height);
  for (let i = 0; i < altitude.length; i++) {
    altitude[i] = e[i*4]*256+e[i*4+1]-11000; land[i] = e[i*4+2]/255; forest[i] = c[i*4+3]/255;
  }
  return { width,height,altitude,land,forest };
}
const SHADOW = /* glsl */ `
uniform sampler2D uShadow;
uniform float uShadowTexel;
varying vec4 vShadow;
float visibility() {
  vec3 p = vShadow.xyz/vShadow.w*0.5+0.5;
  if (min(p.x,p.y)<0.0 || max(p.x,p.y)>1.0 || p.z>1.0) return 1.0;
  float sum = 0.0;
  for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++)
    sum += step(p.z-0.002, texture2D(uShadow,p.xy+vec2(float(x),float(y))*uShadowTexel).r);
  return sum/9.0;
}
`;
const TERRAIN_VERT = /* glsl */ `
uniform mat4 uShadowMatrix;
varying vec2 vUv;
varying vec3 vNormal, vPosition;
varying vec4 vShadow;
void main() {
  vUv=uv; vNormal=normalize(normalMatrix*normal);
  vec4 world=modelMatrix*vec4(position,1.0);
  vPosition=(viewMatrix*world).xyz;
  vShadow=uShadowMatrix*world;
  gl_Position=projectionMatrix*vec4(vPosition,1.0);
}
`;
const TERRAIN_FRAG = /* glsl */ `
uniform sampler2D uWorld, uLand;
uniform float uFaceted;
varying vec2 vUv;
varying vec3 vNormal, vPosition;
${SHADOW}
void main() {
  // Reparamétrisation continue à l'antiméridien pour les dérivées des mipmaps.
  float u1=vUv.x, u2=fract(u1+0.5)-0.5;
  vec2 a=vec2(dFdx(u1),dFdy(u1)),b=vec2(dFdx(u2),dFdy(u2));
  vec2 du=dot(a,a)<=dot(b,b)?a:b;
  vec3 col=textureGrad(uWorld,vec2(fract(u1),1.0-vUv.y),vec2(du.x,-dFdx(vUv.y)),vec2(du.y,-dFdy(vUv.y))).rgb;
  float land=smoothstep(0.42,0.58,texture2D(uLand,vUv).b);
  vec3 n=normalize(vNormal);
  if(uFaceted>0.5) n=normalize(cross(dFdx(vPosition),dFdy(vPosition)));
  float diffuse=max(dot(n,normalize(vec3(-0.6,0.8,1.0))),0.0);
  float shade=visibility();
  vec3 lit=col*(0.64+0.6*diffuse*shade);
  lit+=col*vec3(0.13,0.08,0.01)*diffuse;
  // Océan et données acoustiques émissifs : pas d'extinction par les ombres terrestres.
  gl_FragColor=vec4(mix(col,lit,land),1.0);
}
`;
const OBJECT_VERT = /* glsl */ `
uniform mat4 uShadowMatrix;
uniform float uTime, uSmoke;
varying vec3 vNormal, vPosition, vColor;
varying vec4 vShadow;
void main() {
  vec3 p=position;
  if(uSmoke>0.5) p.x+=sin(uTime*0.6+instanceMatrix[3].y*17.0)*0.15*p.y;
  vec4 world=modelMatrix*instanceMatrix*vec4(p,1.0);
  vPosition=(viewMatrix*world).xyz;
  vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);
  vColor=instanceColor;
  vShadow=uShadowMatrix*world;
  gl_Position=projectionMatrix*vec4(vPosition,1.0);
}
`;
const OBJECT_FRAG = /* glsl */ `
uniform float uLight, uFaceted, uSmoke;
uniform vec3 uTint;
varying vec3 vNormal, vPosition, vColor;
${SHADOW}
void main() {
  vec3 n=normalize(vNormal);
  if(uFaceted>0.5)n=normalize(cross(dFdx(vPosition),dFdy(vPosition)));
  float d=max(dot(n,normalize(vec3(-0.6,0.8,1.0))),0.0);
  float grain=0.97+0.03*sin(vPosition.x*2800.0)*sin(vPosition.y*2300.0);
  vec3 c=vColor*uTint*uLight*(0.6+0.62*d*visibility())*grain;
  gl_FragColor=vec4(c,uSmoke>0.5?0.62:1.0);
}
`;

interface TerrainEntry { mesh: THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>; columns: number; rows: number; relief: number }
export class SculptedGlobe {
  private readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly shadowCamera = new THREE.OrthographicCamera(-1.35,1.35,1.35,-1.35,0.1,12);
  private readonly depth = new THREE.MeshDepthMaterial();
  private readonly raycaster = new THREE.Raycaster();
  private readonly geometries = new Map<string,TerrainEntry>();
  private readonly target = new THREE.WebGLRenderTarget(1,1,{ depthBuffer: true });
  private readonly shadowTarget = new THREE.WebGLRenderTarget(1024,1024,{ depthBuffer: true });
  private readonly uniforms = {
    uWorld: { value: null as THREE.Texture | null }, uLand: { value: null as THREE.Texture | null },
    uShadow: { value: null as THREE.Texture | null }, uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: 1/1024 }, uFaceted: { value: 0 }, uLight: { value: 1 },
    uTint: { value: new THREE.Vector3(1,1,1) }, uTime: { value: 0 },
  };
  private grid: SurfaceGrid | null = null;
  private terrain: TerrainEntry | null = null;
  private ornaments = new THREE.Group();
  private smoke: THREE.InstancedMesh | null = null;
  private ornamentKey = '';

  constructor(private readonly assets: WorldAssets, private readonly volcanoes: Volcano[]) {
    this.root.matrixAutoUpdate=false; this.scene.add(this.root);
    this.shadowCamera.position.set(-3,4,5); this.shadowCamera.lookAt(0,0,0); this.shadowCamera.updateMatrixWorld();
    this.shadowTarget.depthTexture=new THREE.DepthTexture(1024,1024,THREE.UnsignedIntType);
    this.uniforms.uShadow.value=this.shadowTarget.depthTexture;
    this.uniforms.uLand.value=assets.elevationLinear;
    this.uniforms.uShadowMatrix.value.multiplyMatrices(this.shadowCamera.projectionMatrix,this.shadowCamera.matrixWorldInverse);
  }
  private objectMaterial(smoke = false): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ uniforms: { ...this.uniforms, uSmoke: { value: smoke?1:0 } },
      vertexShader: OBJECT_VERT, fragmentShader: OBJECT_FRAG, transparent: smoke, depthWrite: !smoke });
  }
  private makeInstances(geometry: THREE.BufferGeometry, count: number, material: THREE.ShaderMaterial): THREE.InstancedMesh {
    const mesh=new THREE.InstancedMesh(geometry,material,count);
    // Instancing shaders require instanceColor even for empty sets.
    mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(count*3).fill(1),3);
    mesh.frustumCulled=false; this.ornaments.add(mesh); return mesh;
  }
  private clearOrnaments(): void {
    this.ornaments.traverse(o=>{ if(o instanceof THREE.InstancedMesh){ o.geometry.dispose(); (o.material as THREE.Material).dispose(); o.dispose(); } });
    this.root.remove(this.ornaments); this.ornaments=new THREE.Group(); this.root.add(this.ornaments); this.smoke=null;
  }
  private rebuildOrnaments(cfg: Config, faceted: boolean): void {
    this.clearOrnaments();
    if(!cfg.land.ornaments.enabled)return;
    const grid=this.grid!, relief=cfg.scene.relief;
    const seed=(n:number)=>{ const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s); };
    const trees: Array<{ lon:number;lat:number;seed:number }> = [];
    const step=cfg.display.quality==='light'?3:2;
    for(let lat=-64;lat<76;lat+=step) for(let lon=-180;lon<180;lon+=step){
      const id=(lat+90)*1000+lon+180, la=lat+seed(id)*step,lo=lon+seed(id+7)*step;
      const s=sampleSurface(grid,lo,la);
      if(s.land>0.9 && seed(id+3)<s.forest*cfg.land.ornaments.treeDensity*1.5*Math.cos(la*Math.PI/180))trees.push({lon:lo,lat:la,seed:seed(id+9)});
    }
    const trunk=this.makeInstances(new THREE.CylinderGeometry(0.11,0.16,1,5),trees.length,this.objectMaterial());
    const crown=this.makeInstances(faceted?new THREE.ConeGeometry(1,2,5):new THREE.IcosahedronGeometry(1,1),trees.length,this.objectMaterial());
    const crown2=this.makeInstances(faceted?new THREE.ConeGeometry(1,1.5,5):new THREE.IcosahedronGeometry(1,1),trees.length,this.objectMaterial());
    const matrix=new THREE.Matrix4(), rotation=new THREE.Quaternion(), scale=new THREE.Vector3(), y=new THREE.Vector3(0,1,0);
    const color=new THREE.Color();
    const place=(mesh:THREE.InstancedMesh,i:number,lon:number,lat:number,height:number,sx:number,sy:number,sz:number,offset:number)=>{
      const dir=earthDirection(lon,lat),s=sampleSurface(grid,lon,lat),r=1+terrainHeight(s.altitude,s.land)*relief;
      rotation.setFromUnitVectors(y,dir);scale.set(sx,sy,sz);
      matrix.compose(dir.multiplyScalar(r+height*offset),rotation,scale);mesh.setMatrixAt(i,matrix);
    };
    trees.forEach((t,i)=>{
      const h=(0.016+t.seed*0.015)*(0.4+0.6*relief),r=h*(faceted?0.33:0.38);
      place(trunk,i,t.lon,t.lat,h,h*0.18,h,h*0.18,0.5);trunk.setColorAt(i,color.setRGB(0.27,0.2,0.12));
      place(crown,i,t.lon,t.lat,h,r,faceted?h*0.65:h*0.42,r,0.9);
      crown.setColorAt(i,color.setRGB(0.25+t.seed*0.12,0.43+t.seed*0.17,0.12+t.seed*0.06));
      place(crown2,i,t.lon+0.18,t.lat+0.1,h,r*0.7,h*0.34,r*0.75,1.25);
      crown2.setColorAt(i,color.setRGB(0.38+t.seed*0.13,0.54+t.seed*0.15,0.18+t.seed*0.08));
    });
    const volcanoes=cfg.land.ornaments.volcanoes?this.volcanoes:[];
    const cone=this.makeInstances(new THREE.ConeGeometry(1,1,faceted?5:12),volcanoes.length,this.objectMaterial());
    const crater=this.makeInstances(new THREE.TorusGeometry(0.27,0.12,4,12).rotateX(Math.PI/2),volcanoes.length,this.objectMaterial());
    volcanoes.forEach((v,i)=>{
      const h=(0.009+Math.max(0,Math.min(5000,v[2]))/5000*0.02)*(0.4+0.6*relief);
      place(cone,i,v[0],v[1],h,h*0.55,h,h*0.55,0.5);cone.setColorAt(i,color.setRGB(0.54,0.4,0.28));
      place(crater,i,v[0],v[1],h,h*0.5,h*0.25,h*0.5,0.87);crater.setColorAt(i,color.setRGB(0.2,0.16,0.12));
    });
    const active=volcanoes.filter(v=>v[3]!==null && v[3]>=cfg.land.ornaments.smokeSinceYear);
    this.smoke=this.makeInstances(new THREE.IcosahedronGeometry(1,1),active.length*3,this.objectMaterial(true));
    active.forEach((v,i)=>{for(let j=0;j<3;j++){
      const h=(0.009+Math.max(0,Math.min(5000,v[2]))/5000*0.02)*(0.4+0.6*relief),r=0.002+j*0.002;
      place(this.smoke!,i*3+j,v[0]+j*0.12,v[1],h,r,r*1.3,r,1.3+j*0.6);
      this.smoke!.setColorAt(i*3+j,color.setRGB(0.75,0.72,0.65));
    }});
  }
  render(renderer: THREE.WebGLRenderer, world: THREE.Texture, cam: GlobeCamera, M: THREE.Matrix3, cfg: Config, width:number,height:number,time:number): THREE.Texture {
    this.grid??=readSurface(this.assets);
    const faceted=cfg.scene.style==='faceted', light=cfg.display.quality==='light';
    const key=`${faceted}:${light}`;
    if(!this.geometries.has(key)){
      const columns=faceted?(light?128:192):(light?256:512),rows=columns/2;
      const geometry=buildTerrainGeometry(this.grid,columns,rows,cfg.scene.relief);
      const material=new THREE.ShaderMaterial({ uniforms:this.uniforms, vertexShader:TERRAIN_VERT, fragmentShader:TERRAIN_FRAG });
      this.geometries.set(key,{mesh:new THREE.Mesh(geometry,material),columns,rows,relief:cfg.scene.relief});
    }
    const entry=this.geometries.get(key)!;
    if(this.terrain!==entry){if(this.terrain)this.root.remove(this.terrain.mesh);this.terrain=entry;this.root.add(entry.mesh);}
    if(entry.relief!==cfg.scene.relief){updateTerrainRelief(entry.mesh.geometry,cfg.scene.relief,entry.columns,entry.rows);entry.relief=cfg.scene.relief;}
    const o=cfg.land.ornaments;
    const ornamentKey=JSON.stringify([key,cfg.scene.relief,o.enabled,o.treeDensity,o.volcanoes,o.smokeSinceYear]);
    if(this.ornamentKey!==ornamentKey){this.rebuildOrnaments(cfg,faceted);this.ornamentKey=ornamentKey;}
    this.root.matrix.setFromMatrix3(M).invert();this.root.matrixWorldNeedsUpdate=true;
    this.camera.position.set(0,0,cam.dist);this.camera.fov=2*Math.atan(cam.tanHalf)*180/Math.PI;
    this.camera.aspect=width/height;this.camera.near=0.1;this.camera.far=10;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
    const shadowSize=light?1024:2048;
    if(this.shadowTarget.width!==shadowSize)this.shadowTarget.setSize(shadowSize,shadowSize);
    this.uniforms.uShadowTexel.value=1/shadowSize;
    this.uniforms.uWorld.value=world;this.uniforms.uFaceted.value=faceted?1:0;
    this.uniforms.uLight.value=cfg.palette.landLight;this.uniforms.uTime.value=time;
    const tint=parseInt(cfg.palette.landTint.slice(1),16);
    this.uniforms.uTint.value.set(((tint>>16)&255)/255,((tint>>8)&255)/255,(tint&255)/255);
    if(this.target.width!==width || this.target.height!==height)this.target.setSize(width,height);
    const samples=light?0:4;
    if(this.target.samples!==samples){this.target.samples=samples;this.target.dispose();}
    const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
    renderer.setClearColor(0,0);
    this.scene.overrideMaterial=this.depth;
    if(this.smoke)this.smoke.visible=false;
    renderer.setRenderTarget(this.shadowTarget);renderer.clear();renderer.render(this.scene,this.shadowCamera);
    this.scene.overrideMaterial=null;if(this.smoke)this.smoke.visible=true;
    renderer.setRenderTarget(this.target);renderer.clear();renderer.render(this.scene,this.camera);
    renderer.setClearColor(clear,alpha);
    return this.target.texture;
  }
  /** Coordonnées sous la surface réellement dessinée, sans les ornements décoratifs. */
  pixelToGeo(x:number,y:number,width:number,height:number): [number,number] | null {
    if(!this.terrain)return null;
    this.raycaster.setFromCamera(new THREE.Vector2(x/width*2-1,y/height*2-1),this.camera);
    const hit=this.raycaster.intersectObject(this.terrain.mesh,false)[0];
    return hit?.uv ? [90-hit.uv.y*180,hit.uv.x*360-180] : null;
  }
}
