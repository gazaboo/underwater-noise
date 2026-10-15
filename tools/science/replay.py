"""AIS historique (CSV DMA ou MarineCadastre, éventuellement .gz) → replay NDJSON trié du serveur.

Même conversion que tools/convert_ais.py (messages PositionReport / ShipStaticData), sans
sous-échantillonnage. Un fichier `<replay>.json` résume la conversion (période, lignes, retards).

  - DMA : CSV trié par temps → conversion en flux, tampon de réordonnancement de 5 min ; une ligne
    plus ancienne que ce tampon est comptée et ignorée (jamais déplacée en silence).
  - MarineCadastre : CSV trié par navire → tri en mémoire du sous-ensemble géographique.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import heapq
import importlib.util
import json
import fcntl
from functools import wraps
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REORDER_SEC = 300


def exclusive_conversion(function):
    """Un seul écrivain par replay, même si deux commandes le demandent."""
    @wraps(function)
    def convert(source, out):
        out.parent.mkdir(parents=True, exist_ok=True)
        with Path(f'{out}.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            meta = Path(f'{out}.json')
            if out.exists() and meta.exists():
                saved = json.loads(meta.read_text())
                if saved['source'] != source.name: raise ValueError('Replay existant issu d’un autre fichier')
                return saved
            return function(source, out)
    return convert


def converter():
    spec = importlib.util.spec_from_file_location('convert_ais', ROOT / 'tools/convert_ais.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def open_csv(path: Path):
    return gzip.open(path, 'rt', newline='') if path.suffix == '.gz' else path.open(newline='')


@exclusive_conversion
def dma_to_replay(source: Path, out: Path) -> dict:
    m = converter()
    writer = m.Writer(out, 0)
    heap, seq, watermark, late, rows, first, last = [], 0, -float('inf'), 0, 0, None, None
    def emit(item):
        nonlocal first, last
        t, _, mmsi, lat, lon, ais_type, a, b, length, sog, cog, heading = item
        writer.static(t, mmsi, ais_type, a, b, length)
        writer.position(t, mmsi, lat, lon, sog, cog, heading)
        first = t if first is None else first; last = t
    with open_csv(source) as file:
        for row in csv.DictReader(file):
            if row.get('Type of mobile') not in ('Class A', 'Class B'): continue
            try: t = datetime.strptime(row['# Timestamp'], '%d/%m/%Y %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
            except (ValueError, KeyError): continue
            lat, lon = m.fnum(row['Latitude']), m.fnum(row['Longitude'])
            if lat is None or lon is None: continue
            rows += 1
            if t < watermark - REORDER_SEC: late += 1; continue
            watermark = max(watermark, t)
            heapq.heappush(heap, (t, seq, int(row['MMSI']), lat, lon, m.DMA_TYPES.get(row['Ship type'].strip().lower()),
                                  m.fnum(row.get('A', '')), m.fnum(row.get('B', '')), m.fnum(row['Length']), m.fnum(row['SOG']), m.fnum(row['COG']), m.fnum(row['Heading'])))
            seq += 1
            while heap and heap[0][0] <= watermark - REORDER_SEC: emit(heapq.heappop(heap))
    while heap: emit(heapq.heappop(heap))
    writer.close()
    return summary(source, out, rows, late, first, last, 'DMA')


@exclusive_conversion
def marinecadastre_to_replay(source: Path, out: Path) -> dict:
    m = converter()
    items = []
    with open_csv(source) as file:
        for row in csv.DictReader(file):
            try: t = datetime.fromisoformat(row['BaseDateTime']).replace(tzinfo=timezone.utc).timestamp()
            except (ValueError, KeyError): continue
            vt = m.fnum(row.get('VesselType', ''))
            items.append((t, int(row['MMSI']), float(row['LAT']), float(row['LON']), int(vt) if vt is not None else None,
                          m.fnum(row.get('Length', '')), m.fnum(row['SOG']), m.fnum(row['COG']), m.fnum(row['Heading'])))
    items.sort(key=lambda x: x[0])
    writer = m.Writer(out, 0)
    for t, mmsi, lat, lon, vt, length, sog, cog, heading in items:
        writer.static(t, mmsi, vt, None, None, length)
        writer.position(t, mmsi, lat, lon, sog, cog, heading)
    writer.close()
    return summary(source, out, len(items), 0, items[0][0] if items else None, items[-1][0] if items else None, 'MarineCadastre')


def summary(source: Path, out: Path, rows: int, late: int, first, last, kind: str) -> dict:
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat().replace('+00:00', 'Z') if t is not None else None
    result = {'source': source.name, 'kind': kind, 'rows': rows, 'lateRowsDropped': late, 'reorderSec': REORDER_SEC if kind == 'DMA' else None,
              'start': iso(first), 'end': iso(last)}
    Path(f'{out}.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('kind', choices=['dma', 'mc']); parser.add_argument('source', type=Path); parser.add_argument('out', type=Path)
    args = parser.parse_args()
    print(json.dumps((dma_to_replay if args.kind == 'dma' else marinecadastre_to_replay)(args.source, args.out)))
