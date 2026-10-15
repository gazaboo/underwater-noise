"""NOAA « hybrid millidecade » (HMD, 1 min, netCDF NCEI) → niveaux décidécades au format de ices.py.

Les HMD (Martin et al. 2021, doi:10.1121/10.0003324) donnent une densité spectrale moyenne par bande :
bandes de 1 Hz jusqu'à 435 Hz, puis millidécades. La puissance d'une décidécade est la somme, sur
chaque bande HMD, de la densité × largeur du recouvrement avec la décidécade (densité supposée
uniforme dans une bande HMD, comme le définit le produit). Une minute n'est retenue pour une
décidécade que si toutes les bandes HMD qui y contribuent sont de qualité 1 (« Good ») et si la minute
est enregistrée en entier (effort = 60 s). Rien n'est interpolé.
"""
from __future__ import annotations
import csv
import math
from datetime import datetime, timezone
from pathlib import Path
import h5py
import numpy as np
from ices import FIELDS, NOMINAL

HALF = 10 ** 0.05


def hmd_edges(centres: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Bords des bandes HMD : ±0,5 Hz dans la partie à 1 Hz (le premier centre, 0,1 Hz, représente la
    bande 0–0,5 Hz), puis moyennes géométriques des centres millidécades, contiguës à la jonction."""
    spacing = np.isclose(np.diff(centres), 1.0)
    last_linear = int(np.argmax(~spacing[1:])) + 1  # premier écart ≠ 1 Hz après le centre 0,1 Hz
    lo, hi = np.empty_like(centres), np.empty_like(centres)
    lo[0], hi[0] = 0.0, 0.5
    lo[1:last_linear + 1], hi[1:last_linear + 1] = centres[1:last_linear + 1] - .5, centres[1:last_linear + 1] + .5
    for i in range(last_linear + 1, len(centres)):
        lo[i] = hi[i - 1]
        hi[i] = math.sqrt(centres[i] * centres[i + 1]) if i + 1 < len(centres) else centres[i] * 10 ** .0005
    return lo, hi


def decidecade_matrix(lo: np.ndarray, hi: np.ndarray, decidecades: list[float]) -> np.ndarray:
    """W[d, k] = largeur (Hz) du recouvrement entre la bande HMD k et la décidécade d."""
    w = np.zeros((len(decidecades), len(lo)))
    for d, fc in enumerate(decidecades):
        a, b = fc / HALF, fc * HALF
        w[d] = np.clip(np.minimum(hi, b) - np.maximum(lo, a), 0, None)
    return w


def export_nrs(folder: Path, station: dict, day: str, output: Path) -> dict:
    stamp = day.replace('-', '')
    files = sorted(folder.glob(f'*_{stamp}_*MinRes_v3_v3.nc'))
    if len(files) != 1: raise ValueError(f'NRS {day} : un fichier HMD netCDF NCEI attendu, trouvé {files}')
    d = station['deployment']
    with h5py.File(files[0], 'r') as f:
        centres = f['frequency'][:].astype(float)
        psd = f['psd'][:].astype(float)
        flags = f['quality_flag'][:]
        effort = f['effort'][:]
        times = f['time'][:].astype(int)
        comment = f.attrs.get('comment', b'').decode() if isinstance(f.attrs.get('comment', b''), bytes) else str(f.attrs.get('comment'))
    if psd.shape != (len(times), len(centres)): raise ValueError('Axes temps/fréquence HMD non conformes')
    lo, hi = hmd_edges(centres)
    candidates = [10 ** (n / 10) for n in range(10, 44) if 10 ** (n / 10) * HALF <= hi[-1]]
    W = decidecade_matrix(lo, hi, candidates)
    rows = 0
    with output.open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS); writer.writeheader()
        for t, spectrum, flag, seconds in zip(times, psd, flags, effort):
            if seconds != 60: continue
            start = datetime.fromtimestamp(int(t), timezone.utc)
            if not (f'{day}T00:15:00' <= start.strftime('%Y-%m-%dT%H:%M:%S') < f'{day}T23:59:00'): continue
            linear = 10 ** (spectrum / 10)
            for k, fc in enumerate(candidates):
                contributing = W[k] > 0
                if not np.all(flag[contributing] == 1) or not np.all(np.isfinite(spectrum[contributing])): continue
                n = round(10 * math.log10(fc))
                nominal = NOMINAL[n % 10] * 10 ** (n // 10 - 1)
                writer.writerow({'station': d['station'], 'start': start.isoformat().replace('+00:00', 'Z'), 'end': datetime.fromtimestamp(int(t) + 60, timezone.utc).isoformat().replace('+00:00', 'Z'),
                                 'bandHz': int(nominal) if nominal == int(nominal) else nominal, 'centerHz': fc, 'lat': d['lat'], 'lon': d['lon'], 'receiverDepthM': d['receiverDepthM'],
                                 'observedDb': 10 * math.log10(float(W[k][contributing] @ linear[contributing])), 'quality': 'unreviewed'})
                rows += 1
    minutes = int(np.sum(effort == 60))
    return {'source': files[0].name, 'calibration': 'Calibration applied before processing (métadonnées NCEI) ; ' + comment, 'minutes': minutes,
            'missingMinutes': 1440 - minutes, 'exportedRows': rows, 'decidecadesHz': candidates}
