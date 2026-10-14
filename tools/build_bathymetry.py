# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "rasterio", "pyshp", "requests"]
# ///
"""
Construit les grilles terre/mer et bathymétrie utilisées par la simulation et le rendu.

Sources (domaine public) :
  - ETOPO 2022 (NOAA NCEI), 60 secondes d'arc, version « bed », servie en OPeNDAP par le
    THREDDS de la NOAA ; téléchargée par bandes de latitude avec un pas de 3 (0,05°).
  - Natural Earth 1:10m « land » : trait de côte net (les zones sous le niveau de la mer,
    comme les polders, restent bien des terres).

Sorties (data/grid/) :
  - ocean_{W}.png  pour chaque largeur de grille de simulation W (hauteur W/2), RGBA8 :
        R = 255 si mer, 0 si terre (masque de la simulation)
        G = profondeur, échelle logarithmique : 0 → 10 m, 255 → 11 000 m
        B = fraction de terre dans la cellule (0–255), pour adoucir les côtes
  - elevation_4096.png  RGBA8 pour le rendu : R,G = (altitude + 11000 m) sur 16 bits
        (octet fort, octet faible), B = fraction de terre (côte anti-crénelée).
  - meta.json : description des fichiers.

Usage : uv run tools/build_bathymetry.py
"""
from __future__ import annotations

import io
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np
import requests
import shapefile  # pyshp
from PIL import Image
from rasterio import features
from rasterio.transform import from_bounds

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
OUT = ROOT / "data" / "grid"

ETOPO_DODS = (
    "https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_bed_elev_netcdf/"
    "ETOPO_2022_v1_60s_N90W180_bed.nc.dods?z%5B{a}:3:{b}%5D%5B0:3:21599%5D"
)
ETOPO_ROWS = 10800  # lignes de la grille source (sud → nord)
ETOPO_BAND = 1800  # lignes source par requête
NE_LAND_URL = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip"

# Largeurs des grilles de simulation (profils de qualité, grilles visuelle et physique).
SIM_WIDTHS = [768, 1024, 1536, 2048]
DISPLAY_WIDTH = 4096
# Seuil de fraction d'eau pour qu'une cellule de simulation soit « mer ».
WATER_THRESHOLD = 0.4

# Détroits naturels forcés ouverts (sinon ils se ferment aux résolutions grossières).
# Lignes (lon, lat) le long de l'axe du détroit. Les canaux (Suez, Panama) restent fermés :
# ils ne transmettent pas le son d'un océan à l'autre.
STRAITS: dict[str, list[tuple[float, float]]] = {
    "Gibraltar": [(-6.3, 35.95), (-5.2, 36.0)],
    "Dardanelles": [(26.1, 40.0), (26.7, 40.4)],
    "Marmara": [(26.7, 40.4), (28.9, 40.9)],
    "Bosphore": [(28.95, 41.0), (29.1, 41.25)],
    "Kertch": [(36.5, 45.2), (36.6, 45.45)],
    "Pas de Calais": [(1.2, 50.8), (1.9, 51.1)],
    "Øresund": [(12.65, 55.6), (12.6, 56.1)],
    "Grand Belt": [(10.9, 55.2), (11.0, 55.9)],
    "Messine": [(15.6, 38.0), (15.65, 38.3)],
    "Bonifacio": [(9.0, 41.35), (9.5, 41.35)],
    "Bab-el-Mandeb": [(43.2, 12.4), (43.5, 12.7)],
    "Ormuz": [(56.0, 26.0), (56.8, 26.6)],
    "Malacca": [(98.0, 4.5), (101.0, 2.6), (103.5, 1.3)],
    "Singapour": [(103.5, 1.2), (104.4, 1.3)],
    "Tsugaru": [(140.2, 41.5), (141.4, 41.6)],
    "Corée": [(128.5, 34.0), (130.2, 34.8)],
    "Bass": [(144.5, -39.5), (147.5, -39.2)],
    "Torres": [(141.5, -10.0), (143.5, -10.5)],
    "Magellan": [(-74.5, -52.5), (-70.5, -53.5), (-68.4, -52.5)],
    "Belle-Isle": [(-57.3, 51.4), (-55.8, 51.7)],
}


def download(url: str, name: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"  téléchargement {url}")
        r = requests.get(url, timeout=600)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path.read_bytes()


