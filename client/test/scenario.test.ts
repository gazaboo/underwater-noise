import {describe, expect, it} from 'vitest';
import {cycleNoise, noiseLabel, NOISE_STYLES, noShips, scenarioLabel, toggleScenario} from '../src/ui/scenario.ts';

describe('nappe : styles puis masquée',()=>{
  it('parcourt les styles, masque après le dernier, revient au premier',()=>{
    const n={style:NOISE_STYLES[0],visible:true};
    const seen=[noiseLabel(n)];
    for(let i=0;i<NOISE_STYLES.length+1;i++){cycleNoise(n);seen.push(noiseLabel(n));}
    expect(seen).toEqual(['Bruit : Isophones','Bruit : Météo','Bruit : Encre','Bruit : Fronts','Bruit : masqué','Bruit : Isophones']);
  });
});

describe('scénario « océan sans navires »',()=>{
  it('bascule et s\'affiche',()=>{
    const cfg={scenario:'actuel' as const} as {scenario:'actuel'|'sans-navires'};
    expect(noShips(cfg)).toBe(false);
    toggleScenario(cfg);
    expect(cfg.scenario).toBe('sans-navires');
    expect(scenarioLabel(cfg)).toBe('Sans navires');
    toggleScenario(cfg);
    expect(scenarioLabel(cfg)).toBe('Avec navires');
  });
});
