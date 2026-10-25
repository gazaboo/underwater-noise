/**
 * Nappe affichée ou masquée, et scénario « océan sans navires » : un seul endroit pour la touche V, la touche S
 * et la barre d'outils du web autonome.
 *
 * Masquer la nappe est un choix d'affichage ; « sans navires » est un calcul (docs/REPRESENTATION.md).
 */
import type { Config } from '@vacarme/shared';

export const NOISE_STYLES: Config['noise']['style'][] = ['isophones', 'meteo', 'encre', 'fronts'];
const NAMES = { isophones: 'Isophones', meteo: 'Météo', encre: 'Encre', fronts: 'Fronts' } as const;

/** Vrai quand le scénario retire les navires (calcul, son et affichage). */
export const noShips = (cfg: Pick<Config, 'scenario'>): boolean => cfg.scenario === 'sans-navires';

/** Style suivant ; après le dernier style, la nappe est masquée ; masquée, elle revient au premier style. */
export function cycleNoise(noise: Pick<Config['noise'], 'style' | 'visible'>): void {
  if (!noise.visible) {
    noise.visible = true;
    noise.style = NOISE_STYLES[0];
    return;
  }
  const i = NOISE_STYLES.indexOf(noise.style);
  if (i === NOISE_STYLES.length - 1) noise.visible = false;
  else noise.style = NOISE_STYLES[i + 1];
}

export const noiseLabel = (noise: Pick<Config['noise'], 'style' | 'visible'>): string =>
  `Bruit : ${noise.visible ? NAMES[noise.style] : 'masqué'}`;

export function toggleScenario(cfg: Pick<Config, 'scenario'>): void {
  cfg.scenario = noShips(cfg) ? 'actuel' : 'sans-navires';
}

export const scenarioLabel = (cfg: Pick<Config, 'scenario'>): string => (noShips(cfg) ? 'Sans navires' : 'Avec navires');
