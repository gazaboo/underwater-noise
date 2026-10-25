import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {playCall} from '../src/audio/whale-voice.ts';

class Param {
  setValueAtTime() {return this;}
  linearRampToValueAtTime() {return this;}
  exponentialRampToValueAtTime() {return this;}
  cancelScheduledValues() {return this;}
  setTargetAtTime() {return this;}
}
class Node {
  gain=new Param(); frequency=new Param();
  connect(node: unknown) {return node;}
  disconnect() {}
}
class Oscillator extends Node {
  static instances: Oscillator[]=[];
  stops:number[]=[];
  constructor() {super();Oscillator.instances.push(this);}
  start() {}
  stop(time:number) {this.stops.push(time);}
}
beforeEach(()=>{
  vi.useFakeTimers(); vi.spyOn(Math,'random').mockReturnValue(.5);
  vi.stubGlobal('OscillatorNode',Oscillator); vi.stubGlobal('GainNode',Node); vi.stubGlobal('BiquadFilterNode',Node);
  Oscillator.instances=[];
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('durée des appels dans le temps commun',()=>{
  const ctx={currentTime:100} as AudioContext;
  const dest=new Node() as unknown as AudioNode;
  it.each(['blue','fin','humpback','sperm','orca'])('compresse la durée de %s avec le facteur temporel',species=>{
    const base={species,gain:.5,clarity:1,transpose:1};
    const normal=playCall(ctx,dest,{...base,timeScale:1});
    const accelerated=playCall(ctx,dest,{...base,timeScale:10});
    // The fixed 20 ms audio scheduling lead is not biological time.
    expect(accelerated.endTime-100.02).toBeCloseTo((normal.endTime-100.02)/10,8);
  });
  it('annule aussi les oscillateurs dont le démarrage était programmé dans le futur',()=>{
    const call=playCall(ctx,dest,{species:'blue',gain:.5,clarity:1,transpose:1,timeScale:1});
    call.stop();
    expect(Oscillator.instances.length).toBeGreaterThan(1);
    for(const node of Oscillator.instances) expect(node.stops.at(-1)).toBeCloseTo(100.03);
  });
});
