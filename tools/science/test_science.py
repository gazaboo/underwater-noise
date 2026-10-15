"""Scientific checks: analytic propagation, JOMOPANS benchmark, measurement export and matching.

Slow tests (RAM benchmark, several minutes) run only with VACARME_SLOW=1.
"""
import cmath
import csv
import json
import math
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
import h5py
import numpy as np
import ram
from ices import decidecade, export
from validate import evaluate


class PropagationTests(unittest.TestCase):
    def test_pressure_release_surface_image_solution(self):
        # Identical water/seabed fluids remove the bottom interface. The analytic
        # solution is a monopole plus its opposite-sign surface image, re 1 m.
        path = {'bathymetry': [[0, 100], [2000, 100]], 'water': {'depthsM': [0, 100], 'rangesM': [0], 'soundSpeedMs': [[1500], [1500]]},
                'sediment': {'soundSpeedMs': 1500, 'densityGcm3': 1, 'attenuationDbPerWavelength': 0}, 'receiverDepthM': 50}
        for f in ram.CENTERS:
            with self.subTest(f=f):
                direct, image = math.hypot(2000, 50 - 6), math.hypot(2000, 50 + 6)
                pressure = cmath.exp(2j * math.pi * f * direct / 1500) / direct - cmath.exp(2j * math.pi * f * image / 1500) / image
                expected = -20 * math.log10(abs(pressure)) + ram.thorp(f) * 2
                self.assertLess(abs(ram.transmission(path, f, 'receiver', 2) - expected), .3)

    def test_band_boundaries_and_integral_weights(self):
        for f in ram.CENTERS:
            samples = ram.quadrature(f)
            self.assertAlmostEqual(sum(s['widthHz'] for s in samples), f * (10 ** .05 - 10 ** -.05))
            self.assertTrue(all(f / 10 ** .05 < s['frequencyHz'] < f * 10 ** .05 for s in samples))

    def test_land_path_rejected(self):
        path = {'bathymetry': [[0, 100], [1000, 0]], 'water': {}, 'sediment': {}}
        with self.assertRaises(ValueError): ram.transmission(path, 63., 'receiver')

    @unittest.skipUnless(os.environ.get('VACARME_SLOW'), 'benchmark RAM lent : VACARME_SLOW=1')
    def test_jomopans_annex_e_benchmark(self):
        # de Jong et al. (2021), Guidelines for modelling ocean ambient noise, Annex E: uniform (case 1)
        # and upslope (case 2) waveguides, 63/125 Hz decidecades. Reference values are read from the
        # guideline tables (one decimal), the 1 dB tolerance covers that rounding plus model-to-model
        # spread; observed maximum on 15/10/2026: 0.59 dB. No parameter is fitted to these outputs.
        import benchmark
        report = benchmark.run()
        self.assertEqual(len(report['results']), 16)
        self.assertLess(report['maxAbsoluteErrorDb'], 1.0)


def write_ices(path: Path, starts: list[int], values: list[list[float]], frequencies=(63.096, 125.89), averaging=20):
    with h5py.File(path, 'w') as file:
        file['FileInformation/StationCode'] = np.array([b'TEST'])
        for key, value in [('AveragingTime', [averaging]), ('FrequencyUnit', [b'Hz']), ('MeasurementUnit', [b'SPL']), ('CalibrationProcedure', [b'TEST']), ('FrequencyIndex', list(frequencies))]:
            file[f'Metadata/{key}'] = np.array(value)
        iso = lambda t: f'2019-10-01 {t // 3600:02d}:{t // 60 % 60:02d}:{t % 60:02d}'.encode()
        file['Data/DateTime'] = np.array([iso(t) for t in starts])
        file['Data/LeqMeasurementsOfChannel1'] = np.array(values, dtype=float)


STATION = {'station': 'TEST', 'lat': 55, 'lon': 3, 'receiverDepthM': 50, 'timestampConvention': 'start', 'source': 'TEST metadata'}


