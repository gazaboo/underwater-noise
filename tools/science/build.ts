import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildRegionalDataset, kernelSchema, trafficSchema } from '../../shared/src/index.ts';

const [kernelsPath, trafficPath, outputPath] = process.argv.slice(2);
if (!kernelsPath || !trafficPath || !outputPath) throw new Error('Usage : npx tsx tools/science/build.ts kernels.json traffic.json data/science/north-sea.json');
const kernelsText = readFileSync(kernelsPath, 'utf8'), trafficText = readFileSync(trafficPath, 'utf8');
const kernels = kernelSchema.parse(JSON.parse(kernelsText));
const traffic = trafficSchema.parse(JSON.parse(trafficText));
const hash = createHash('sha256').update(kernelsText).update(trafficText).digest('hex');
const data = buildRegionalDataset(kernels, traffic, hash);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(data) + '\n');
console.log(`${data.frames.length} minutes, ${data.frames.reduce((n, f) => n + f.cells.filter(Boolean).length, 0)} cellules renseignées. Validation sur mesures non réalisée.`);
