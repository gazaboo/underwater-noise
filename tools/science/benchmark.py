"""JOMOPANS Annex E benchmark, 63 and 125 Hz; no fitting to reference outputs."""
import argparse
import json
import math
from pathlib import Path
import ram

REFERENCES = {
    'case1': [[121.9, 109.7, 102.5, 74.9], [119.3, 107.3, 100.3, 80.6]],
    'case2': [[119.7, 109.6, 94.9, 30.7], [117.4, 107.0, 92.9, 58.2]],
}


def run():
    results = []
    for case in REFERENCES:
      for band, f in enumerate(ram.CENTERS):
        for i, distance in enumerate([1000, 5000, 10000, 50000]):
            bathy = [[0,50],[distance,50]] if case == 'case1' else [[0,100],[distance,100]] if distance <= 5000 else [[0,100],[5000,100],[7000,30],[distance,30]]
            path = {'bathymetry': bathy, 'receiverDepthM': 25,
                    'water': {'depthsM': [0, 50 if case == 'case1' else 100], 'rangesM': [0], 'soundSpeedMs': [[1500], [1500]]},
                    'sediment': {'soundSpeedMs': 1700, 'densityGcm3': 2, 'attenuationDbPerWavelength': .5}}
            loss = ram.transmission(path, f, 'depth-mean', 2, source_depth_m=5, absorption='ainslie-mccolm-benchmark')
            source = 230 - 35.94 * math.log10(max(f,30)) + 9.17 * math.log10(1 + (max(f,30)/340)**2) + 10 * math.log10(.231*f)
            predicted = source - loss; expected = REFERENCES[case][band][i]
            results.append({'case': case, 'bandHz': [63,125][band], 'rangeM': distance, 'referenceDb': expected, 'predictedDb': predicted, 'errorDb': predicted-expected})
    return {'source': 'de Jong et al. (2021), Guidelines for modelling ocean ambient noise, §4.1.2 and Annex E',
            'url': 'https://publications.tno.nl/publication/34640581/ebunFp/jong-2021-guidelines.pdf',
            'scope': 'JOMOPANS uniform and upslope waveguides, 63/125 Hz, source 5 m. Other bands not covered.',
            'maxAbsoluteErrorDb': max(abs(r['errorDb']) for r in results), 'results': results}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('output',type=Path); args=parser.parse_args()
    report=run(); args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
