"""Comparaison modèle–mesures à une station, pilotée par `stations/<id>.json`.

Étapes, toutes reproductibles et hachées :
  1. mesures ICES → fenêtres de 60 s contiguës, toutes décidécades (ices.py) ;
  2. AIS DMA (CSV extrait par ais_archive.py) → replay trié ;
  3. vent ERA5 au point (Open-Meteo archive, m/s), mis en cache ;
  4. prédictions : loi du moteur mondial, fond naturel seul, RAM au récepteur (option) ;
  5. comparaison (validate.py). Sans contrôle qualité revu, seul un rapport `--exploratory`
     est produit, étiqueté comme tel. Aucun paramètre n'est ajusté ici.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import importlib.util
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen
import ram
from ices import export
from validate import evaluate

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse(text: str) -> datetime:
    return datetime.fromisoformat(text.replace('Z', '+00:00'))


def replay_from_dma(csv_path: Path, output: Path) -> dict:
    """DMA CSV → replay NDJSON trié (même conversion que tools/convert_ais.py, sans sous-échantillonnage)."""
    spec = importlib.util.spec_from_file_location('convert_ais', ROOT / 'tools/convert_ais.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    rows = []
    with csv_path.open(newline='') as file:
        for row in csv.DictReader(file):
            if row['Type of mobile'] not in ('Class A', 'Class B'): continue
            try: t = datetime.strptime(row['# Timestamp'], '%d/%m/%Y %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
            except ValueError: continue
            lat, lon = module.fnum(row['Latitude']), module.fnum(row['Longitude'])
            if lat is None or lon is None: continue
            rows.append((t, row, lat, lon))
    rows.sort(key=lambda r: r[0])  # tri stable : le replay exige des horodatages croissants
    writer = module.Writer(output, 0)
    for t, row, lat, lon in rows:
        writer.static(t, int(row['MMSI']), module.DMA_TYPES.get(row['Ship type'].strip().lower()), module.fnum(row.get('A', '')), module.fnum(row.get('B', '')), module.fnum(row['Length']))
        writer.position(t, int(row['MMSI']), lat, lon, module.fnum(row['SOG']), module.fnum(row['COG']), module.fnum(row['Heading']))
    writer.close()
    return {'aisRows': len(rows), 'aisStart': datetime.fromtimestamp(rows[0][0], timezone.utc).isoformat() if rows else None,
            'aisEnd': datetime.fromtimestamp(rows[-1][0], timezone.utc).isoformat() if rows else None}


def wind_file(cache: Path, station: dict, start: datetime, end: datetime) -> Path:
    d = station['deployment']
    path = cache / f"wind-{station['id']}-{start:%Y%m%d}-{end:%Y%m%d}.json"
    if not path.exists():
        url = ('https://archive-api.open-meteo.com/v1/archive?'
               f"latitude={d['lat']}&longitude={d['lon']}&start_date={start:%Y-%m-%d}&end_date={end:%Y-%m-%d}"
               '&hourly=wind_speed_10m&wind_speed_unit=ms&timezone=GMT&models=era5')
        with urlopen(url, timeout=60) as response: path.write_bytes(response.read())
    return path


def predict(station_path: Path, observations: Path, replay: Path, wind: Path, start: str, end: str, model: str, out: Path, extra=()):
    subprocess.run(['node', '--import', 'tsx', str(HERE / 'point-predict.ts'), '--station', str(station_path), '--observations', str(observations),
                    '--replay', str(replay), '--wind', str(wind), '--from', start, '--to', end, '--model', model, '--out', str(out), *extra], cwd=ROOT, check=True)


def run(args):
    for name in ['station', 'ais_csv', 'cache', 'out']: setattr(args, name, getattr(args, name).resolve())
    station = json.loads(args.station.read_text())
    sid, cache, out = station['id'], args.cache, args.out
    out.mkdir(parents=True, exist_ok=True)
    start, end = parse(args.start), parse(args.end)
    # 1. Mesures : empreinte du fichier contrôlée contre la fiche station.
    hdf5 = cache / sid / station['ices']['file']
    if sha256(hdf5) != station['ices']['sha256']: raise ValueError(f'Empreinte ICES différente de la fiche station : {hdf5}')
    observations = out / f'{sid}-observations.csv'
    export(hdf5, station['deployment'], observations, 60, station['ices']['segment'])
    # 2. AIS.
    replay = out / f'{sid}-replay.ndjson.gz'
    ais = replay_from_dma(args.ais_csv, replay)
    if not ais['aisStart'] or parse(ais['aisStart']) > start - timedelta(minutes=args.warmup_min) or parse(ais['aisEnd']) < end:
        raise ValueError(f"AIS insuffisant : {ais['aisStart']} – {ais['aisEnd']} pour {start} – {end} avec {args.warmup_min} min de mise en route.")
    # 3. Vent.
    wind = wind_file(cache, station, start, end)
    # 4. Prédictions.
    models = {'world-law': [], 'ambient-only': []}
    ram_converged = None
    if args.ram_depth:
        d = station['deployment']
        path = {'bathymetry': [[0, args.ram_depth], [args.ram_range_km * 1000, args.ram_depth]], 'receiverDepthM': d['receiverDepthM'],
                'water': {'depthsM': [0, args.ram_depth], 'rangesM': [0], 'soundSpeedMs': [[1500], [1500]]},
                'sediment': {'soundSpeedMs': args.ram_sediment, 'densityGcm3': 2, 'attenuationDbPerWavelength': .5}}
        curves_path = cache / f"ram-{sid}-h{args.ram_depth:g}-c{args.ram_sediment:g}-{args.ram_range_km:g}km-adaptive.json"
        if not curves_path.exists():
            result = ram.receiver_curves(path, args.ram_range_km * 1000)
            result.update({'station': d, 'environment': path,
                           'provenance': {'environment': f"Guide de Pekeris uniforme {args.ram_depth} m, eau 1500 m/s, demi-espace {args.ram_sediment} m/s, 2 g/cm³, 0,5 dB/λ : paramètres du benchmark JOMOPANS, PAS une mesure locale.",
                                          'assumptions': ['Profondeur uniforme, marée ignorée.', 'Pertes interpolées en énergie tous les 100 m.']},
                           'numerical': {'convergence': result.pop('convergence')}})
            curves_path.write_text(json.dumps(result))
        convergence = json.loads(curves_path.read_text())['numerical']['convergence']
        ram_converged = all(c['converged'] for c in convergence)
        if not ram_converged: print(f'ATTENTION : RAM non convergé ({convergence}) ; référence RAM à ne pas interpréter.')
        models['ram-curves'] = ['--ram-curves', str(curves_path)]
    reports = {}
    for model, extra in models.items():
        prediction = out / f'{sid}-{model}.json'
        predict(args.station, observations, replay, wind, args.start, args.end, model, prediction, [*extra, '--radius-km', str(args.radius_km)])
        with observations.open(newline='') as file: rows = list(csv.DictReader(file))
        report = evaluate(json.loads(prediction.read_text()), rows, station, args.exploratory)
        report['inputHashes'] = {p.name: sha256(p) for p in [prediction, observations, args.station, hdf5, args.ais_csv, wind]}
        (out / f'{sid}-{model}-report.json').write_text(json.dumps(report, indent=2, allow_nan=False, ensure_ascii=False) + '\n')
        reports[model] = {'status': report['status'], 'matched': {r['band']: r['count'] for r in report['results']}, 'skipped': report['skipped']}
    summary = {'station': sid, 'split': station['split'], 'qcStatus': station['qc']['status'], 'period': [args.start, args.end], 'ais': ais, 'ramConverged': ram_converged, 'reports': reports}
    (out / f'{sid}-summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('station', type=Path); parser.add_argument('--ais-csv', type=Path, required=True)
    parser.add_argument('--start', required=True); parser.add_argument('--end', required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / 'tools/.cache/science'); parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--radius-km', type=float, default=300); parser.add_argument('--warmup-min', type=float, default=15)
    parser.add_argument('--ram-depth', type=float, help='profondeur du guide de Pekeris (m) ; active le modèle RAM au récepteur')
    parser.add_argument('--ram-sediment', type=float, default=1700); parser.add_argument('--ram-range-km', type=float, default=70)
    parser.add_argument('--exploratory', action='store_true')
    run(parser.parse_args())
