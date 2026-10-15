# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "requests", "tifffile"]
# ///
"""
Densité mondiale de navires en route, pour le mode « navires estimés ».

Source : Global Fishing Watch, API 4Wings, jeu « AIS vessel presence » (public-global-presence:latest) :
une position par navire et par heure, AIS terrestre ET satellite, tous types de navires, en heures de
présence par cellule de 0,1°. Sur une période de D jours,

    λ (cellule) = heures de présence / (24 · D)

est le nombre moyen de navires présents dans la cellule à un instant donné (grandeur sourcée, pas un
réglage). On ne garde que les navires en route (filtre de vitesse ≥ 2 nœuds) : à quai ou au mouillage,
ils sont quasi silencieux.

Groupes (types GFW → canaux) ; les tranches de vitesse servent aussi à tirer la vitesse des navires :
  cargo_fast : cargo + carrier à ≥ 15 nœuds (→ porte-conteneurs, comme la règle « > 16 nœuds » de l'AIS)
  cargo_slow : cargo + carrier de 2 à 15 nœuds (→ vraquiers et pétroliers)
  passenger, fishing
  other      : support, bunker, other, seismic_vessel
Exclus : gear (balises d'engins de pêche), discrepancy (identités incohérentes).

Sorties :
  data/density/<groupe>.png : 3600 × 1800 (0,1°, ligne 0 au nord), niveaux de gris 8 bits,
      v = 0 → λ = 0 ; sinon λ = 10^(LOG_MIN + (v − 1) / 254 · (LOG_MAX − LOG_MIN))
  data/density/meta.json : période, requêtes, totaux exacts, heures par tranche de vitesse, licence.

Licence : données GFW, usage non commercial (conditions de l'API : CC BY-NC 4.0 ; l'archive livrée avec
les données indique CC BY-SA 4.0) — attribution obligatoire, voir docs/SOURCES_DONNEES.md.

Usage : jeton gratuit (usage non commercial) dans .env : GLOBALFISHINGWATCH_API_KEY=…
  uv run tools/build_presence.py [--days 30]
Les réponses brutes sont gardées dans tools/.cache/gfw/ (une requête ≈ 20 s, 24 requêtes).
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import sys
import zipfile
from pathlib import Path

import numpy as np
import requests
import tifffile
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "density"
CACHE = ROOT / "tools" / ".cache" / "gfw"
API = "https://gateway.api.globalfishingwatch.org/v3"
DATASET = "public-global-presence:latest"

W, H = 3600, 1800  # 0,1°
LOG_MIN, LOG_MAX = -4.0, 2.0  # λ de 1e-4 à 100 navires par cellule
NODATA = 999999

SPEED_BANDS = ["2-4", "4-6", "6-10", "10-15", "15-25", ">25"]
GROUPS: dict[str, tuple[list[str], list[str]]] = {
    "cargo_fast": (["cargo", "carrier"], ["15-25", ">25"]),
    "cargo_slow": (["cargo", "carrier"], ["2-4", "4-6", "6-10", "10-15"]),
    "passenger": (["passenger"], SPEED_BANDS),
    "fishing": (["fishing"], SPEED_BANDS),
    "other": (["support", "bunker", "other", "seismic_vessel"], SPEED_BANDS),
}


def token() -> str:
    t = os.environ.get("GLOBALFISHINGWATCH_API_KEY")
    env = ROOT / ".env"
    if not t and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("GLOBALFISHINGWATCH_API_KEY="):
                t = line.split("=", 1)[1].strip().strip("'\"")
    if not t:
        sys.exit("GLOBALFISHINGWATCH_API_KEY absent (.env)")
    return t


def dataset_end(tok: str) -> dt.date:
    r = requests.get(f"{API}/datasets/{DATASET}", headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    r.raise_for_status()
    return dt.date.fromisoformat(r.json()["endDate"][:10])


def fetch(tok: str, types: list[str], band: str, start: dt.date, end: dt.date) -> np.ndarray:
    """Heures de présence sur la grille mondiale 0,1° (ligne 0 au nord, 90° N)."""
    key = f"{'+'.join(types)}_{band.replace('>', 'gt')}_{start}_{end}.zip"
    path = CACHE / key
    if not path.exists():
        filt = f"vessel_type in ({','.join(repr(t) for t in types)}) AND speed in ('{band}')"
        params = {
            "spatial-resolution": "LOW",
            "temporal-resolution": "ENTIRE",
            "datasets[0]": DATASET,
            "date-range": f"{start},{end}",
            "format": "TIF",
            "filters[0]": filt,
        }
        body = {"geojson": {"type": "Polygon", "coordinates": [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]}}
        print(f"  {filt} …", flush=True)
        r = requests.post(f"{API}/4wings/report", params=params, json=body, headers={"Authorization": f"Bearer {tok}"}, timeout=600)
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".tif"))
        with tifffile.TiffFile(io.BytesIO(z.read(name))) as t:
            page = t.pages[0]
            a = page.asarray().astype(np.float64)
            tie = page.tags["ModelTiepointTag"].value
            scale = page.tags["ModelPixelScaleTag"].value
    a[a == NODATA] = 0
    # Le raster est rogné à l'emprise des données, et ses cellules sont centrées sur les multiples de
    # 0,1° (bord à −180,05°) : on le recale sur la grille mondiale par les centres de cellule.
    lon0, lat0 = tie[3], tie[4]  # coin nord-ouest
    assert abs(scale[0] - 0.1) < 1e-6 and abs(scale[1] - 0.1) < 1e-6, scale
    x0 = int(np.floor((lon0 + 0.05 + 180) / 0.1 + 1e-6))
    y0 = int(np.floor((90 - (lat0 - 0.05)) / 0.1 + 1e-6))
    out = np.zeros((H, W))
    h, w = a.shape
    cols = (np.arange(w) + x0) % W  # la colonne de +180° se replie sur −180°
    rows = np.arange(h) + y0
    ok = (rows >= 0) & (rows < H)
    np.add.at(out, (rows[ok][:, None], cols[None, :]), a[ok])
    return out


def encode(lam: np.ndarray) -> np.ndarray:
    v = np.zeros(lam.shape, np.uint8)
    nz = lam > 0
    q = (np.log10(np.clip(lam[nz], 10**LOG_MIN, 10**LOG_MAX)) - LOG_MIN) / (LOG_MAX - LOG_MIN) * 254 + 1
    v[nz] = np.clip(np.rint(q), 1, 255).astype(np.uint8)
    return v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    tok = token()
    end = dataset_end(tok)
    start = end - dt.timedelta(days=args.days)
    hours_total = 24.0 * args.days
    print(f"GFW {DATASET} : {start} → {end} ({args.days} jours)")
    OUT.mkdir(parents=True, exist_ok=True)
    meta: dict = {
        "source": "Global Fishing Watch, 4Wings API, AIS vessel presence (public-global-presence:latest)",
        "period": [str(start), str(end)],
        "days": args.days,
        "accessed": str(dt.date.today()),
        "resolutionDeg": 0.1,
        "width": W,
        "height": H,
        "encoding": "v = 0 → 0 ; sinon λ = 10^(logMin + (v − 1)/254 · (logMax − logMin)) navires présents en moyenne par cellule",
        "logMin": LOG_MIN,
        "logMax": LOG_MAX,
        "minSpeedKn": 2,
        "licence": "Global Fishing Watch — usage non commercial ; API : CC BY-NC 4.0 ; archive des données : CC BY-SA 4.0. Attribution obligatoire.",
        "attribution": f"Global Fishing Watch, AIS vessel presence (public-global-presence:latest), {start}–{end}. Données consultées le {dt.date.today()} sur https://globalfishingwatch.org/our-apis/.",
        "groups": {},
    }
    for name, (types, bands) in GROUPS.items():
        print(f"{name} :")
        lam = np.zeros((H, W))
        speed_hours: dict[str, float] = {}
        for band in bands:
            hrs = fetch(tok, types, band, start, end)
            speed_hours[band] = float(hrs.sum())
            lam += hrs / hours_total
        Image.fromarray(encode(lam), "L").save(OUT / f"{name}.png", optimize=True)
        meta["groups"][name] = {
            "file": f"{name}.png",
            "gfwTypes": types,
            "speedBands": bands,
            "speedHours": speed_hours,
            "meanShips": float(lam.sum()),
        }
        print(f"  → {lam.sum():.0f} navires présents en moyenne")
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    total = sum(g["meanShips"] for g in meta["groups"].values())
    print(f"total : {total:.0f} navires en route en moyenne → {OUT}")


if __name__ == "__main__":
    main()
