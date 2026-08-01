import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { generateCase } = await import('./src/generator.js');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'distribution_config.json'), 'utf8'));

const seeds = [
  { id: 'case-001', corruption: 'NONE', severity: 'LOW', seed: 'seed-a0' },
  { id: 'case-002', corruption: 'TIMING_DRIFT', severity: 'LOW', seed: 'seed-a1' },
  { id: 'case-003', corruption: 'CONCEALMENT', severity: 'HIGH', seed: 'seed-a3' },
  { id: 'case-004', corruption: 'FABRICATION', severity: 'HIGH', seed: 'seed-a4' },
];

const cases = seeds.map((s, i) => {
  const c = generateCase(i, CONFIG, s.corruption, s.severity, s.seed);
  c.id = s.id;
  return c;
});

const output = 'const INITIAL_CASES = ' + JSON.stringify(cases, null, 2) + ';\n';
fs.writeFileSync(path.join(__dirname, 'initial_cases.js'), output, 'utf8');

const jsxPath = path.join(__dirname, 'src', 'FraudCaseExplorer.jsx');
let jsx = fs.readFileSync(jsxPath, 'utf8');
const replaced = jsx.replace(/const INITIAL_CASES = \[[\s\S]*?\n\];/, output.trimEnd());
if (replaced === jsx) {
  console.error('Failed to patch INITIAL_CASES');
  process.exit(1);
}
fs.writeFileSync(jsxPath, replaced, 'utf8');
console.log('Refreshed INITIAL_CASES with', cases.length, 'seed cases');
