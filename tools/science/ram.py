"""RAM v1.5 through PyRAM 1.0.1. No parameters are inferred from the display.

Input paths explicitly describe bathymetry, water SSP and sediment properties.
Grid cells without a path remain missing; no empirical loss is substituted.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path

import numpy as np

# PyRAM 1.0.1 uses this removed dtype alias. This does not alter its arithmetic.
np.complex = np.complex128
np.Inf = np.inf
from pyram.PyRAM import PyRAM
from pyram.outpt import outpt
from pyram.solve import solve
from pyram.matrc import matrc

CENTERS = [10 ** 1.8, 10 ** 2.1]


def quadrature(center: float, count: int = 5) -> list[dict]:
    """Midpoint quadrature, exact base-10 decidecade boundaries and Hz weights."""
    edges = np.geomspace(center / 10 ** .05, center * 10 ** .05, count + 1)
    return [{"frequencyHz": float(math.sqrt(a * b)), "widthHz": float(b - a)} for a, b in zip(edges[:-1], edges[1:])]


def thorp(f: float) -> float:
    f2 = (f / 1000) ** 2
    return .11 * f2 / (1 + f2) + 44 * f2 / (4100 + f2) + 2.75e-4 * f2 + .003


def transmission(path: dict, frequency: float, depth_mode: str, refinement: int = 1, *, source_depth_m: float = 6, absorption='thorp', return_curve=False):
    bathy = np.array(path["bathymetry"], dtype=float)
    ssp = path["water"]
    sediment = path["sediment"]
    distance = float(bathy[-1, 0])
    depth = float(bathy[-1, 1])
    zr = float(path.get("receiverDepthM", depth / 2))
    if bathy.ndim != 2 or bathy.shape[1] != 2 or bathy[0, 0] != 0 or distance < 500 or np.any(np.diff(bathy[:, 0]) <= 0):
        raise ValueError('Bathymétrie : distances croissantes de 0 à >= 500 m requises.')
    if np.any(bathy[:, 1] <= max(6, source_depth_m)) or not 0 < zr < depth:
        raise ValueError('Source à 6 m et récepteur doivent être dans l’eau ; aucun trajet terrestre accepté.')
    # RAM fluids: density in g/cm³, attenuation in dB/wavelength.
    if sediment["densityGcm3"] <= 0 or sediment["soundSpeedMs"] <= 0 or sediment["attenuationDbPerWavelength"] < 0:
        raise ValueError('Propriétés du sédiment invalides.')
    water_depths = np.array(ssp["depthsM"], dtype=float)
    cw = np.array(ssp["soundSpeedMs"], dtype=float)
    ranges = np.array(ssp["rangesM"], dtype=float)
    if water_depths[0] != 0 or np.any(np.diff(water_depths) <= 0) or ranges[0] != 0 or np.any(np.diff(ranges) <= 0) or np.any(cw <= 0):
        raise ValueError('Profils de célérité invalides.')
    wavelength = 1500 / frequency
    dr = distance / math.ceil(distance / (min(50, wavelength * 2) / refinement))
    dz = min(1, wavelength / 20) / refinement
    model = PyRAM(float(frequency), float(source_depth_m), zr, water_depths, ranges, cw,
                  np.array([0., float(water_depths.max())]), np.array([0.]),
                  np.full((2, 1), sediment["soundSpeedMs"], dtype=float),
                  np.full((2, 1), sediment["densityGcm3"], dtype=float),
                  np.full((2, 1), sediment["attenuationDbPerWavelength"], dtype=float), bathy,
                  dr=dr, dz=dz, rmax=distance + dr * .01, zmplt=depth, ndr=1, ndz=1, lyrw=80)
    model.setup()
    # 1.0.1 leaves the self-starter Padé coefficients active. Upstream master
    # resets them before marching (PyRAM.py setup: self.epade()). Without this
    # correction convergence alone can hide a large absolute level error.
    model.epade()
    matrc(model.k0, model._dz, model.iz, model.iz, model.nz, model._np,
          model.f1, model.f2, model.f3, model.ksq, model.alpw, model.alpb,
          model.ksqw, model.ksqb, model.rhob, model.r1, model.r2, model.r3,
          model.s1, model.s2, model.s3, model.pd1, model.pd2)
    # Exact integer stepping, as in upstream master: avoids 1.0.1's floating while
    # loop writing beyond its allocated arrays. Output points remain unchanged.
    for i in range(1, model.vr.size):
        model.updat()
        solve(model.u, model.v, model.s1, model.s2, model.s3, model.r1, model.r2, model.r3, model.iz, model.nz, model._np)
        model.r = (i + 1) * dr
        model.mdr, model.tlc = outpt(model.r, model.mdr, model._ndr, model._ndz, model.tlc, model.f3, model.u, model.dir, model.ir, model.tll, model.tlg)
    if absorption == 'ainslie-mccolm-benchmark':
        f = frequency / 1000
        alpha = 20 / math.log(10) * (.014 * f*f / (f*f + 1.15**2) + 5.58 * f*f / (f*f + 75.6**2) + 3.90e-5 * f*f)
    else: alpha = thorp(frequency)
    if return_curve:
        if depth_mode != 'receiver': raise ValueError('Courbe disponible pour récepteur ponctuel uniquement')
        return model.vr.copy(), model.tll + alpha * model.vr / 1000
    if depth_mode == 'receiver':
        loss = float(model.tll[-1])
    else:
        # 1.0.1 outpt's row j samples grid index j, not the advertised vz[j].
        z = np.arange(model.tlg.shape[0]) * dz
        energy = 10 ** (-model.tlg[:, -1] / 10)
        # Include pressure-release surface and interpolate the last partial cell.
        ze = np.append(z, depth)
        ee = np.append(energy, energy[-1])
        integral = float(np.trapezoid(ee, ze)) / depth
        loss = -10 * math.log10(integral)
    loss += alpha * distance / 1000
    if not math.isfinite(loss):
        raise ValueError('Résultat RAM non fini.')
    return loss


def build(environment: dict) -> dict:
    if importlib.metadata.version('pyram') != '1.0.1':
        raise ValueError('Version PyRAM 1.0.1 requise pour la reproductibilité.')
    mode = environment['depthMode']
    if mode not in ['receiver', 'depth-mean']:
        raise ValueError('depthMode invalide')
    errors = []
    paths = []
    source_ids = {s['id']: s for s in environment['sources']}
    grid = environment['grid']
    if len(source_ids) != len(environment['sources']): raise ValueError('Identifiants sources dupliqués')
    for path in environment['paths']:
        cell = path['cellIndex']
        if cell < 0 or cell >= grid['width'] * grid['height']: raise ValueError('Cellule réceptrice hors grille')
        source = source_ids[path['sourceId']]
        lat = grid['north'] - (cell // grid['width'] + .5) * grid['deltaLat']
        lon = grid['west'] + (cell % grid['width'] + .5) * grid['deltaLon']
        phi1, phi2 = math.radians(source['lat']), math.radians(lat)
        a = math.sin((phi2-phi1)/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(math.radians(lon-source['lon'])/2)**2
        distance = 2 * 6371000 * math.asin(min(1, math.sqrt(a)))
        if abs(path['bathymetry'][-1][0] - distance) > max(5, distance * .01): raise ValueError('La longueur du trajet ne correspond pas aux coordonnées source/récepteur (tolérance 1 % ou 5 m).')
        bands = []
        for center in CENTERS:
            samples = quadrature(center)
            for sample in samples:
                f = sample['frequencyHz']
                coarse = transmission(path, f, mode, 1)
                fine = transmission(path, f, mode, 2)
                errors.append(abs(fine - coarse))
                sample['lossDb'] = fine
            # Frequency convergence matters in a waveguide with interference.
            refined = quadrature(center, 10)
            for sample in refined:
                sample['lossDb'] = transmission(path, sample['frequencyHz'], mode, 2)
            coarse_gain = sum(s['widthHz'] * 10 ** (-s['lossDb'] / 10) for s in samples)
            fine_gain = sum(s['widthHz'] * 10 ** (-s['lossDb'] / 10) for s in refined)
            errors.append(abs(10 * math.log10(fine_gain / coarse_gain)))
            bands.append(refined)
        paths.append({'sourceId': path['sourceId'], 'cellIndex': path['cellIndex'], 'bands': bands,
                      'receiverDepthM': path.get('receiverDepthM') if mode == 'receiver' else None})
    return {'schemaVersion': 1, 'method': 'RAM-PyRAM-1.0.1', 'frequenciesHz': CENTERS,
            'sourceDepthM': 6, 'depthMode': mode, 'grid': environment['grid'], 'sources': environment['sources'],
            'paths': paths, 'validFrom': environment['validFrom'], 'validTo': environment['validTo'],
            'maxSourceOffsetM': environment['maxSourceOffsetM'],
            'provenance': {'environment': environment['provenance']['environment'], 'assumptions': environment['provenance']['assumptions'] + [
                'PyRAM 1.0.1 avec corrections amont du démarrage et du pas entier ; couche absorbante 80 longueurs d’onde.',
                'Propagation 2D par trajet ; fond fluide homogène sur chaque trajet ; absorption de Thorp ajoutée.',
                'Convergence : pas distance/profondeur divisés par deux, quadrature fréquentielle 5 puis 10 points (spectre plat pour ce dernier contrôle).']},
            'environmentHash': hashlib.sha256(json.dumps(environment, sort_keys=True).encode()).hexdigest(),
            'numerical': {'maxDifferenceDb': max(errors) if errors else None, 'benchmark': None}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Pré-calcul RAM 63/125 Hz et contrôle de convergence (pas divisés par deux).')
    parser.add_argument('environment', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = build(json.loads(args.environment.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, allow_nan=False, indent=2) + '\n')
    print(f"{len(result['paths'])} trajets ; écart de convergence max {result['numerical']['maxDifferenceDb']:.2f} dB. Validation observationnelle non réalisée.")
