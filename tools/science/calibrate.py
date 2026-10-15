"""Calage des paramètres empiriques de la loi mondiale sur les SEULES stations de calage (protocole §6).

Entrées : pour chaque station × jour de calage, le run de référence (station_case.py) : prédiction
`world-law`, géométrie des contributions (`--dump` de point-predict.ts), mesures exportées, fiche.
La perte de chaque contribution est recalculée exactement pour chaque jeu de paramètres :
  TL = 20 log r_t + 10 log(r / r_t) + moyenne_trajet(lossRateDbPerKm(profondeur, f, p)) × r,
  r_t = max(10 m, k × profondeur de la cellule source), k ∈ {1, 2}.
`lossRateDbPerKm` est transcrite ici depuis shared/src/acoustics/propagation.ts ; un test vérifie
l'identité numérique avec la version TypeScript (loss_rate_matches_typescript).

Critère : somme des carrés de ΔL50 et ΔL10 (prédit − mesuré) par station × jour × bande, bandes
d125, mid et high, hors bandes signalées pour l'écoulement. Recherche : grille puis affinement
coordonnée par coordonnée, dans les bornes du protocole. Sortie : JSON {label, physics, ...}.
"""
from __future__ import annotations
import argparse
import csv
import itertools
import json
import math
from pathlib import Path
import numpy as np
from validate import pair

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BOUNDS = {'bottomBounceLossDb': (0.01, 1.0), 'sedimentSoundSpeed': (1550.0, 1900.0), 'cutoffLossDbPerKm': (1.0, 20.0)}
LOG_SCALE = {'bottomBounceLossDb', 'cutoffLossDbPerKm'}
OBJECTIVE_BANDS = ['d125', 'mid', 'high']
FULL_DEPTH, ZERO_DEPTH, C_WATER = 200.0, 400.0, 1500.0


def thorp(f_hz):
    f2 = (f_hz / 1000) ** 2
    return 0.11 * f2 / (1 + f2) + 44 * f2 / (4100 + f2) + 2.75e-4 * f2 + 0.003


def loss_rate(depth, f_hz, p):
    """Transcription de lossRateDbPerKm (shared/src/acoustics/propagation.ts)."""
    h = np.maximum(depth, 5.0)
    w = np.where(h <= FULL_DEPTH, 1.0, np.where(h >= ZERO_DEPTH, 0.0, (ZERO_DEPTH - h) / (ZERO_DEPTH - FULL_DEPTH)))
    bounces = 1000 * math.tan(math.radians(p['grazingAngleDeg'])) / (2 * h)
    bottom = p['bottomBounceLossDb'] * bounces * w
    r = C_WATER / p['sedimentSoundSpeed']
    fc = C_WATER / (4 * np.maximum(h, 1) * math.sqrt(max(1e-6, 1 - r * r)))
    cut = p['cutoffLossDbPerKm'] * np.clip((fc / f_hz - 0.8) / 0.4, 0, 1)
    return thorp(f_hz) + bottom + cut + p['extraLossDbPerKm']


def depth_from_code(code):
    return 10 * 1100 ** (np.asarray(code, dtype=float) / 255)


