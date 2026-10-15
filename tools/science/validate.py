"""Compare independent, quality-controlled Leq measurements with matching model cells.

CSV: station,start,end,bandHz,lat,lon,receiverDepthM,observedDb,split,quality
split=calibration|holdout. Only accepted holdout samples establish reported errors.
No depth-averaged prediction is compared to a point hydrophone.
"""
from __future__ import annotations
import argparse
import csv
from collections import defaultdict, Counter
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import statistics


def timestamp(value):
    d = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if d.tzinfo is None: raise ValueError('Dates UTC/offset requis')
    return d.timestamp()


def evaluate(data, measurements):
    if data['depthMode'] != 'receiver': raise ValueError('La validation hydrophone exige depthMode=receiver ; moyenne en profondeur incompatible.')
    groups, skipped, keys = defaultdict(list), Counter(), set()
    grid = data['grid']
    frames = {(timestamp(f['start']), timestamp(f['end'])): f for f in data['frames']}
    for row in measurements:
        if row['quality'] != 'accepted' or row['split'] != 'holdout': skipped['not-independent-or-rejected'] += 1; continue
        start, end = timestamp(row['start']), timestamp(row['end'])
        key = (row['station'], start, end, row['bandHz'])
        if key in keys: raise ValueError('Mesure dupliquée')
        keys.add(key)
        frame = frames.get((start, end))
        if frame is None: skipped['period-mismatch'] += 1; continue
        nominal = float(row['bandHz'])
        if nominal not in (63, 125): skipped['band-mismatch'] += 1; continue
        band = 0 if nominal == 63 else 1
        lat, lon = float(row['lat']), float(row['lon'])
        x = math.floor((lon - grid['west']) / grid['deltaLon']); y = math.floor((grid['north'] - lat) / grid['deltaLat'])
        if not (0 <= x < grid['width'] and 0 <= y < grid['height']): skipped['outside-grid'] += 1; continue
        # Require a receiver actually placed at the station, rather than anywhere
        # inside a potentially large cell. 1e-5 deg ~ 1 m.
        if abs(lon - (grid['west'] + (x + .5) * grid['deltaLon'])) > 1e-5 or abs(lat - (grid['north'] - (y + .5) * grid['deltaLat'])) > 1e-5:
            skipped['receiver-position-mismatch'] += 1; continue
        cell = frame['cells'][y * grid['width'] + x]
        if cell is None: skipped['missing-prediction'] += 1; continue
        if cell['receiverDepthM'] is None or abs(float(row['receiverDepthM']) - cell['receiverDepthM']) > .1: skipped['depth-mismatch'] += 1; continue
        ships, ambient = cell['shipsDb'][band], cell['ambientDb'][band]
        predicted = ambient + (10 * math.log10(1 + 10 ** ((ships - ambient) / 10)) if ships is not None else 0)
        measured = float(row['observedDb'])
        if not math.isfinite(measured): skipped['invalid-measurement'] += 1; continue
        groups[(row['station'], nominal)].append(predicted - measured)
    results = []
    for (station, band), errors in sorted(groups.items()):
        ordered = sorted(errors)
        percentile = lambda q: ordered[round(q * (len(ordered) - 1))]
        results.append({'station': station, 'bandHz': band, 'count': len(errors), 'biasDb': statistics.mean(errors),
                        'rmseDb': math.sqrt(statistics.mean(e * e for e in errors)), 'medianErrorDb': statistics.median(errors),
                        'p05ErrorDb': percentile(.05), 'p95ErrorDb': percentile(.95)})
    return {'status': 'evaluated-on-holdout' if results else 'no-compatible-observations', 'results': results, 'skipped': dict(skipped),
            'limits': 'Écarts sur les seuls sites/périodes évalués ; aucune précision mondiale ni conséquence biologique validée.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path); parser.add_argument('measurements', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args()
    with args.measurements.open(newline='') as file: report = evaluate(json.loads(args.dataset.read_text()), list(csv.DictReader(file)))
    report.update({'profileId': 'north-sea-reference-v1', 'datasetHash': hashlib.sha256(args.dataset.read_bytes()).hexdigest(), 'measurementsHash': hashlib.sha256(args.measurements.read_bytes()).hexdigest()})
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(report['status'])
