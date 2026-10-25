/** Utilitaires de passes plein écran (GPGPU et composition). */
import * as THREE from 'three';

/** Vertex shader commun : un quad couvrant tout le cadre, vUv ∈ [0,1]². */
export const FULLSCREEN_VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Une passe plein écran : un maillage, une caméra factice et une scène dédiée. */
export class FullscreenPass {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.Camera();
  readonly mesh: THREE.Mesh;

  constructor(readonly material: THREE.RawShaderMaterial) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export function rawMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: `precision highp float;\nprecision highp int;\n${fragmentShader}`,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

/**
 * Couleur « #rrggbb » → vec3, sans conversion colorimétrique : la composition se fait
 * directement dans l'espace de l'écran, la couleur choisie par l'artiste est celle affichée.
 */
export function hexToVec3(hex: string, out = new THREE.Vector3()): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