class ExportTests(unittest.TestCase):
    def test_decidecade_labels(self):
        self.assertEqual(decidecade(63.096)[0], 63)
        self.assertEqual(decidecade(31.5)[0], 31.5)
        self.assertEqual(decidecade(1.2589e4)[0], 12500)
        with self.assertRaises(ValueError): decidecade(70)

    def test_contiguous_windows_energy_mean_and_gaps(self):
        # 20 s records from an arbitrary recorder phase (00:00:07), a 2 min gap, then one incomplete run.
        starts = [7 + 20 * i for i in range(6)] + [600 + 20 * i for i in range(4)]
        values = [[100 if i == 0 else 80, 90] for i in range(len(starts))]
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'in.h5', Path(directory) / 'levels.csv'
            write_ices(source, starts, values)
            self.assertEqual(export(source, STATION, output), 2 * 3)  # 2 windows (6 records) + 1 window (3 of 4) × 2 bands
            rows = list(csv.DictReader(output.open()))
            self.assertEqual(rows[0]['start'], '2019-10-01T00:00:07Z')
            self.assertEqual(rows[0]['end'], '2019-10-01T00:01:07Z')
            self.assertAlmostEqual(float(rows[0]['observedDb']), 10 * math.log10((10 ** 10 + 2 * 10 ** 8) / 3))
            self.assertEqual({r['quality'] for r in rows}, {'unreviewed'})
            meta = json.loads(output.with_suffix('.metadata.json').read_text())
            self.assertEqual(meta['discontinuities'], {'493': 1})

    def test_overlapping_series_require_explicit_segment(self):
        # Two copies of the same period, offset by 5 s, with different values: ambiguous.
        first = [20 * i for i in range(6)]; second = [5 + 20 * i for i in range(6)]
        values = [[90, 90]] * 6 + [[91, 90]] * 6
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'in.h5', Path(directory) / 'levels.csv'
            write_ices(source, first + second, values)
            with self.assertRaises(ValueError): export(source, STATION, output)
            self.assertEqual(export(source, STATION, output, segment=1), 2 * 2)
            self.assertEqual(json.loads(output.with_suffix('.metadata.json').read_text())['recordsOutsideSegment'], 6)

    def test_exact_duplicates_are_removed(self):
        starts = [20 * i for i in range(3)]
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'in.h5', Path(directory) / 'levels.csv'
            write_ices(source, starts + starts, [[90, 80]] * 6)
            self.assertEqual(export(source, STATION, output), 2)
            self.assertEqual(json.loads(output.with_suffix('.metadata.json').read_text())['exactDuplicatesRemoved'], 3)


