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
