import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ZoneVoice, zoneClarity} from '../src/audio/zone-voice.ts';

class Param {
  value=0; calls: unknown[][]=[];
  setValueAtTime(...a: unknown[]) {this.calls.push(['set',...a]);return this;}
  setTargetAtTime(...a: unknown[]) {this.calls.push(['target',...a]);return this;}
  cancelScheduledValues() {return this;}
}
class Node {
  gain=new Param(); frequency=new Param();
  constructor(_ctx?: unknown, readonly options: Record<string, unknown>={}) {}
  connect(node: unknown) {return node;}
  disconnect() {}
}
class Source extends Node {
  static all: Source[]=[];
  onended: (() => void) | null=null; started: number[]=[]; stopped: number[]=[];
  constructor(ctx: unknown, options: Record<string, unknown>) {super(ctx, options); Source.all.push(this);}
  start(t: number) {this.started.push(t);}
  stop(t: number) {this.stopped.push(t);}
}
beforeEach(()=>{
  vi.useFakeTimers();
  vi.stubGlobal('GainNode',Node); vi.stubGlobal('BiquadFilterNode',Node); vi.stubGlobal('AudioBufferSourceNode',Source);
  Source.all=[];
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('clarté d\'un lieu',()=>{
  it('1 sans bruit ajouté, 10^(−ΔL/20) sinon',()=>{
    expect(zoneClarity(0)).toBe(1);
    expect(zoneClarity(-3)).toBe(1);
    expect(zoneClarity(20)).toBeCloseTo(0.1,10);
  });
});

describe('paysage sonore d\'un lieu',()=>{
  const ctx={currentTime:10} as unknown as AudioContext;
  const dest=new Node() as unknown as AudioNode;
  const sounds=[{buffer:{duration:3} as AudioBuffer,levelDbfs:-14},{buffer:{duration:5} as AudioBuffer,levelDbfs:-20}];

  it('enchaîne ses sons en boucle',()=>{
    new ZoneVoice(ctx,dest,sounds);
    expect(Source.all).toHaveLength(1);
    expect(Source.all[0].options.buffer).toBe(sounds[0].buffer);
    Source.all[0].onended!();
    expect(Source.all[1].options.buffer).toBe(sounds[1].buffer);
    Source.all[1].onended!();
    expect(Source.all[2].options.buffer).toBe(sounds[0].buffer);
  });

  it('s\'arrête sans relancer de son',()=>{
    const z=new ZoneVoice(ctx,dest,sounds);
    z.stop();
    expect(Source.all[0].stopped).toHaveLength(1);
    Source.all[0].onended!();
    expect(Source.all).toHaveLength(1);
  });
});