class QualityTests(unittest.TestCase):
    def test_instrument_silence_detected_but_steady_real_sound_kept(self):
        from qc import dropouts
        rng = np.random.default_rng(1)
        starts = [f'2019-06-05T{h:02d}:{m:02d}:00Z' for h in range(2) for m in range(60)]
        matrix = 90 + rng.normal(0, 3, (120, 5))
        matrix[:, 0] = 100 + rng.normal(0, 0.1, 120)   # chœur stable et réel : distribution étroite, pas un silence
        matrix[70:90] = 55.0                            # spectre figé très bas : silence de l'instrument
        periods, floor = dropouts(starts, [20, 63, 125, 1000, 8000], matrix)
        self.assertEqual([(p['start'], p['end'], p['minutes']) for p in periods], [('2019-06-05T01:10:00Z', '2019-06-05T01:30:00Z', 20)])
        self.assertTrue(np.allclose(floor, 55))
        self.assertEqual(dropouts(starts[:60], [20], matrix[:60, :1])[0], [])

    def test_instrument_silence_never_bridges_recording_gaps(self):
        from qc import dropouts
        starts = [f'2019-06-05T00:{m:02d}:00Z' for m in range(40)]
        matrix = np.full((40, 2), 100.0)
        matrix[20:30] = 50.0
        # Deux suites de cinq minutes séparées par dix minutes absentes : aucune
        # n'atteint les dix minutes consécutives du critère 4a.
        starts[25:] = [f'2019-06-05T00:{m:02d}:00Z' for m in range(35, 50)]
        self.assertEqual(dropouts(starts, [63, 125], matrix)[0], [])

    def test_persistent_floor_requires_stability_and_matching_spectrum(self):
        from qc import persistent_floor
        floor = np.array([55., 60., 65.])
        stable = np.tile(floor + .2, (100, 1))
        self.assertTrue(persistent_floor(stable, floor)['detected'])
        self.assertFalse(persistent_floor(stable + 10, floor)['detected'])
        varying = stable.copy(); varying[:30] += 5
        self.assertFalse(persistent_floor(varying, floor)['detected'])

    def test_spectrogram_leaves_recording_gaps_blank(self):
        from qc import spectrogram_cells
        edges, cells = spectrogram_cells([0., 1 / 60, 1.], np.array([[80.], [90.], [100.]]))
        np.testing.assert_allclose(edges, [0., 1 / 60, 2 / 60, 1., 1 + 1 / 60])
        self.assertTrue(np.isnan(cells[2, 0]))
        np.testing.assert_allclose(cells[[0, 1, 3], 0], [80, 90, 100])


class NoaaTests(unittest.TestCase):
    def test_hmd_to_decidecade_is_exact_for_white_noise(self):
        from noaa import decidecade_matrix, hmd_edges
        # HMD layout: 0.1 Hz (DC band), 1 Hz bands to 440 Hz, then millidecades to 2.5 kHz.
        linear = np.r_[0.1, np.arange(1, 441, dtype=float)]
        milli = 10 ** (np.arange(2644.5, 3398, 1.0) / 1000)
        centres = np.r_[linear, milli]
        lo, hi = hmd_edges(centres)
        self.assertTrue(np.allclose(lo[1:], hi[:-1]))
        fc = [10 ** 1.8, 10 ** 2.6, 10 ** 3.0]  # 63 Hz (linear part), ~400 Hz (junction), 1 kHz (millidecades)
        W = decidecade_matrix(lo, hi, fc)
        for row, f in zip(W, fc):
            self.assertAlmostEqual(10 * math.log10(row.sum()), 10 * math.log10(f * (10 ** .05 - 10 ** -.05)), places=6)


