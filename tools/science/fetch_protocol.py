"""Télécharge les données du protocole (protocol-v1.json) dans le cache, sans rien calculer.

  - mesures ICES (HDF5, avec leur notice de conditions d'utilisation) → cache/ices/
  - AIS danois DMA, un jour par fichier, zone du protocole → cache/ais/dma-<jour>.csv.gz
  - AIS MarineCadastre (NOAA/BOEM), idem → cache/ais/mc-<jour>.csv.gz
  - spectres NOAA NRS11 (« hybrid millidecade », 1 min) → cache/nrs/

Reprise possible : un fichier déjà présent n'est pas retéléchargé. Un journal JSON (tailles,
empreintes, sources) est écrit dans cache/fetch-log.json.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import hashlib
import io
import json
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen, urlretrieve
from ais_archive import extract_dma

ROOT = Path(__file__).resolve().parents[2]
ICES = 'https://underwaternoise.ices.dk/continuous/api/DownloadFile/{}'
MC = 'https://coast.noaa.gov/htdata/CMSP/AISDataHandler/{y}/AIS_{d}.zip'
NRS = 'https://storage.googleapis.com/storage/v1/b/noaa-passive-bioacoustic/o?prefix=nrs/products/sound_level_metrics/{site}/'
GCS = 'https://storage.googleapis.com/noaa-passive-bioacoustic/{}'


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


def fetch_ices(upload_id: int, folder: Path) -> Path:
    with urlopen(ICES.format(upload_id), timeout=120) as response: content = response.read()
    if not content.startswith(b'PK'): raise ValueError(f'ICES {upload_id} : archive ZIP attendue')
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        files = [n for n in archive.namelist() if n.lower().endswith(('.h5', '.hdf5'))]
        if len(files) != 1: raise ValueError(f'ICES {upload_id} : un HDF5 unique requis, trouvé {files}')
        target = folder / Path(files[0]).name
        data = archive.read(files[0])
        if not data.startswith(b'\x89HDF\r\n\x1a\n'): raise ValueError(f'ICES {upload_id} : pas un HDF5')
        target.write_bytes(data)
        notices = [archive.read(n).decode(errors='replace') for n in archive.namelist() if n.lower().endswith('.txt')]
        if notices: target.with_suffix('.policy.txt').write_text('\n'.join(notices))
    return target


def fetch_marinecadastre(day: str, bounds, out: Path) -> dict:
    y, d = day[:4], day.replace('-', '_')
    with tempfile.TemporaryDirectory() as tmp:
        archive_path = Path(tmp) / 'ais.zip'
        urlretrieve(MC.format(y=y, d=d), archive_path)
        size = archive_path.stat().st_size
        rows = selected = 0
        partial = out.with_name(out.name + '.part')
        with zipfile.ZipFile(archive_path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith('.csv')]
            if len(names) != 1: raise ValueError(f'MarineCadastre {day} : CSV unique attendu, trouvé {names}')
            with archive.open(names[0]) as raw, gzip.open(partial, 'wt', newline='') as output:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig'))
                writer = csv.DictWriter(output, fieldnames=reader.fieldnames); writer.writeheader()
                for row in reader:
                    rows += 1
                    try: lat, lon = float(row['LAT']), float(row['LON'])
                    except (ValueError, KeyError): continue
                    if bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3]:
                        writer.writerow(row); selected += 1
        partial.rename(out)
    return {'source': MC.format(y=y, d=d), 'archiveBytes': size, 'rowsRead': rows, 'rowsSelected': selected}


def nrs_files(site: str, day: str) -> list[str]:
    """Daily HMD netCDF of a NRS site for one day (all deployments listed, the one covering the day kept)."""
    stamp = day.replace('-', '')
    names, token = [], None
    while True:
        url = NRS.format(site=site) + (f'&pageToken={token}' if token else '')
        with urlopen(url, timeout=60) as response: listing = json.loads(response.read())
        names += [i['name'] for i in listing.get('items', []) if f'_{stamp}_' in i['name'] and i['name'].endswith(('.nc', '.json')) or i['name'].endswith('-metadata.json')]
        token = listing.get('nextPageToken')
        if not token: break
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--protocol', type=Path, default=Path(__file__).with_name('protocol-v1.json'))
    parser.add_argument('--cache', type=Path, default=ROOT / 'tools/.cache/science')
    parser.add_argument('--only', choices=['ices', 'dma', 'mc', 'nrs'], action='append')
    parser.add_argument('--relog', action='store_true', help='consigne les fichiers présents absents du journal (empreinte et taille seules)')
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    only = set(args.only or ['ices', 'dma', 'mc', 'nrs'])
    log_path = args.cache / 'fetch-log.json'
    def read_log() -> dict:
        return json.loads(log_path.read_text()) if log_path.exists() else {}
    def record(key, path, extra=None):
        # Relu juste avant d'écrire : plusieurs téléchargements (--only) peuvent tourner en parallèle.
        entry = {'file': str(path.relative_to(args.cache)), 'bytes': path.stat().st_size, 'sha256': sha256(path), **(extra or {})}
        log = read_log(); log[key] = entry
        tmp = log_path.with_name(f'{log_path.name}.{key}.tmp'); tmp.write_text(json.dumps(log, indent=2, ensure_ascii=False) + '\n'); tmp.replace(log_path)
        print(key, entry['bytes'], flush=True)
    for folder in ['ices', 'ais', 'nrs']: (args.cache / folder).mkdir(parents=True, exist_ok=True)
    if args.relog:
        known = {v['file'] for v in read_log().values()}
        for path in sorted([*(args.cache / 'ais').glob('*.csv.gz'), *(args.cache / 'nrs').glob('*')]):
            rel = str(path.relative_to(args.cache))
            if rel not in known: record(f"{path.parent.name}-{path.name}", path, {'note': 'consigné après coup (--relog) : taille et empreinte seules'})
        return
    if 'ices' in only:
        for station in protocol['stations']:
            for day, upload in station['days'].items():
                if upload is None or f'ices-{upload}' in read_log(): continue
                record(f'ices-{upload}', fetch_ices(upload, args.cache / 'ices'), {'station': station['ices'], 'day': day})
    if 'nrs' in only:
        for station in protocol['stations']:
            if 'nrs' not in station: continue
            for day in station['days']:
                for name in nrs_files(station['nrs'], day):
                    target = args.cache / 'nrs' / Path(name).name
                    if target.exists(): continue
                    urlretrieve(GCS.format(name), target)
                    record(f'nrs-{target.name}', target, {'source': GCS.format(name)})
    if 'dma' in only:
        for day in protocol['dma']['days']:
            out = args.cache / 'ais' / f'dma-{day}.csv.gz'
            if out.exists(): continue
            record(f'dma-{day}', out, extract_dma(day, 24, protocol['dma']['bounds'], out))
    if 'mc' in only:
        for day in protocol['marinecadastre']['days']:
            out = args.cache / 'ais' / f'mc-{day}.csv.gz'
            if out.exists(): continue
            record(f'mc-{day}', out, fetch_marinecadastre(day, protocol['marinecadastre']['bounds'], out))


if __name__ == '__main__': main()
