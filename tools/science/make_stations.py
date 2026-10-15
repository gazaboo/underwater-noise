"""Génère les fiches des stations ICES du protocole à partir de sources figées, sans rien inventer.

Sources : instantané du dictionnaire de stations ICES et des profondeurs EMODnet
(stations/sources-2026-10-15.json), protocole (protocol-v1.json), journal des téléchargements
(empreintes), métadonnées des fichiers HDF5 (hauteur de l'hydrophone au-dessus du fond).
Une fiche existante n'est jamais écrasée : sa section `qc` est le résultat d'une revue.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import h5py

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def scalar(file, path):
    value = file[path][()].reshape(-1)[0]
    return value.decode().strip('\x00 ') if isinstance(value, bytes) else value.item() if hasattr(value, 'item') else value


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--cache', type=Path, default=ROOT / 'tools/.cache/science')
    args = parser.parse_args()
    protocol = json.loads((HERE / 'protocol-v1.json').read_text())
    sources = json.loads((HERE / 'stations/sources-2026-10-15.json').read_text())
    log = json.loads((args.cache / 'fetch-log.json').read_text())
    for spec in protocol['stations']:
        if 'ices' not in spec: continue
        target = HERE / 'stations' / f"{spec['id']}.json"
        if target.exists(): print(f'{target.name} existe : conservée'); continue
        code = spec['ices']
        entry = sources['stations'][code]
        depth = -sources['emodnetDepth'][code]['avg']
        if any(f'ices-{u}' not in log for u in spec['days'].values()): print(f"{spec['id']} : fichiers incomplets, fiche différée"); continue
        files = {}
        for day, upload in spec['days'].items():
            fetched = log[f'ices-{upload}']
            path = args.cache / fetched['file']
            with h5py.File(path, 'r') as f:
                if str(scalar(f, 'FileInformation/StationCode')) != code: raise ValueError(f'{path.name} : station différente')
                height = float(scalar(f, 'Metadata/MeasurementHeight'))
            files[day] = {'uploadId': upload, 'file': path.name, 'sha256': fetched['sha256'], 'segment': None, 'heightAboveBottomM': height}
        heights = {f['heightAboveBottomM'] for f in files.values()}
        station = {
            'id': spec['id'], 'name': f"ICES {code} — {entry['Station_Name']}, {entry['Station_LongName']}",
            'split': spec['role'], 'stratum': spec['stratum'], 'splitNote': 'Rôle fixé par docs/VALIDATION_PROTOCOLE.md (v1), tirage stratifié avant tout calcul.',
            'deployment': {
                'station': code, 'lat': entry['Station_Latitude'], 'lon': entry['Station_Longitude'], 'waterDepthM': round(depth, 2),
                'heightAboveBottomM': next(iter(heights)) if len(heights) == 1 else None, 'receiverDepthM': round(depth - next(iter(heights)), 2) if len(heights) == 1 else None,
                'timestampConvention': 'start',
                'source': (f"Position : dictionnaire de stations ICES (Station_Code {code}, ±{entry['Station_LatitudeRange']}°), instantané du 15/10/2026. "
                           f"Profondeur d'eau : EMODnet Bathymetry à cette position ({depth:.2f} m, {sources['emodnetDepth'][code]['reference']['identifier']}), marée ignorée. "
                           "Hauteur au-dessus du fond : métadonnée ICES MeasurementHeight de chaque fichier. Convention d'horodatage « début de fenêtre » NON confirmée par le producteur.")},
            'ices': {'files': files},
            'ais': {'source': 'DMA (aisdata.ais.dk), AIS terrestre danois', 'coverageNote': 'À quantifier par le diagnostic de rayon.'},
            'qc': {'status': 'draft', 'excludeBands': [], 'excludePeriods': [], 'flags': [
                {'bandsUpToHz': 63, 'flag': 'flow-noise-susceptible', 'note': 'Critère 5 du protocole : décidécades ≤ 63 Hz évaluées mais exclues du calage.', 'source': 'Basan et al. 2024, §4.2.3 (lu)'}],
                'notes': ['Revue non réalisée.']},
        }
        target.write_text(json.dumps(station, indent=2, ensure_ascii=False) + '\n')
        print(f'{target.name} écrite')


if __name__ == '__main__': main()
