"""Contrôle qualité des MESURES seules (protocole §4) : aucune prédiction n'est lue ici.

Pour chaque station du protocole et chacun de ses jours :
  - export des fenêtres de 60 s (ices.py) ou des minutes NOAA (noaa.py) ;
  - critère 1 (intégrité) : métadonnées d'export (segments, chevauchements, trous) ;
  - critère 2 (étalonnage déclaré) : métadonnée CalibrationProcedure / état d'étalonnage NOAA ;
  - critère 4 (plancher de l'instrument, version de l'écart n° 2 au protocole) :
      a) silences instrumentaux : ≥ 10 min consécutives où le niveau large bande est ≥ 15 dB sous la
         médiane du jour ET varie de moins de 0,5 dB d'une minute à l'autre (spectre figé) → période exclue ;
      b) bandes au plancher : médiane du jour à moins de 3 dB du spectre de ces silences → bande exclue ;
      c) indicateur seulement (non éliminatoire) : L50 − L99 < 3 dB (distribution étroite : chœurs
         biologiques, trafic lointain régulier ou plancher ; décidé sur figure) ;
  - figure par station : spectres de percentiles (L1, L10, L50, L90, L99) et spectrogramme par jour.
Les critères 3, 5 et 6 (littérature, écoulement, interventions) sont reportés à la main dans la fiche.
Sortie : <out>/<station>-qc.json et <out>/<station>-qc.png ; la fiche station n'est pas modifiée.
Les jours extraits sont conservés dans <cache>/days/ (avec l'empreinte du fichier source) ; avec
--prune-raw, le fichier ICES brut est ensuite supprimé (re-téléchargeable : identifiant et empreinte
dans la fiche).
"""
from __future__ import annotations
import argparse
import csv
import json
from collections import defaultdict
from datetime import date, datetime, timedelta
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


DROPOUT_MIN, DROPOUT_BELOW_DB, DROPOUT_STEADY_DB = 10, 15, 0.5


def dropouts(starts, bands, matrix):
    """Silences instrumentaux (critère 4a) et bandes au plancher (4b)."""
    broadband = 10 * np.log10(np.nansum(10 ** (matrix / 10), axis=1))
    median = np.median(broadband)
    low = broadband <= median - DROPOUT_BELOW_DB
    times = np.array([datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() for s in starts])
    contiguous = np.r_[False, np.diff(times) == 60]
    steady = contiguous & np.r_[False, np.abs(np.diff(broadband)) < DROPOUT_STEADY_DB]
    candidate = low & (steady | np.r_[steady[1:], False])
    periods, run = [], []
    for i, flag in enumerate(candidate):
        if flag and (not run or contiguous[i]): run.append(i); continue
        if len(run) >= DROPOUT_MIN: periods.append(run)
        run = [i] if flag else []
    if len(run) >= DROPOUT_MIN: periods.append(run)
    result = [{'start': starts[r[0]], 'end': end_of(starts[r[-1]]), 'minutes': len(r), 'broadbandDb': float(np.median(broadband[r]))} for r in periods]
    floor = np.nanmedian(matrix[[i for r in periods for i in r]], axis=0) if periods else None
    return result, floor


def end_of(start: str) -> str:
    return (datetime.fromisoformat(start.replace('Z', '+00:00')) + timedelta(minutes=1)).isoformat().replace('+00:00', 'Z')


def day_stats(starts, bands, matrix):
    pct = {name: np.nanpercentile(matrix, p, axis=0).tolist() for name, p in [('L99', 1), ('L90', 10), ('L50', 50), ('L10', 90), ('L1', 99)]}
    spread = np.array(pct['L50']) - np.array(pct['L99'])  # L99 : niveau dépassé 99 % du temps (percentile 1)
    narrow = [b for b, s in zip(bands, spread) if s < FLOOR_SPREAD_DB]
    silences, floor_spectrum = dropouts(starts, bands, matrix)
    keep = np.ones(len(starts), bool)
    for p in silences: keep &= ~np.array([p['start'] <= s < p['end'] for s in starts])
    at_floor = [] if floor_spectrum is None else [b for b, l50, f in zip(bands, np.nanpercentile(matrix[keep], 50, axis=0), floor_spectrum) if l50 - f < FLOOR_SPREAD_DB]
    return {'windows': len(starts), 'bandsHz': bands, 'percentiles': pct, 'narrowDistributionBandsHz': narrow,
            'instrumentSilences': silences, 'bandsAtInstrumentFloorHz': at_floor,
            'floorSuspectBandsHz': at_floor}


def persistent_floor(matrix, floor):
    """Écart n° 3 : jour stable et spectre identique à un silence du même hydrophone.

    La correspondance du numéro d'instrument et des fréquences est vérifiée par
    persistent_floor_checks ; ce calcul ne lit aucune prédiction.
    """
    broadband = 10 * np.log10(np.sum(10 ** (matrix / 10), axis=1))
    spread = float(np.percentile(broadband, 99) - np.percentile(broadband, 1))
    delta = float(np.max(np.abs(np.median(matrix, axis=0) - floor)))
    return {'detected': spread < DROPOUT_STEADY_DB and delta < FLOOR_SPREAD_DB,
            'broadbandP99MinusP1Db': spread, 'maxMedianSpectrumDifferenceDb': delta}


