# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "scipy"]
# ///
"""
Assemble les vignettes rendues par render_cells.py en un atlas pour le client.

    python3 tools/ornaments/pack_atlas.py <dossier des vignettes>

Sorties (data/ornaments/) :
  - atlas.png  : RGBA, alpha non prémultiplié (le client prémultiplie au chargement) ; couleur prolongée
                 dans les zones transparentes pour que les mipmaps ne fassent pas de liseré ;
  - atlas.json : taille, cellule, colonnes, vignettes (catégorie, point d'ancrage, échelle) et
                 index par catégorie.
Sources des modèles : pack « Ultimate Stylized Nature » de Quaternius (CC0 1.0) et modèles procéduraux
de render_cells.py. Retouches (réduction, liseré) artistiques.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "ornaments"
CELL = 256
COLS = 8
ORDER = ["forest_tropical", "forest_temperate", "forest_boreal", "savanna", "meadow", "desert", "tundra",
         "mountain_snow", "mountain_rock", "mesa", "volcano", "smoke", "cloud"]


def shrink(img: Image.Image) -> np.ndarray:
    """Réduction en couleurs prémultipliées (pas de halo sombre), puis retour à l'alpha droit."""
    a = np.asarray(img.convert("RGBA"), np.float32) / 255.0
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4]
    small = np.stack([np.asarray(Image.fromarray(pm[..., k]).resize((CELL, CELL), Image.Resampling.LANCZOS)) for k in range(4)], -1)
    small = np.clip(small, 0, 1)
    alpha = small[..., 3:4]
    rgb = np.where(alpha > 1e-4, small[..., :3] / np.maximum(alpha, 1e-4), 0)
    return np.concatenate([np.clip(rgb, 0, 1), alpha], -1)


def outline(px: np.ndarray, width=1.6, strength=0.55) -> np.ndarray:
    """Liseré sombre autour des objets (pas des ombres portées) : lisibilité sur le projecteur."""
    rgb, a = px[..., :3], px[..., 3]
    lum = rgb.mean(-1)
    solid = (a > 0.85) & (lum > 0.06)  # les ombres du plan sont noires et semi-transparentes
    dist = ndimage.distance_transform_edt(~solid)
    ring = np.clip(1 - (dist - 0.5) / width, 0, 1) * (dist > 0)
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    ink = rgb[iy, ix] * 0.32
    out_a = np.maximum(a, ring * strength)
    w = (ring * strength) / np.maximum(out_a, 1e-4)
    out_rgb = rgb * (1 - w[..., None]) + ink * w[..., None]
    return np.concatenate([out_rgb, out_a[..., None]], -1)


def bleed(px: np.ndarray) -> np.ndarray:
    """Prolonge la couleur des pixels visibles dans les pixels transparents (mipmaps propres)."""
    vis = px[..., 3] > 0.02
    if not vis.any():
        return px
    _, (iy, ix) = ndimage.distance_transform_edt(~vis, return_indices=True)
    out = px.copy()
    out[..., :3] = np.where(vis[..., None], px[..., :3], px[iy, ix, :3])
    return out


def main() -> int:
    src = Path(sys.argv[1])
    cells = json.loads((src / "cells.json").read_text())
    cells.sort(key=lambda c: (ORDER.index(c["category"]), c["name"]))
    rows = (len(cells) + COLS - 1) // COLS
    size = CELL * COLS
    assert rows * CELL <= size, "atlas trop petit"
    atlas = np.zeros((size, size, 4), np.float32)
    sprites, cats = [], {}
    for i, c in enumerate(cells):
        px = shrink(Image.open(src / f"{c['name']}.png"))
        if c["category"] not in ("cloud", "smoke"):
            px = outline(px)
        px = bleed(px)
        r, q = divmod(i, COLS)
        atlas[r * CELL:(r + 1) * CELL, q * CELL:(q + 1) * CELL] = px
        sprites.append({"name": c["name"], "category": c["category"], "index": i, "pivot": c["pivot"], "scale": round(c["scale"], 4)})
        cats.setdefault(c["category"], []).append(i)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.round(atlas * 255).astype(np.uint8), "RGBA").save(OUT / "atlas.png", optimize=True)
    doc = {
        "size": size, "cell": CELL, "cols": COLS,
        "source": "Quaternius, Ultimate Stylized Nature (CC0 1.0) ; montagnes, volcans, fumées et nuages procéduraux (tools/ornaments/render_cells.py)",
        "sprites": sprites, "categories": cats,
    }
    (OUT / "atlas.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(f"atlas {size}×{size}, {len(cells)} vignettes → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
