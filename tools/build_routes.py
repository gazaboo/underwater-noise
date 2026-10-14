# /// script
# requires-python = ">=3.10"
# dependencies = ["searoute==1.6.0", "numpy"]
# ///
"""
Construit le réseau de routes maritimes du mode simulation (data/routes.json).

Les navires synthétiques suivent des routes entre grands ports, calculées sur le réseau
maritime « marnet » via le paquet Python `searoute` (Apache-2.0 ; réseau d'origine :
Oak Ridge National Laboratory / Eurostat, EUPL). La liste des ports et leurs poids
(ordre de grandeur du trafic) est établie à la main : ce n'est pas une statistique,
seulement de quoi obtenir une géographie du trafic crédible.

Chaque route reçoit un poids (modèle gravitaire : produit des poids des ports, atténué
par la distance) et un mélange de classes de navires selon la nature des ports.

Usage : uv run tools/build_routes.py
"""
from __future__ import annotations

import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np
import searoute as sr

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "routes.json"

# (nom, lon, lat, poids relatif, nature) — nature : mixed | container | oil | bulk | cruise
PORTS: list[tuple[str, float, float, float, str]] = [
    ("Shanghai", 122.1, 30.6, 10, "container"),
    ("Singapour", 103.85, 1.2, 10, "container"),
    ("Ningbo", 121.9, 29.9, 8, "container"),
    ("Shenzhen", 113.9, 22.4, 8, "container"),
    ("Guangzhou", 113.7, 22.6, 6, "container"),
    ("Qingdao", 120.4, 36.0, 6, "mixed"),
    ("Busan", 129.05, 35.05, 6, "container"),
    ("Tianjin", 118.0, 38.95, 5, "mixed"),
    ("Hong Kong", 114.15, 22.25, 5, "container"),
    ("Kaohsiung", 120.25, 22.55, 3, "container"),
    ("Tokyo", 139.8, 35.4, 3, "mixed"),
    ("Port Klang", 101.3, 2.95, 4, "container"),
    ("Tanjung Pelepas", 103.5, 1.33, 3, "container"),
    ("Laem Chabang", 100.85, 13.05, 2, "container"),
    ("Ho Chi Minh", 106.95, 10.4, 2, "container"),
    ("Manille", 120.9, 14.5, 1.5, "mixed"),
    ("Jakarta", 106.9, -6.05, 2, "mixed"),
    ("Colombo", 79.85, 6.95, 2.5, "container"),
    ("Mumbai", 72.95, 18.95, 2.5, "mixed"),
    ("Jebel Ali", 55.0, 25.05, 5, "container"),
    ("Ras Tanura", 50.2, 26.7, 5, "oil"),
    ("Fujairah", 56.4, 25.15, 3, "oil"),
    ("Bassora", 48.85, 29.7, 3, "oil"),
    ("Djeddah", 39.1, 21.45, 2, "container"),
    ("Port-Saïd", 32.35, 31.3, 3, "container"),
    ("Le Pirée", 23.6, 37.9, 2, "mixed"),
    ("Istanbul", 28.95, 41.0, 2, "mixed"),
    ("Novorossiysk", 37.8, 44.7, 2, "oil"),
    ("Gênes", 8.9, 44.4, 1.5, "mixed"),
    ("Marseille", 5.3, 43.3, 1.5, "mixed"),
    ("Barcelone", 2.2, 41.35, 2, "cruise"),
    ("Valence", -0.3, 39.45, 2, "container"),
    ("Algésiras", -5.4, 36.1, 3, "container"),
    ("Tanger Med", -5.5, 35.9, 2.5, "container"),
    ("Rotterdam", 4.0, 51.95, 6, "mixed"),
    ("Anvers", 4.3, 51.4, 5, "mixed"),
    ("Hambourg", 9.9, 53.55, 4, "container"),
    ("Le Havre", 0.1, 49.5, 2, "container"),
    ("Felixstowe", 1.35, 51.95, 2, "container"),
    ("Gdansk", 18.7, 54.4, 1.5, "mixed"),
    ("Saint-Pétersbourg", 30.2, 59.9, 1.5, "mixed"),
    ("Göteborg", 11.85, 57.7, 1.2, "mixed"),
    ("Bergen", 5.3, 60.4, 1, "oil"),
    ("New York", -74.05, 40.6, 4, "container"),
    ("Savannah", -81.0, 32.05, 3, "container"),
    ("Houston", -94.8, 29.35, 4, "oil"),
    ("Nouvelle-Orléans", -89.6, 29.0, 3, "bulk"),
    ("Miami", -80.1, 25.75, 2, "cruise"),
    ("Panama (Colón)", -79.9, 9.4, 4, "container"),
    ("Panama (Balboa)", -79.55, 8.9, 3, "container"),
    ("Kingston", -76.8, 17.95, 1.5, "container"),
    ("Santos", -46.3, -24.0, 3, "mixed"),
    ("Tubarão", -40.25, -20.3, 3, "bulk"),
    ("Buenos Aires", -57.8, -34.8, 1.5, "mixed"),
    ("Callao", -77.2, -12.05, 1.5, "mixed"),
    ("Valparaíso", -71.65, -33.0, 1, "mixed"),
    ("Los Angeles", -118.25, 33.7, 5, "container"),
    ("Oakland", -122.35, 37.8, 2, "container"),
    ("Vancouver", -123.3, 49.25, 3, "bulk"),
    ("Manzanillo (MX)", -104.35, 19.05, 2, "container"),
    ("Durban", 31.05, -29.9, 2, "container"),
    ("Richards Bay", 32.1, -28.8, 2, "bulk"),
    ("Le Cap", 18.4, -33.9, 1.5, "mixed"),
    ("Lagos", 3.4, 6.4, 2, "oil"),
    ("Abidjan", -4.0, 5.25, 1.2, "mixed"),
    ("Dakar", -17.45, 14.65, 1, "mixed"),
    ("Mombasa", 39.7, -4.1, 1.2, "mixed"),
    ("Port Hedland", 118.55, -20.25, 4, "bulk"),
    ("Dampier", 116.7, -20.6, 2, "bulk"),
    ("Newcastle (AU)", 151.85, -32.95, 3, "bulk"),
    ("Sydney", 151.25, -33.95, 1.5, "container"),
    ("Melbourne", 144.9, -37.9, 1.5, "container"),
    ("Auckland", 174.8, -36.85, 1, "mixed"),
    ("Honolulu", -157.9, 21.3, 0.5, "mixed"),
    ("Nakhodka", 132.9, 42.75, 1.5, "oil"),
]

