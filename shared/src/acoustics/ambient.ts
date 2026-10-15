/**
 * Bruit ambiant naturel (sans navires) : modèle empirique de densité spectrale en quatre composantes,
 * tel que donné par Lucani, Stojanovic & Médard (2008, arXiv:0801.0426, éq. 4–8), qui le reprennent de
 * Stojanovic (2007) — lui-même dérivé de Coates (1990), ajustement des courbes de Wenz.
 *
 *   10·log N_t(f)  = 17 − 30·log f                                   turbulence
 *   10·log N_s(f)  = 40 + 20(s − 0,5) + 26·log f − 60·log(f + 0,03)  trafic lointain (s ∈ [0, 1])
 *   10·log N_w(f)  = 50 + 7,5·w^½ + 20·log f − 40·log(f + 0,4)       vent (w en m/s)
 *   10·log N_th(f) = −15 + 20·log f                                  agitation thermique
 *
 * f en kHz, densités en dB re 1 µPa²/Hz, total = somme des densités linéaires.
 *
 * L'œuvre modélise les navires un par un : la composante « trafic lointain » N_s est donc **exclue**
 * (sinon le trafic serait compté deux fois). Le bruit naturel retenu est N_t + N_w + N_th.
 */

/** Densité spectrale du bruit naturel (dB re 1 µPa²/Hz) à fHz, vent windMs (m/s). */
export function ambientSpectralDensity(fHz: number, windMs: number): number {
  const f = fHz / 1000;
  const lin = (db: number) => Math.pow(10, db / 10);
  const nt = 17 - 30 * Math.log10(f);
  const nw = 50 + 7.5 * Math.sqrt(Math.max(0, windMs)) + 20 * Math.log10(f) - 40 * Math.log10(f + 0.4);
  const nth = -15 + 20 * Math.log10(f);
  return 10 * Math.log10(lin(nt) + lin(nw) + lin(nth));
}

/** Composantes séparées (dB re 1 µPa²/Hz), pour la documentation et les tests. */
export function ambientComponents(fHz: number, windMs: number, shipping = 0.5) {
  const f = fHz / 1000;
  return {
    turbulence: 17 - 30 * Math.log10(f),
    shipping: 40 + 20 * (shipping - 0.5) + 26 * Math.log10(f) - 60 * Math.log10(f + 0.03),
    wind: 50 + 7.5 * Math.sqrt(windMs) + 20 * Math.log10(f) - 40 * Math.log10(f + 0.4),
    thermal: -15 + 20 * Math.log10(f),
  };
}

/** Niveau de bande (dB re 1 µPa) : intégrale de la densité entre fMin et fMax (Hz). */
export function ambientBandLevel(fMin: number, fMax: number, windMs: number): number {
  const n = 400;
  let sum = 0;
  let prevF = fMin;
  let prevP = Math.pow(10, ambientSpectralDensity(fMin, windMs) / 10);
  for (let i = 1; i <= n; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / n); // pas logarithmique
    const p = Math.pow(10, ambientSpectralDensity(f, windMs) / 10);
    sum += 0.5 * (p + prevP) * (f - prevF);
    prevF = f;
    prevP = p;
  }
  return 10 * Math.log10(sum);
}

const bandCache = new Map<string, number>();

/**
 * Bruit naturel d'une bande : valeur forcée dans la configuration, sinon modèle (vent).
 * Mis en cache : l'intégration numérique ne dépend que des bornes et du vent (appelée à chaque image).
 */
export function naturalLevel(band: { fMin: number; fMax: number; naturalDb?: number }, windMs: number): number {
  if (band.naturalDb !== undefined) return band.naturalDb;
  const key = `${band.fMin}|${band.fMax}|${windMs}`;
  let v = bandCache.get(key);
  if (v === undefined) {
    v = ambientBandLevel(band.fMin, band.fMax, windMs);
    bandCache.set(key, v);
  }
  return v;
}
