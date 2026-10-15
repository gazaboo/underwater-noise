"""Extract a time/space subset of DMA monthly ZIP64 archives using HTTP ranges."""
from __future__ import annotations
import argparse
import csv
import gzip
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
import requests


class HTTPFile(io.RawIOBase):
    def __init__(self, url):
        self.session = requests.Session(); self.url = url; self.position = 0; self.transferred = 0
        r = self.session.get(url, headers={'Range': 'bytes=0-0'}, timeout=45)
        r.raise_for_status()
        if r.status_code != 206 or 'Content-Range' not in r.headers: raise ValueError('Le serveur doit accepter HTTP Range ; refus de télécharger l’archive complète.')
        self.size = int(r.headers['Content-Range'].split('/')[-1]); self.cache_start = -1; self.cache = b''
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.position
    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        return self.position
    def read(self, length=-1):
        if length < 0: length = self.size - self.position
        if not length or self.position >= self.size: return b''
        end = min(self.size, self.position + length)
        if not (self.cache_start <= self.position and end <= self.cache_start + len(self.cache)):
            cache_end = min(self.size, max(end, self.position + 2**20))
            r = self.session.get(self.url, headers={'Range': f'bytes={self.position}-{cache_end-1}'}, timeout=45)
            r.raise_for_status()
            if r.status_code != 206: raise ValueError('HTTP Range perdu')
            self.cache_start = self.position; self.cache = r.content; self.transferred += len(r.content)
        value = self.cache[self.position-self.cache_start:end-self.cache_start]; self.position += len(value); return value


def extract_dma(date: str, hours: float, bounds, out: Path | None, list_only=False) -> dict:
    """Extract one day of the DMA monthly archive by HTTP range requests; `.gz` output is compressed."""
    datetime.strptime(date, '%Y-%m-%d')
    url = f'https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/{date[:4]}/aisdk-{date[:7]}.zip'
    remote = HTTPFile(url)
    with zipfile.ZipFile(remote) as archive:
        if list_only:
            return {'url': url, 'archiveBytes': remote.size, 'members': archive.namelist(), 'downloadBytes': remote.transferred}
        names = [n for n in archive.namelist() if date in n and n.lower().endswith('.csv')]
        if len(names) != 1: raise ValueError(f'CSV journalier ambigu/absent : {archive.namelist()}')
        if out is None: raise ValueError('--out requis')
        out.parent.mkdir(parents=True, exist_ok=True)
        start = datetime.strptime(date, '%Y-%m-%d'); rows = selected = 0
        partial = out.with_name(out.name + '.part')
        opener = (lambda: gzip.open(partial, 'wt', newline='')) if out.suffix == '.gz' else (lambda: partial.open('w', newline=''))
        with archive.open(names[0]) as raw, opener() as output:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig')); writer = csv.DictWriter(output, fieldnames=reader.fieldnames); writer.writeheader()
            for row in reader:
                rows += 1
                date_row = datetime.strptime(row.get('# Timestamp', row.get('Timestamp')), '%d/%m/%Y %H:%M:%S')
                if (date_row - start).total_seconds() >= hours * 3600: break
                if row.get('Type of mobile') not in ('Class A', 'Class B'): continue
                try: lat, lon = float(row['Latitude']), float(row['Longitude'])
                except (ValueError, KeyError): continue
                if bounds and not (bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3]): continue
                writer.writerow(row); selected += 1
        partial.rename(out)  # never leave a truncated file under the final name
        return {'source': url, 'member': names[0], 'rowsRead': rows, 'rowsSelected': selected, 'downloadBytes': remote.transferred}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('date'); parser.add_argument('--hours', type=float, default=1)
    parser.add_argument('--bounds', nargs=4, type=float, metavar=('WEST','SOUTH','EAST','NORTH'))
    parser.add_argument('--out', type=Path); parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    print(json.dumps(extract_dma(args.date, args.hours, args.bounds, args.out, args.list)))


if __name__ == '__main__': main()
