# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow", "scipy"]
# ///
"""
Précalcul du « monde illustré » (land.style = 'illustre') : tout ce qui est statique est calculé ici,
une fois, pour que le GPU de l'exposition n'ait plus que des lectures de texture.

Entrées (data/grid/, produites par build_bathymetry.py et build_landcover.py) :
  - elevation_4096.png : altitude ETOPO 2022 (sourcée) et fraction de terre Natural Earth (sourcée) ;
  - landcover_4096.png : couleurs Natural Earth II (sourcées) ;
  - volcanoes.json     : volcans holocènes émergés du Smithsonian GVP (sourcés).

Sorties (data/grid/), même convention équirectangulaire que elevation_4096.png (ligne 0 au nord) :
  - land_biome_4096.png  RGBA8
        R = milieu illustré (0 glace, 1 toundra, 2 forêt boréale, 3 forêt tempérée, 4 forêt tropicale,
            5 prairie / cultures, 6 savane / steppe, 7 désert de sable, 8 désert de roche), × 16 ;
        G = variation de ton héritée de NE II (128 = ton moyen du milieu) ;
        B = densité de forêt lissée (0–255) ;
        A = 255.
  - land_shape_4096.png  RGBA8
        R = distance signée à la côte : 128 + d / 2° × 127 (d > 0 sur terre), bornée à ±2° ;
        G = altitude lissée pour les paliers : sqrt(clamp(alt, 0, 7000) / 7000) ;
        B = lumière précalculée (relief ombré, ombres portées, occlusion) : 128 = terrain plat éclairé ;
        A = 255.
  - ornaments.json : placements des ornements (bosquets, montagnes, volcans), en niveaux de détail
        emboîtés (bruit bleu sur la sphère).

Traçabilité : les données d'entrée sont sourcées ; la classification en milieux est une
**interprétation artistique** des couleurs NE II (ce n'est pas une carte de végétation) ; les seuils,
l'exagération du relief, la direction du soleil, les densités et espacements des ornements sont
**artistiques**. La limite des neiges utilisée par le shader est un **ordre de grandeur**.

Usage : uv run tools/build_illustrated.py   (ou python3 avec numpy, pillow, scipy)
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
GRID = ROOT / "data" / "grid"
W, H = 4096, 2048
PX_DEG = 360.0 / W  # degrés par pixel
RNG = np.random.default_rng(20261015)

ICE, TUNDRA, BOREAL, TEMPERATE, TROPICAL, GRASS, SAVANNA, DESERT, ROCK = range(9)
N_CLASSES = 9

# ----------------------------------------------------------------------------- outils


def lat_grid() -> np.ndarray:
    return (90.0 - (np.arange(H) + 0.5) * PX_DEG)[:, None] * np.ones((1, W), np.float32)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Flou gaussien : la longitude boucle, la latitude s'arrête aux pôles."""
    return ndimage.gaussian_filter(a, sigma, mode=["nearest", "wrap"])


def fractal_noise(sigmas=(48, 24, 12, 6), seed=0) -> np.ndarray:
    """Bruit lisse (somme d'octaves de bruit blanc floutées), centré, écart-type ≈ 1. Artistique."""
    rng = np.random.default_rng(seed)
    out = np.zeros((H, W), np.float32)
    amp = 1.0
    for s in sigmas:
        n = blur(rng.standard_normal((H, W)).astype(np.float32), s)
        out += amp * n / (n.std() + 1e-9)
        amp *= 0.55
    return out / out.std()


