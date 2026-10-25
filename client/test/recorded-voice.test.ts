import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {maskCutoffHz, maskGain} from '../src/audio/mask-chain.ts';
import {LEVEL_REF_DBFS, levelGain, playRecording} from '../src/audio/recorded-voice.ts';
import {SampleBank} from '../src/audio/sample-bank.ts';

class Param {
  value=0;
  setValueAtTime() {return this;}
  linearRampToValueAtTime() {return this;}
  cancelScheduledValues() {return this;}
  setTargetAtTime() {return this;}
}
class Node {
  static instances: Node[]=[];
  gain=new Param(); frequency=new Param();
  constructor(_ctx?: unknown, readonly options: Record<string, unknown>={}) {Node.instances.push(this);}
  connect(node: unknown) {return node;}
  disconnect() {}
}
class Source extends Node {
  static last: Source;
  starts: number[][]=[]; stops: number[]=[];
  constructor(ctx: unknown, options: Record<string, unknown>) {super(ctx, options); Source.last=this;}
  start(...args: number[]) {this.starts.push(args);}
  stop(t: number) {this.stops.push(t);}
}
beforeEach(()=>{
  vi.useFakeTimers(); vi.spyOn(Math,'random').mockReturnValue(.5);
  vi.stubGlobal('GainNode',Node); vi.stubGlobal('BiquadFilterNode',Node); vi.stubGlobal('AudioBufferSourceNode',Source);
  Node.instances=[];
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

const ctx={currentTime:100} as unknown as AudioContext;
const dest=new Node() as unknown as AudioNode;
const buffer=(duration: number) => ({duration}) as AudioBuffer;
const base={gain:.5,clarity:1,playbackRate:1,maxSec:8,levelDbfs:LEVEL_REF_DBFS};

describe('chaîne de masquage commune',()=>{
  it('mêmes paramètres que la synthèse d\'origine',()=>{
    expect(maskCutoffHz(1)).toBe(9400);
    expect(maskCutoffHz(0)).toBe(400);
    expect(maskCutoffHz(.5)).toBe(400+9000*.25);
    expect(maskGain(1)).toBe(1);
    expect(maskGain(0)).toBe(.25);
  });
});

describe('appel enregistré',()=>{
  it('joue l\'extrait entier quand il est court',()=>{
    const call=playRecording(ctx,dest,buffer(2),base);
    expect(call.endTime).toBeCloseTo(100.02+2,8);
    expect(Source.last.starts[0]).toEqual([100.02,0,2]);
  });

  it('tire une fenêtre plafonnée dans un long extrait, à la vitesse de transposition',()=>{
    // 84 s lues ×5 = 16,8 s ; plafond 10 s ; hasard 0,5 → départ au milieu de la marge (3,4 s réelles = 17 s du fichier).
    const call=playRecording(ctx,dest,buffer(84),{...base,playbackRate:5,maxSec:10});
    expect(call.endTime).toBeCloseTo(100.02+10,8);
    const [t0,offset,dur]=Source.last.starts[0];
    expect(t0).toBeCloseTo(100.02,8);
    expect(offset).toBeCloseTo(17,8);
    expect(dur).toBeCloseTo(50,8); // 10 s réelles = 50 s du fichier
    expect(Source.last.options.playbackRate).toBe(5);
  });

  it('égalise le niveau actif et applique le masquage',()=>{
    playRecording(ctx,dest,buffer(2),{...base,clarity:.5,levelDbfs:LEVEL_REF_DBFS-10});
    const out=Node.instances.find(n=>n.options.gain!==undefined && n.options.gain!==1);
    expect(out?.options.gain).toBeCloseTo(.5*Math.pow(10,10/20)*maskGain(.5),8);
    expect(levelGain(-80)).toBeCloseTo(Math.pow(10,15/20),8); // plafond +15 dB
  });

  it('stop coupe la source',()=>{
    const call=playRecording(ctx,dest,buffer(2),base);
    call.stop();
    expect(Source.last.stops.at(-1)).toBeCloseTo(100.03,8);
  });
});

describe('banque d\'enregistrements',()=>{
  const decoder={decodeAudioData:async()=>buffer(3)} as unknown as BaseAudioContext;
  const catalog={generated:'',about:'',items:[
    {id:'a',kind:'son',subject:{species:'blue'},files:{ogg:'sons/a.ogg',m4a:'sons/a.m4a'},levelDbfs:-12},
    {id:'b',kind:'son',subject:{species:'sperm'},files:{ogg:'sons/b.ogg',m4a:'sons/b.m4a'},levelDbfs:-36},
    {id:'c',kind:'son',subject:{lieu:'palaoa'},files:{ogg:'sons/c.ogg',m4a:'sons/c.m4a'},levelDbfs:-20},
  ]};
  const respond=(ok: boolean, body: unknown=null) => ({ok,status:ok?200:404,json:async()=>body,arrayBuffer:async()=>new ArrayBuffer(8)}) as Response;

  it('catalogue absent : aucune espèce, repli sur la synthèse',async()=>{
    const bank=new SampleBank(async()=>respond(false));
    await bank.load(decoder);
    expect(bank.pick('blue')).toBeNull();
    expect(bank.status).toContain('synthèse');
  });

  it('format de repli, fichier manquant, sons de lieux ignorés',async()=>{
    const bank=new SampleBank(async(url)=>{
      if(url.endsWith('catalog.json')) return respond(true,catalog);
      if(url.endsWith('a.ogg')) return respond(false); // Opus absent : l'AAC prend le relais
      if(url.includes('/b.')) return respond(false); // cachalot : aucun fichier → synthèse
      return respond(true);
    });
    await bank.load(decoder);
    expect(bank.species).toEqual(['blue']);
    expect(bank.pick('blue')?.levelDbfs).toBe(-12);
    expect(bank.pick('sperm')).toBeNull();
  });
});
