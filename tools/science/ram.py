"""RAM v1.5 through PyRAM 1.0.1 : référence de propagation hors ligne (jamais affichée).

Les trajets décrivent explicitement bathymétrie, profil de célérité et sédiment ; aucun paramètre
n'est déduit de l'affichage. Utilisé par station_case.py (courbes au récepteur) et benchmark.py.
"""
from __future__ import annotations

import math

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


def band_gain(samples: list[dict], losses) -> float:
    """Band energy gain (Hz-weighted quadrature) for one set of per-frequency losses (dB)."""
    return sum(s['widthHz'] * 10 ** (-loss / 10) for s, loss in zip(samples, losses))


# Pertes au-delà desquelles un navire ne peut plus contribuer : niveau source décidécade J-E maximal
# (~190 dB re 1 µPa·m) moins le plus faible fond mesuré (~70 dB re 1 µPa) [C]. La convergence n'est
# exigée qu'en deçà ; plus loin, l'énergie reçue est négligeable devant toute mesure.
RELEVANT_LOSS_DB = 120


def receiver_curves(path: dict, max_range_m: float, step_m: float = 100, count: int = 10, tolerance_db: float = 1, max_refinement: int = 16) -> dict:
    """Range-dependent losses at a point receiver for both decidecades, with adaptive grid refinement.

    Convergence compares the band-integrated energy (not single frequencies, whose interference
    fringes move with the grid) between successive grids whose steps are halved, at every range where
    the loss stays below RELEVANT_LOSS_DB. Refinement doubles until the difference is <= tolerance_db.
    """
    query = np.arange(500, max_range_m + 1, step_m, dtype=float)
    bands, report = [], []
    for center in CENTERS:
        samples = quadrature(center, count)
        widths = np.array([s['widthHz'] for s in samples])[:, None]
        def energies(refinement):
            out = []
            for sample in samples:
                r, loss = transmission(path, sample['frequencyHz'], 'receiver', refinement, return_curve=True)
                out.append(np.interp(query, r, 10 ** (-loss / 10)))
            return np.array(out)
        refinement, previous = 1, energies(1)
        history = []
        while True:
            current = energies(refinement * 2)
            band_fine = (widths * current).sum(0) / widths.sum()
            relevant = (-10 * np.log10(band_fine) <= RELEVANT_LOSS_DB) & (query >= 1000)
            diff = np.abs(10 * np.log10((widths * current).sum(0) / (widths * previous).sum(0)))
            worst = float(diff[relevant].max()) if relevant.any() else 0.0
            history.append({'refinement': refinement * 2, 'maxRelevantBandDifferenceDb': worst})
            refinement *= 2
            if worst <= tolerance_db or refinement >= max_refinement: break
            previous = current
        for sample, energy in zip(samples, current):
            sample.update({'rangesM': query.tolist(), 'lossDb': (-10 * np.log10(energy)).tolist()})
        report.append({'centerHz': center, 'refinement': refinement, 'converged': history[-1]['maxRelevantBandDifferenceDb'] <= tolerance_db,
                       'relevantMaxRangeM': float(query[relevant].max()) if relevant.any() else None, 'history': history})
        bands.append(samples)
    return {'bands': bands, 'convergence': report}