# Mélange de classes J-E par nature de port.
MIX: dict[str, dict[str, float]] = {
    "container": {"container": 0.6, "bulker": 0.15, "tanker": 0.1, "vehicleCarrier": 0.1, "other": 0.05},
    "oil": {"tanker": 0.7, "bulker": 0.1, "container": 0.1, "other": 0.1},
    "bulk": {"bulker": 0.7, "tanker": 0.1, "container": 0.1, "other": 0.1},
    "cruise": {"cruise": 0.35, "container": 0.35, "passenger": 0.1, "bulker": 0.1, "tanker": 0.1},
    "mixed": {"container": 0.35, "bulker": 0.25, "tanker": 0.2, "vehicleCarrier": 0.05, "other": 0.15},
}

# Grandes lignes connues, ajoutées quel que soit leur score gravitaire
# (minerai Brésil → Chine par le cap de Bonne-Espérance, pétrole du Golfe, etc.).
LANES: list[tuple[str, str]] = [
    ("Tubarão", "Qingdao"), ("Tubarão", "Rotterdam"), ("Port Hedland", "Qingdao"), ("Dampier", "Shanghai"),
    ("Ras Tanura", "Houston"), ("Ras Tanura", "Ningbo"), ("Bassora", "Mumbai"), ("Fujairah", "Singapour"),
    ("Lagos", "Rotterdam"), ("Lagos", "Houston"), ("Santos", "Rotterdam"), ("Santos", "Shanghai"),
    ("Buenos Aires", "Anvers"), ("Durban", "Singapour"), ("Richards Bay", "Mumbai"), ("Le Cap", "Singapour"),
    ("Le Cap", "Rotterdam"), ("Callao", "Shanghai"), ("Valparaíso", "Busan"), ("Newcastle (AU)", "Busan"),
    ("Auckland", "Los Angeles"), ("Honolulu", "Los Angeles"), ("Panama (Balboa)", "Shanghai"),
    ("Dakar", "Rotterdam"), ("Mombasa", "Jebel Ali"), ("Abidjan", "Le Havre"), ("Nakhodka", "Busan"),
    ("Kingston", "Savannah"), ("Miami", "Kingston"), ("Novorossiysk", "Algésiras"), ("Bergen", "Rotterdam"),
    ("Melbourne", "Singapour"), ("Sydney", "Auckland"), ("Vancouver", "Busan"), ("Manzanillo (MX)", "Busan"),
]
PARTNERS_PER_PORT = 4
MAX_ROUTES = 420
SEGMENT_KM = 40.0  # densification orthodromique
R_EARTH_KM = 6371.0


