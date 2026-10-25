/** Papier procédural partagé ; constantes de matière purement artistiques. */
export const PAPER_GLSL = /* glsl */ `
uniform float uPaperStrength, uPaperScale;
float paperNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
vec3 paper(vec3 col, vec2 frag) {
  if (uPaperStrength <= 0.0) return col;
  vec2 p = frag / uPaperScale;
  float fiber = 0.65 * paperNoise(p * vec2(0.12, 0.7))
              + 0.25 * paperNoise(p * vec2(0.8, 0.09)) + 0.1 * hash(floor(p));
  return col * (1.0 + (fiber - 0.5) * 0.16 * uPaperStrength)
       + (fiber - 0.35) * 0.012 * uPaperStrength;
}
`;