class Case:
    """Un station × jour : géométrie regroupée par trajet unique, mesures, prédiction de référence."""

    def __init__(self, run_dir: Path, station_id: str, day: str):
        stamp = day.replace('-', '')
        self.prediction = json.loads((run_dir / f'{station_id}-{stamp}-world-law.json').read_text())
        self.station = json.loads((run_dir / f'{station_id}-{stamp}-station.json').read_text())
        with (run_dir / f'{station_id}-{stamp}-observations.csv').open(newline='') as f: self.rows = list(csv.DictReader(f))
        meta = json.loads((run_dir / f'{station_id}-{stamp}-geometry.bin.json').read_text())
        bands = [b['id'] for b in self.prediction['bands']]
        if meta['bands'] != bands: raise ValueError('Bandes de la géométrie ≠ prédiction')
        B, P = len(bands), meta['maxPath']
        dtype = np.dtype([('w', '<u4'), ('r', '<f4'), ('src', 'u1'), ('n', 'u1'), ('sl', '<f4', (B,)), ('codes', 'u1', (P,))])
        if dtype.itemsize != meta['recordBytes']: raise ValueError('Format de géométrie inattendu')
        data = np.fromfile(run_dir / f'{station_id}-{stamp}-geometry.bin', dtype=dtype)
        if len(data) != meta['records']: raise ValueError('Géométrie tronquée')
        self.windows = len(meta['windows'])
        self.weight = 1.0 / np.asarray(meta['samplesPerWindow'], dtype=float)[data['w']]
        self.window = data['w'].astype(np.int64)
        self.r = data['r'].astype(float)
        self.src_depth = depth_from_code(data['src'])
        self.lin_sl = 10 ** (data['sl'].astype(float) / 10)
        self.loss_hz = np.asarray(meta['lossHz'])
        self.band_index = {b: i for i, b in enumerate(bands)}
        # Trajets uniques : la perte moyenne ne dépend que de la suite de codes.
        signature = np.concatenate([data['n'][:, None], data['codes']], axis=1)
        unique, self.path_of = np.unique(signature, axis=0, return_inverse=True)
        self.path_of = self.path_of.reshape(-1)
        n = unique[:, 0].astype(int)
        codes = unique[:, 1:]
        self.code_counts = np.zeros((len(unique), 256))
        for i, (count, row) in enumerate(zip(n, codes)): np.add.at(self.code_counts[i], row[:count], 1)
        self.code_counts /= n[:, None]
        self.unique_paths = len(unique)
        # Appariement mesures / fenêtres fait une seule fois (même logique et même contrôle qualité que validate.py).
        pairs, _ = pair(self.prediction, self.rows, self.station)
        flagged = lambda band: any(min(float(x) for x in band['decidecadesHz']) <= f['bandsUpToHz'] for f in self.station['qc'].get('flags', []))
        self.targets = {}
        for band in self.prediction['bands']:
            if band['id'] in OBJECTIVE_BANDS and pairs.get(band['id']) and not flagged(band):
                index = np.array([i for i, _ in pairs[band['id']]])
                b = self.band_index[band['id']]
                ambient = np.array([self.prediction['windows'][i]['ambientDb'][b] for i in index])
                measured = np.array([m for _, m in pairs[band['id']]])
                self.targets[band['id']] = (index, ambient, np.percentile(measured, 50), np.percentile(measured, 90))

    def ships_db(self, p: dict, rt_factor: float) -> np.ndarray:
        """Niveaux navires (dB) par fenêtre et par bande pour des paramètres donnés."""
        all_depths = depth_from_code(np.arange(256))
        rt = np.maximum(10.0, rt_factor * self.src_depth)
        r = np.maximum(self.r, 1.0)
        geometric = np.where(r <= rt, 20 * np.log10(r), 20 * np.log10(rt) + 10 * np.log10(r / rt))
        out = np.full((self.windows, len(self.loss_hz)), -np.inf)
        for b, f in enumerate(self.loss_hz):
            mean_rate = self.code_counts @ loss_rate(all_depths, f, p)
            tl = geometric + mean_rate[self.path_of] * r / 1000
            e = np.bincount(self.window, weights=self.weight * self.lin_sl[:, b] * 10 ** (-tl / 10), minlength=self.windows)
            with np.errstate(divide='ignore'): out[:, b] = 10 * np.log10(e)
        return out

    def objective_terms(self, p: dict, rt_factor: float) -> list[tuple[str, float, float]]:
        ships = self.ships_db(p, rt_factor)
        terms = []
        for band, (index, ambient, l50, l10) in self.targets.items():
            s = ships[index, self.band_index[band]]
            total = 10 * np.log10(10 ** (ambient / 10) + np.where(np.isfinite(s), 10 ** (s / 10), 0.0))
            terms.append((band, float(np.percentile(total, 50) - l50), float(np.percentile(total, 90) - l10)))
        return terms


