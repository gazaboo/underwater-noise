/** Browser-only numerical controls. These are not hydrophone validation. */
import * as THREE from 'three';
import { bandCenter, PHYS_COURANT, SOUND_SPEED_M_S, naturalLevel, thorpAbsorptionDbPerKm, type Config } from '@vacarme/shared';
import { PhysicsField, PHYS_SIGNAL_GLSL } from '../src/sim/physics-sim.ts';
import { FlatView, worldTransform } from '../src/render/flat-view.ts';
import { FullscreenPass, rawMaterial } from '../src/render/fullscreen.ts';

function check(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

export function verifySolver(cfg: Config) {
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  renderer.autoClear = false;
  const cellM = 5000;
  const N = 128;
  const span = N * cellM / 6371000 * 180 / Math.PI;
  const results: Record<string, unknown>[] = [];
  function run(lat: number, seconds: number, depth: number, damping: boolean, carrier = false, wall = false) {
    const bytes = new Uint8Array(N * N * 4);
    const depthCode = Math.round(255 * Math.log(depth / 10) / Math.log(1100));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = 4 * (y * N + x);
      bytes[i] = wall && x === N / 2 ? 0 : 255;
      bytes[i + 1] = depthCode;
      bytes[i + 3] = 255;
    }
    const ocean = new THREE.DataTexture(bytes, N, N);
    ocean.needsUpdate = true;
    const field = new PhysicsField(N, ocean, { lonCenter: 0, latTop: lat + span / 2, latSpan: span, lonSpan: span });
    field.configure(cfg);
    field.setDampingScale(damping ? 1 : 0);
    field.clear(renderer);
    // Analytic travelling initial condition, independent of the solver recurrence.
    const seed = new FullscreenPass(rawMaterial(`
      in vec2 vUv; out vec4 outColor;
      uniform float uShift;
      void main() {
        float x = vUv.x * ${N.toFixed(1)} - 0.5;
        float d = x - ${String(N / 4)}.0 - uShift;
        float u = exp(-d*d / ${carrier ? '128.0' : '32.0'});
        ${carrier ? 'u *= cos(6.283185307 * d / 6.0);' : ''}
        ${wall ? `if (x >= ${String(N / 2)}.0) u = 0.0;` : ''}
        outColor = vec4(u, u, u, 1.0);
      }`, { uShift: { value: 0 } }));
    // Test fixture writes the two initial buffers; production has no state-seeding API.
    const targets = (field as unknown as { states: THREE.WebGLRenderTarget[] }).states;
    seed.material.uniforms.uShift.value = -PHYS_COURANT / Math.cos(lat * Math.PI / 180);
    seed.render(renderer, targets[0]);
    seed.material.uniforms.uShift.value = 0;
    seed.render(renderer, targets[1]);
    const count = Math.floor(seconds / field.stepSeconds);
    for (let i = 0; i < count; i++) field.step(renderer);
    const row = new Float32Array(N * 4);
    renderer.readRenderTargetPixels((field as unknown as { states: THREE.WebGLRenderTarget[] }).states[1], 0, N / 2, N, 1, row);
    const sums = [0, 0, 0]; let moment = 0, far = 0;
    for (let x = 0; x < N; x++) {
      for (let b = 0; b < 3; b++) sums[b] += row[4 * x + b] ** 2;
      moment += x * row[4 * x] ** 2;
      if (x > N / 2) far += row[4 * x] ** 2;
    }
    const shiftM = (moment / sums[0] - N / 4) * cellM * Math.cos(lat * Math.PI / 180);
    const elapsed = count * field.stepSeconds;
    field.dispose(); ocean.dispose(); seed.dispose();
    return { lat, elapsed, expectedM: SOUND_SPEED_M_S * elapsed, measuredM: shiftM, sums, far };
  }
  function twoSources() {
    const bytes=new Uint8Array(N*N*4);
    for(let i=0;i<N*N;i++) bytes.set([255,255,0,255],i*4);
    const ocean=new THREE.DataTexture(bytes,N,N); ocean.needsUpdate=true;
    const field=new PhysicsField(N,ocean,{lonCenter:0,latTop:span/2,lonSpan:span,latSpan:span});
    field.setDampingScale(0); field.clear(renderer);
    const source=new FullscreenPass(rawMaterial(`
      in vec2 vUv; out vec4 outColor; uniform float uClock;
      ${PHYS_SIGNAL_GLSL}
      void main() {
        ivec2 p=ivec2(vUv*${N.toFixed(1)});
        if(p.x!=${N/2} || p.y!=${N/2}) { outColor=vec4(0.0); return; }
        float a=physSignal(0.37,uClock), b=physSignal(0.83,uClock);
        outColor=vec4(a,b,a+b,1.0);
      }`,{uClock:{value:0}}));
    try {
      for(let i=0;i<4000;i++) {
        source.material.uniforms.uClock.value=i;
        source.render(renderer,field.sourceTarget); field.step(renderer);
        field.updateEnergy(renderer,i<600?1/100:1/1000);
      }
      const values=new Float32Array(N*N*4);
      renderer.readRenderTargetPixels(field.energyTarget,0,0,N,N,values);
      const e=[0,0,0];
      for(let y=0;y<N;y++) for(let x=0;x<N;x++) {
        const r=Math.hypot(x-N/2,y-N/2);
        if(r<18 || r>40) continue;
        for(let b=0;b<3;b++) e[b]+=values[4*(y*N+x)+b];
      }
      const deviationDb=10*Math.log10(e[2]/(e[0]+e[1]));
      check(Math.abs(deviationDb)<1,`Long-average incoherent source sum: ${deviationDb} dB`);
      return {case:'two-incoherent-sources-long-average',singleEnergies:e.slice(0,2),combinedEnergy:e[2],deviationFromEnergySumDb:deviationDb,toleranceDb:1,
        averagingSteps:1000,note:'Long numerical average, not the six-second production average'};
    } finally {source.dispose();field.dispose();ocean.dispose();}
  }
  try {
    for (const lat of [0, 45, 70]) {
      const r = run(lat, 60, 11000, false);
      check(Math.abs(r.measuredM - r.expectedM) <= cellM, `Propagation ${lat}°: ${JSON.stringify(r)}`);
      results.push({ case: 'travelling-packet', ...r, toleranceM: cellM });
    }
    // The six-cell carrier is the signal actually used by the existing model.
    const ref = run(0, 120, 11000, false, true);
    check(Math.abs(ref.measuredM - ref.expectedM) <= cellM, `Six-cell dispersion: ${JSON.stringify(ref)}`);
    results.push({ case: 'six-cell-packet-dispersion', ...ref, errorPercent: 100 * (ref.measuredM / ref.expectedM - 1) });
    const loss = run(0, 120, 11000, true, true);
    const measuredLossDb = ref.sums.map((e, b) => 10 * Math.log10(e / loss.sums[b]));
    const expectedLossDb = cfg.bands.map(b => thorpAbsorptionDbPerKm(bandCenter(b)) * ref.expectedM / 1000);
    for (let b = 0; b < 3; b++) check(Math.abs(measuredLossDb[b] - expectedLossDb[b]) < 1, `Deep-water loss band ${b}: ${measuredLossDb[b]} vs ${expectedLossDb[b]}`);
    results.push({ case: 'deep-absorption', measuredLossDb, expectedLossDb, toleranceDb: 1 });
    const shelf = run(0, 120, 100, true, true);
    check(shelf.sums[0] < loss.sums[0], 'Shelf losses must exceed deep-water losses');
    results.push({ case: 'shelf-bottom-loss', extraLowBandLossDb: 10 * Math.log10(loss.sums[0] / shelf.sums[0]) });
    const blocked = run(0, 160, 11000, false, true, true);
    check(blocked.far === 0, 'Wave crossed a one-cell land barrier');
    results.push({ case: 'land-barrier', energyBeyond: blocked.far });
    results.push(twoSources());
    return results;
  } finally { renderer.dispose(); }
}


