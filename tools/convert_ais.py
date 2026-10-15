# /// script
# requires-python = ">=3.10"
# dependencies = ["remotezip"]
# ///
"""
Convertit des données AIS historiques ouvertes en fichier de replay (NDJSON compressé).

Format de sortie (identique à celui de l'enregistreur du serveur) : une ligne JSON par message,
  {"t": <ms depuis l'époque Unix>, "m": <message au format aisstream.io>}
avec des messages « PositionReport » et « ShipStaticData ». Le serveur rejoue donc
indifféremment un enregistrement aisstream ou une archive convertie.

Sources prises en charge :
  --dma AAAA-MM-JJ   archive quotidienne de l'Autorité maritime danoise (aisdata.ais.dk) ;
                     seules les premières heures sont lues, par requêtes HTTP partielles
                     (l'archive complète fait ~600 Mo).
  --noaa FICHIER.csv fichier MarineCadastre (NOAA, eaux des États-Unis) déjà téléchargé.

Pour garder des fichiers légers, on ne retient qu'une position par navire toutes les
`--min-interval` secondes (et toutes les 10 minutes pour un navire à quai).

Exemples :
  uv run tools/convert_ais.py --dma 2025-02-26 --hours 1 --out data/replays/dma-2025-02-26.ndjson.gz
  uv run tools/convert_ais.py --noaa AIS_2024_01_01.csv --hours 2 --out data/replays/noaa.ndjson.gz
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DMA_URL = "http://aisdata.ais.dk.s3.eu-central-1.amazonaws.com/{year}/aisdk-{date}.zip"

# Types de navires textuels (DMA) → codes AIS numériques.
DMA_TYPES = {
    "fishing": 30, "towing": 31, "towing long/wide": 32, "dredging": 33, "diving": 34,
    "military": 35, "sailing": 36, "pleasure": 37, "hsc": 40, "pilot": 50, "sar": 51,
    "tug": 52, "port tender": 53, "anti-pollution": 54, "law enforcement": 55, "medical": 58,
    "passenger": 60, "cargo": 70, "tanker": 80, "other": 90, "wig": 20,
}


def fnum(s: str) -> float | None:
    s = (s or "").strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


class Writer:
    """Écrit les messages en limitant la fréquence des positions par navire."""

    def __init__(self, path: Path, min_interval: float):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.f = gzip.open(path, "wt", encoding="utf-8")
        self.min_interval = min_interval
        self.last_pos: dict[int, float] = {}
        self.static_done: dict[int, tuple[int | None, float | None]] = {}
        self.n_pos = 0
        self.n_static = 0

    def position(self, t: float, mmsi: int, lat: float, lon: float, sog: float | None, cog: float | None, heading: float | None) -> None:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return
        moored = sog is not None and sog < 0.5
        gap = 600 if moored else self.min_interval
        if t - self.last_pos.get(mmsi, -1e18) < gap:
            return
        self.last_pos[mmsi] = t
        msg = {
            "MessageType": "PositionReport",
            "MetaData": {"MMSI": mmsi, "latitude": lat, "longitude": lon},
            "Message": {
                "PositionReport": {
                    "UserID": mmsi,
                    "Latitude": lat,
                    "Longitude": lon,
                    "Sog": 102.3 if sog is None else round(sog, 1),
                    "Cog": 360 if cog is None else round(cog, 1),
                    "TrueHeading": 511 if heading is None else int(heading),
                }
            },
        }
        self.f.write(json.dumps({"t": int(t * 1000), "m": msg}, separators=(",", ":")) + "\n")
        self.n_pos += 1

    def static(self, t: float, mmsi: int, ais_type: int | None, a: float | None, b: float | None, length: float | None) -> None:
        # Réémis seulement quand l'information s'enrichit (type ou longueur jusque-là inconnus) :
        # une première ligne incomplète ne doit pas masquer la longueur, qui fixe le niveau source.
        known_type, known_length = self.static_done.get(mmsi, (None, None))
        length = length or (a + b if a and b else None)
        if (ais_type is None or known_type is not None) and (length is None or known_length is not None):
            return
        ais_type, length = known_type or ais_type, known_length or length
        if length != (a + b if a and b else None): a = b = None  # dimensions cohérentes avec la longueur retenue
        self.static_done[mmsi] = (ais_type, length)
        if a is None or b is None:
            a, b = (length or 0), 0
        msg = {
            "MessageType": "ShipStaticData",
            "MetaData": {"MMSI": mmsi},
            "Message": {"ShipStaticData": {"UserID": mmsi, "Type": ais_type or 0, "Dimension": {"A": int(a), "B": int(b), "C": 0, "D": 0}}},
        }
        self.f.write(json.dumps({"t": int(t * 1000), "m": msg}, separators=(",", ":")) + "\n")
        self.n_static += 1

    def close(self) -> None:
        self.f.close()


def convert_dma(date: str, hours: float, w: Writer) -> None:
    from remotezip import RemoteZip

    url = DMA_URL.format(year=date[:4], date=date)
    print(f"lecture partielle de {url}")
    with RemoteZip(url) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        with z.open(name) as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace"))
            header = next(reader)
            col = {h.strip("# ").strip(): i for i, h in enumerate(header)}
            t0 = None
            for k, row in enumerate(reader):
                try:
                    t = datetime.strptime(row[col["Timestamp"]], "%d/%m/%Y %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
                except (ValueError, IndexError):
                    continue
                t0 = t if t0 is None else t0
                if t - t0 > hours * 3600:
                    break
                if row[col["Type of mobile"]] not in ("Class A", "Class B"):
                    continue
                mmsi = int(row[col["MMSI"]])
                lat, lon = fnum(row[col["Latitude"]]), fnum(row[col["Longitude"]])
                if lat is None or lon is None:
                    continue
                w.static(t, mmsi, DMA_TYPES.get(row[col["Ship type"]].strip().lower()), fnum(row[col["A"]]) if "A" in col else None, fnum(row[col["B"]]) if "B" in col else None, fnum(row[col["Length"]]))
                w.position(t, mmsi, lat, lon, fnum(row[col["SOG"]]), fnum(row[col["COG"]]), fnum(row[col["Heading"]]))
                if k % 200_000 == 0:
                    print(f"  {k} lignes, {(t - t0) / 60:.0f} min")


def convert_noaa(path: Path, hours: float, w: Writer) -> None:
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            try:
                t = datetime.fromisoformat(r["BaseDateTime"]).replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                continue
            rows.append((t, r))
    rows.sort(key=lambda x: x[0])  # les fichiers NOAA sont triés par navire, pas par temps
    t0 = rows[0][0]
    for t, r in rows:
        if t - t0 > hours * 3600:
            break
        mmsi = int(r["MMSI"])
        vt = fnum(r.get("VesselType", ""))
        w.static(t, mmsi, int(vt) if vt is not None else None, None, None, fnum(r.get("Length", "")))
        w.position(t, mmsi, float(r["LAT"]), float(r["LON"]), fnum(r["SOG"]), fnum(r["COG"]), fnum(r["Heading"]))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--dma", metavar="AAAA-MM-JJ")
    src.add_argument("--noaa", type=Path, metavar="FICHIER.csv")
    ap.add_argument("--hours", type=float, default=1.0)
    ap.add_argument("--min-interval", type=float, default=60.0, help="secondes entre deux positions d'un même navire")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    # Écriture dans un fichier temporaire : on trie ensuite par temps (sûreté).
    tmp = args.out.with_suffix(".tmp.gz")
    w = Writer(tmp, args.min_interval)
    try:
        if args.dma:
            convert_dma(args.dma, args.hours, w)
        else:
            convert_noaa(args.noaa, args.hours, w)
    finally:
        w.close()
    with gzip.open(tmp, "rt", encoding="utf-8") as f:
        lines = sorted(f, key=lambda l: json.loads(l)["t"])
    with gzip.open(args.out, "wt", encoding="utf-8") as f:
        f.writelines(lines)
    tmp.unlink()
    print(f"{w.n_pos} positions, {w.n_static} fiches statiques, {len(w.last_pos)} navires → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