def persistent_floor_checks(protocol, cache, out):
    """Deuxième passe sur les seules extractions et rapports QC déjà disponibles."""
    days, references = [], []
    for spec in protocol['stations']:
        if 'ices' not in spec: continue
        report_path = out / f"{spec['id']}-qc.json"
        if not report_path.exists(): continue
        report = json.loads(report_path.read_text())
        for day, stats in report['days'].items():
            path = cache / 'days' / f"{spec['id']}-{day}.csv"
            meta = json.loads(path.with_suffix('.metadata.json').read_text())
            serial = meta['instrument'].get('HydrophoneSerialNumber')
            if not serial: continue
            starts, bands, matrix = load(path)
            days.append((spec['id'], day, serial, bands, matrix, report_path))
            mask = np.array([any(p['start'] <= s < p['end'] for p in stats['instrumentSilences']) for s in starts])
            if mask.any():
                references.append((spec['id'], day, serial, bands, np.median(matrix[mask], axis=0)))
    for sid, day, serial, bands, matrix, report_path in days:
        checks = []
        for ref_sid, ref_day, ref_serial, ref_bands, floor in references:
            if serial != ref_serial or bands != ref_bands or (sid, day) == (ref_sid, ref_day): continue
            check = persistent_floor(matrix, floor)
            checks.append({**check, 'referenceStation': ref_sid, 'referenceDay': ref_day, 'hydrophoneSerialNumber': serial})
        report = json.loads(report_path.read_text())
        report['days'][day]['persistentFloorChecks'] = checks
        report_path.write_text(json.dumps(report, indent=1, ensure_ascii=False) + '\n')
        for check in checks:
            if check['detected']: print('Silence persistant :', sid, day, check, flush=True)


def spectrogram_cells(hours, matrix):
    """Cellules de 60 s et cellules vides aux lacunes, sans étirer les mesures."""
    edges, columns = [hours[0]], []
    for hour, values in zip(hours, matrix):
        if hour > edges[-1] + 1e-8:
            columns.append(np.full(matrix.shape[1], np.nan)); edges.append(hour)
        columns.append(values); edges.append(hour + 1 / 60)
    return np.array(edges), np.array(columns)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--protocol', type=Path, default=HERE / 'protocol-v1.json')
    parser.add_argument('--cache', type=Path, default=ROOT / 'tools/.cache/science')
    parser.add_argument('--out', type=Path, default=ROOT / 'docs/validation/qc')
    parser.add_argument('--station', action='append')
    parser.add_argument('--prune-raw', action='store_true', help='supprime les HDF5 ICES une fois tous leurs jours extraits')
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    work = args.cache / 'days'; work.mkdir(exist_ok=True)
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
                              'periodStart': f'{day}T00:15:00Z', 'periodEnd': f'{(date.fromisoformat(day) + timedelta(days=1)).isoformat()}T00:00:00Z'}
                raw = args.cache / 'ices' / entry['file']
                if raw.exists():
                    export(raw, deployment, csv_path, 60, entry.get('segment'))
                meta = json.loads(csv_path.with_suffix('.metadata.json').read_text())
                if meta['sourceSha256'] != entry['sha256']: raise ValueError(f'{csv_path.name} : empreinte source ≠ fiche')
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
            for b in stats['narrowDistributionBandsHz']: ax.axvline(b, color='tab:orange', alpha=.25)
            for b in stats['bandsAtInstrumentFloorHz']: ax.axvline(b, color='tab:red', alpha=.5)
            ax.set_title(f"{spec['id']} {day} ({stats['windows']} min)"); ax.set_xlabel('Hz'); ax.set_ylabel('dB re 1 µPa'); ax.grid(alpha=.3)
            if column == 0: ax.legend(fontsize=7)
            ax = axes[1][column]
            if len(starts):
                hours = [(datetime.fromisoformat(s.replace('Z', '+00:00')) - datetime.fromisoformat(f'{day}T00:00:00+00:00')).total_seconds() / 3600 for s in starts]
                edges, displayed = spectrogram_cells(hours, matrix)
                frequency_edges = np.r_[bands[0] / 10 ** .05, np.array(bands) * 10 ** .05]
                mesh = ax.pcolormesh(edges, frequency_edges, displayed.T, shading='flat', cmap='viridis', vmin=np.nanpercentile(matrix, 2), vmax=np.nanpercentile(matrix, 98))
                ax.set_yscale('log'); ax.set_xlabel('heure UTC'); ax.set_ylabel('Hz'); fig.colorbar(mesh, ax=ax, label='dB')
        fig.suptitle(f"Contrôle qualité des mesures — {station['name']} (aucune prédiction affichée)", fontsize=10)
        fig.savefig(args.out / f"{spec['id']}-qc.png", dpi=80); plt.close(fig)
        (args.out / f"{spec['id']}-qc.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + '\n')
        print(spec['id'], {d: (v['windows'], v['bandsAtInstrumentFloorHz'], [(p['start'][11:16], p['minutes']) for p in v['instrumentSilences']]) for d, v in report['days'].items()}, flush=True)
        if args.prune_raw and 'ices' in spec:
            for entry in station['ices']['files'].values():
                raw = args.cache / 'ices' / entry['file']
                if raw.exists(): raw.unlink(); print(f'  supprimé : {raw.name} (empreinte {entry["sha256"][:12]}… dans la fiche)')
    persistent_floor_checks(protocol, args.cache, args.out)


if __name__ == '__main__': main()
