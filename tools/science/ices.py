"""Export ICES continuous-noise HDF5 (JOMOPANS processing) into contiguous window energies.

Station coordinates, receiver depth and timestamp convention are REQUIRED from
deployment metadata. MeasurementHeight is height above bottom, not receiver depth.

Windows are built from records that follow each other exactly (start + AveragingTime):
recorder clocks drift and restart, so no fixed UTC grid is imposed and nothing is
interpolated across a gap. Every decidecade of the file is exported, so broad bands
can be rebuilt by energy summation. Rows stay `unreviewed`: acceptance is decided by
an explicit QC file read by validate.py, never here.
"""
from __future__ import annotations
import argparse
import csv
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import h5py
import numpy as np

# IEC 61260-1 nominal mid-band labels, one decade (base-10 decidecades).
NOMINAL = [10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80]
FIELDS = ['station', 'start', 'end', 'bandHz', 'centerHz', 'lat', 'lon', 'receiverDepthM', 'observedDb', 'quality']


def decidecade(frequency: float) -> tuple[float, float]:
    """(nominal label, exact base-10 centre) of a decidecade given as nominal or exact centre."""
    n = round(10 * math.log10(frequency))
    exact = 10 ** (n / 10)
    if abs(frequency - exact) / exact > .025: raise ValueError(f'{frequency} Hz : pas un centre de décidécade')
    nominal = NOMINAL[n % 10] * 10 ** (n // 10 - 1)
    return (int(nominal) if nominal == int(nominal) else nominal), exact


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat().replace('+00:00', 'Z')


def parse_time(raw) -> int:
    text = raw.decode() if isinstance(raw, bytes) else str(raw)
    date = datetime.fromisoformat(text.strip('\x00 ').replace('Z', '+00:00'))
    # ICES DateTime specification is UTC even when no offset is encoded.
    t = (date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date).timestamp()
    if not float(t).is_integer(): raise ValueError('Échantillons non alignés à la seconde')
    return int(t)


def segments(starts: np.ndarray) -> list[tuple[int, int]]:
    """Raw-order runs of strictly increasing start times, as [a, b) index ranges."""
    cuts = [0, *(np.where(np.diff(starts) <= 0)[0] + 1).tolist(), len(starts)]
    return list(zip(cuts[:-1], cuts[1:]))


def select_records(starts, values, segment: int | None, averaging: int):
    """Remove exact duplicates; refuse overlapping, differing series unless one segment is chosen."""
    parts = segments(starts)
    info = [{'index': i, 'records': b - a, 'start': iso(starts[a]), 'end': iso(starts[b - 1])} for i, (a, b) in enumerate(parts)]
    if segment is not None:
        if not 0 <= segment < len(parts): raise ValueError(f'Segment {segment} inexistant : {info}')
        a, b = parts[segment]
        return starts[a:b], values[a:b], {'segments': info, 'selectedSegment': segment, 'exactDuplicatesRemoved': 0, 'recordsOutsideSegment': len(starts) - (b - a)}
    order = np.argsort(starts, kind='stable')
    kept, duplicates = [], 0
    for i in order:
        if kept and starts[kept[-1]] == starts[i]:
            if np.array_equal(values[kept[-1]], values[i]): duplicates += 1; continue
            raise ValueError(f'Mesures différentes au même instant {iso(starts[i])} : série ambiguë, choisir un segment explicitement (--segment). Segments : {json.dumps(info)}')
        kept.append(i)
    kept = np.array(kept)
    overlaps = np.where(np.diff(starts[kept]) < averaging)[0]
    if overlaps.size:
        raise ValueError(f'Mesures chevauchantes ({overlaps.size}, première à {iso(starts[kept][overlaps[0]])}) : séries multiples, choisir un segment explicitement (--segment). Segments : {json.dumps(info)}')
    return starts[kept], values[kept], {'segments': info, 'selectedSegment': None, 'exactDuplicatesRemoved': duplicates, 'recordsOutsideSegment': 0}


def windows(starts: np.ndarray, averaging: int, window_sec: int):
    """Contiguous runs chunked into windows of window_sec/averaging records; remainders dropped."""
    k = window_sec // averaging
    result, run, gaps, overlaps = [], [0], Counter(), 0
    def flush():
        for c in range(0, len(run) - k + 1, k): result.append(run[c:c + k])
    for i in range(1, len(starts)):
        step = int(starts[i] - starts[i - 1])
        if step == averaging: run.append(i); continue
        if step < averaging: overlaps += 1
        gaps[step] += 1
        flush(); run = [i]
    flush()
    return result, {'discontinuities': dict(sorted(gaps.items())), 'overlappingSteps': overlaps}


def export(source, station, output, window_sec=60, segment=None):
    for field in ['station', 'lat', 'lon', 'receiverDepthM', 'timestampConvention', 'source']:
        if field not in station: raise ValueError(f'Métadonnée de déploiement requise : {field}')
    if station['timestampConvention'] not in ['start', 'end']: raise ValueError('Convention d’horodatage start/end requise')
    if not 0 < station['receiverDepthM']: raise ValueError('Profondeur du récepteur invalide')
    if not (-90 <= station['lat'] <= 90 and -180 <= station['lon'] <= 180): raise ValueError('Coordonnées invalides')
    lower = parse_time(station['periodStart']) if 'periodStart' in station else -math.inf
    upper = parse_time(station['periodEnd']) if 'periodEnd' in station else math.inf
    with h5py.File(source, 'r') as file:
        def scalar(path):
            if path not in file: return None
            value = file[path][()].reshape(-1)[0]
            return value.decode().strip('\x00 ') if isinstance(value, bytes) else value.item() if hasattr(value, 'item') else value
        if str(scalar('FileInformation/StationCode')) != str(station['station']): raise ValueError('Station différente de celle du fichier ICES')
        averaging = int(scalar('Metadata/AveragingTime'))
        if averaging <= 0 or window_sec % averaging or scalar('Metadata/FrequencyUnit') != 'Hz' or scalar('Metadata/MeasurementUnit') != 'SPL':
            raise ValueError('SPL en Hz requis ; durée de moyenne entière divisant la fenêtre')
        bands = [decidecade(float(f)) for f in file['Metadata/FrequencyIndex'][:].reshape(-1)]
        values = file['Data/LeqMeasurementsOfChannel1'][:].astype(float)
        starts = np.array([parse_time(t) for t in file['Data/DateTime'][:].reshape(-1)], dtype=np.int64)
        if values.shape != (len(starts), len(bands)): raise ValueError('Axes temps/fréquence non conformes ; aucune transposition supposée')
        if station['timestampConvention'] == 'end': starts = starts - averaging
        starts, values, selection = select_records(starts, values, segment, averaging)
        inside = (starts >= lower) & (starts + averaging <= upper)
        starts, values = starts[inside], values[inside]
        chunks, continuity = windows(starts, averaging, window_sec)
        output.parent.mkdir(parents=True, exist_ok=True)
        count = nonfinite = 0
        with output.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS)
            writer.writeheader()
            for chunk in chunks:
                start = int(starts[chunk[0]])
                for b, (nominal, exact) in enumerate(bands):
                    db = values[chunk, b]
                    if not np.all(np.isfinite(db)): nonfinite += 1; continue
                    level = 10 * math.log10(float(np.mean(10 ** (db / 10))))
                    writer.writerow({'station': station['station'], 'start': iso(start), 'end': iso(start + window_sec), 'bandHz': nominal, 'centerHz': exact,
                                     'lat': station['lat'], 'lon': station['lon'], 'receiverDepthM': station['receiverDepthM'], 'observedDb': level, 'quality': 'unreviewed'})
                    count += 1
        metadata = {'source': Path(source).name, 'deployment': station, 'windowSec': window_sec, 'averagingSec': averaging,
                    'file': {k: scalar(f'FileInformation/{k}') for k in ['StationCode', 'Institution', 'CountryCode', 'StartDate', 'EndDate', 'CreationDate']},
                    'instrument': {k: scalar(f'Metadata/{k}') for k in ['HydrophoneType', 'HydrophoneSerialNumber', 'RecorderType', 'MeasurementHeight', 'MeasurementSetup', 'RigDesign',
                                                                      'CalibrationProcedure', 'CalibrationDateTime', 'ProcessingAlgorithm', 'DatasetVersion', 'Comments']},
                    'bandsHz': [n for n, _ in bands], **selection, **continuity,
                    'recordsInPeriod': int(len(starts)), 'windows': len(chunks), 'recordsInWindows': len(chunks) * (window_sec // averaging),
                    'nonFiniteBandWindows': nonfinite, 'exportedRows': count, 'quality': 'unreviewed',
                    'notice': 'Acceptation décidée par le fichier QC de la station (validate.py), jamais par cet export.'}
        output.with_suffix('.metadata.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False, default=str) + '\n')
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('hdf5', type=Path); parser.add_argument('station', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--window', type=int, default=60, help='durée des fenêtres (s), multiple de AveragingTime')
    parser.add_argument('--segment', type=int, help='segment brut à retenir quand le fichier contient des séries chevauchantes')
    args = parser.parse_args()
    station = json.loads(args.station.read_text())
    n = export(args.hdf5, station.get('deployment', station), args.output, args.window, args.segment)
    print(f'{n} niveaux (fenêtre × décidécade) exportés, contrôle qualité non réalisé.')
