/** Positions GVP sourcées ; cônes, dimensions et fumée artistiques. Carte plate seulement. */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import type { Volcano } from '../assets.ts';
import type { FlatTransform } from './flat-view.ts';
import { hexToVec3 } from './fullscreen.ts';

export class VolcanoLayer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly uniforms = {
    uCenter: { value: new THREE.Vector2() }, uResolution: { value: new THREE.Vector2() },
    uLatRange: { value: new THREE.Vector2() }, uScale: { value: 1 }, uSize: { value: 14 },
    uSmokeSince: { value: 1950 }, uFade: { value: 0 }, uTime: { value: 0 },
    uTint: { value: new THREE.Vector3() }, uLight: { value: 1 },
  };
  constructor(volcanoes: Volcano[]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(volcanoes.length*3),3));
    geometry.setAttribute('aLatLon', new THREE.Float32BufferAttribute(volcanoes.flatMap(v => [v[1],v[0]]),2));
    geometry.setAttribute('aAlt', new THREE.Float32BufferAttribute(volcanoes.map(v => v[2]),1));
    geometry.setAttribute('aKnown', new THREE.Float32BufferAttribute(volcanoes.map(v => v[3] === null ? 0 : 1),1));
    geometry.setAttribute('aYear', new THREE.Float32BufferAttribute(volcanoes.map(v => v[3] ?? -1e6),1));
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.uniforms,
      transparent: true, blending: THREE.NormalBlending, depthTest: false, depthWrite: false,
      vertexShader: `
precision highp float;
in vec3 position;
in vec2 aLatLon;
in float aAlt, aYear, aKnown;
uniform vec2 uCenter, uResolution, uLatRange;
uniform float uScale, uSize, uSmokeSince;
out float vSmoke;
void main() {
  float lon = mod(aLatLon.y-uCenter.x+180.0,360.0)-180.0;
  vec2 px = vec2(lon,aLatLon.x-uCenter.y)*uScale;
  // Le pied du cône est ancré à la position, le panache reste dans le même sprite.
  gl_PointSize = uSize*(0.85+0.15*clamp(aAlt/4000.0,0.0,1.0));
  px.y += gl_PointSize*0.3;
  gl_Position = vec4(px/(0.5*uResolution),0,1);
  if (aLatLon.x < uLatRange.x || aLatLon.x > uLatRange.y) gl_Position = vec4(2,2,0,1);
  vSmoke = aKnown > 0.5 && aYear >= uSmokeSince ? 1.0 : 0.0;
}`,
      fragmentShader: `
precision highp float;
in float vSmoke;
uniform float uFade, uTime, uLight;
uniform vec3 uTint;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_PointCoord.x,1.0-gl_PointCoord.y);
  float aa = max(fwidth(p.x),0.001);
  float y = (p.y-0.2)/0.42;
  float width = mix(0.38,0.06,clamp(y,0.0,1.0));
  float cone = (1.0-smoothstep(width-aa,width+aa,abs(p.x-0.5)))
             *smoothstep(-aa,aa,y)*(1.0-smoothstep(1.0-aa,1.0+aa,y));
  vec3 c = mix(vec3(0.27,0.24,0.23),vec3(0.65,0.52,0.37),(1.0-smoothstep(0.3,0.7,p.x)));
  float crater = 1.0-smoothstep(0.7,1.0,length((p-vec2(0.5,0.61))/vec2(0.07,0.025)));
  c = mix(c,vec3(0.12,0.08,0.07),crater);
  // Pigment irrégulier, fixe dans le cône (aucun scintillement).
  c *= 0.96+0.04*sin(p.x*133.0+sin(p.y*97.0))*sin(p.y*119.0);
  float sy = (p.y-0.62)/0.34;
  float center = 0.5+0.06*sin(sy*7.0-uTime*0.7)*sy;
  float smoke = exp(-pow((p.x-center)/(0.03+max(sy,0.0)*0.12),2.0))
              *smoothstep(0.0,0.15,sy)*(1.0-smoothstep(0.45,1.0,sy))*vSmoke*0.45;
  float alpha = cone+smoke*(1.0-cone);
  c = mix(vec3(0.62,0.61,0.57),c,cone/max(alpha,0.001));
  if (alpha < 0.005) discard;
  outColor = vec4(c*uTint*uLight,alpha*uFade);
}`,
    });
    const points = new THREE.Points(geometry,material);
    points.frustumCulled = false;
    this.scene.add(points);
  }
  draw(renderer: THREE.WebGLRenderer, view: FlatTransform, cfg: Config, time: number): void {
    const l = cfg.land, o = l.ornaments;
    if (l.style !== 'gouache' || !o.enabled || !o.volcanoes || view.zoom <= o.minZoom) return;
    const u = this.uniforms;
    u.uCenter.value.set(view.centerLon,view.centerLat);
    u.uResolution.value.set(view.width,view.height);
    u.uLatRange.value.set(view.latMin,view.latMax);
    u.uScale.value = view.scale;
    u.uSize.value = o.volcanoSize*renderer.getPixelRatio()*view.zoom**0.35;
    u.uFade.value = THREE.MathUtils.smoothstep(view.zoom,o.minZoom,o.minZoom*1.5);
    u.uSmokeSince.value = o.smokeSinceYear; u.uTime.value = time;
    hexToVec3(cfg.palette.landTint,u.uTint.value); u.uLight.value = cfg.palette.landLight;
    renderer.setRenderTarget(null);
    renderer.render(this.scene,this.camera);
  }
}