def warp(a: np.ndarray, dx: np.ndarray, dy: np.ndarray, order=1) -> np.ndarray:
    """Échantillonne `a` en (x + dx, y + dy) : bords de pinceau irréguliers (artistique)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    pad = 16
    ap = np.pad(a, ((pad, pad), (0, 0)), mode="edge")
    coords = [np.clip(yy + dy, -pad, H - 1 + pad) + pad, (xx + dx) % W]
    return ndimage.map_coordinates(ap, coords, order=order, mode="grid-wrap")


# ----------------------------------------------------------------------------- milieux


def classify(rgb: np.ndarray, alt: np.ndarray, land: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Milieu illustré d'après les couleurs NE II (interprétation artistique, pas une classification)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = g - np.maximum(r, b)  # excès de vert
    warm = r - b  # chaleur (sable, roche)
    bright = (r + g + b) / 3
    yel = np.minimum(r, g) - b  # herbe sèche
    # Les frontières climatiques (tropiques, taïga) ondulent de quelques degrés : pas de règle tracée.
    alat = np.abs(lat) + 4.0 * fractal_noise((64, 32), seed=3)
    cls = np.full((H, W), GRASS, np.uint8)
    cls[(alat > 48) & (green < 0.05)] = TUNDRA
    cls[(yel > 0.05) & (green < 0.035)] = SAVANNA
    cls[(warm > 0.09) & (green < 0.0)] = DESERT
    cls[(warm > 0.09) & (green < 0.0) & (bright < 0.8)] = ROCK
    cls[green > 0.035] = GRASS
    forest = green > 0.085
    cls[forest] = TEMPERATE
    cls[forest & (alat < 24)] = TROPICAL
    cls[forest & (alat > 50)] = BOREAL
    # Glace : calottes et hautes latitudes seulement (le plateau tibétain, blanchâtre dans NE II,
    # reste de la toundra d'altitude ; les sommets enneigés viennent de l'altitude, dans le shader).
    ice = (bright > 0.885) & (warm < 0.01) & ((np.abs(lat) > 58) | (alt > 5800))
    cls[ice] = ICE
    return cls


def paint_classes(cls: np.ndarray, land: np.ndarray) -> np.ndarray:
    """Aplats de gouache : vote majoritaire flou puis frontières déformées au pinceau (artistique)."""
    votes = np.zeros((N_CLASSES, H, W), np.float32)
    for k in range(N_CLASSES):
        votes[k] = blur((cls == k).astype(np.float32), 1.6)
    dx = 3.5 * fractal_noise((10, 5), seed=11)
    dy = 3.5 * fractal_noise((10, 5), seed=12)
    for k in range(N_CLASSES):
        votes[k] = warp(votes[k], dx, dy)
    out = np.argmax(votes, axis=0).astype(np.uint8)
    out[~land] = cls[~land]
    return out


def fill_sea_nearest(a: np.ndarray, land: np.ndarray) -> np.ndarray:
    """Valeur de la terre la plus proche sur la mer (le shader lit 4 voisins sans déborder de mer)."""
    _, (iy, ix) = ndimage.distance_transform_edt(~land, return_indices=True)
    return a[iy, ix]


# ----------------------------------------------------------------------------- côte


def signed_coast_distance(land: np.ndarray) -> np.ndarray:
    """Distance signée à la côte en degrés d'arc (≈ grand cercle : x pondéré par cos φ), > 0 sur terre."""
    out = np.zeros((H, W), np.float32)
    band, margin = 32, 32
    for y0 in range(0, H, band):
        y1 = min(H, y0 + band)
        a, b = max(0, y0 - margin), min(H, y1 + margin)
        phi = math.radians(90.0 - (0.5 * (y0 + y1)) * PX_DEG)
        sampling = (1.0, max(math.cos(phi), 0.05))
        sub = np.concatenate([land[a:b, -W // 4:], land[a:b], land[a:b, : W // 4]], axis=1)
        din = ndimage.distance_transform_edt(sub, sampling=sampling)
        dout = ndimage.distance_transform_edt(~sub, sampling=sampling)
        d = np.where(sub, din - 0.5, -(dout - 0.5))[:, W // 4: W // 4 + W]
        out[y0:y1] = d[y0 - a: y0 - a + (y1 - y0)]
    return out * PX_DEG


# ----------------------------------------------------------------------------- relief

SUN = np.array([-1.0, -1.0])  # vers la lumière, en pixels (x vers l'est, y vers le sud) : nord-ouest
SUN_ELEV = math.radians(28)  # hauteur du soleil (artistique)
EXAGGERATION = 22.0  # exagération verticale du relief ombré (artistique)


def baked_light(alt_land: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Lumière d'un relief de maquette : ombré doux, ombres portées douces, occlusion des vallées.
    1 = terrain plat éclairé. Constantes artistiques ; l'altitude est sourcée (ETOPO)."""
    h = blur(alt_land, 1.2) * EXAGGERATION  # m
    cosphi = np.maximum(np.cos(np.radians(lat)), 0.05)
    px_m = PX_DEG * 111_320.0
    gy, gx = np.gradient(h)
    gx = gx / (px_m * cosphi)
    gy = gy / px_m
    # Normale (x est, y sud, z haut) ; lumière du nord-ouest.
    n = np.stack([-gx, -gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=0)
    l = np.array([SUN[0] / math.sqrt(2) * math.cos(SUN_ELEV), SUN[1] / math.sqrt(2) * math.cos(SUN_ELEV), math.sin(SUN_ELEV)])
    lam = np.clip(np.tensordot(l, n, axes=1), 0, 1)
    flat = math.sin(SUN_ELEV)
    shade = lam / flat
    # Ombres portées : marche vers le soleil sur le relief exagéré, pénombre douce.
    shadow = np.zeros_like(h)
    tan_e = math.tan(SUN_ELEV)
    for k in range(1, 28):
        dy, dx = int(round(SUN[1] * k)), int(round(SUN[0] * k))
        hk = np.roll(np.roll(h, -dy, axis=0), -dx, axis=1)
        if dy < 0:
            hk[:-dy] = h[:-dy]  # au bord nord, pas de relief au-delà
        dist = k * math.sqrt(2) * px_m * cosphi
        excess = (hk - h - dist * tan_e) / (1500.0 + 0.15 * dist * tan_e)
        shadow = np.maximum(shadow, np.clip(excess, 0, 1))
    # Occlusion : creux par rapport au relief environnant.
    ao = np.clip((blur(h, 10) - h) / (EXAGGERATION * 900.0), 0, 1)
    light = shade * (1 - 0.55 * shadow) * (1 - 0.35 * ao)
    return np.clip(light, 0, 1.99)


# ----------------------------------------------------------------------------- ornements

# Catégories d'ornements (le client associe à chacune des vignettes de l'atlas).
CATS = ["forest_tropical", "forest_temperate", "forest_boreal", "savanna", "meadow", "desert", "tundra", "mountain_snow", "mountain_rock", "volcano", "mesa"]
CAT = {c: i for i, c in enumerate(CATS)}
# Espacement minimal (degrés d'arc) par niveau de détail : chaque niveau double la densité. Artistique.
LEVELS = [3.6, 1.8, 0.9, 0.45]
VOLCANO_LEVELS = [7.0, 3.4, 1.6, 0.8]
MOUNTAIN_LEVELS = [4.2, 2.2, 1.1, 0.6]
# Probabilité qu'un point du semis reçoive un ornement, selon le milieu. Artistique.
CLASS_ORNAMENT = {
    TROPICAL: ("forest_tropical", 0.95),
    TEMPERATE: ("forest_temperate", 0.85),
    BOREAL: ("forest_boreal", 0.8),
    SAVANNA: ("savanna", 0.35),
    GRASS: ("meadow", 0.22),
    DESERT: ("desert", 0.035),  # le grand erg reste presque vide
    ROCK: ("desert", 0.09),
    TUNDRA: ("tundra", 0.12),
    ICE: (None, 0.0),
}


def unit(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], axis=-1)


class SphereHash:
    """Ensemble de points sur la sphère, requête « un point à moins de d ? » par grille 3D."""

    def __init__(self, cell_deg: float):
        self.cell = math.radians(cell_deg)
        self.grid: dict[tuple[int, int, int], list[np.ndarray]] = {}

    def key(self, p):
        return (int(math.floor(p[0] / self.cell)), int(math.floor(p[1] / self.cell)), int(math.floor(p[2] / self.cell)))

    def near(self, p, d_deg: float) -> bool:
        chord = 2 * math.sin(math.radians(d_deg) / 2)
        r = int(math.ceil(chord / self.cell))
        k = self.key(p)
        for i in range(k[0] - r, k[0] + r + 1):
            for j in range(k[1] - r, k[1] + r + 1):
                for m in range(k[2] - r, k[2] + r + 1):
                    for q in self.grid.get((i, j, m), ()):
                        if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < chord * chord:
                            return True
        return False

    def add(self, p):
        self.grid.setdefault(self.key(p), []).append(p)


def sample(a: np.ndarray, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    x = np.clip(((lon + 180.0) / PX_DEG).astype(int), 0, W - 1)
    y = np.clip(((90.0 - lat) / PX_DEG).astype(int), 0, H - 1)
    return a[y, x]


def place_ornaments(classes, land, alt_smooth, lat, volcanoes, coast_dist) -> list[list]:
    out: list[list] = []
    allpts: list[np.ndarray] = []  # tous les ornements déjà posés (espacement entre catégories)

    def taken_at(cell_deg: float) -> SphereHash:
        h = SphereHash(cell_deg)
        for q in allpts:
            h.add(q)
        return h

    # 1. Volcans (positions GVP, sourcées) : éruption récente d'abord, puis altitude.
    vs = sorted(volcanoes, key=lambda v: (-(v[3] if v[3] is not None else -1e6), -v[2]))
    vsp = VOLCANO_LEVELS  # espacements propres aux volcans (artistiques)
    placed = set()
    for lvl, sp in enumerate(vsp):
        vhash = taken_at(sp)
        for i, v in enumerate(vs):
            if i in placed:
                continue
            p = unit(np.array(v[0]), np.array(v[1]))
            if vhash.near(p, sp):
                continue
            vhash.add(p)
            allpts.append(p)
            placed.add(i)
            recent = v[3] if v[3] is not None else None
            # Îlot (moins de ~25 km de terre autour) : seulement aux niveaux fins, pour laisser la mer aux ondes.
            lvl_out = max(lvl, 2) if sample(coast_dist, np.array(v[0]), np.array(v[1])) < 0.22 else lvl
            out.append([round(v[0], 2), round(v[1], 2), CAT["volcano"], lvl_out, int(RNG.integers(256)), round(float(0.85 + 0.3 * min(v[2], 5000) / 5000), 2), recent])

    # 2. Montagnes : sommets du relief lissé (ETOPO), du plus haut au plus bas.
    peaks = (alt_smooth == ndimage.maximum_filter(alt_smooth, size=9, mode=["nearest", "wrap"])) & (alt_smooth > 1400) & land
    py, px = np.nonzero(peaks)
    order = np.argsort(-alt_smooth[py, px])
    msp = MOUNTAIN_LEVELS
    used = np.zeros(len(order), bool)
    nvolc = len(allpts)
    for lvl, sp in enumerate(msp):
        mhash = SphereHash(sp)
        for q in allpts[nvolc:]:
            mhash.add(q)
        vnear = SphereHash(sp * 0.8)
        for q in allpts[:nvolc]:
            vnear.add(q)
        for n, idx in enumerate(order):
            if used[n]:
                continue
            y, x = py[idx], px[idx]
            lo, la = -180 + (x + 0.5) * PX_DEG, 90 - (y + 0.5) * PX_DEG
            p = unit(np.array(lo), np.array(la))
            if mhash.near(p, sp) or vnear.near(p, sp * 0.8):
                continue
            used[n] = True
            mhash.add(p)
            allpts.append(p)
            a = float(alt_smooth[y, x])
            # Neige : altitude au-dessus d'une limite des neiges approchée (ordre de grandeur).
            snowline = 5200.0 * max(0.0, 1.0 - (abs(la) / 72.0) ** 2) + 300.0
            # Le relief lissé écrête les sommets : seuil abaissé pour que les Alpes, les Rocheuses gardent leurs neiges.
            cat = "mountain_snow" if a > snowline * 0.62 else "mountain_rock"
            if cat == "mountain_rock" and classes[y, x] in (DESERT, ROCK, SAVANNA):
                cat = "mesa"  # reliefs arides : plateaux de grès
            out.append([round(lo, 2), round(la, 2), CAT[cat], lvl, int(RNG.integers(256)), round(0.8 + 0.5 * min(a, 6000) / 6000, 2), None])

    # 3. Végétation et pierres : semis de bruit bleu sur la sphère, niveaux emboîtés.
    n_cand = 900_000
    z = RNG.uniform(-1, 1, n_cand)
    lon = RNG.uniform(-180, 180, n_cand)
    la = np.degrees(np.arcsin(z))
    keep = sample(land, lon, la)
    lon, la = lon[keep], la[keep]
    cls = sample(classes, lon, la)
    roll = RNG.uniform(0, 1, len(lon))
    pts = unit(lon, la)
    for lvl, sp in enumerate(LEVELS):
        taken = taken_at(sp)
        for i in range(len(lon)):
            c = int(cls[i])
            cat, prob = CLASS_ORNAMENT.get(c, (None, 0))
            if cat is None or roll[i] > prob:
                continue
            p = pts[i]
            if taken.near(p, sp):
                continue
            taken.add(p)
            allpts.append(p)
            cls[i] = 255  # déjà posé
            out.append([round(float(lon[i]), 2), round(float(la[i]), 2), CAT[cat], lvl, int(RNG.integers(256)), round(float(RNG.uniform(0.85, 1.15)), 2), None])
        print(f"  niveau {lvl} (espacement {sp}°) : {sum(1 for o in out if o[3] == lvl)} ornements")
    return out


# ----------------------------------------------------------------------------- principal


def main() -> int:
    elev = np.asarray(Image.open(GRID / "elevation_4096.png")).astype(np.int32)
    alt = (elev[..., 0] * 256 + elev[..., 1] - 11000).astype(np.float32)
    frac = elev[..., 2].astype(np.float32) / 255.0
    land = frac >= 0.5
    lc = np.asarray(Image.open(GRID / "landcover_4096.png")).astype(np.float32) / 255.0
    rgb, forest = lc[..., :3], lc[..., 3]
    lat = lat_grid()

    print("Milieux…")
    cls = paint_classes(classify(rgb, alt, land, lat), land)
    cls = fill_sea_nearest(cls, land)
    lum = rgb.mean(axis=2)
    tone = np.zeros_like(lum)
    for k in range(N_CLASSES):
        m = (cls == k) & land
        if m.any():
            tone[m] = lum[m] - lum[m].mean()
    tone = blur(tone, 1.0)
    forest_s = fill_sea_nearest(blur(forest * land, 2.0), land)
    biome = np.zeros((H, W, 4), np.uint8)
    biome[..., 0] = cls * 16
    biome[..., 1] = np.clip(128 + tone * 600, 0, 255).astype(np.uint8)
    biome[..., 2] = np.clip(forest_s * 255, 0, 255).astype(np.uint8)
    biome[..., 3] = 255
    Image.fromarray(biome, "RGBA").save(GRID / "land_biome_4096.png", optimize=True)
    print("  " + ", ".join(f"{n} {100 * ((cls == k) & land).sum() / land.sum():.1f} %" for k, n in enumerate(["glace", "toundra", "boréale", "tempérée", "tropicale", "prairie", "savane", "sable", "roche"])))

    print("Côte, paliers, lumière…")
    sd = signed_coast_distance(land)
    alt_land = np.where(land, np.maximum(alt, 1.0), 0.0)
    terr = blur(alt_land, 1.4)
    tdx = 2.0 * fractal_noise((8, 4), seed=21)
    tdy = 2.0 * fractal_noise((8, 4), seed=22)
    terr = np.where(land, np.maximum(warp(terr, tdx, tdy), 1.0), 0.0)
    light = fill_sea_nearest(baked_light(alt_land, lat), land)
    shape = np.zeros((H, W, 4), np.uint8)
    shape[..., 0] = np.clip(np.round(128 + np.clip(sd, -2, 2) / 2 * 127), 0, 255).astype(np.uint8)
    shape[..., 1] = np.clip(np.round(np.sqrt(np.clip(terr, 0, 7000) / 7000) * 255), 0, 255).astype(np.uint8)
    shape[..., 2] = np.clip(np.round(light / 2 * 255), 0, 255).astype(np.uint8)
    shape[..., 3] = 255
    Image.fromarray(shape, "RGBA").save(GRID / "land_shape_4096.png", optimize=True)

    print("Ornements…")
    volcanoes = json.loads((GRID / "volcanoes.json").read_text())
    orn = place_ornaments(cls, land, blur(alt_land, 2.0), lat, volcanoes, sd)
    doc = {
        "categories": CATS,
        "spacing": {c: (VOLCANO_LEVELS if c == "volcano" else MOUNTAIN_LEVELS if c.startswith("mountain") or c == "mesa" else LEVELS) for c in CATS},
        "encoding": "[lon, lat, catégorie, niveau de détail, graine 0–255, échelle, dernière éruption (volcans) ou null]",
        "ornaments": orn,
    }
    (GRID / "ornaments.json").write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    print(f"  {len(orn)} ornements")

    meta_path = GRID / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta["illustrated"] = {
        "biome": "land_biome_4096.png — R/16 = milieu illustré (interprétation artistique de NE II), G = ton, B = forêt",
        "shape": "land_shape_4096.png — R = distance signée à la côte (±2°), G = altitude lissée (racine), B = lumière précalculée",
        "ornaments": "ornaments.json — placements en bruit bleu ; volcans du GVP, sommets d'ETOPO",
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print("terminé →", GRID)
    return 0


if __name__ == "__main__":
    sys.exit(main())
