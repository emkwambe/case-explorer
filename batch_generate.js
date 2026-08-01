// batch_generate.js — Node.js batch generator for synthetic underwriting cases
// Usage: node batch_generate.js [count] [output_prefix] [seed]
// Example: node batch_generate.js 1000 my_dataset 42

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBlendedCase, calculateStatistics, casesToCsv } from './src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCH_SIZE = parseInt(process.argv[2], 10) || 1000;
const OUTPUT_PREFIX = process.argv[3] || 'synthetic_dataset';
const SEED = process.argv[4];

// Load the same distribution config used by the browser app
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'distribution_config.json'), 'utf8'));

const allCases = [];
for (let i = 0; i < BATCH_SIZE; i++) {
  allCases.push(generateBlendedCase(i, CONFIG, SEED));
}

const stats = calculateStatistics(allCases);
const fraudCount = allCases.filter(c => c.label.fraud_risk_level !== "NONE").length;

const metadata = {
  generator_version: "1.0.0",
  timestamp: new Date().toISOString(),
  count: BATCH_SIZE,
  seed: SEED ?? null,
  config_checksum: "sha256:pending",
  statistics: stats,
  outcome_counts: allCases.reduce((acc, c) => {
    acc[c.label.expected_outcome] = (acc[c.label.expected_outcome] || 0) + 1;
    return acc;
  }, {})
};

fs.writeFileSync(`${OUTPUT_PREFIX}.json`, JSON.stringify({ metadata, cases: allCases }, null, 2));
fs.writeFileSync(`${OUTPUT_PREFIX}.csv`, casesToCsv(allCases));

console.log(`Generated ${BATCH_SIZE} cases`);
if (SEED) console.log(`Seed: ${SEED}`);
console.log(`Fraud cases: ${fraudCount} (${(fraudCount / BATCH_SIZE * 100).toFixed(1)}%)`);
console.log(`Outcomes:`, metadata.outcome_counts);
console.log(`Statistics:`);
console.table(stats);
console.log(`Saved ${OUTPUT_PREFIX}.json and ${OUTPUT_PREFIX}.csv`);
