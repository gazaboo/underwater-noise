"""Reproduce an EXPLORATORY real-data comparison at JOMOPANS Vinga.

No claim of global validation: unresolved sediment/AIS uncertainties must remain explicit.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import importlib.util
import json
import math
import subprocess
from pathlib import Path
import numpy as np
import ram
from ices import export
from validate import evaluate

ROOT = Path(__file__).resolve().parents[2]
START = '2019-07-01T03:10:40Z'
END = '2019-07-01T04:10:40Z'
STATION = {'station': '13076', 'lat': 57.623, 'lon': 11.572, 'receiverDepthM': 45-4, 'timestampConvention': 'start',
           'periodStart': START, 'periodEnd': END,
           'source': 'Basan et al. 2024 Table 2 (coordinates, water depth 45 m); ICES 1522 MeasurementHeight=4 m above bottom. Data/DateTime explicitly UTC; timestamp treated as interval start.'}


def prepare(cache):
    spec=importlib.util.spec_from_file_location('convert_ais',ROOT/'tools/convert_ais.py'); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    rows=list(csv.DictReader((cache/'vinga-ais.csv').open()))
    static={}
    for row in rows:
        if row['Type of mobile'] not in ['Class A','Class B']:continue
        mmsi=int(row['MMSI']); cls=module.DMA_TYPES.get(row['Ship type'].lower()); length=module.fnum(row['Length'])
        old=static.get(mmsi,(None,None))
        static[mmsi]=(cls or old[0],length or old[1])
    replay=cache/'vinga-replay.ndjson.gz'; writer=module.Writer(replay,0)
    from datetime import datetime,timezone
    t0=datetime(2019,7,1,tzinfo=timezone.utc).timestamp()
    for mmsi,(cls,length) in static.items():writer.static(t0,mmsi,cls,None,None,length)
    for row in rows:
        if row['Type of mobile'] not in ['Class A','Class B']:continue
        time=datetime.strptime(row['# Timestamp'],'%d/%m/%Y %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
        writer.position(time,int(row['MMSI']),float(row['Latitude']),float(row['Longitude']),module.fnum(row['SOG']),module.fnum(row['COG']),module.fnum(row['Heading']))
    writer.close()
    weather=json.loads((cache/'wind-vinga.json').read_text()); times=weather['hourly']['time']; winds=weather['hourly']['wind_speed_10m']
    # A 10 s snapshot can cross these tiny intervals, so use hourly interpolation at
    # minute boundaries and hold each minute constant, reporting that convention.
    intervals=[]
    for i in range(len(times)-1):
        epoch=datetime.fromisoformat(times[i]).replace(tzinfo=timezone.utc).timestamp()
        for minute in range(60):
            intervals.append({'start':datetime.fromtimestamp(epoch+minute*60,timezone.utc).isoformat(),'end':datetime.fromtimestamp(epoch+(minute+1)*60+10,timezone.utc).isoformat(),'windMs':winds[i]+(winds[i+1]-winds[i])*minute/60})
    wind_path=cache/'vinga-wind.json';wind_path.write_text(json.dumps({'provenance':'ERA5 hourly 10 m wind via Open-Meteo archive, 2019-07-01, nearest 0.25° grid; linear hourly interpolation, minute hold; no hydrophone fitting.','intervals':intervals}))
    subprocess.run(['node','--import','tsx','tools/science/import-replay.ts',str(replay),str(wind_path),START,END,str(cache/'vinga-traffic.json')],cwd=ROOT,check=True)
    station=cache/'vinga-station.json';station.write_text(json.dumps(STATION,indent=2)+'\n')
    export(cache/'vinga/3093_ICES_SE_13076_190701_190731.h5',STATION,cache/'vinga-observations-unreviewed.csv')
    return static


def curves(cache, water_depth=45, sediment_speed=1700, water_speed=1500, name='reference'):
    path=cache/f'vinga-curves-{name}.json'
    if path.exists():return path
    bands=[]; differences=[]
    for center in ram.CENTERS:
        band=[]
        for sample in ram.quadrature(center,10):
            f=sample['frequencyHz']; environment={'bathymetry':[[0,water_depth],[70000,water_depth]],'receiverDepthM':STATION['receiverDepthM'],
                'water':{'depthsM':[0,water_depth],'rangesM':[0],'soundSpeedMs':[[water_speed],[water_speed]]},
                'sediment':{'soundSpeedMs':sediment_speed,'densityGcm3':2,'attenuationDbPerWavelength':.5}}
            ranges,loss=ram.transmission(environment,f,'receiver',2,return_curve=True)
            coarse_r,coarse_loss=ram.transmission(environment,f,'receiver',1,return_curve=True)
            query=np.arange(500,70001,100,dtype=float)
            fine=np.interp(query,ranges,10**(-loss/10)); coarse=np.interp(query,coarse_r,10**(-coarse_loss/10))
            differences.append(float(np.max(np.abs(10*np.log10(fine/coarse)))))
            band.append({**sample,'rangesM':query.tolist(),'lossDb':(-10*np.log10(fine)).tolist()})
        bands.append(band);print(f'{name}: {center:.1f} Hz terminé',flush=True)
    result={'station':STATION,'bands':bands,'provenance':{'environment':'Vinga published water depth + ICES receiver height; uniform Pekeris scenario, no measured sediment or sound-speed profile.',
        'assumptions':[f'Uniform water depth {water_depth} m; no tide correction.',f'Water sound speed {water_speed} m/s, homogeneous (JOMOPANS simplification).',f'Sandy half-space {sediment_speed} m/s, 2 g/cm³, 0.5 dB/wavelength: benchmark parameters, not a sediment measurement at Vinga.',
        'Station coordinates rounded to 0.001° in the paper, position uncertainty not independently resolved.', 'Only producer-processed band levels available; raw audio and current contamination not independently reviewed.', 'Lookup every 100 m, interpolated in energy; no fitted offsets.']},
        'numerical':{'maxDifferenceDb':max(differences),'benchmark':'JOMOPANS case 1, 63/125 Hz: maximum deviation 0.36 dB; upslope unverified'}}
    path.write_text(json.dumps(result));return path


def run(cache,output):
    prepare(cache)
    output.mkdir(parents=True,exist_ok=True)
    results={}
    for name,depth,sediment,c in [('reference',45,1700,1500),('sediment-1600',45,1600,1500),('sediment-1800',45,1800,1500),('water-1480',45,1700,1480),('depth-47',47,1700,1500)]:
        curve=curves(cache,depth,sediment,c,name)
        target=output/f'vinga-{name}.json'
        subprocess.run(['node','--import','tsx','tools/science/build-case.ts',str(curve),str(cache/'vinga-traffic.json'),str(target)],cwd=ROOT,check=True)
        with (cache/'vinga-observations-unreviewed.csv').open() as file: rows=list(csv.DictReader(file))
        # Independent producer-processed measurements, limited automated screening.
        # Report remains exploratory; accepting rows here is not a certificate.
        selected=[{**r,'quality':'accepted'} for r in rows if START <= r['start'].replace('+00:00','Z') < END]
        data=json.loads(target.read_text()); comparison=evaluate(data,selected)
        comparison['datasetHash']=hashlib.sha256(target.read_bytes()).hexdigest()
        results[name]=comparison
    extra=output/'vinga-radius70.json'
    subprocess.run(['node','--import','tsx','tools/science/build-case.ts',str(cache/'vinga-curves-reference.json'),str(cache/'vinga-traffic.json'),str(extra),'70000'],cwd=ROOT,check=True)
    results['radius70']=evaluate(json.loads(extra.read_text()),selected)
    report={'status':'exploratory-real-data-comparison','station':STATION,'start':START,'end':END,'results':results,
        'notValidatedReasons':['Only one hour and one receiver; duty-cycle gaps are excluded.','Sediment and water sound speed are scenarios, not local measurements.','AIS coverage and ships outside the extraction domain remain incomplete.','Timestamp start/end convention, tides and flow noise not independently verified.'],
        'sources':{'measurements':'https://underwaternoise.ices.dk/continuous/api/DownloadFile/1522','station':'https://doi.org/10.1016/j.marpolbul.2023.115891','ais':'https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/2019/aisdk-2019-07.zip','wind':'https://open-meteo.com/en/docs/historical-weather-api'},
        'inputHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [cache/'vinga-ais.csv',cache/'wind-vinga.json',cache/'vinga/3093_ICES_SE_13076_190701_190731.h5']}}
    (output/'vinga-comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v['results'] for k,v in results.items()},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cache',type=Path,default=ROOT/'tools/.cache/science');parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();run(args.cache,args.output)
