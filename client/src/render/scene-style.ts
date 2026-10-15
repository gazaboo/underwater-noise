import type { Config } from '@vacarme/shared';

export type SceneStyle = Config['scene']['style'];
export const SCENE_STYLES: ReadonlyArray<{ id: SceneStyle; title: string; subtitle: string }> = [
  { id: 'current', title: 'Actuel', subtitle: 'Le témoin · gouache' },
  { id: 'painted', title: 'Planète peinte', subtitle: '01 · Pigments & lumière' },
  { id: 'sculpted', title: 'Monde sculpté', subtitle: '02 · Argile & volumes' },
  { id: 'faceted', title: 'Atlas facetté', subtitle: '03 · Roches & facettes' },
];
export function supportsSceneStyle(mode: Config['display']['mode']): boolean {
  return mode === 'flat' || mode === 'globe';
}
export function sceneStyleIndex(cfg: Config): number {
  return supportsSceneStyle(cfg.display.mode) ? SCENE_STYLES.findIndex(s => s.id === cfg.scene.style) : 0;
}

/** Palettes artistiques de rendu uniquement ; la configuration éditable est conservée. */
export function styledSceneConfig(cfg: Config): Config {
  const style = sceneStyleIndex(cfg);
  if (style === 0) return cfg;
  const day = cfg.display.theme === 'day';
  const palettes = [
    {},
    { landTint: '#ffe4af', landLight: day ? 0.92 : 0.3,
      oceanShallow: day ? '#397f90' : '#102735', oceanDeep: day ? '#123749' : '#02070e',
      coast: day ? '#b4a774' : '#344334', background: '#030912' },
    { landTint: '#fff0ce', landLight: day ? 0.96 : 0.34,
      oceanShallow: day ? '#4497a5' : '#102f40', oceanDeep: day ? '#17445c' : '#030c16',
      coast: day ? '#b79860' : '#4d4934', background: '#030b12' },
    { landTint: '#f4e7cc', landLight: day ? 0.9 : 0.32,
      oceanShallow: day ? '#3c8994' : '#0c2837', oceanDeep: day ? '#173b50' : '#030912',
      coast: day ? '#887451' : '#434735', background: '#040912' },
  ];
  return { ...cfg, palette: { ...cfg.palette, ...palettes[style] } };
}
