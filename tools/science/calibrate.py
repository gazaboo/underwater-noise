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
import hashlib
import time
from datetime import datetime, timezone
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
        if self.station.get('split') != 'calibration' or self.station.get('qc', {}).get('status') != 'reviewed':
            raise ValueError('Calage réservé aux seules stations de calage avec QC revu.')
        with (run_dir / f'{station_id}-{stamp}-observations.csv').open(newline='') as f: self.rows = list(csv.DictReader(f))
        meta = json.loads((run_dir / f'{station_id}-{stamp}-geometry.bin.json').read_text())
        if meta.get('dumpEvery') != 1:
            raise ValueError('Calage refusé : géométrie sous-échantillonnée ; tous les pas de la prédiction sont requis.')
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
        self.identity = {'station': station_id, 'day': day}
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

    def ships_db(self, p: dict, rt_factor: float, band_ids=None) -> np.ndarray:
        """Niveaux navires (dB) par fenêtre et par bande pour des paramètres donnés."""
        all_depths = depth_from_code(np.arange(256))
        rt = np.maximum(10.0, rt_factor * self.src_depth)
        r = np.maximum(self.r, 1.0)
        geometric = np.where(r <= rt, 20 * np.log10(r), 20 * np.log10(rt) + 10 * np.log10(r / rt))
        out = np.full((self.windows, len(self.loss_hz)), -np.inf)
        for b, f in enumerate(self.loss_hz):
            if band_ids is not None and b not in {self.band_index[x] for x in band_ids}: continue
            mean_rate = self.code_counts @ loss_rate(all_depths, f, p)
            tl = geometric + mean_rate[self.path_of] * r / 1000
            e = np.bincount(self.window, weights=self.weight * self.lin_sl[:, b] * 10 ** (-tl / 10), minlength=self.windows)
            with np.errstate(divide='ignore'): out[:, b] = 10 * np.log10(e)
        return out

    def objective_terms(self, p: dict, rt_factor: float) -> list[tuple[str, float, float]]:
        if not self.targets: return []
        ships = self.ships_db(p, rt_factor, self.targets)
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


def optimize(reference, count, evaluate_score, exclude=None):
    """Même grille et même affinement pour le calage complet et chaque pli."""
    names = list(BOUNDS)
    base, _ = evaluate_score(reference, 1.0, exclude)
    best = (base, dict(reference), 1.0)
    for factor in (1.0, 2.0):
        for values in itertools.product(*(grid(n, count) for n in names)):
            p = {**reference, **dict(zip(names, map(float, values)))}
            value, _ = evaluate_score(p, factor, exclude)
            if value < best[0]: best = (value, p, factor)
    value, params, factor = best
    steps = {n: (math.log(BOUNDS[n][1] / BOUNDS[n][0]) if n in LOG_SCALE else BOUNDS[n][1] - BOUNDS[n][0]) / (count - 1) for n in names}
    for _ in range(6):
        for name in names:
            for direction in (-1, 1):
                trial = dict(params)
                trial[name] = params[name] * math.exp(direction * steps[name]) if name in LOG_SCALE else params[name] + direction * steps[name]
                trial[name] = min(max(trial[name], BOUNDS[name][0]), BOUNDS[name][1])
                score_value, _ = evaluate_score(trial, factor, exclude)
                if score_value < value: value, params = score_value, trial
            steps[name] /= 2
    return value, params, factor