def gc_distance(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH_KM * math.asin(min(1.0, math.sqrt(a)))


def slerp(lon1, lat1, lon2, lat2, t) -> tuple[float, float]:
    """Interpolation orthodromique ; la longitude reste « dépliée » (continue)."""
    def vec(lon, lat):
        lo, la = math.radians(lon), math.radians(lat)
        return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])

    a, b = vec(lon1, lat1), vec(lon2, lat2)
    w = math.acos(float(np.clip(a @ b, -1, 1)))
    if w < 1e-9:
        return lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t
    v = (math.sin((1 - t) * w) * a + math.sin(t * w) * b) / math.sin(w)
    lat = math.degrees(math.asin(float(np.clip(v[2], -1, 1))))
    lon = math.degrees(math.atan2(v[1], v[0]))
    # recaler la longitude au plus près de l'interpolation linéaire dépliée
    ref = lon1 + (lon2 - lon1) * t
    lon += 360 * round((ref - lon) / 360)
    return lon, lat


def densify(coords: list[list[float]]) -> list[list[float]]:
    out = [coords[0]]
    for (lo1, la1), (lo2, la2) in itertools.pairwise(coords):
        d = gc_distance(lo1, la1, lo2, la2)
        n = max(1, math.ceil(d / SEGMENT_KM))
        for k in range(1, n + 1):
            lo, la = slerp(lo1, la1, lo2, la2, k / n)
            out.append([round(lo, 4), round(la, 4)])
    return out


def mix_for(a: str, b: str) -> dict[str, float]:
    m: dict[str, float] = {}
    for kind in (a, b):
        for k, v in MIX[kind].items():
            m[k] = m.get(k, 0) + v / 2
    return {k: round(v, 3) for k, v in m.items()}


def main() -> int:
    candidates = []
    for (i, pa), (j, pb) in itertools.combinations(enumerate(PORTS), 2):
        d = gc_distance(pa[1], pa[2], pb[1], pb[2])
        if d < 150:
            continue
        # Modèle gravitaire, atténuation douce avec la distance.
        g = pa[3] * pb[3] / (1 + d / 4000) ** 1.2
        candidates.append((g, i, j))
    candidates.sort(reverse=True)

    # Sélection : grandes lignes, puis meilleurs partenaires de chaque port, puis classement global.
    index = {p[0]: k for k, p in enumerate(PORTS)}
    score = {(i, j): g for g, i, j in candidates}
    chosen: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()

    def take(i: int, j: int) -> None:
        key = (min(i, j), max(i, j))
        if key not in seen:
            seen.add(key)
            chosen.append(key)

    for a, b in LANES:
        take(index[a], index[b])
    for k in range(len(PORTS)):
        mine = sorted(((g, i, j) for g, i, j in candidates if k in (i, j)), reverse=True)[:PARTNERS_PER_PORT]
        for _, i, j in mine:
            take(i, j)
    for _, i, j in candidates:
        if len(chosen) >= MAX_ROUTES:
            break
        take(i, j)

    routes = []
    for i, j in chosen:
        pa, pb = PORTS[i], PORTS[j]
        g = score.get((i, j)) or PORTS[i][3] * PORTS[j][3] / (1 + gc_distance(pa[1], pa[2], pb[1], pb[2]) / 4000) ** 1.2
        if (pa[0], pb[0]) in LANES or (pb[0], pa[0]) in LANES:
            g = max(g, 2.0)  # une grande ligne garde un trafic visible
        try:
            r = sr.searoute([pa[1], pa[2]], [pb[1], pb[2]], units="km")
        except Exception as e:  # noqa: BLE001 — une route impossible est simplement ignorée
            print(f"  ✗ {pa[0]} → {pb[0]} : {e}")
            continue
        coords = r["geometry"]["coordinates"]
        if len(coords) < 2:
            continue
        routes.append(
            {
                "from": pa[0],
                "to": pb[0],
                "weight": round(g, 4),
                "lengthKm": round(r["properties"]["length"], 1),
                "mix": mix_for(pa[4], pb[4]),
                "coords": densify(coords),
            }
        )
    total = sum(r["weight"] for r in routes)
    for r in routes:
        r["weight"] = round(r["weight"] / total, 6)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "searoute 1.6.0 (réseau marnet : ORNL / Eurostat) ; ports et poids : liste manuelle, ordres de grandeur",
                "routes": routes,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    pts = sum(len(r["coords"]) for r in routes)
    print(f"{len(routes)} routes, {pts} points → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
