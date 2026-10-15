import { describe, expect, it } from 'vitest';
import type { Config } from '@vacarme/shared';
import { sceneStyleIndex, styledSceneConfig } from '../src/render/scene-style.ts';
const config=(mode='globe',style='sculpted')=>({display:{mode,theme:'day'},scene:{style,relief:0.7},palette:{landLight:0.5},physics:{enabled:true},land:{style:'gouache'}} as Config);
describe('directions artistiques',()=>{
  it('conserve le rendu actuel sans surcharge',()=>{
    const c=config('flat','current');expect(styledSceneConfig(c)).toBe(c);
  });
  it.each(['hemisphere','fisheye','equirect'])('préserve la projection %s et mémorise le choix',(mode)=>{
    const c=config(mode);expect(sceneStyleIndex(c)).toBe(0);expect(styledSceneConfig(c)).toBe(c);expect(c.scene.style).toBe('sculpted');
  });
  it('ne change ni la configuration éditable ni les calculs physiques',()=>{
    const c=config(),styled=styledSceneConfig(c);
    expect(styled.palette.landLight).not.toBe(c.palette.landLight);
    expect(c.palette.landLight).toBe(0.5);expect(styled.physics).toBe(c.physics);expect(styled.land).toBe(c.land);
    expect(sceneStyleIndex(config('globe','faceted'))).toBe(3);
  });
});