def reference_identity(case, reference):
    expected = np.array([[-np.inf if x in (None, 'zero') else x for x in w['shipsDb']] for w in case.prediction['windows']])
    actual = case.ships_db(reference, 1.0)
    if not np.array_equal(np.isfinite(expected), np.isfinite(actual)):
        raise ValueError(f'{case.identity} : énergie navires absente ou ajoutée par le recalcul')
    finite = np.isfinite(expected)
    error = float(np.max(np.abs(expected[finite] - actual[finite]))) if finite.any() else 0.0
    if error > .001:
        raise ValueError(f'{case.identity} : recalcul de référence différent de {error} dB')
    return error


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--protocol', type=Path, default=HERE / 'protocol-v1.json')
    parser.add_argument('--runs', type=Path, default=ROOT / 'tools/.cache/science/runs/v1-calibration')
    parser.add_argument('--out', type=Path, default=HERE / 'calibration-v2.json')
    parser.add_argument('--grid', type=int, default=7)
    parser.add_argument('--benchmark', action='store_true', help='durée et identité sur le premier cas de calage, sans optimisation ni fichier de profil')
    args = parser.parse_args()
    if args.grid < 2: parser.error('--grid doit être ≥ 2')
    protocol = json.loads(args.protocol.read_text())
    specs = [(s, day) for s in protocol['stations'] if s['role'] == 'calibration' for day in sorted(s['days'])]
    selected = specs[:1] if args.benchmark else specs
    started = time.perf_counter()
    cases = [Case(args.runs, spec['id'], day) for spec, day in selected]
    reference = cases[0].prediction['parameters']['physics']
    identities = [reference_identity(c, reference) for c in cases]
    t = time.perf_counter()
    base, _ = score(cases, reference, 1.0)
    duration = time.perf_counter() - t
    print(json.dumps({'cases': len(cases), 'loadAndIdentitySec': t - started, 'scoreSec': duration,
                      'maxReferenceIdentityErrorDb': max(identities), 'referenceScore': base}), flush=True)
    if args.benchmark: return
    # Mémoïsation des résidus par jeu de paramètres : chaque pli utilise la même
    # grille pré-enregistrée, sans refaire les contributions déjà calculées.
    cache = {}
    def evaluate_score(params, factor, exclude=None):
        key = (*[params[n] for n in BOUNDS], factor)
        if key not in cache:
            cache[key] = [{**case.identity, 'band': band, 'diffL50Db': a, 'diffL10Db': b}
                          for case in cases for band, a, b in case.objective_terms(params, factor)]
            if len(cache) % 25 == 0: print(f'{len(cache)} jeux de paramètres évalués', flush=True)
        terms = [r for r in cache[key] if r['station'] != exclude]
        return sum(r['diffL50Db'] ** 2 + r['diffL10Db'] ** 2 for r in terms), terms
    base, reference_terms = evaluate_score(reference, 1.0)
    final, params, factor = optimize(reference, args.grid, evaluate_score)
    _, terms = evaluate_score(params, factor)
    cross_validation = []
    for sid in sorted({s['id'] for s, _ in specs}):
        value, fold_params, fold_factor = optimize(reference, args.grid, evaluate_score, sid)
        _, all_terms = evaluate_score(fold_params, fold_factor)
        withheld = [r for r in all_terms if r['station'] == sid]
        cross_validation.append({'leftOutStation': sid, 'trainingObjective': value,
                                 'physics': {n: fold_params[n] for n in BOUNDS}, 'transitionFactor': fold_factor,
                                 'residuals': withheld})
        print(f'Validation croisée : {sid}, {len(withheld)} comparaisons laissées de côté', flush=True)
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [args.protocol, *[HERE / 'stations' / f"{s['id']}.json" for s in protocol['stations']]]}
    result = {'label': 'north-sea-reference-v2', 'protocol': 'docs/VALIDATION_PROTOCOLE.md v1 §6 et §8',
              'completed': True, 'generated': datetime.now(timezone.utc).isoformat(),
              'physics': {n: params[n] for n in BOUNDS}, 'transitionFactor': factor,
              'objective': {'reference': base, 'calibrated': final, 'bands': OBJECTIVE_BANDS},
              'cases': [f"{s['id']} {day}" for s, day in specs],
              'residualsCalibrated': terms, 'residualsReference': reference_terms,
              'crossValidation': cross_validation, 'inputHashes': hashes,
              'maxReferenceIdentityErrorDb': max(identities), 'gridCount': args.grid,
              'windModel': 'Wenz/Coates, inchangé ; aucun modèle alternatif exploré faute de formule sourcée lue',
              'elapsedSec': time.perf_counter() - started,
              'note': 'Valeurs [C-calé] : ajustées sur les seules stations de calage ; jugées ensuite une seule fois sur les stations de test. Validation croisée : même recherche en retirant chaque station, sans accès aux stations de test.'}
    if factor != 1.0: result['note'] += ' Le facteur de transition k ≠ 1 exige la même modification dans le moteur (r_t = k × profondeur).'
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k: result[k] for k in ['physics', 'transitionFactor', 'objective', 'elapsedSec']}, indent=2))


if __name__ == '__main__': main()
