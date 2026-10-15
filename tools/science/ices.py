"""Export ICES/JOMOPANS one-second Leq into complete UTC minute energies.

Station coordinates, receiver depth and timestamp convention are REQUIRED from
deployment metadata. MeasurementHeight is height above bottom, not receiver depth.
Exported rows remain unreviewed until independent quality control is supplied.
"""
import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import h5py
import numpy as np


def export(source, station, output, split='holdout'):
    for field in ['station', 'lat', 'lon', 'receiverDepthM', 'timestampConvention', 'source']:
        if field not in station: raise ValueError(f'Métadonnée de déploiement requise : {field}')
    if station['timestampConvention'] not in ['start', 'end']: raise ValueError('Convention d’horodatage start/end requise')
    if not 0 < station['receiverDepthM']: raise ValueError('Profondeur du récepteur invalide')
    if not (-90 <= station['lat'] <= 90 and -180 <= station['lon'] <= 180): raise ValueError('Coordonnées invalides')
    lower = datetime.fromisoformat(station['periodStart'].replace('Z','+00:00')).timestamp() if 'periodStart' in station else -math.inf
    upper = datetime.fromisoformat(station['periodEnd'].replace('Z','+00:00')).timestamp() if 'periodEnd' in station else math.inf
    with h5py.File(source, 'r') as file:
        def scalar(path):
            value = file[path][()].reshape(-1)[0]
            return value.decode().strip('\x00 ') if isinstance(value, bytes) else value.item() if hasattr(value, 'item') else value
        if str(scalar('FileInformation/StationCode')) != str(station['station']): raise ValueError('Station différente de celle du fichier ICES')
        averaging = int(scalar('Metadata/AveragingTime'))
        if averaging <= 0 or 60 % averaging or scalar('Metadata/FrequencyUnit') != 'Hz' or scalar('Metadata/MeasurementUnit') != 'SPL': raise ValueError('SPL en Hz requis ; durée entière divisant 60 s')
        frequencies = file['Metadata/FrequencyIndex'][:].reshape(-1)
        indices = []
        for nominal, exact in [(63, 10 ** 1.8), (125, 10 ** 2.1)]:
            hits = np.where(np.isclose(frequencies, exact, rtol=.002) | np.isclose(frequencies, nominal, rtol=.0001))[0]
            if len(hits) != 1: raise ValueError(f'Bande {nominal} Hz absente ou ambiguë')
            indices.append(int(hits[0]))
        values = file['Data/LeqMeasurementsOfChannel1'][:]
        times = file['Data/DateTime'][:]
        if values.shape != (len(times), len(frequencies)): raise ValueError('Axes temps/fréquence non conformes ; aucune transposition supposée')
        groups = defaultdict(dict)
        origin = None
        skipped_alignment = 0
        previous_end = -math.inf
        for text, row in zip(times, values):
            text = text.decode().strip('\x00 ')
            date = datetime.fromisoformat(text.replace('Z', '+00:00'))
            # ICES DateTime specification uses UTC even when no Z is encoded.
            time = date.replace(tzinfo=timezone.utc).timestamp() if date.tzinfo is None else date.timestamp()
            if not time.is_integer(): raise ValueError('Échantillons non alignés à la seconde')
            start = int(time) - (averaging if station['timestampConvention'] == 'end' else 0)
            if start < lower or start + averaging > upper: continue
            if start < previous_end: raise ValueError('Mesures chevauchantes ou non triées : comparaison refusée')
            previous_end = start + averaging
            if origin is None: origin = start
            window, second = divmod(start - origin, 60)
            minute = origin + window * 60
            if second % averaging:
                skipped_alignment += 1
                continue # recorder clock discontinuity: do not invent overlapping integration windows
            if second in groups[minute]: raise ValueError('Seconde dupliquée')
            groups[minute][second] = [float(row[i]) for i in indices]
        output.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        with output.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=['station', 'start', 'end', 'bandHz', 'lat', 'lon', 'receiverDepthM', 'observedDb', 'split', 'quality'])
            writer.writeheader()
            for minute, seconds in sorted(groups.items()):
                if len(seconds) != 60 // averaging: continue
                for band, nominal in enumerate([63, 125]):
                    db = [v[band] for v in seconds.values()]
                    if not all(math.isfinite(v) for v in db): continue
                    level = 10 * math.log10(sum(10 ** (v / 10) for v in db) / len(db))
                    writer.writerow({'station': station['station'], 'start': datetime.fromtimestamp(minute, timezone.utc).isoformat(), 'end': datetime.fromtimestamp(minute + 60, timezone.utc).isoformat(),
                                     'bandHz': nominal, 'lat': station['lat'], 'lon': station['lon'], 'receiverDepthM': station['receiverDepthM'], 'observedDb': level, 'split': split, 'quality': 'unreviewed'})
                    count += 1
        metadata = {'source': str(source), 'deployment': station, 'calibrationProcedure': scalar('Metadata/CalibrationProcedure'), 'exportedRows': count, 'skippedUnalignedRecords': skipped_alignment,
                    'quality': 'unreviewed', 'notice': 'Vérifier calibration, bruit de courant, intégrité et indépendance avant de marquer une ligne accepted.'}
        output.with_suffix('.metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('hdf5', type=Path); parser.add_argument('station', type=Path); parser.add_argument('output', type=Path)
    parser.add_argument('--split', choices=['calibration', 'holdout'], default='holdout')
    args = parser.parse_args()
    print(f'{export(args.hdf5, json.loads(args.station.read_text()), args.output, args.split)} niveaux de minute exportés, contrôle qualité non réalisé.')