def parse_dods_grid(raw: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Décode une réponse OPeNDAP binaire (DDS + XDR) d'une grille z[lat][lon] avec ses axes."""
    header, _, data = raw.partition(b"\nData:\n")
    dims = [int(x) for x in header.split(b"Float32 z[lat = ")[1].split(b"]")[0:1]]
    nlat = dims[0]
    nlon = int(header.split(b"[lon = ")[1].split(b"]")[0])
    n = int(np.frombuffer(data[:4], ">u4")[0])
    assert n == nlat * nlon, (n, nlat, nlon)
    z = np.frombuffer(data[8 : 8 + 4 * n], ">f4").reshape(nlat, nlon).astype(np.float32)
    off = 8 + 4 * n
    lat = np.frombuffer(data[off + 8 : off + 8 + 8 * nlat], ">f8")
    return z, lat


def load_etopo() -> np.ndarray:
    """Altitude (m) sur une grille régulière 0,05°, lignes du nord vers le sud, lon de -180 à 180."""
    bands = []
    for a in range(0, ETOPO_ROWS, ETOPO_BAND):
        b = min(a + ETOPO_BAND, ETOPO_ROWS) - 1
        raw = download(ETOPO_DODS.format(a=a, b=b), f"etopo2022_rows_{a:05d}.dods")
        z, lat = parse_dods_grid(raw)
        bands.append((lat[0], z, lat))
    bands.sort(key=lambda t: t[0])
    alt = np.concatenate([z for _, z, _ in bands], axis=0)
    lat = np.concatenate([l for _, _, l in bands])
    if lat[0] < lat[-1]:
        alt = alt[::-1]  # nord en haut
    return np.ascontiguousarray(alt)


def load_land_shapes():
    raw = download(NE_LAND_URL, "ne_10m_land.zip")
    zf = zipfile.ZipFile(io.BytesIO(raw))
    r = shapefile.Reader(
        shp=io.BytesIO(zf.read("ne_10m_land.shp")),
        shx=io.BytesIO(zf.read("ne_10m_land.shx")),
        dbf=io.BytesIO(zf.read("ne_10m_land.dbf")),
    )
    return [s.__geo_interface__ for s in r.shapes()]


def land_fraction(shapes, width: int, supersample: int) -> np.ndarray:
    """Fraction de terre par cellule (0–1), grille équirectangulaire width × width/2."""
    w, h = width * supersample, (width // 2) * supersample
    transform = from_bounds(-180, -90, 180, 90, w, h)
    fine = features.rasterize(((g, 1) for g in shapes), out_shape=(h, w), transform=transform, fill=0, dtype="uint8")
    return fine.reshape(width // 2, supersample, width, supersample).mean(axis=(1, 3))


def open_straits(water: np.ndarray, width: int) -> None:
    transform = from_bounds(-180, -90, 180, 90, width, width // 2)
    lines = [{"type": "LineString", "coordinates": pts} for pts in STRAITS.values()]
    burned = features.rasterize(((l, 1) for l in lines), out_shape=water.shape, transform=transform, fill=0, all_touched=True, dtype="uint8")
    water[burned == 1] = True


def resample(alt: np.ndarray, width: int) -> np.ndarray:
    """Moyenne par surface (filtre BOX) vers width × width/2."""
    img = Image.fromarray(alt, mode="F")
    return np.array(img.resize((width, width // 2), Image.Resampling.BOX), dtype=np.float32)


def depth_to_byte(depth: np.ndarray) -> np.ndarray:
    d = np.clip(depth, 10, 11000)
    return np.round(np.log10(d / 10) / math.log10(1100) * 255).astype(np.uint8)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print("ETOPO 2022…")
    alt = load_etopo()
    print(f"  grille {alt.shape[1]}×{alt.shape[0]}")
    print("Natural Earth (terres 1:10m)…")
    shapes = load_land_shapes()

    meta: dict = {
        "sources": {
            "etopo": "ETOPO 2022 v1 60s bed (NOAA NCEI), domaine public, via OPeNDAP, pas 0,05°",
            "land": "Natural Earth 1:10m land, domaine public",
        },
        "ocean": {},
    }

    for width in SIM_WIDTHS:
        frac_land = land_fraction(shapes, width, supersample=4)
        water = (1 - frac_land) >= WATER_THRESHOLD
        open_straits(water, width)
        elev = resample(alt, width)
        depth = np.where(water, np.maximum(-elev, 10.0), 0.0)
        rgba = np.zeros((width // 2, width, 4), dtype=np.uint8)
        rgba[..., 0] = np.where(water, 255, 0)
        rgba[..., 1] = np.where(water, depth_to_byte(depth), 0)
        rgba[..., 2] = np.round(frac_land * 255).astype(np.uint8)
        rgba[..., 3] = 255
        name = f"ocean_{width}.png"
        Image.fromarray(rgba, mode="RGBA").save(OUT / name, optimize=True)
        meta["ocean"][str(width)] = name
        print(f"  {name} : {water.mean() * 100:.1f} % de mer")

    print(f"Élévation d'affichage {DISPLAY_WIDTH}…")
    elev = resample(alt, DISPLAY_WIDTH)
    frac_land = land_fraction(shapes, DISPLAY_WIDTH, supersample=2)
    enc = np.clip(np.round(elev + 11000), 0, 65535).astype(np.uint16)
    rgba = np.zeros((DISPLAY_WIDTH // 2, DISPLAY_WIDTH, 4), dtype=np.uint8)
    rgba[..., 0] = (enc >> 8).astype(np.uint8)
    rgba[..., 1] = (enc & 0xFF).astype(np.uint8)
    rgba[..., 2] = np.round(frac_land * 255).astype(np.uint8)
    rgba[..., 3] = 255
    Image.fromarray(rgba, mode="RGBA").save(OUT / "elevation_4096.png", optimize=True)
    meta["elevation"] = {"file": "elevation_4096.png", "encoding": "R*256+G - 11000 = altitude (m) ; B = fraction de terre"}
    meta["depthEncoding"] = "G/255 = log10(profondeur/10 m)/log10(1100)"

    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print("terminé →", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
