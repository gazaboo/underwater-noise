# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "requests", "scipy"]
# ///
"""
Habitats et observations des cétacés de l'œuvre.

1. Habitats : cartes AquaMaps « native range » (probabilité de présence par c-carré de 0,5°),
   extraites de la base publiée par le projet AquaMaps (paquet R aquamapsdata :
   https://archive.org/download/aquamapsdb/am.db.bz2, ~1,2 Go compressé, téléchargée une fois dans
   tools/.cache et décompressée en am.db). Licence AquaMaps : CC-BY-NC 3.0 — compatible avec une
   œuvre non commerciale, attribution obligatoire (voir docs/SOURCES_DONNEES.md).
   → data/habitats/<espèce>.png : 720 × 360, niveaux de gris = probabilité × 255, ligne 0 au nord.

2. Observations : occurrences OBIS depuis 2015 (api.obis.org), regroupées par cellules de 0,25°,
   au plus 400 par espèce, avec la liste des jeux de données et de leurs licences.
   → data/habitats/sightings.json

Usage :
  (cd tools/.cache && curl -LO https://archive.org/download/aquamapsdb/am.db.bz2 && bunzip2 -k am.db.bz2)
  uv run tools/build_habitats.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "tools" / ".cache" / "am.db"
OUT = ROOT / "data" / "habitats"

SPECIES = {
    "blue": ("Balaenoptera", "musculus"),
    "fin": ("Balaenoptera", "physalus"),
    "humpback": ("Megaptera", "novaeangliae"),
    "sperm": ("Physeter", "macrocephalus"),
    "orca": ("Orcinus", "orca"),
}

W, H = 720, 360  # 0,5°


def tables(con: sqlite3.Connection) -> list[str]:
    return [r[0] for r in con.execute("select name from sqlite_master where type in ('table','view') order by name")]


def columns(con: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in con.execute(f"pragma table_info('{table}')")]


def find_table(con: sqlite3.Connection, *needles: str) -> str:
    for t in tables(con):
        if all(n in t.lower() for n in needles):
            return t
    raise SystemExit(f"table introuvable ({needles}) parmi : {tables(con)}")


def build_habitats() -> None:
    if not DB.exists():
        raise SystemExit(f"{DB} absent : voir l'en-tête de ce script pour la télécharger")
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    t_species = find_table(con, "speciesoccursum")
    t_native = find_table(con, "hcaf_species_native")
    cols_native = columns(con, t_native)
    lat_c = next(c for c in cols_native if c.lower() == "centerlat")
    lon_c = next(c for c in cols_native if c.lower() == "centerlong")
    prob_c = next(c for c in cols_native if c.lower() == "probability")
    sp_c = next(c for c in cols_native if c.lower() == "speciesid")
    cols_sp = columns(con, t_species)
    genus_c = next(c for c in cols_sp if c.lower() == "genus")
    species_c = next(c for c in cols_sp if c.lower() == "species")
    id_c = next(c for c in cols_sp if c.lower() == "speciesid")

    OUT.mkdir(parents=True, exist_ok=True)
    ids: dict[str, str] = {}
    for key, (genus, species) in SPECIES.items():
        row = con.execute(f"select {id_c} from {t_species} where {genus_c}=? and {species_c}=?", (genus, species)).fetchone()
        if row:
            ids[row[0]] = key
        else:
            print(f"  ✗ {genus} {species} absent de la base")
    # Une seule lecture de la (très grande) table pour les cinq espèces.
    grids = {key: np.zeros((H, W), dtype=np.float32) for key in ids.values()}
    counts = Counter()
    marks = ",".join("?" * len(ids))
    for sid, lat, lon, p in con.execute(f"select {sp_c}, {lat_c}, {lon_c}, {prob_c} from {t_native} where {sp_c} in ({marks})", list(ids)):
        key = ids[sid]
        x = int((lon + 180) / 0.5)
        y = int((90 - lat) / 0.5)
        if 0 <= x < W and 0 <= y < H:
            grids[key][y, x] = max(grids[key][y, x], float(p))
            counts[key] += 1
    for key, grid in grids.items():
        # Léger adoucissement : les c-carrés de 0,5° restent lisibles, sans marches.
        smooth = gaussian_filter(grid, sigma=0.8, mode=("nearest", "wrap"))
        smooth = np.maximum(smooth, grid * 0.85)
        img = (np.clip(smooth, 0, 1) * 255).astype(np.uint8)
        rgba = np.dstack([img, img, img, np.full_like(img, 255)])
        Image.fromarray(rgba, mode="RGBA").save(OUT / f"{key}.png", optimize=True)
        genus, species = SPECIES[key]
        print(f"  {key:9s} {genus} {species} : {counts[key]} cellules, probabilité max {grid.max():.2f}, moyenne (présence) {grid[grid > 0].mean():.2f}")


def build_sightings() -> None:
    out: dict = {"source": "OBIS (api.obis.org), occurrences depuis 2015, regroupées par cellules de 0,25°", "species": {}, "datasets": {}}
    for key, (genus, species) in SPECIES.items():
        name = f"{genus} {species}"
        pts: dict[tuple[int, int], tuple[float, float]] = {}
        datasets: Counter[str] = Counter()
        after = None
        for _ in range(10):
            params = {"scientificname": name, "startdate": "2015-01-01", "size": 5000, "fields": "decimalLatitude,decimalLongitude,dataset_id,id"}
            if after:
                params["after"] = after
            r = requests.get("https://api.obis.org/v3/occurrence", params=params, timeout=120)
            r.raise_for_status()
            res = r.json()["results"]
            if not res:
                break
            for o in res:
                lat, lon = o.get("decimalLatitude"), o.get("decimalLongitude")
                if lat is None or lon is None:
                    continue
                pts.setdefault((int(lat * 4), int(lon * 4)), (round(lat, 3), round(lon, 3)))
                datasets[o.get("dataset_id", "?")] += 1
            after = res[-1]["id"]
        rng = np.random.default_rng(42)
        sel = list(pts.values())
        if len(sel) > 400:
            sel = [sel[i] for i in rng.choice(len(sel), 400, replace=False)]
        out["species"][key] = [{"lat": a, "lon": b} for a, b in sel]
        for ds in datasets:
            out["datasets"].setdefault(ds, None)
        print(f"  {key:9s} {name} : {len(pts)} cellules observées, {len(sel)} retenues, {len(datasets)} jeux de données")
    # Licences des jeux de données (attribution).
    for ds in list(out["datasets"]):
        try:
            d = requests.get(f"https://api.obis.org/v3/dataset/{ds}", timeout=60).json()["results"][0]
            out["datasets"][ds] = {"title": d.get("title"), "license": (d.get("intellectualrights") or "")[:160], "url": d.get("url")}
        except Exception:  # noqa: BLE001
            out["datasets"][ds] = {"title": None, "license": None}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sightings.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


def main() -> int:
    print("Habitats AquaMaps…")
    build_habitats()
    if "--skip-obis" not in sys.argv:
        print("Observations OBIS…")
        build_sightings()
    return 0


if __name__ == "__main__":
    sys.exit(main())