class CalibrationTests(unittest.TestCase):
    # Valeurs de lossRateDbPerKm (shared/src/acoustics/propagation.ts), générées le 15/10/2026 :
    # (perte par rebond, célérité du sédiment, perte sous coupure, profondeur m, fréquence Hz, dB/km).
    TS_CASES = [[0.09, 1700, 5, 5, 20, 6.5899912115], [0.09, 1700, 5, 5, 63.1, 6.5904228909], [0.09, 1700, 5, 5, 223.6, 1.5957309137], [0.09, 1700, 5, 5, 3162, 1.7997279546], [0.09, 1700, 5, 20, 20, 5.3997840917], [0.09, 1700, 5, 20, 63.1, 0.4002157711], [0.09, 1700, 5, 20, 223.6, 0.4055237939], [0.09, 1700, 5, 20, 3162, 0.6095208349], [0.09, 1700, 5, 60, 20, 0.1352936206], [0.09, 1700, 5, 60, 63.1, 0.1357253001], [0.09, 1700, 5, 60, 223.6, 0.1410333228], [0.09, 1700, 5, 60, 3162, 0.3450303638], [0.09, 1700, 5, 250, 20, 0.0268525275], [0.09, 1700, 5, 250, 63.1, 0.0272842069], [0.09, 1700, 5, 250, 223.6, 0.0325922297], [0.09, 1700, 5, 250, 3162, 0.2365892707], [0.09, 1700, 5, 3000, 20, 0.0030483851], [0.09, 1700, 5, 3000, 63.1, 0.0034800645], [0.09, 1700, 5, 3000, 223.6, 0.0087880873], [0.09, 1700, 5, 3000, 3162, 0.2127851283], [0.5, 1600, 12, 5, 20, 20.8193974205], [0.5, 1600, 12, 5, 63.1, 20.8198291], [0.5, 1600, 12, 5, 223.6, 13.7419120465], [0.5, 1600, 12, 5, 3162, 9.0291341637], [0.5, 1600, 12, 20, 20, 14.2071356439], [0.5, 1600, 12, 20, 63.1, 3.8248053304], [0.5, 1600, 12, 20, 223.6, 2.2128753461], [0.5, 1600, 12, 20, 3162, 2.4168723871], [0.5, 1600, 12, 60, 20, 3.6785394421], [0.5, 1600, 12, 60, 63.1, 0.7381758175], [0.5, 1600, 12, 60, 223.6, 0.7434838402], [0.5, 1600, 12, 60, 3162, 0.9474808812], [0.5, 1600, 12, 250, 20, 0.1352936206], [0.5, 1600, 12, 250, 63.1, 0.1357253001], [0.5, 1600, 12, 250, 223.6, 0.1410333228], [0.5, 1600, 12, 250, 3162, 0.3450303638], [0.5, 1600, 12, 3000, 20, 0.0030483851], [0.5, 1600, 12, 3000, 63.1, 0.0034800645], [0.5, 1600, 12, 3000, 223.6, 0.0087880873], [0.5, 1600, 12, 3000, 3162, 0.2127851283]]

    def test_loss_rate_matches_typescript(self):
        from calibrate import loss_rate
        for bounce, sediment, cutoff, depth, f, expected in self.TS_CASES:
            p = {'bottomBounceLossDb': bounce, 'sedimentSoundSpeed': sediment, 'cutoffLossDbPerKm': cutoff, 'grazingAngleDeg': 10, 'extraLossDbPerKm': 0}
            self.assertAlmostEqual(float(loss_rate(np.array(depth, dtype=float), f, p)), expected, places=8)

    def test_calibration_rejects_holdout_and_decimated_geometry(self):
        from calibrate import Case
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 's-20190101-world-law.json').write_text('{}')
            station = folder / 's-20190101-station.json'
            station.write_text(json.dumps({'split': 'holdout', 'qc': {'status': 'reviewed'}}))
            with self.assertRaisesRegex(ValueError, 'seules stations de calage'):
                Case(folder, 's', '2019-01-01')
            station.write_text(json.dumps({'split': 'calibration', 'qc': {'status': 'reviewed'}}))
            (folder / 's-20190101-observations.csv').write_text('start,end\n')
            (folder / 's-20190101-geometry.bin.json').write_text('{"dumpEvery":6}')
            with self.assertRaisesRegex(ValueError, 'sous-échantillonnée'):
                Case(folder, 's', '2019-01-01')

    def test_optimizer_keeps_bounds_and_passes_left_out_station(self):
        from calibrate import BOUNDS, optimize
        reference = {'bottomBounceLossDb': .09, 'sedimentSoundSpeed': 1700., 'cutoffLossDbPerKm': 5.}
        calls = []
        def objective(params, factor, exclude):
            calls.append(exclude)
            for name, (lo, hi) in BOUNDS.items(): self.assertTrue(lo <= params[name] <= hi)
            return ((params['sedimentSoundSpeed'] - 1800) / 100) ** 2 + (factor - 2) ** 2, []
        value, params, factor = optimize(reference, 3, objective, 'withheld')
        self.assertEqual(set(calls), {'withheld'})
        self.assertLess(value, .01)
        self.assertEqual(factor, 2.)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.prediction = {
            'model': 'world-law', 'profileId': 'test', 'parameters': {'physicsSource': 'test'},
            'station': {'station': 'TEST', 'lat': 55, 'lon': 3, 'receiverDepthM': 50},
            'bands': [{'id': 'd63', 'kind': 'decidecade', 'fMin': 56.2, 'fMax': 70.8, 'decidecadesHz': [63]},
                      {'id': 'pair', 'kind': 'broad', 'fMin': 56.2, 'fMax': 141, 'decidecadesHz': [63, 125]}],
            'windows': [{'start': '2019-10-01T00:00:00Z', 'end': '2019-10-01T00:01:00Z', 'status': 'ok', 'shipsDb': [100, 100], 'ambientDb': [80, 80]}]}
        self.station = {'id': 'test', 'split': 'holdout', 'deployment': {'station': 'TEST'},
                        'qc': {'status': 'reviewed', 'excludeBands': [], 'excludePeriods': [], 'flags': []}}
        row = {'station': 'TEST', 'start': '2019-10-01T00:00:00Z', 'end': '2019-10-01T00:01:00Z', 'lat': '55', 'lon': '3', 'receiverDepthM': '50', 'quality': 'unreviewed'}
        self.rows = [{**row, 'bandHz': '63', 'observedDb': '100'}, {**row, 'bandHz': '125', 'observedDb': '100'}]

    def test_energy_sum_and_metric(self):
        report = evaluate(self.prediction, self.rows, self.station)
        self.assertEqual(report['status'], 'evaluated')
        d63, pair = report['results']
        self.assertAlmostEqual(d63['biasDb'], 10 * math.log10(1.01))
        # Broad band: two 100 dB decidecades sum to 103.01 dB.
        self.assertAlmostEqual(pair['biasDb'], 10 * math.log10(1.01) + 100 - 10 * math.log10(2 * 10 ** 10))
        self.assertEqual(d63['byRegime']['ships']['count'], 1)

    def test_quality_comes_from_station_review_not_rows(self):
        draft = deepcopy(self.station); draft['qc']['status'] = 'draft'
        rows = [{**r, 'quality': 'accepted'} for r in self.rows]
        self.assertEqual(evaluate(self.prediction, rows, draft)['status'], 'qc-not-reviewed')
        self.assertEqual(evaluate(self.prediction, rows, draft, exploratory=True)['status'], 'exploratory')

    def test_qc_exclusions_and_incomplete_bands(self):
        excluded = deepcopy(self.station); excluded['qc']['excludeBands'] = [{'bandHz': 125}]
        self.assertEqual([r['band'] for r in evaluate(self.prediction, self.rows, excluded)['results']], ['d63'])
        report = evaluate(self.prediction, self.rows[:1], self.station)
        self.assertEqual([r['band'] for r in report['results']], ['d63'])
        self.assertEqual(report['skipped']['incomplete-band-pair'], 1)
        period = deepcopy(self.station); period['qc']['excludePeriods'] = [{'start': '2019-10-01T00:00:30Z', 'end': '2019-10-01T00:05:00Z'}]
        self.assertEqual(evaluate(self.prediction, self.rows, period)['status'], 'no-compatible-observations')

    def test_incompatible_receiver_is_not_compared(self):
        for changes in [{'receiverDepthM': '40'}, {'lon': '3.001'}, {'end': '2019-10-01T00:00:20Z'}]:
            with self.subTest(changes=changes):
                self.assertEqual(evaluate(self.prediction, [{**r, **changes} for r in self.rows], self.station)['results'], [])
        with self.assertRaises(ValueError): evaluate(self.prediction, self.rows + self.rows, self.station)

    def test_zero_ship_energy_is_ambient_not_missing(self):
        prediction = deepcopy(self.prediction); prediction['windows'][0]['shipsDb'] = ['zero', 'zero']
        report = evaluate(prediction, self.rows, self.station)
        self.assertAlmostEqual(report['results'][0]['biasDb'], -20)
        self.assertIn('ambient', report['results'][0]['byRegime'])


if __name__ == '__main__': unittest.main()
