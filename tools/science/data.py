"""Read-only public ICES access and HDF5 inventory; no guessed axis/unit conversion."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from urllib.request import urlopen
import re
import io
import zipfile

BASE = 'https://underwaternoise.ices.dk/continuous/api/'


def fetch(url: str) -> bytes:
    with urlopen(url, timeout=45) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    catalog = commands.add_parser('catalog'); catalog.add_argument('--year', default='2019'); catalog.add_argument('--out', type=Path, required=True)
    download = commands.add_parser('download'); download.add_argument('file_id', type=int); download.add_argument('out', type=Path)
    inspect = commands.add_parser('inspect'); inspect.add_argument('file', type=Path)
    args = parser.parse_args()
    if args.command == 'catalog':
        result = json.loads(fetch(BASE + 'getListSubmissions'))
        rows = result if isinstance(result, list) else next((v for v in result.values() if isinstance(v, list)), [])
        selected = [r for r in rows if str(r.get('startDate', '')).startswith(args.year) or str(r.get('endDate', '')).startswith(args.year)]
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({'source': BASE + 'getListSubmissions', 'year': args.year, 'records': selected}, indent=2))
        print(f'{len(selected)} soumissions contenant {args.year} ; catalogue écrit dans {args.out}')
        docs = fetch('https://underwaternoise.ices.dk/continuous/webservices').decode()
        print('Download API examples:', [u for u in re.findall(r'href=["\']([^"\']+)', docs) if 'download' in u.lower()])
        for row in selected[:3]:
            print(json.dumps({k: row.get(k) for k in ['tblUploadID', 'fileName', 'countryCode', 'stationCode', 'startDate', 'endDate']}, ensure_ascii=False))
    elif args.command == 'download':
        if args.file_id < 1: raise ValueError('ID de fichier positif requis')
        content = fetch(BASE + f'DownloadFile/{args.file_id}')
        if content.startswith(b'PK'):
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                files = [name for name in archive.namelist() if name.lower().endswith(('.h5', '.hdf5'))]
                if len(files) != 1: raise ValueError('Archive ICES : un fichier HDF5 unique requis.')
                # Retain the accompanying data policy, without extracting arbitrary paths.
                notices = [archive.read(n).decode(errors='replace') for n in archive.namelist() if n.lower().endswith('.txt')]
                content = archive.read(files[0])
                args.out.parent.mkdir(parents=True, exist_ok=True)
                if notices: args.out.with_suffix('.policy.txt').write_text('\n'.join(notices))
        if not content.startswith(b'\x89HDF\r\n\x1a\n'): raise ValueError('La réponse n’est pas un fichier HDF5 (aucune donnée enregistrée).')
        args.out.parent.mkdir(parents=True, exist_ok=True); args.out.write_bytes(content)
        print(f'{len(content)} octets téléchargés depuis ICES')
    else:
        import h5py
        def value(v):
            return v.decode(errors='replace') if isinstance(v, bytes) else v.tolist() if hasattr(v, 'tolist') else str(v)
        with h5py.File(args.file, 'r') as file:
            def visit(name, obj):
                item = {'path': name, 'attributes': {k: value(v) for k, v in obj.attrs.items()}}
                if isinstance(obj, h5py.Dataset):
                    item.update({'shape': list(obj.shape), 'dtype': str(obj.dtype)})
                    if obj.size < 30: item['value'] = value(obj[()])
                print(json.dumps(item, default=str, ensure_ascii=False))
            file.visititems(visit)


if __name__ == '__main__': main()
