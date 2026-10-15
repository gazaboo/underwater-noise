"""Exécute une phase du protocole (docs/VALIDATION_PROTOCOLE.md) : calage ou test.

  --phase calibration : stations de calage seulement ; les stations de test ne sont pas calculées.
  --phase test        : stations de test (dont NRS11) ; à lancer une seule fois, après le calage.
Les fiches doivent avoir un contrôle qualité revu (statut `reviewed`) : aucun rapport exploratoire ici.
Les replays AIS de chaque jour sont construits une fois (replay.py) et partagés entre stations.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path
from replay import dma_to_replay, marinecadastre_to_replay

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ROLES = {'calibration': {'calibration'}, 'test': {'holdout', 'holdout-deep'}}


def replay_for(cache: Path, kind: str, day: str) -> Path:
    source = cache / 'ais' / f'{kind}-{day}.csv.gz'
    target = cache / 'ais' / f'{kind}-{day}.replay.ndjson.gz'
    if not Path(f'{target}.json').exists():
        print(json.dumps((dma_to_replay if kind == 'dma' else marinecadastre_to_replay)(source, target)), flush=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--phase', choices=ROLES, required=True)
    parser.add_argument('--protocol', type=Path, default=HERE / 'protocol-v1.json')
    parser.add_argument('--cache', type=Path, default=ROOT / 'tools/.cache/science')
    parser.add_argument('--out', type=Path, default=ROOT / 'tools/.cache/science/runs')
    parser.add_argument('--physics', type=Path, help='profil calé (JSON) à évaluer en plus du profil de référence')
    parser.add_argument('--station', action='append')
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    out = args.out / f'v{protocol["version"]}-{args.phase}'
    for spec in protocol['stations']:
        if spec['role'] not in ROLES[args.phase] or (args.station and spec['id'] not in args.station): continue
        fiche = HERE / 'stations' / f"{spec['id']}.json"
        if json.loads(fiche.read_text())['qc']['status'] != 'reviewed':
            sys.exit(f"{spec['id']} : contrôle qualité non revu, phase {args.phase} refusée.")
        kind = 'mc' if 'nrs' in spec else 'dma'
        for day in sorted(spec['days']):
            if (out / f"{spec['id']}-{day.replace('-', '')}-summary.json").exists(): continue
            replay = replay_for(args.cache, kind, day)
            end = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
            command = [sys.executable, str(HERE / 'station_case.py'), str(fiche), '--replay', str(replay), '--start', f'{day}T{protocol["windowStartUtc"]}:00Z',
                       '--end', f'{end}T00:00:00Z', '--out', str(out), '--radius-km', str(protocol['radiusKm']), '--cache', str(args.cache)]
            if args.physics: command += ['--physics', str(args.physics)]
            print(' '.join(command), flush=True)
            subprocess.run(command, check=True)


if __name__ == '__main__': main()
