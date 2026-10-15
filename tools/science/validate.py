"""Compare point predictions (point-predict.ts) with hydrophone window levels (ices.py / noaa.py).

Acceptance is never read from the measurement rows: it comes from the station file
(`stations/<id>.json`, section `qc`), whose status must be `reviewed`. Without review,
only an explicitly `--exploratory` report can be produced, labelled as such.

Broad bands are rebuilt by summing the energies of the measured decidecades listed in
the prediction; a window missing any of them is skipped, never completed.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
import numpy as np

DOMINANCE_DB = 3  # navires/fond : écart au-delà duquel une composante « domine » (choix [A] de présentation)


def timestamp(value: str) -> float:
    d = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if d.tzinfo is None: raise ValueError('Dates UTC/offset requises')
    return d.timestamp()


def in_period(t0: float, t1: float, periods) -> bool:
    return any(t0 < timestamp(p['end']) and t1 > timestamp(p['start']) for p in periods)


def stats(errors: np.ndarray, predicted: np.ndarray, observed: np.ndarray) -> dict:
    q = lambda x, p: float(np.percentile(x, p))
    result = {'count': int(errors.size), 'biasDb': float(errors.mean()), 'rmseDb': float(math.sqrt(float((errors ** 2).mean()))),
              'medianErrorDb': q(errors, 50), 'p05ErrorDb': q(errors, 5), 'p95ErrorDb': q(errors, 95),
              'stdErrorDb': float(errors.std(ddof=1)) if errors.size > 1 else None,
              'pearsonR': float(np.corrcoef(predicted, observed)[0, 1]) if errors.size > 2 and predicted.std() > 0 and observed.std() > 0 else None}
    # Niveaux dépassés x % du temps (L10 = percentile 90), indicateurs DCSMM/JOMOPANS.
    for name, p in [('L90', 10), ('L50', 50), ('L10', 90)]:
        result[f'observed{name}'] = q(observed, p); result[f'predicted{name}'] = q(predicted, p)
        result[f'diff{name}Db'] = result[f'predicted{name}'] - result[f'observed{name}']
    return result


def total_db(ambient: float, ships) -> float:
    """Fond + navires (somme d'énergies). ships = None ou 'zero' : aucune énergie de navire."""
    if ships in (None, 'zero'): return ambient
    return ambient + 10 * math.log10(1 + 10 ** ((float(ships) - ambient) / 10))


def pair(prediction: dict, rows: list[dict], station: dict):
    """Apparie fenêtres prédites et mesures compatibles ; applique le contrôle qualité de la fiche.

    Renvoie ({bande: [(indice de fenêtre, niveau mesuré)]}, compteurs d'exclusion)."""
    qc = station.get('qc', {})
    deployment = station['deployment']
    rx = prediction['station']
    if str(rx['station']) != str(deployment['station']): raise ValueError('Prédiction et station différentes')
    excluded_bands = {float(b['bandHz']) for b in qc.get('excludeBands', [])}
    excluded_periods = qc.get('excludePeriods', [])
    skipped = Counter()
    observed = defaultdict(dict)  # (start, end) -> {nominal: dB}
    for row in rows:
        if str(row['station']) != str(deployment['station']): skipped['other-station'] += 1; continue
        if abs(float(row['lat']) - rx['lat']) > 1e-5 or abs(float(row['lon']) - rx['lon']) > 1e-5: skipped['receiver-position-mismatch'] += 1; continue
        if abs(float(row['receiverDepthM']) - rx['receiverDepthM']) > .1: skipped['depth-mismatch'] += 1; continue
        level = float(row['observedDb'])
        if not math.isfinite(level): skipped['invalid-measurement'] += 1; continue
        key = (timestamp(row['start']), timestamp(row['end']))
        nominal = float(row['bandHz'])
        if nominal in observed[key]: raise ValueError('Mesure dupliquée')
        observed[key][nominal] = level
    pairs = defaultdict(list)
    for index, window in enumerate(prediction['windows']):
        key = (timestamp(window['start']), timestamp(window['end']))
        if window['status'] != 'ok': skipped[f"prediction-{window['status']}"] += 1; continue
        if key not in observed: skipped['no-measurement-window'] += 1; continue
        if in_period(*key, excluded_periods): skipped['qc-excluded-period'] += 1; continue
        levels = observed[key]
        for b, band in enumerate(prediction['bands']):
            wanted = [float(f) for f in band['decidecadesHz']]
            if excluded_bands & set(wanted): skipped[f"qc-excluded-band-{band['id']}"] += 1; continue
            if not all(f in levels for f in wanted): skipped[f"incomplete-band-{band['id']}"] += 1; continue
            if window['ambientDb'][b] is None: skipped[f"no-ambient-{band['id']}"] += 1; continue
            if prediction['model'] != 'ambient-only' and window['shipsDb'][b] is None: continue  # bande non couverte par ce modèle
            pairs[band['id']].append((index, 10 * math.log10(sum(10 ** (levels[f] / 10) for f in wanted))))
    return pairs, skipped


def evaluate(prediction: dict, rows: list[dict], station: dict, exploratory: bool = False) -> dict:
    qc, split = station.get('qc', {}), station.get('split', 'unassigned')
    reviewed = qc.get('status') == 'reviewed'
    base = {'model': prediction['model'], 'profileId': prediction['profileId'], 'station': station['id'], 'split': split,
            'qcStatus': qc.get('status', 'absent'), 'physicsSource': prediction['parameters']['physicsSource']}
    if not reviewed and not exploratory:
        return {**base, 'status': 'qc-not-reviewed', 'results': [], 'skipped': {}}
    pairs, skipped = pair(prediction, rows, station)
    results = []
    for b, band in enumerate(prediction['bands']):
        data = pairs.get(band['id'])
        if not data: continue
        windows = prediction['windows']
        predicted = np.array([total_db(windows[i]['ambientDb'][b], windows[i]['shipsDb'][b]) for i, _ in data])
        measured = np.array([m for _, m in data])
        ships = [windows[i]['shipsDb'][b] for i, _ in data]
        margins = np.array([-math.inf if s in (None, 'zero') else float(s) - windows[i]['ambientDb'][b] for (i, _), s in zip(data, ships)])
        regimes = np.where(margins > DOMINANCE_DB, 'ships', np.where(margins < -DOMINANCE_DB, 'ambient', 'mixed'))
        flags = [f['flag'] for f in qc.get('flags', []) if min(float(x) for x in band['decidecadesHz']) <= f['bandsUpToHz']]
        entry = {'band': band['id'], 'kind': band['kind'], 'fMinHz': band['fMin'], 'fMaxHz': band['fMax'], 'qcFlags': flags,
                 **stats(predicted - measured, predicted, measured), 'byRegime': {}}
        for regime in ['ships', 'mixed', 'ambient']:
            mask = regimes == regime
            if mask.any(): entry['byRegime'][regime] = stats(predicted[mask] - measured[mask], predicted[mask], measured[mask])
        results.append(entry)
    status = ('exploratory' if not reviewed else 'evaluated') if results else 'no-compatible-observations'
    return {**base, 'status': status, 'results': results, 'skipped': dict(skipped),
            'dominanceThresholdDb': DOMINANCE_DB,
            'limits': 'Écarts sur les seuls sites, périodes et bandes évalués ; aucune précision hors de ces conditions ni conséquence biologique validée.'
                      + ('' if reviewed else ' RAPPORT EXPLORATOIRE : contrôle qualité des mesures non revu.')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('prediction', type=Path); parser.add_argument('measurements', type=Path); parser.add_argument('station', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--exploratory', action='store_true', help='autorise un rapport sans contrôle qualité revu (étiqueté exploratoire)')
    args = parser.parse_args()
    with args.measurements.open(newline='') as file: rows = list(csv.DictReader(file))
    report = evaluate(json.loads(args.prediction.read_text()), rows, json.loads(args.station.read_text()), args.exploratory)
    report['inputHashes'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [args.prediction, args.measurements, args.station]}
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(report, indent=2, allow_nan=False, ensure_ascii=False) + '\n')
    print(report['status'], {r['band']: (r['count'], round(r['biasDb'], 1), round(r['rmseDb'], 1)) for r in report['results']})