def score(cases, p, rt_factor):
    terms = [t for c in cases for t in c.objective_terms(p, rt_factor)]
    return sum(a * a + b * b for _, a, b in terms), terms


def grid(name, count):
    lo, hi = BOUNDS[name]
    return np.geomspace(lo, hi, count) if name in LOG_SCALE else np.linspace(lo, hi, count)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--protocol', type=Path, default=HERE / 'protocol-v1.json')
    parser.add_argument('--runs', type=Path, default=ROOT / 'tools/.cache/science/runs/v1-calibration')
    parser.add_argument('--out', type=Path, default=HERE / 'calibration-v2.json')
    parser.add_argument('--grid', type=int, default=7)
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    reference = json.loads(next(args.runs.glob('*-world-law.json')).read_text())['parameters']['physics']
    cases = [Case(args.runs, s['id'], day) for s in protocol['stations'] if s['role'] == 'calibration' for day in sorted(s['days'])]
    print(f'{len(cases)} cas ; trajets uniques : {[c.unique_paths for c in cases]}', flush=True)
    base, base_terms = score(cases, reference, 1.0)
    print(f'référence v1 : {base:.1f}', flush=True)
    best = (base, dict(reference), 1.0)
    names = list(BOUNDS)
    for rt_factor in (1.0, 2.0):
        for values in itertools.product(*(grid(n, args.grid) for n in names)):
            p = {**reference, **dict(zip(names, map(float, values)))}
            s, _ = score(cases, p, rt_factor)
            if s < best[0]: best = (s, p, rt_factor); print(f'{s:.1f} {dict(zip(names, values))} k={rt_factor}', flush=True)
    # Affinement coordonnée par coordonnée (pas divisé par deux, 6 tours), bornes respectées.
    s0, p0, k0 = best
    steps = {n: (math.log(BOUNDS[n][1] / BOUNDS[n][0]) if n in LOG_SCALE else BOUNDS[n][1] - BOUNDS[n][0]) / (args.grid - 1) for n in names}
    for _ in range(6):
        for n in names:
            for direction in (-1, 1):
                trial = dict(p0)
                trial[n] = p0[n] * math.exp(direction * steps[n]) if n in LOG_SCALE else p0[n] + direction * steps[n]
                trial[n] = min(max(trial[n], BOUNDS[n][0]), BOUNDS[n][1])
                s, _ = score(cases, trial, k0)
                if s < s0: s0, p0 = s, trial
            steps[n] /= 2
    final, terms = score(cases, p0, k0)
    result = {'label': 'north-sea-reference-v2', 'protocol': 'docs/VALIDATION_PROTOCOLE.md v1 §6',
              'physics': {n: p0[n] for n in names}, 'transitionFactor': k0,
              'objective': {'reference': base, 'calibrated': final, 'bands': OBJECTIVE_BANDS},
              'cases': [f"{c.station['id']} {c.prediction['windows'][0]['start'][:10]}" for c in cases],
              'residualsCalibrated': [{'band': b, 'diffL50Db': a, 'diffL10Db': c} for b, a, c in terms],
              'residualsReference': [{'band': b, 'diffL50Db': a, 'diffL10Db': c} for b, a, c in base_terms],
              'note': 'Valeurs [C-calé] : ajustées sur les seules stations de calage ; jugées ensuite une seule fois sur les stations de test.'}
    if k0 != 1.0: result['note'] += ' Le facteur de transition k ≠ 1 exige la même modification dans le moteur (r_t = k × profondeur).'
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k: result[k] for k in ['physics', 'transitionFactor', 'objective']}, indent=2))


if __name__ == '__main__': main()
