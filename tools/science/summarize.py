"""Publie les résultats figés du protocole, sans prédiction ni ajustement.

Refuse un test incomplet. Reprend tous les rapports, les exclusions et les séries
appariées ; les percentiles sur plusieurs jours sont calculés sur les minutes
concaténées, jamais en moyennant des percentiles journaliers. Le résumé de l'app
utilise le vent de scénario du profil effectivement actif, pas celui d'ERA5.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import shutil
from collections import defaultdict
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from validate import pair, stats, total_db

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VARIANTS = ['world-law', 'world-law-wind5', 'world-law-calibrated', 'world-law-calibrated-wind5', 'ambient-only']
LABELS = {'world-law': 'v1 / ERA5', 'world-law-wind5': 'v1 / vent de scénario',
          'world-law-calibrated': 'v2 / ERA5', 'world-law-calibrated-wind5': 'v2 / vent de scénario',
          'ambient-only': 'fond seul / ERA5'}
PRIMARY = {'d125', 'mid', 'high'}
BANDS = ['d63', 'd125', 'low', 'mid', 'high']
BAND_LABELS = {'d63': '63 Hz', 'd125': '125 Hz', 'low': '10–40 Hz', 'mid': '100–500 Hz', 'high': '1–10 kHz'}


def read(path):
    return json.loads(path.read_text())


def numeric_range(values):
    a = np.array(values, dtype=float)
    if not len(a) or not np.isfinite(a).all(): raise ValueError('Une série finie et non vide est requise')
    return {'min': float(a.min()), 'median': float(np.median(a)), 'max': float(a.max())}


def criterion(rows):
    values = [r['diffL50Db'] for r in rows if r['band'] in PRIMARY]
    return {'comparisons': len(values), 'within3Db': sum(abs(x) <= 3 for x in values),
            'within3DbFraction': sum(abs(x) <= 3 for x in values) / len(values) if values else None}


def published_summary(profile, protocol, specs, records, generated):
    variant = {'north-sea-reference-v1': 'world-law-wind5', 'north-sea-reference-v2': 'world-law-calibrated-wind5'}[profile]
    regions = []
    for spec in specs:
        sid = spec['id']
        selected = [r for r in records if r['station'] == sid and r['variant'] == variant]
        if not selected: continue
        bands = []
        for band in BANDS:
            rows = [r for r in selected if r['band'] == band]
            if not rows: continue
            bands.append({'band': band, 'fMinHz': rows[0]['fMinHz'], 'fMaxHz': rows[0]['fMaxHz'],
                          'comparisons': len(rows), 'diffL50Db': numeric_range([r['diffL50Db'] for r in rows]),
                          'within3DbFraction': sum(abs(r['diffL50Db']) <= 3 for r in rows) / len(rows)})
        station = read(HERE / 'stations' / f'{sid}.json')
        lat, lon = station['deployment']['lat'], station['deployment']['lon']
        # Emprise d'interaction [A], pas une distance de validité acoustique.
        half = .02
        regions.append({'id': sid, 'label': station['name'], 'regime': 'deep' if spec['role'] == 'holdout-deep' else 'shallow',
                        'bounds': {'west': lon - half, 'south': lat - half, 'east': lon + half, 'north': lat + half},
                        'stations': [sid], 'days': len({r['day'] for r in selected}), 'bands': bands,
                        'statement': 'Écarts [C] aux jours et au point de cet hydrophone, vent de scénario 5 m/s [E]. '
                                     + 'Jours évalués : ' + ', '.join(sorted({r['day'] for r in selected})) + '. '
                                     +
                                     'Repère géographique ±0,02° [A], sans validation autour du point. '
                                     'Loi au point exact ; écart supplémentaire du rendu sur grille non quantifié ici. '
                                     'Aucune précision validée pour les autres périodes, le trafic synthétique ou les portées des cétacés.'})
    return {'schemaVersion': 1, 'profileId': profile, 'protocol': f"{protocol['document']} v{protocol['version']} (§8 inclus)",
            'generated': generated, 'numberStatus': '[C] : écarts et dénombrements ; coordonnées [S], emprises de repérage [A].',
            'variant': variant, 'regions': regions}


def gap_line(times, values):
    """N'interpole pas les pauses d'acquisition dans les figures temporelles."""
    x, y = [], []
    for i, (t, value) in enumerate(zip(times, values)):
        if i and t - times[i - 1] > 1.01 / 60: x.append(np.nan); y.append(np.nan)
        x.append(t); y.append(value)
    return x, y


def diagnostics(prediction, matched):
    indices = sorted({i for pairs in matched.values() for i, _ in pairs})
    windows = [prediction['windows'][i] for i in indices]
    inside = sum(w.get('diagnostics', {}).get('inRadius', 0) for w in windows)
    blocked = sum(w.get('diagnostics', {}).get('blockedByLand', 0) for w in windows)
    nearest = [w['diagnostics']['nearestM'] for w in windows if w.get('diagnostics', {}).get('nearestM') is not None]
    rings = {}
    for b, band in enumerate(prediction['bands']):
        rows = []
        for i, _ in matched.get(band['id'], []):
            w = prediction['windows'][i]
            fractions = w.get('diagnostics', {}).get('energyFractionByRingKm')
            if fractions and fractions[b] is not None and isinstance(w['shipsDb'][b], (int, float)):
                rows.append((w['shipsDb'][b], fractions[b]))
        if rows:
            maximum = max(v for v, _ in rows)
            energy = np.array([10 ** ((v - maximum) / 10) for v, _ in rows])
            rings[band['id']] = ((energy[:, None] * np.array([f for _, f in rows])).sum(axis=0) / energy.sum()).tolist()
    return {'predictionWindows': len(prediction['windows']), 'statusCounts': dict(Counter(w['status'] for w in prediction['windows'])),
            'matchedWindowsAnyBand': len(indices), 'inRadiusShipSamples': inside, 'blockedShipSamples': blocked,
            'blockedFraction': blocked / inside if inside else None, 'nearestShipM': numeric_range(nearest) if nearest else None,
            'ringsKm': prediction.get('ringsKm'), 'receivedShipEnergyFractionByRing': rings}


def make_figures(specs, series, out):
    colors = dict(zip(VARIANTS, ['tab:blue', 'tab:cyan', 'tab:red', 'tab:orange', 'tab:green']))
    for spec in specs:
        sid, days = spec['id'], sorted(spec['days'])
        fig, axes = plt.subplots(len(BANDS), len(days), figsize=(16, 12), squeeze=False, constrained_layout=True)
        for col, day in enumerate(days):
            for row, band in enumerate(BANDS):
                ax = axes[row, col]
                observed_drawn = False
                for variant in VARIANTS:
                    points = series.get((sid, day, variant, band), [])
                    if not points: continue
                    hours = [(datetime.fromisoformat(t.replace('Z', '+00:00')) - datetime.fromisoformat(day + 'T00:00:00+00:00')).total_seconds() / 3600 for t, _, _ in points]
                    if not observed_drawn:
                        ax.plot(*gap_line(hours, [v for _, _, v in points]), color='black', linewidth=.7, label='hydrophone [S/C]')
                        observed_drawn = True
                    ax.plot(*gap_line(hours, [v for _, v, _ in points]), color=colors[variant], linewidth=.6, alpha=.8, label=LABELS[variant] + ' [C]')
                if not observed_drawn: ax.text(.5, .5, 'Aucune fenêtre compatible\n(QC ou bande incomplète)', ha='center', va='center', transform=ax.transAxes, fontsize=8)
                if row == 0: ax.set_title(day)
                if col == 0: ax.set_ylabel(BAND_LABELS[band] + '\ndB re 1 µPa')
                if row == len(BANDS) - 1: ax.set_xlabel('heure UTC')
                ax.grid(alpha=.2)
                ax.set_xlim(0, 24)
        handles, labels = [], []
        for ax in axes.flat:
            h, l = ax.get_legend_handles_labels()
            if h: handles, labels = h, l; break
        fig.suptitle(f'{sid} — niveaux de bande : mesures et modèles [C], pauses laissées vides', fontsize=11)
        if handles: fig.legend(handles, labels, loc='outside lower center', ncol=3, fontsize=7)
        fig.savefig(out / f'{sid}-timeseries.png', dpi=100)
        plt.close(fig)


def publish(args):
    protocol = read(args.protocol)
    execution = read(args.runs / 'execution.json')
    if execution.get('status') != 'complete': raise ValueError('Publication refusée : exécution unique du test non terminée')
    calibration = read(args.calibration)
    if hashlib.sha256(args.calibration.read_bytes()).hexdigest() != execution['physicsSha256']:
        raise ValueError('Profil de calage modifié depuis le test')
    if hashlib.sha256(args.protocol.read_bytes()).hexdigest() != execution['protocolSha256']:
        raise ValueError('Protocole JSON modifié depuis le test')
    specs = [s for s in protocol['stations'] if s['role'] in {'holdout', 'holdout-deep'}]
    args.out.mkdir(parents=True, exist_ok=True)
    reports_out = args.out / 'reports'; reports_out.mkdir(exist_ok=True)
    generated = datetime.now(timezone.utc).isoformat()
    records, reports, series, diagnostic_rows = [], [], {}, []
    pooled_values = defaultdict(lambda: [[], []])
    for spec in specs:
        sid = spec['id']
        for day in sorted(spec['days']):
            prefix = f"{sid}-{day.replace('-', '')}"
            fiche = read(args.runs / f'{prefix}-station.json')
            if fiche['qc']['status'] != 'reviewed': raise ValueError(f'{prefix} : QC non revu')
            if hashlib.sha256((HERE / 'stations' / f'{sid}.json').read_bytes()).hexdigest() != calibration['inputHashes'][f'{sid}.json']:
                raise ValueError(f'{sid} : fiche modifiée depuis le calage')
            with (args.runs / f'{prefix}-observations.csv').open(newline='') as file:
                observations = list(csv.DictReader(file))
            for variant in VARIANTS:
                path = args.runs / f'{prefix}-{variant}-report.json'
                report = read(path)
                if report['variant'] != variant or report['station'] != sid or report['qcStatus'] != 'reviewed': raise ValueError(f'{path} : rapport incompatible')
                prediction_path = args.runs / f'{prefix}-{variant}.json'
                for source in [prediction_path, args.runs / f'{prefix}-observations.csv', args.runs / f'{prefix}-station.json']:
                    if hashlib.sha256(source.read_bytes()).hexdigest() != report['inputHashes'][source.name]:
                        raise ValueError(f'{source} : empreinte différente du rapport')
                prediction = read(prediction_path)
                matched, _ = pair(prediction, observations, fiche)
                diagnostic_rows.append({'station': sid, 'day': day, 'variant': variant, **diagnostics(prediction, matched)})
                reports.append({'station': sid, 'day': day, 'variant': variant, **report})
                shutil.copyfile(path, reports_out / path.name)
                for result in report['results']:
                    regime = 'deep' if spec['role'] == 'holdout-deep' else 'shallow'
                    records.append({'station': sid, 'day': day, 'variant': variant, 'regime': regime, **result})
                    b = next(i for i, band in enumerate(prediction['bands']) if band['id'] == result['band'])
                    points = []
                    for index, measured in matched[result['band']]:
                        window = prediction['windows'][index]
                        predicted = total_db(window['ambientDb'][b], window['shipsDb'][b])
                        points.append((window['start'], predicted, measured))
                    if len(points) != result['count']: raise ValueError(f'{prefix} : nombre de paires différent du rapport')
                    series[(sid, day, variant, result['band'])] = points
                    pool = pooled_values[(sid, variant, result['band'])]
                    pool[0].extend(p for _, p, _ in points); pool[1].extend(m for _, _, m in points)
    expected = len(VARIANTS) * sum(len(s['days']) for s in specs)
    if len(reports) != expected: raise ValueError('Rapports incomplets')
    pooled = []
    for (sid, variant, band), (predicted, measured) in sorted(pooled_values.items()):
        p, m = np.array(predicted), np.array(measured)
        pooled.append({'station': sid, 'variant': variant, 'band': band, **stats(p - m, p, m)})
    # Archives publiques : tous les rapports et statistiques, même défavorables.
    details = {'generated': generated, 'numberStatus': '[C] sauf valeurs du profil v2 [C-calé] ; lectures instrumentales [S].',
               'execution': execution, 'calibration': calibration, 'stationDayBand': records,
               'pooledByStation': pooled, 'reportsIncludingEmpty': reports, 'predictionDiagnostics': diagnostic_rows}
    (args.out / 'results.json').write_text(json.dumps(details, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    columns = ['station', 'day', 'variant', 'regime', 'band', 'count', 'diffL50Db', 'diffL10Db', 'biasDb', 'rmseDb', 'p05ErrorDb', 'p95ErrorDb', 'pearsonR']
    with (args.out / 'results.csv').open('w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=columns, extrasaction='ignore'); writer.writeheader(); writer.writerows(records)
    make_figures(specs, series, args.out)
    summary = published_summary(args.profile, protocol, specs, records, generated)
    # Le schéma TypeScript est la référence ; contrôle réel par Zod avant écriture.
    import subprocess
    subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e',
                    "import {validationSummarySchema,SCIENTIFIC_PROFILE_ID} from './shared/src/acoustics/scientific.ts';let s='';for await(const c of process.stdin)s+=c;const d=validationSummarySchema.parse(JSON.parse(s));if(d.profileId!==SCIENTIFIC_PROFILE_ID)throw Error('profil différent de celui de l’œuvre');"],
                   input=json.dumps(summary), text=True, cwd=ROOT, check=True)
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(json.dumps(summary, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    write_markdown(args, protocol, specs, records, pooled, reports, calibration, summary, execution, diagnostic_rows)
    print(json.dumps({'reports': len(reports), 'comparisons': len(records), 'regions': len(summary['regions']), 'profile': args.profile}))


def write_markdown(args, protocol, specs, records, pooled, reports, calibration, summary, execution, diagnostic_rows):
    lines = ['# Confrontation des niveaux sonores aux hydrophones', '',
             'Résultats du protocole pré-enregistré [v1](VALIDATION_PROTOCOLE.md), avec ses écarts datés au §8. '
             'Les stations de test ont été calculées dans une seule exécution, après le calage. Aucun réglage ne suit ces résultats.', '',
             '**Statuts des nombres** : données et métadonnées des producteurs [S] ; métriques, effectifs et niveaux dérivés [C] ; '
             'paramètres optimisés [C-calé] ; paramètres empiriques fixes [E] ; repères d’interaction dans l’app [A]. '
             'Dans les tableaux de résultats, toutes les cellules numériques sont [C]. Les dates identifient les jours de mesure.', '',
             '## Résultat principal sur les stations de test', '',
             'ΔL50 = médiane prédite − médiane mesurée ; ΔL10 = percentile 90 prédit − percentile 90 mesuré. '
             'Un écart positif signifie une surestimation. Le dénominateur est le nombre de comparaisons station × jour × bande '
             'compatibles après QC, sans pondération par leur nombre de minutes. Les bandes principales sont 125 Hz, 100–500 Hz et 1–10 kHz [C, définition du protocole].', '',
             '| Régime | Variante | Médianes à ±3 dB [C] | Fraction [C] | Critère ≥80 % [E, pré-enregistré] |',
             '|---|---|---:|---:|---|']
    for regime, label in [('shallow', 'Eau peu profonde'), ('deep', 'Eau profonde, un point')]:
        for variant in VARIANTS:
            rows = [r for r in records if r['regime'] == regime and r['variant'] == variant]
            c = criterion(rows)
            frac = c['within3DbFraction']
            outcome = 'atteint' if frac is not None and frac >= .8 else 'non atteint'
            lines.append(f"| {label} | {LABELS[variant]} | {c['within3Db']}/{c['comparisons']} | {100 * frac:.1f} % | {outcome} |" if frac is not None else f'| {label} | {LABELS[variant]} | — | — | non évaluable |')
    active = summary['variant']
    lines += ['']
    for regime, label in [('shallow', 'Eau peu profonde'), ('deep', 'NRS11, un seul point profond')]:
        c = criterion([r for r in records if r['regime'] == regime and r['variant'] == active])
        if c['within3DbFraction'] is None:
            lines.append(f'**{label} : non évaluable.**')
        elif c['within3DbFraction'] < .8:
            lines.append(f"**{label} : critère non atteint** pour la variante affichée : {c['within3Db']}/{c['comparisons']} médianes à ±3 dB [C]. "
                         'La formulation « compatible avec les mesures à l’état de l’art des cartes publiées » n’est pas autorisée par le protocole.')
        else:
            lines.append(f"**{label} : critère atteint pour la loi au point**, {c['within3Db']}/{c['comparisons']} médianes à ±3 dB [C]. "
                         'La limite du rendu GPU reste à expliciter ; cela ne valide pas les autres lieux ni périodes.')
        lines.append('')
    lines += ['', f"**Profil actuellement affiché : `{args.profile}`**, variante `{active}` (vent uniforme de scénario 5 m/s [E]). "
              + ('Décision de l’auteur du 15/10/2026 : conserver v1 et garder v2 comme étude hors ligne. ' if args.profile.endswith('-v1') else 'Le profil v2 a été adopté explicitement par l’auteur ; les résultats v1 restent publiés. ')
              + 'Un résultat ERA5 ne décrit pas à lui seul le scénario de l’exposition.', '',
              'Repère publié [S, lu dans le travail antérieur] : Farcas et al. (2020), *Validated shipping noise maps of the Northeast Atlantic*, '
              'STOTEN 735, 139509, DOI [10.1016/j.scitotenv.2020.139509](https://doi.org/10.1016/j.scitotenv.2020.139509) : '
              '93 % des médianes à ±3 dB, tiers d’octave 125 Hz–5 kHz. Notre choix de bandes, notre échantillonnage et les conditions '
              'diffèrent : ce repère ne constitue pas une comparaison statistique à échantillon identique.', '',
              '## Mesures, qualité et couverture', '',
              'Le [dossier QC](validation/qc/REVUE.md) publie les figures, les sélections de segments et les exclusions décidées sur les seules mesures. '
              'Critères appliqués par l’agent : **pas une revue d’acousticien**. L’étalonnage est déclaré par les producteurs [S], sans réétalonnage indépendant.', '',
              'Information manquante [S, métadonnées ICES] : date d’étalonnage absente pour Anholt en hiver, printemps et été, '
              'Horns Rev 3 en automne et Stevns au printemps et en été. La procédure CPC est déclarée dans ces fichiers ; '
              'le critère pré-enregistré portait sur cette déclaration, sans exiger la date. Aucun retrait n’a été ajouté après le test. '
              'Les [métadonnées des extractions](validation/measurement-metadata/) sont conservées : déclarations du producteur [S], comptages d’export [C].', '',
              'Stevns en hiver et Anholt en automne sont exclus pour silence instrumental persistant (écart n° 3 approuvé) ; '
              'Hjelm en été comporte deux silences exclus, total 47 min [C]. Les bandes ≤63 Hz [C, définition du protocole] '
              'restent évaluées avec signalement d’écoulement, hors objectif du calage. Les chœurs possibles à NRS11 restent conservés. '
              'À NRS11, 10–40 Hz et 1–10 kHz ne sont pas reconstituables complètement : aucun chiffre n’est inventé pour ces bandes.', '',
              '| Station de test | Jours prévus [C] | Jours avec résultat [C] | Fenêtres appariées, variante active [C] |', '|---|---:|---:|---:|']
    for spec in specs:
        rows = [r for r in records if r['station'] == spec['id'] and r['variant'] == active and r['band'] == 'd125']
        lines.append(f"| {spec['id']} | {len(spec['days'])} | {len({r['day'] for r in rows})} | {sum(r['count'] for r in rows)} |")
    lines += ['', 'Diagnostics v1 / ERA5, sur les fenêtres appariées d’au moins une bande. Les parts de rayon '
              'sont pondérées par l’énergie reçue, pas par le nombre de navires ; elles décrivent le modèle dans le rayon, '
              'sans quantifier le trafic réellement absent au-delà. Tous les diagnostics par variante sont dans le JSON intégral.', '',
              '| Station | Jour | Fenêtres appariées [C] | Trajets bloqués [C] | Énergie navires à 125 Hz venant de 100–300 km [C] |', '|---|---|---:|---:|---:|']
    for d in diagnostic_rows:
        if d['variant'] != 'world-law': continue
        blocked = '—' if d['blockedFraction'] is None else f"{100 * d['blockedFraction']:.1f} %"
        ring = d['receivedShipEnergyFractionByRing'].get('d125')
        distant = '—' if ring is None else f'{100 * ring[-1]:.1f} %'
        lines.append(f"| {d['station']} | {d['day']} | {d['matchedWindowsAnyBand']} | {blocked} | {distant} |")
    lines += ['', '## Calage et validation croisée', '',
              'Seules les stations Hjelm, Stevns, Arkona et Horns Rev 3 interviennent dans le calage. '
              'Le modèle de vent reste inchangé : aucun modèle alternatif d’eau peu profonde n’a été exploré faute de formule sourcée lue. '
              'Les bornes restent celles du §6 : leurs justifications de littérature générale [L] n’ont pas été promues en sources lues [S].', '',
              '| Paramètre | Profil v2 [C-calé] |', '|---|---:|']
    lines += [f'| `{name}` | {value:.6g} |' for name, value in calibration['physics'].items()]
    lines += [f"| `transitionFactor` | {calibration['transitionFactor']:.6g} |", '',
              'Ces valeurs sont des paramètres effectifs du modèle simplifié [C-calé], sans mesure locale du sédiment. '
              'Leur ajustement peut compenser des erreurs de propagation, de masque côtier, de trafic ou de fond naturel. '
              'La perte sous coupure atteint la borne basse autorisée ; aucune borne n’a été élargie. '
              'Le facteur de transition agit aussi en eau profonde : le calage en eau peu profonde ne valide pas ce transfert.', '',
              f"Somme des carrés ΔL50 et ΔL10 : {calibration['objective']['reference']:.2f} → {calibration['objective']['calibrated']:.2f} dB² [C]. "
              f"Écart maximal du recalcul Python à la référence TypeScript : {calibration['maxReferenceIdentityErrorDb']:.3g} dB [C]. "
              'La validation croisée refait la même recherche en laissant de côté chaque station de calage ; ses résultats ne sont pas des tests indépendants supplémentaires.', '',
              '| Station laissée de côté | Bande | Jour | ΔL50 dB [C] | ΔL10 dB [C] |', '|---|---|---|---:|---:|']
    for fold in calibration['crossValidation']:
        for r in fold['residuals']:
            lines.append(f"| {fold['leftOutStation']} | {BAND_LABELS[r['band']]} | {r['day']} | {r['diffL50Db']:+.2f} | {r['diffL10Db']:+.2f} |")
    lines += ['', '## Résultats par station, jour et bande', '',
              'Chaque cellule donne **ΔL50 / ΔL10 en dB [C]**. « — » signifie exclusion QC ou bande incomplète ; '
              'les [rapports JSON intégraux](validation/results.json) conservent les motifs, les effectifs, biais, RMSE, corrélations, '
              'quantiles et sous-groupes de dominance. Le [CSV](validation/results.csv) permet une relecture indépendante. Aucun résultat défavorable n’est retiré.']
    for variant in VARIANTS:
        lines += ['', f'### {LABELS[variant]}', '', '| Station | Jour | ' + ' | '.join(BAND_LABELS[b] for b in BANDS) + ' |', '|---|---|' + '---:|' * len(BANDS)]
        for spec in specs:
            for day in sorted(spec['days']):
                lookup = {r['band']: r for r in records if r['station'] == spec['id'] and r['day'] == day and r['variant'] == variant}
                cells = [f"{lookup[b]['diffL50Db']:+.1f} / {lookup[b]['diffL10Db']:+.1f}" if b in lookup else '—' for b in BANDS]
                lines.append(f"| {spec['id']} | {day} | " + ' | '.join(cells) + ' |')
    lines += ['', '## Percentiles sur tous les jours de chaque station', '',
              'Les minutes compatibles sont concaténées avant calcul des percentiles [C]. '
              'Les jours ayant davantage de minutes retenues pèsent donc davantage ; ce tableau ne représente pas une moyenne saisonnière ni annuelle.', '',
              '| Station | Variante | Bande | Minutes [C] | ΔL50 dB [C] | ΔL10 dB [C] |', '|---|---|---|---:|---:|---:|']
    for r in pooled:
        lines.append(f"| {r['station']} | {LABELS[r['variant']]} | {BAND_LABELS[r['band']]} | {r['count']} | {r['diffL50Db']:+.2f} | {r['diffL10Db']:+.2f} |")
    lines += ['', '## Séries temporelles', '', 'Toutes les variantes et les mesures appariées sont montrées, en dB re 1 µPa [C]. Les lacunes ne sont pas interpolées.']
    for spec in specs: lines += ['', f"![{spec['id']} — mesures et modèles](validation/{spec['id']}-timeseries.png)"]
    lines += ['', '## Limites de l’énoncé public', '',
              '- Cette confrontation concerne la **loi du moteur mondial au point exact**, avec le masque et la bathymétrie de sa grille. '
              'L’écart entre ce calcul et les niveaux réellement lus dans le champ GPU n’a pas été chiffré aux stations. '
              'Le champ proche et la résolution d’environ 39 km [C, configuration] restent des limites ; la carte rendue n’est pas entièrement validée par cette étude.',
              '- Un jour par saison [C, plan] et une seule station profonde [C] ne permettent pas une généralisation aux saisons, au grand large ni aux autres régions. '
              'Les fenêtres sont autocorrélées ; aucun intervalle de confiance ni test de significativité n’est déduit de leur nombre.',
              '- 125 Hz est inclus dans la bande 100–500 Hz [C, définition] : les comparaisons ne sont pas indépendantes. '
              'Les distributions du fond seul peuvent être moins restreintes par l’AIS ; les effectifs propres à chaque variante sont publiés.',
              '- Navires non reçus ou sans AIS absents ; rayon de trafic limité à 300 km [C, protocole], sans correction arbitraire du trafic lointain. '
              'La grille grossière bloque de nombreux trajets côtiers. Vent ERA5 à résolution régionale ; scénario uniforme dans l’œuvre.',
              '- Convention temporelle ICES et profondeur de l’hydrophone NRS11 non confirmées par le producteur. '
              'Biologie, pluie, courants au récepteur et milieu local détaillé non modélisés.',
              '- Les bandes larges somment les décidécades de la source et des mesures. Le fond naturel reste intégré sur les limites exactes de configuration : '
              'écart de définition non corrigé, déjà signalé dans la passation. RAM n’est pas utilisé ici comme mesure ni comme preuve de validité du milieu réel.',
              '- Les écarts ne s’appliquent ni au trafic synthétique GFW, ni aux niveaux sources des appels, ni aux espaces de communication, ni aux conséquences biologiques.', '',
              '## Traçabilité', '',
              f"Test ouvert : `{execution['started']}` ; terminé : `{execution['completed']}`. "
              'Les empreintes des entrées sont conservées dans chaque [rapport brut](validation/reports/). '
              'Les [rapports bruts des stations de calage](validation/calibration-reports/) et '
              'le [manifeste au moment du calage](validation/calibration-manifest.json) sont aussi conservés. '
              'Le [manifeste du test](validation/test-manifest.json) archive les empreintes de son exécution unique. '
              'La [décision de maintien du profil](validation/DECISIONS.md) est consignée séparément. '
              'Le [profil de calage](../tools/science/calibration-v2.json), ses résidus et les paramètres de chaque pli sont publics. '
              'Les grands replays et extractions restent dans le cache ; les identifiants des HDF5 supprimés et leurs empreintes restent dans les fiches. '
              'Les fichiers de restitution se régénèrent sans relancer le modèle ni ajuster ses paramètres.', '']
    lines += ['## Vérification du panneau dans l’app', '',
              'Le panneau a été vérifié dans un navigateur local avec le résumé réel. Les coordonnées et le statut AIS sont '
              'injectés pour contrôler ses états ; les niveaux du champ ne sont pas affichés dans ces captures. '
              'Il s’agit d’un contrôle de l’interface, pas d’une confrontation GPU–hydrophone. '
              'Les gardes pour trafic synthétique et profil expérimental ont également été contrôlées.', '',
              '![Panneau au repère mesuré, contrôle d’interface](validation/ui-fiabilite-station.png)', '',
              '![Panneau hors des points mesurés, contrôle d’interface](validation/ui-fiabilite-hors-mesure.png)', '']
    args.document.write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol', type=Path, default=HERE / 'protocol-v1.json')
    parser.add_argument('--runs', type=Path, default=ROOT / 'tools/.cache/science/runs/v1-test')
    parser.add_argument('--calibration', type=Path, default=HERE / 'calibration-v2.json')
    parser.add_argument('--out', type=Path, default=ROOT / 'docs/validation')
    parser.add_argument('--document', type=Path, default=ROOT / 'docs/VALIDATION.md')
    parser.add_argument('--summary', type=Path, default=ROOT / 'data/science/validation-summary.json')
    parser.add_argument('--profile', choices=['north-sea-reference-v1', 'north-sea-reference-v2'], default='north-sea-reference-v1')
    publish(parser.parse_args())


if __name__ == '__main__': main()
