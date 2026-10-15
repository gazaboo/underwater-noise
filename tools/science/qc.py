"""Contrôle qualité des MESURES seules (protocole §4) : aucune prédiction n'est lue ici.

Pour chaque station du protocole et chacun de ses jours :
  - export des fenêtres de 60 s (ices.py) ou des minutes NOAA (noaa.py) ;
  - critère 1 (intégrité) : métadonnées d'export (segments, chevauchements, trous) ;
  - critère 2 (étalonnage déclaré) : métadonnée CalibrationProcedure / état d'étalonnage NOAA ;
  - critère 4 (plancher de l'instrument) : décidécade signalée si L50 − L1 < 3 dB sur le jour ;
  - figure par station : spectres de percentiles (L1, L10, L50, L90, L99) et spectrogramme par jour.
Les critères 3, 5 et 6 (littérature, écoulement, interventions) sont reportés à la main dans la fiche.
Sortie : <out>/<station>-qc.json et <out>/<station>-qc.png ; la fiche station n'est pas modifiée.
"""
from __future__ import annotations
import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from ices import export

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FLOOR_SPREAD_DB = 3


def load(csv_path: Path):
    levels = defaultdict(dict)
    with csv_path.open(newline='') as file:
        for row in csv.DictReader(file):
            levels[row['start']][float(row['bandHz'])] = float(row['observedDb'])
    starts = sorted(levels)
    bands = sorted({b for v in levels.values() for b in v})
    matrix = np.array([[levels[s].get(b, np.nan) for b in bands] for s in starts])
    return starts, bands, matrix


def day_stats(starts, bands, matrix):
    pct = {name: np.nanpercentile(matrix, p, axis=0).tolist() for name, p in [('L99', 1), ('L90', 10), ('L50', 50), ('L10', 90), ('L1', 99)]}
    spread = np.array(pct['L50']) - np.array(pct['L99'])  # L99 : niveau dépassé 99 % du temps (percentile 1)
    floor = [b for b, s in zip(bands, spread) if s < FLOOR_SPREAD_DB]
    return {'windows': len(starts), 'bandsHz': bands, 'percentiles': pct, 'floorSuspectBandsHz': floor}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--protocol', type=Path, default=HERE / 'protocol-v1.json')
    parser.add_argument('--cache', type=Path, default=ROOT / 'tools/.cache/science')
    parser.add_argument('--out', type=Path, default=ROOT / 'docs/validation/qc')
    parser.add_argument('--station', action='append')
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    work = args.cache / 'qc'; work.mkdir(exist_ok=True)
    for spec in protocol['stations']:
        if args.station and spec['id'] not in args.station: continue
        station = json.loads((HERE / 'stations' / f"{spec['id']}.json").read_text())
        days = sorted(spec['days'])
        fig, axes = plt.subplots(2, len(days), figsize=(4.2 * len(days), 7), squeeze=False, constrained_layout=True)
        report = {'station': spec['id'], 'role': spec['role'], 'criteria': {'floorSpreadDb': FLOOR_SPREAD_DB}, 'days': {}}
        for column, day in enumerate(days):
            csv_path = work / f"{spec['id']}-{day}.csv"
            if 'ices' in spec:
                entry = station['ices']['files'][day]
                deployment = {**station['deployment'], 'receiverDepthM': round(station['deployment']['waterDepthM'] - entry['heightAboveBottomM'], 2),
                              'periodStart': f'{day}T00:15:00Z', 'periodEnd': f'{day}T23:59:59Z'}
                export(args.cache / 'ices' / entry['file'], deployment, csv_path, 60, entry.get('segment'))
                meta = json.loads(csv_path.with_suffix('.metadata.json').read_text())
                calibration = meta['instrument'].get('CalibrationProcedure')
                integrity = {k: meta[k] for k in ['segments', 'selectedSegment', 'exactDuplicatesRemoved', 'discontinuities', 'overlappingSteps', 'windows']}
            else:
                from noaa import export_nrs
                meta = export_nrs(args.cache / 'nrs', station, day, csv_path)
                calibration, integrity = meta['calibration'], {k: meta[k] for k in ['minutes', 'missingMinutes']}
            starts, bands, matrix = load(csv_path)
            stats = day_stats(starts, bands, matrix)
            report['days'][day] = {'calibration': calibration, 'calibrationDeclared': bool(calibration), 'integrity': integrity, **stats}
            ax = axes[0][column]
            for name, style in [('L99', ':'), ('L90', '--'), ('L50', '-'), ('L10', '--'), ('L1', ':')]:
                ax.semilogx(bands, stats['percentiles'][name], style, label=name, color='k' if name == 'L50' else 'gray')
            for b in stats['floorSuspectBandsHz']: ax.axvline(b, color='tab:red', alpha=.3)
            ax.set_title(f"{spec['id']} {day} ({stats['windows']} min)"); ax.set_xlabel('Hz'); ax.set_ylabel('dB re 1 µPa'); ax.grid(alpha=.3)
            if column == 0: ax.legend(fontsize=7)
            ax = axes[1][column]
            if len(starts):
                hours = [(datetime.fromisoformat(s.replace('Z', '+00:00')) - datetime.fromisoformat(f'{day}T00:00:00+00:00')).total_seconds() / 3600 for s in starts]
                mesh = ax.pcolormesh(hours, bands, matrix.T, shading='nearest', cmap='viridis', vmin=np.nanpercentile(matrix, 2), vmax=np.nanpercentile(matrix, 98))
                ax.set_yscale('log'); ax.set_xlabel('heure UTC'); ax.set_ylabel('Hz'); fig.colorbar(mesh, ax=ax, label='dB')
        fig.suptitle(f"Contrôle qualité des mesures — {station['name']} (aucune prédiction affichée)", fontsize=10)
        fig.savefig(args.out / f"{spec['id']}-qc.png", dpi=80); plt.close(fig)
        (args.out / f"{spec['id']}-qc.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + '\n')
        print(spec['id'], {d: (v['windows'], v['floorSuspectBandsHz']) for d, v in report['days'].items()}, flush=True)


if __name__ == '__main__': main()
