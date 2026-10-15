"""Comparaison modèle–mesures à une station, pilotée par `stations/<id>.json`.

Étapes, toutes reproductibles et hachées :
  1. mesures ICES → fenêtres de 60 s contiguës, toutes décidécades (ices.py) ;
  2. AIS : replay trié construit par replay.py (DMA ou MarineCadastre), partagé entre stations ;
  3. vent ERA5 au point (Open-Meteo archive, m/s), mis en cache ;
  4. prédictions : loi du moteur mondial, fond naturel seul, RAM au récepteur (option) ;
  5. comparaison (validate.py). Sans contrôle qualité revu, seul un rapport `--exploratory`
     est produit, étiqueté comme tel. Aucun paramètre n'est ajusté ici.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen
import ram
from ices import export
from noaa import export_nrs
from validate import evaluate

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse(text: str) -> datetime:
    return datetime.fromisoformat(text.replace('Z', '+00:00'))


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
    model = 'world-law' if model.startswith('world-law') else model  # variantes : options passées dans extra
    subprocess.run(['node', '--import', 'tsx', str(HERE / 'point-predict.ts'), '--station', str(station_path), '--observations', str(observations),
                    '--replay', str(replay), '--wind', str(wind), '--from', start, '--to', end, '--model', model, '--out', str(out), *extra], cwd=ROOT, check=True)


def run(args):
    for name in ['station', 'replay', 'cache', 'out']: setattr(args, name, getattr(args, name).resolve())
    station = json.loads(args.station.read_text())
    sid, cache, out = station['id'], args.cache, args.out
    out.mkdir(parents=True, exist_ok=True)
    start, end = parse(args.start), parse(args.end)
    # Fiche résolue pour ce jour : fichier ICES du jour et profondeur du récepteur de ce déploiement.
    day = f'{start:%Y-%m-%d}'
    entry = (station['ices']['files'][day] if 'files' in station['ices'] else station['ices']) if 'ices' in station else {}
    station = {**station, **({'ices': entry} if entry else {}), 'deployment': dict(station['deployment'])}
    if 'heightAboveBottomM' in entry:
        d = station['deployment']
        d['heightAboveBottomM'] = entry['heightAboveBottomM']
        d['receiverDepthM'] = round(d['waterDepthM'] - entry['heightAboveBottomM'], 2)
    station_path = out / f'{sid}-{start:%Y%m%d}-station.json'
    station_path.write_text(json.dumps(station, indent=2, ensure_ascii=False) + '\n')
    # 1. Mesures : empreinte du fichier contrôlée contre la fiche station (ICES), ou produit NOAA du jour.
    observations = out / f'{sid}-{start:%Y%m%d}-observations.csv'
    if 'nrs' in station:
        measurement = export_nrs(cache / 'nrs', station, day, observations)
        hdf5 = cache / 'nrs' / measurement['source']
    else:
        hdf5 = cache / 'ices' / entry['file']
        if sha256(hdf5) != entry['sha256']: raise ValueError(f'Empreinte ICES différente de la fiche station : {hdf5}')
        period = {'periodStart': args.start, 'periodEnd': args.end}
        export(hdf5, {**station['deployment'], **period}, observations, 60, entry.get('segment'))
    # 2. AIS : le replay doit couvrir la période et la mise en route du registre.
    replay = args.replay
    ais = json.loads(Path(f'{replay}.json').read_text())
    if not ais['start'] or parse(ais['start']) > start - timedelta(minutes=args.warmup_min) or parse(ais['end']) < end - timedelta(minutes=1):
        raise ValueError(f"AIS insuffisant : {ais['start']} – {ais['end']} pour {start} – {end} avec {args.warmup_min} min de mise en route.")
    # 3. Vent.
    wind = wind_file(cache, station, start, end)
    # 4. Prédictions.
    # world-law-wind5 : même loi avec le vent uniforme de 5 m/s de l'exposition (ce que voit le public).
    models = {'world-law': [], 'world-law-wind5': ['--scenario-wind', '5'], 'ambient-only': []}
    if args.physics:  # profil calé : évalué en plus du profil de référence, jamais à sa place
        models.update({'world-law-calibrated': ['--physics', str(args.physics.resolve())], 'world-law-calibrated-wind5': ['--physics', str(args.physics.resolve()), '--scenario-wind', '5']})
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
    # Géométrie des contributions (un instant par minute) pour le calage, profil de référence seulement.
    models['world-law'] = models['world-law'] + ['--dump', str(out / f'{sid}-{start:%Y%m%d}-geometry.bin')]
    for model, extra in models.items():
        prediction = out / f'{sid}-{start:%Y%m%d}-{model}.json'
        predict(station_path, observations, replay, wind, args.start, args.end, model, prediction, [*extra, '--radius-km', str(args.radius_km)])
        with observations.open(newline='') as file: rows = list(csv.DictReader(file))
        report = evaluate(json.loads(prediction.read_text()), rows, station, args.exploratory)
        report['variant'] = model
        report['inputHashes'] = {p.name: sha256(p) for p in [prediction, observations, station_path, hdf5, replay, wind]}
        (out / f'{sid}-{start:%Y%m%d}-{model}-report.json').write_text(json.dumps(report, indent=2, allow_nan=False, ensure_ascii=False) + '\n')
        reports[model] = {'status': report['status'], 'matched': {r['band']: r['count'] for r in report['results']}, 'skipped': report['skipped']}
    summary = {'station': sid, 'split': station['split'], 'qcStatus': station['qc']['status'], 'period': [args.start, args.end], 'ais': ais, 'ramConverged': ram_converged, 'reports': reports}
    (out / f'{sid}-{start:%Y%m%d}-summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('station', type=Path); parser.add_argument('--replay', type=Path, required=True, help='replay.py ; résumé <replay>.json requis')
    parser.add_argument('--start', required=True); parser.add_argument('--end', required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / 'tools/.cache/science'); parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--radius-km', type=float, default=300); parser.add_argument('--warmup-min', type=float, default=15)
    parser.add_argument('--ram-depth', type=float, help='profondeur du guide de Pekeris (m) ; active le modèle RAM au récepteur')
    parser.add_argument('--ram-sediment', type=float, default=1700); parser.add_argument('--ram-range-km', type=float, default=70)
    parser.add_argument('--physics', type=Path, help='paramètres calés (JSON {label, physics}) évalués en variante')
    parser.add_argument('--exploratory', action='store_true')
    run(parser.parse_args())
