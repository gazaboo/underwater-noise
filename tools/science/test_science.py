"""Scientific checks: analytic propagation and independent observation matching."""
import cmath
import math
import unittest
from copy import deepcopy
import tempfile
import csv
from pathlib import Path
import h5py
import numpy as np
import ram
from validate import evaluate
from ices import export


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


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.data = {'depthMode': 'receiver', 'grid': {'west': 2.99, 'north': 55.01, 'deltaLon': .02, 'deltaLat': .02, 'width': 1, 'height': 1},
                     'frames': [{'start': '2019-10-01T00:00:00Z', 'end': '2019-10-01T00:01:00Z', 'cells': [{'shipsDb': [100, 90], 'ambientDb': [80, 70], 'receiverDepthM': 50}]}]}
        self.row = {'station': 'TEST', 'start': self.data['frames'][0]['start'], 'end': self.data['frames'][0]['end'], 'bandHz': '63',
                    'lat': '55', 'lon': '3', 'receiverDepthM': '50', 'observedDb': '100', 'split': 'holdout', 'quality': 'accepted'}

    def test_report_is_independent_and_uses_correct_metric(self):
        report = evaluate(self.data, [self.row])
        self.assertEqual(report['status'], 'evaluated-on-holdout')
        self.assertAlmostEqual(report['results'][0]['biasDb'], 10 * math.log10(1.01))
        calibration = {**self.row, 'split': 'calibration'}
        self.assertEqual(evaluate(self.data, [calibration])['status'], 'no-compatible-observations')

    def test_incompatible_receiver_is_not_compared(self):
        for changes in [{'receiverDepthM': '40'}, {'lon': '3.001'}, {'end': '2019-10-01T00:00:01Z'}, {'quality': 'rejected'}]:
            with self.subTest(changes=changes):
                self.assertEqual(evaluate(self.data, [{**self.row, **changes}])['results'], [])
        average = deepcopy(self.data); average['depthMode'] = 'depth-mean'
        with self.assertRaises(ValueError): evaluate(average, [self.row])
        with self.assertRaises(ValueError): evaluate(self.data, [self.row, self.row])


    def test_ices_minute_energy_export_keeps_quality_unreviewed(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'input.h5', Path(directory) / 'levels.csv'
            with h5py.File(source, 'w') as file:
                file['FileInformation/StationCode'] = np.array([b'TEST'])
                for key, value in [('AveragingTime', [1]), ('FrequencyUnit', [b'Hz']), ('MeasurementUnit', [b'SPL']), ('CalibrationProcedure', [b'TEST']), ('FrequencyIndex', ram.CENTERS)]:
                    file[f'Metadata/{key}'] = np.array(value)
                file['Data/DateTime'] = np.array([f'2019-10-01T00:00:{i:02d}Z'.encode() for i in range(60)])
                file['Data/LeqMeasurementsOfChannel1'] = np.array([[100 if i < 30 else 80, 90] for i in range(60)])
            station = {'station': 'TEST', 'lat': 55, 'lon': 3, 'receiverDepthM': 50, 'timestampConvention': 'start', 'source': 'TEST metadata'}
            self.assertEqual(export(source, station, output), 2)
            with output.open() as file: rows = list(csv.DictReader(file))
            self.assertAlmostEqual(float(rows[0]['observedDb']), 10 * math.log10((10 ** 10 + 10 ** 8) / 2))
            self.assertEqual(rows[0]['quality'], 'unreviewed')
            self.assertEqual(evaluate(self.data, rows)['results'], [])


if __name__ == '__main__': unittest.main()
