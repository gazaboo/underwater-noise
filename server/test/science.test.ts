import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/config-store.ts';
import { ScienceStore } from '../src/science-store.ts';

const directories: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vacarme-science-')); directories.push(root);
  const config = join(root, 'config'); mkdirSync(config);
  writeFileSync(join(config, 'default.json5'), readFileSync(new URL('../../config/default.json5', import.meta.url)));
  return { root, config, store: new ConfigStore(config) };
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('scientific configuration and unavailable data', () => {
  it('locks reference physics but allows appearance and an explicit experimental profile', () => {
    const { store } = setup();
    expect(() => store.saveLocal({ physics: { extraLossDbPerKm: .08 } })).toThrow(/experimental/);
    expect(() => store.saveLocal({ accumulation: { bandWeights: { low: .1 } }, waves: { damping: .04 } })).not.toThrow();
    expect(() => store.saveLocal({ science: { mode: 'experimental' }, physics: { extraLossDbPerKm: .08 } })).not.toThrow();
  });
  it('neutralizes old local overrides when starting in reference mode', () => {
    const { config } = setup();
    writeFileSync(join(config, 'local.json5'), JSON.stringify({ ambient: { windSpeedMs: 20 }, physics: { extraLossDbPerKm: .08 } }));
    const store = new ConfigStore(config);
    expect(store.config.ambient.windSpeedMs).toBe(5); expect(store.config.physics.extraLossDbPerKm).toBe(0);
  });
  it('reports missing, malformed, and out-of-directory datasets as unavailable', () => {
    const { root, store } = setup(); const science = new ScienceStore(root);
    expect(science.status(store.config)).toMatchObject({ regionalAvailable: false, observationalStatus: 'not-validated' });
    mkdirSync(join(root, 'data', 'science'), { recursive: true });
    writeFileSync(join(root, 'data', 'science', 'north-sea.json'), '{"invalid":true}');
    expect(science.read(store.config)).toBeNull(); expect(science.status(store.config).message).toMatch(/invalide/);
    expect(science.read({ ...store.config, science: { ...store.config.science, dataset: 'config/default.json5' } })).toBeNull();
  });
});
