# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "requests"]
# ///
"""
Construit la couleur des terres et la liste des volcans utilisées par le rendu « gouache ».

Sources :
  - Natural Earth II 1:10m, variante « LC » (couverture du sol seule, sans relief ombré ni eau),
    Tom Patterson, domaine public. Le relief est calculé par le shader à partir d'ETOPO.
  - Smithsonian Institution, Global Volcanism Program, « Volcanoes of the World » : volcans
    holocènes (service WFS public). Citation demandée par le GVP ; voir docs/SOURCES_DONNEES.md.

Sorties (data/grid/) :
  - landcover_4096.png  RGBA8, 4096 × 2048, même convention que elevation_4096.png
        (u = (lon + 180) / 360, ligne 0 au nord) :
        RGB = couleur Natural Earth II (moyenne par surface) ; sur la mer, couleur de la terre
              la plus proche (le filtrage linéaire ne fait pas déborder de bleu sur les côtes) ;
        A   = indice de forêt 0–255 (choix artistique : teinte verte sombre de NE II, pas une mesure).
  - volcanoes.json : [[lon, lat, altitude (m), dernière éruption (année, négative avant J.-C., null si
    inconnue)], …] des volcans holocènes émergés.
  - meta.json : complété (la sortie de build_bathymetry.py est conservée).

Usage : uv run tools/build_landcover.py   (après build_bathymetry.py : il lit elevation_4096.png)
"""
from __future__ import annotations

import io
import json
import sys
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
OUT = ROOT / "data" / "grid"

NE2_URL = "https://naciscdn.org/naturalearth/10m/raster/NE2_HR_LC.zip"
GVP_URL = (
    "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature"
    "&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json"
)
WIDTH = 4096
# Nombre de passes de dilatation de la couleur des terres vers la mer (en pixels de la grille 4096).
COAST_FILL = 8


def download(url: str, name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"  téléchargement {url}")
        r = requests.get(url, timeout=900)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def load_ne2() -> np.ndarray:
    """Natural Earth II réduit à WIDTH × WIDTH/2 (moyenne par surface), RGB float 0–1."""
    zf = zipfile.ZipFile(download(NE2_URL, "NE2_HR_LC.zip"))
    tif = next(n for n in zf.namelist() if n.lower().endswith(".tif"))
    Image.MAX_IMAGE_PIXELS = None
    img = Image.open(io.BytesIO(zf.read(tif))).convert("RGB")
    print(f"  {tif} : {img.width}×{img.height}")
    small = img.resize((WIDTH, WIDTH // 2), Image.Resampling.BOX)
    return np.asarray(small, dtype=np.float32) / 255.0


def land_fraction() -> np.ndarray:
    """Fraction de terre (canal B de elevation_4096.png, produit par build_bathymetry.py)."""
    elev = np.asarray(Image.open(OUT / "elevation_4096.png"))
    assert elev.shape[:2] == (WIDTH // 2, WIDTH), elev.shape
    return elev[..., 2].astype(np.float32) / 255.0


def fill_sea(rgb: np.ndarray, land: np.ndarray) -> np.ndarray:
    """Étend la couleur des terres sur la mer voisine (moyenne des voisins déjà remplis, passe par passe)."""
    known = land >= 0.5
    out = rgb * known[..., None]
    for _ in range(COAST_FILL):
        acc = np.zeros_like(out)
        cnt = np.zeros(known.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            k = np.roll(known, (dy, dx), axis=(0, 1))
            acc += np.roll(out, (dy, dx), axis=(0, 1)) * k[..., None]
            cnt += k
        grow = ~known & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        known = known | grow
    # Au-delà : gris neutre (jamais vu, la mer recouvre ces pixels).
    out[~known] = 0.5
    return out


def forest_index(rgb: np.ndarray) -> np.ndarray:
    """Indice de forêt 0–1 : excès de vert de la palette NE II (pastel : forêt dense ≈ +40/255 de vert sur le
    rouge et le bleu, terres agricoles ≈ +25, prairies ≈ +5). Choix artistique, pas une classification."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    excess = g - np.maximum(r, b)
    return np.clip((excess - 12 / 255) / (28 / 255), 0, 1)


def load_volcanoes() -> list[list[float]]:
    raw = json.loads(download(GVP_URL, "gvp_holocene.json").read_text())
    pts = []
    for f in raw["features"]:
        p = f["properties"]
        lon, lat, alt = p.get("Longitude"), p.get("Latitude"), p.get("Elevation")
        if lon is None or lat is None or alt is None or alt <= 0:
            continue  # volcans sous-marins : pas de dessin sur la mer
        year = p.get("Last_Eruption_Year")
        pts.append([round(lon, 3), round(lat, 3), int(alt), int(year) if year is not None else None])
    return pts


def main() -> int:
    print("Natural Earth II…")
    rgb = load_ne2()
    land = land_fraction()
    rgb = fill_sea(rgb, land)
    forest = forest_index(rgb) * (land >= 0.5)
    rgba = np.zeros((WIDTH // 2, WIDTH, 4), dtype=np.uint8)
    rgba[..., :3] = np.round(np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    rgba[..., 3] = np.round(forest * 255).astype(np.uint8)
    Image.fromarray(rgba, mode="RGBA").save(OUT / "landcover_4096.png", optimize=True)
    print(f"  landcover_4096.png : forêt sur {(forest > 0.5).sum() / max((land >= 0.5).sum(), 1) * 100:.1f} % des terres")

    print("Volcans holocènes (Smithsonian GVP)…")
    volcanoes = load_volcanoes()
    (OUT / "volcanoes.json").write_text(json.dumps(volcanoes, separators=(",", ":")))
    print(f"  volcanoes.json : {len(volcanoes)} volcans émergés")

    meta_path = OUT / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta["sources"]["landcover"] = "Natural Earth II 1:10m (NE2_HR_LC), Tom Patterson, domaine public"
    meta["sources"]["volcanoes"] = f"Smithsonian GVP, Volcanoes of the World (volcans holocènes, WFS), extrait le {date.today().isoformat()}"
    meta["landcover"] = {
        "file": "landcover_4096.png",
        "encoding": "RGB = couleur NE II (prolongée sur la mer côtière) ; A = indice de forêt (artistique)",
    }
    meta["volcanoes"] = {"file": "volcanoes.json", "encoding": "[lon, lat, altitude m, année de la dernière éruption ou null], volcans émergés"}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print("terminé →", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