/** Exercise the real compositor: source energy below threshold must stay black at every gain. */
export function verifyVisibility(input: Config) {
  const cfg = structuredClone(input);
  Object.assign(cfg.render, { exposure: 1, gamma: 1, blackLift: 0, vignette: 0, dither: false });
  Object.assign(cfg.palette, { background: '#000000', oceanShallow: '#000000', oceanDeep: '#000000', land: '#000000', coast: '#000000', wave: '#ffffff', bathyRelief: 0 });
  cfg.accumulation.strength = 0; cfg.incognita.fog = 0; cfg.incognita.grain = 0;
  cfg.waves.relief = 0; cfg.waves.band = 'low';
  cfg.noise.style = 'fronts'; // ces contrôles portent sur les fronts bruts du modèle
  const N = 64;
  const bytes = new Uint8Array(N * N * 4);
  const elevation = new Uint8Array(N * N * 4);
  const coverage = new Uint8Array(N * N).fill(255);
  for (let i = 0; i < N * N; i++) {
    bytes.set([255, 255, 0, 255], 4 * i);
    elevation.set([39, 16, 0, 255], 4 * i); // −1000 m, ocean everywhere
  }
  const ocean = new THREE.DataTexture(bytes, N, N); ocean.needsUpdate = true;
  const elev = new THREE.DataTexture(elevation, N, N); elev.needsUpdate = true;
  const cov = new THREE.DataTexture(coverage, N, N, THREE.RedFormat); cov.needsUpdate = true;
  const renderer = new THREE.WebGLRenderer({canvas:document.createElement('canvas')}); renderer.autoClear = false;
  const field = new PhysicsField(N, ocean);
  const flat = new FlatView({ ocean, oceanWidth: N, elevationNearest: elev, elevationLinear: elev });
  const target = new THREE.WebGLRenderTarget(N, N / 2, {depthBuffer:false});
  const fill = new FullscreenPass(rawMaterial('in vec2 vUv; out vec4 outColor; uniform vec4 uValue; void main() { outColor=uValue; }', {uValue:{value:new THREE.Vector4()}}));
  const states = (field as unknown as {states:THREE.WebGLRenderTarget[]}).states;
  const fillTarget = (to:THREE.WebGLRenderTarget, value:number) => {
    (fill.material.uniforms.uValue.value as THREE.Vector4).set(value,0,0,1); fill.render(renderer,to);
  };
  try {
    const controls = [];
    for (const [ratio, brightness, band] of [[.1,20,'low'], [.25,20,'low'], [1,2.8,'low'], [9,2.8,'low'], [9,20,'mid']] as const) {
      field.clear(renderer);
      const e = ratio * 10 ** ((naturalLevel(cfg.bands[0],cfg.ambient.windSpeedMs) - field.offsetDb) / 10);
      for (const state of states) fillTarget(state, Math.sqrt(2*e));
      fillTarget(field.energyTarget,e);
      flat.setLevels(field.levels.texture,field.width,field.height);
      cfg.waves.brightness = brightness; cfg.waves.band = band;
      flat.render(renderer,field,1,cov,worldTransform(N),cfg,0,target);
      const pixel = new Uint8Array(4);
      renderer.readRenderTargetPixels(target,N/2,N/4,1,1,pixel);
      if (ratio <= .25 || band === 'mid') check(pixel[0]===0 && pixel[1]===0 && pixel[2]===0, `Visibility leaked below threshold or across bands: ${pixel}`);
      else check(pixel[0] > 0,'An above-threshold field was hidden');
      controls.push({ratio,brightness,band,pixel:[...pixel]});
    }
    return controls;
  } finally {
    field.dispose(); fill.dispose(); target.dispose(); ocean.dispose(); elev.dispose(); cov.dispose(); renderer.dispose();
  }
}
