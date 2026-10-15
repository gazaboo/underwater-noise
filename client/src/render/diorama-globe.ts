/** Miniature naturelle du globe entier (d'après le pilote régional de Codex) : modèles Blender originaux, terrain séparé des données océaniques. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Config } from '@vacarme/shared';
import type { WorldAssets, Volcano } from '../assets.ts';
import type { GlobeCamera } from './globe-view.ts';
import { readSurface } from './sculpted-globe.ts';
import { earthDirection, sampleSurface, type SurfaceGrid } from './terrain-geometry.ts';
import { buildDioramaTerrain, groundPoint, pilotWeight, naturalNoise, DIORAMA_REGION } from './diorama-terrain.ts';

const ASSETS=['tropical-a','tropical-b','layered-a','layered-b','shrub-a','shrub-b','volcano-a','volcano-b','rock-a','rock-b'] as const;
type AssetName=typeof ASSETS[number];
type Model={geometry:THREE.BufferGeometry;material:THREE.MeshStandardMaterial};
export type DioramaStatus='idle'|'loading'|'ready'|'error';
const BODY_VERT=`varying vec3 vEarth; void main(){vEarth=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const BODY_FRAG=`
uniform sampler2D uWorld; varying vec3 vEarth;
void main(){
 vec3 p=normalize(vEarth);float u=atan(p.x,p.z)/6.28318530718+0.5,v=asin(clamp(p.y,-1.0,1.0))/3.14159265359+0.5;
 float u2=fract(u+0.5)-0.5;vec2 a=vec2(dFdx(u),dFdy(u)),b=vec2(dFdx(u2),dFdy(u2));vec2 du=dot(a,a)<dot(b,b)?a:b;
 vec3 c=textureGrad(uWorld,vec2(fract(u),v),vec2(du.x,dFdx(v)),vec2(du.y,dFdy(v))).rgb;
 gl_FragColor=vec4(c,1.0);
}`;
const SMOKE_VERT=`
attribute vec3 aNormal,aEast;attribute float aPhase;uniform float uTime,uHeight;
varying float vOpacity;
void main(){float age=fract(uTime*0.09+aPhase);vec3 p=position+aNormal*(0.075*age)+aEast*(0.025*age*age+sin(age*8.0+uTime)*0.002);
 vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;
 gl_PointSize=min(90.0,uHeight*projectionMatrix[1][1]*(0.006+age*0.015)/max(0.1,-mv.z));
 vOpacity=sin(age*3.14159265)*0.34;
}`;
const SMOKE_FRAG=`varying float vOpacity;uniform float uDay;void main(){vec2 p=gl_PointCoord*2.0-1.0;
float r=length(p);float noise=0.85+0.15*sin(p.x*17.0+sin(p.y*13.0));float a=(1.0-smoothstep(0.15,1.0,r))*vOpacity*noise;
if(a<0.005)discard;gl_FragColor=vec4(vec3(0.58,0.6,0.57)*(0.3+0.7*uDay),a);}`;

export class DioramaGlobe {
  status:DioramaStatus='idle';
  error='';
  private readonly scene=new THREE.Scene();
  private readonly root=new THREE.Group();
  private readonly camera=new THREE.PerspectiveCamera();
  private readonly sun=new THREE.DirectionalLight(0xffedcf,2);
  private readonly ambient=new THREE.HemisphereLight(0xc8e1ee,0x594532,1);
  private readonly raycaster=new THREE.Raycaster();
  private readonly body=new THREE.Mesh(new THREE.SphereGeometry(1,192,96),new THREE.ShaderMaterial({uniforms:{uWorld:{value:null}},vertexShader:BODY_VERT,fragmentShader:BODY_FRAG}));
  private readonly lightUniform={value:1};
  private readonly worldUniform={value:null as THREE.Texture|null};
  private readonly target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true});
  private grid:SurfaceGrid|null=null;
  private readonly libraries=new Map<string,Map<AssetName,Model>>();
  private loadingQuality='';
  private generation=0;
  private landscape=new THREE.Group();
  private ground:THREE.Mesh|null=null;
  private cliffs:THREE.Mesh|null=null;
  private smoke:THREE.Points<THREE.BufferGeometry,THREE.ShaderMaterial>|null=null;
  private buildKey='';
  private readonly terrains=new Map<string,ReturnType<typeof buildDioramaTerrain>>();

  constructor(private readonly assets:WorldAssets,private readonly volcanoes:Volcano[]){
    this.root.matrixAutoUpdate=false;this.root.add(this.body,this.landscape);this.scene.add(this.root,this.sun,this.sun.target,this.ambient);
    this.sun.castShadow=true;this.sun.shadow.bias=-.0003;this.sun.shadow.normalBias=.0015;
    // Ombres sur toute la face visible (relief jusqu'à ≈ 1,3 rayon) : boîte centrée sur la Terre.
    const c=this.sun.shadow.camera;c.left=-1.45;c.right=1.45;c.top=1.45;c.bottom=-1.45;c.near=.1;c.far=10;c.updateProjectionMatrix();
  }
  ensureLoaded(quality:Config['display']['quality']):void{
    if(this.libraries.has(quality)){if(this.loadingQuality!==quality){this.generation++;this.loadingQuality=quality}this.status='ready';return}
    if(this.status==='loading'&&this.loadingQuality===quality||this.status==='error'&&this.loadingQuality===quality)return;
    this.status='loading';this.loadingQuality=quality;const generation=++this.generation;
    const loader=new GLTFLoader();
    void Promise.all(ASSETS.map(async name=>{
      const gltf=await loader.loadAsync(`/models/diorama/${name}${quality==='light'?'-light':''}.glb`);
      gltf.scene.updateMatrixWorld(true);let model:Model|null=null;
      gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){
        const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);geometry.computeVertexNormals();
        const source=Array.isArray(o.material)?o.material[0]:o.material;
        const material=(source as THREE.MeshStandardMaterial).clone();material.roughness=.91;material.metalness=0;material.toneMapped=false;material.vertexColors=true;
        model={geometry,material};o.geometry.dispose();
        for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();
      }});
      if(!model)throw new Error(`Modèle ${name} vide`);
      return [name,model] as [AssetName,Model];
    })).then(entries=>{this.libraries.set(quality,new Map(entries));if(generation===this.generation){this.status='ready';this.error=''}})
      .catch(e=>{if(generation===this.generation){this.status='error';this.error=String(e);console.error('[diorama]',e)}});
  }
  retry():void{this.status='idle';this.error='';this.loadingQuality=''}
  private groundMaterial():THREE.MeshStandardMaterial{
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,metalness:0,side:THREE.DoubleSide,toneMapped:false});
    material.onBeforeCompile=shader=>{
      shader.uniforms.uDioramaWorld=this.worldUniform;shader.uniforms.uDioramaLight=this.lightUniform;
      shader.vertexShader='varying vec2 vPilotUv; varying vec3 vPigmentPosition;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPigmentPosition=position;vPilotUv=uv;');
      shader.fragmentShader='uniform float uDioramaLight; uniform sampler2D uDioramaWorld; varying vec2 vPilotUv; varying vec3 vPigmentPosition;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=0.96+0.04*sin(vPigmentPosition.x*2100.0)*sin(vPigmentPosition.z*1900.0+vPigmentPosition.y*1700.0);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight=pow(max(outgoingLight,vec3(0.0)),vec3(1.0/2.2))*uDioramaLight;\n#include <opaque_fragment>`);
    };
    return material;
  }
  private clearLandscape():void{
    this.landscape.traverse(o=>{
      if(o instanceof THREE.InstancedMesh)o.dispose();
      if(o instanceof THREE.Mesh||o instanceof THREE.Points){
        // Instances empruntent les géométries GLB mises en cache.
        if(!(o instanceof THREE.InstancedMesh)&&!o.userData.cachedTerrain)o.geometry.dispose();
        for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();
      }
    });
    this.root.remove(this.landscape);this.landscape=new THREE.Group();this.root.add(this.landscape);this.smoke=null;
  }
  private rebuild(cfg:Config,zoom:number):void{
    this.grid??=readSurface(this.assets,2048);const grid=this.grid,relief=cfg.scene.relief;
    this.clearLandscape();
    const t0=performance.now();
    // Terrain du globe entier mis en cache (2 à 3 s de construction) : un changement de zoom ne replace que la végétation.
    const terrainKey=`${cfg.display.quality}:${relief}`;
    if(!this.terrains.has(terrainKey)){
      for(const t of this.terrains.values()){t.ground.dispose();t.cliffs.dispose();}
      this.terrains.clear();this.terrains.set(terrainKey,buildDioramaTerrain(grid,cfg.display.quality,relief));
    }
    const terrain=this.terrains.get(terrainKey)!;
    this.ground=new THREE.Mesh(terrain.ground,this.groundMaterial());this.cliffs=new THREE.Mesh(terrain.cliffs,this.groundMaterial());
    this.ground.userData.cachedTerrain=this.cliffs.userData.cachedTerrain=true;
    this.ground.castShadow=this.ground.receiveShadow=true;this.cliffs.castShadow=this.cliffs.receiveShadow=true;this.landscape.add(this.ground,this.cliffs);
    const placements=new Map<AssetName,Array<{lon:number;lat:number;scale:number;seed:number;bury?:number}>>(ASSETS.map(n=>[n,[]]));
    const hash=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
    const o=cfg.land.ornaments;
    if(o.enabled){
      // Semis régulier sur la sphère (pas en longitude élargi vers les pôles) ; densité artistique.
      const step=cfg.display.quality==='light'?1.05:.72,r=DIORAMA_REGION;
      for(let lat=r.south;lat<r.north;lat+=step){
        const lonStep=Math.min(30,step/Math.max(.05,Math.cos((lat+step/2)*Math.PI/180)));
        for(let lon=r.west;lon<r.east;lon+=lonStep){
        const id=(lat+90)*173+lon*31,la=lat+hash(id)*step,lo=lon+hash(id+7)*lonStep,s=sampleSurface(grid,lo,la);
        const dx=sampleSurface(grid,lo+.15,la).altitude-sampleSurface(grid,lo-.15,la).altitude;
        const dy=sampleSurface(grid,lo,la+.15).altitude-sampleSurface(grid,lo,la-.15).altitude;
        const patch=naturalNoise(lo*1.1,la*1.1),chance=s.forest*o.treeDensity*(patch>.4?1.5:.25)*pilotWeight(lo,la)**2;
        if(s.land>.95&&pilotWeight(lo,la)>.1&&s.altitude<2800&&Math.hypot(dx,dy)<500&&hash(id+9)<chance){
          const name:AssetName=s.altitude>1400?(hash(id+3)>.5?'layered-a':'layered-b'):(hash(id+3)>.5?'tropical-a':'tropical-b');
          placements.get(name)!.push({lon:lo,lat:la,scale:.008+hash(id+13)*.007,seed:hash(id+17)});
          if(hash(id+19)>.55)placements.get(hash(id+21)>.5?'shrub-a':'shrub-b')!.push({lon:lo+.14,lat:la-.1,scale:.015+hash(id+8)*.01,seed:hash(id+20)});
        }
      }
      }
      terrain.coast.forEach(([lon,lat],i)=>{
        if(i%45===0)placements.get(i%2?'rock-a':'rock-b')!.push({lon,lat,scale:.018+hash(i)*.02,seed:hash(i+4),bury:.002});
      });
    }
    const selected:Volcano[]=[];
    if(o.enabled&&o.volcanoes){
      const cell=zoom>=2?1.6:2.4;
      for(const v of [...this.volcanoes].sort((a,b)=>b[2]-a[2])){
        if(pilotWeight(v[0],v[1])<.65||selected.some(p=>Math.hypot((p[0]-v[0])*Math.cos(v[1]*Math.PI/180),p[1]-v[1])<cell))continue;
        selected.push(v);
        placements.get(v[2]>4000?'volcano-a':'volcano-b')!.push({lon:v[0],lat:v[1],scale:.014+Math.min(6500,Math.max(0,v[2]))/6500*.015,seed:hash(v[0]+v[1]),bury:.006});
      }
    }
    const models=this.libraries.get(cfg.display.quality)!;
    for(const [name,items]of placements){
      if(!items.length)continue;
      const model=models.get(name)!,material=model.material.clone();
      material.onBeforeCompile=shader=>{shader.uniforms.uDioramaLight=this.lightUniform;shader.fragmentShader='uniform float uDioramaLight;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight=pow(max(outgoingLight,vec3(0.0)),vec3(1.0/2.2))*uDioramaLight;\n#include <opaque_fragment>')};
      const mesh=new THREE.InstancedMesh(model.geometry,material,items.length);
      const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),spin=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0);
      items.forEach((p,i)=>{
        const normal=earthDirection(p.lon,p.lat),position=groundPoint(grid,p.lon,p.lat,relief).addScaledVector(normal,-(p.bury??.0005));
        q.setFromUnitVectors(up,normal);spin.setFromAxisAngle(up,p.seed*Math.PI*2);q.multiply(spin);
        const scale=p.scale*(.7+.3*relief);matrix.compose(position,q,new THREE.Vector3(scale*(.86+p.seed*.24),scale,scale*(1.1-p.seed*.2)));mesh.setMatrixAt(i,matrix);
      });
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;this.landscape.add(mesh);
    }
    this.buildSmoke(selected.filter(v=>v[3]!==null&&v[3]>=o.smokeSinceYear),relief);
    let instances=0;for(const items of placements.values())instances+=items.length;
    console.info(`[diorama] globe entier construit en ${(performance.now()-t0).toFixed(0)} ms : ${terrain.ground.getAttribute('position').count} sommets de terrain, ${terrain.ground.getIndex()!.count/3} triangles, ${terrain.cliffs.getAttribute('position').count/3} triangles de falaises, ${instances} instances`);
  }
  private buildSmoke(volcanoes:Volcano[],relief:number):void{
    const p:number[]=[],n:number[]=[],east:number[]=[],phase:number[]=[];
    for(const v of volcanoes){
      const normal=earthDirection(v[0],v[1]),tangent=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),normal).normalize();
      const height=(.014+Math.min(6500,Math.max(0,v[2]))/6500*.015)*(.7+.3*relief);
      const base=groundPoint(this.grid!,v[0],v[1],relief).addScaledVector(normal,height*.96);
      for(let i=0;i<7;i++){p.push(...base.toArray());n.push(...normal.toArray());east.push(...tangent.toArray());phase.push(i/7)}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('aNormal',new THREE.Float32BufferAttribute(n,3));geometry.setAttribute('aEast',new THREE.Float32BufferAttribute(east,3));geometry.setAttribute('aPhase',new THREE.Float32BufferAttribute(phase,1));
    const material=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uHeight:{value:900},uDay:{value:1}},vertexShader:SMOKE_VERT,fragmentShader:SMOKE_FRAG,transparent:true,depthWrite:false});
    this.smoke=new THREE.Points(geometry,material);this.smoke.frustumCulled=false;this.landscape.add(this.smoke);
  }
  render(renderer:THREE.WebGLRenderer,world:THREE.Texture,cam:GlobeCamera,M:THREE.Matrix3,cfg:Config,width:number,height:number,time:number):THREE.Texture{
    const key=JSON.stringify([cfg.display.quality,cfg.scene.relief,cfg.land.ornaments,cam.tanHalf<.15]);
    if(this.buildKey!==key){this.rebuild(cfg,cam.tanHalf<.15?2.5:1.5);this.buildKey=key}
    this.root.matrix.setFromMatrix3(M).invert();this.root.matrixWorldNeedsUpdate=true;
    this.camera.position.set(0,0,cam.dist);this.camera.fov=2*Math.atan(cam.tanHalf)*180/Math.PI;this.camera.aspect=width/height;this.camera.near=.1;this.camera.far=10;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
    this.body.material.uniforms.uWorld.value=world;this.worldUniform.value=world;
    const day=cfg.display.theme==='day';this.sun.intensity=day?2.6:1.1;this.ambient.intensity=day?1.4:.65;this.lightUniform.value=day?1:.43;
    // Soleil fixe par rapport au regard (haut gauche, devant) : l'éclairage reste le même pendant la rotation.
    this.sun.target.position.set(0,0,0);this.sun.position.set(-3,4,4);
    const shadowSize=cfg.display.quality==='light'?2048:4096;
    if(this.sun.shadow.mapSize.x!==shadowSize){this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.sun.shadow.mapSize.set(shadowSize,shadowSize)}
    this.sun.shadow.camera.updateProjectionMatrix();
    if(this.smoke){this.smoke.material.uniforms.uTime.value=time;this.smoke.material.uniforms.uHeight.value=height;this.smoke.material.uniforms.uDay.value=day?1:0}
    if(this.target.width!==width||this.target.height!==height)this.target.setSize(width,height);
    const samples=cfg.display.quality==='light'?0:4;if(this.target.samples!==samples){this.target.samples=samples;this.target.dispose()}
    const clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),shadowEnabled=renderer.shadowMap.enabled,shadowType=renderer.shadowMap.type;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setClearColor(0,0);
    renderer.setRenderTarget(this.target);renderer.clear();renderer.render(this.scene,this.camera);
    renderer.setClearColor(clear,alpha);renderer.shadowMap.enabled=shadowEnabled;renderer.shadowMap.type=shadowType;
    return this.target.texture;
  }
  pixelToGeo(x:number,y:number,width:number,height:number):[number,number]|null{
    this.raycaster.setFromCamera(new THREE.Vector2(x/width*2-1,y/height*2-1),this.camera);
    const hit=this.raycaster.intersectObjects([this.body,...(this.ground?[this.ground]:[]),...(this.cliffs?[this.cliffs]:[])],false)[0];
    if(!hit)return null;
    const p=this.root.worldToLocal(hit.point.clone()).normalize();return [Math.asin(p.y)*180/Math.PI,Math.atan2(p.x,p.z)*180/Math.PI];
  }
}
