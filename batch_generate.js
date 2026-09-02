// batch_generate.js — Node.js batch generator for synthetic underwriting cases
// Usage: node batch_generate.js [count] [output_prefix] [seed]
// Example: node batch_generate.js 1000 my_dataset 42

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBlendedCase, calculateStatistics, casesToCsv } from './src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_BATCH_SIZE = 1_000_000;
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_OUTPUT_PREFIX = 'synthetic_dataset';

function showUsage(errorMessage) {
  if (errorMessage) console.error(`Error: ${errorMessage}`);
  console.log('Usage: node batch_generate.js [count] [output_prefix] [seed]');
  console.log('  count          positive integer, max 1,000,000 (default: 1000)');
  console.log('  output_prefix  safe filename prefix (default: synthetic_dataset)');
  console.log('  seed           optional deterministic seed string/number');
  process.exit(errorMessage ? 1 : 0);
}

function parseArgs() {
  const rawCount = process.argv[2];
  const rawPrefix = process.argv[3];
  const rawSeed = process.argv[4];

  if (rawCount === '-h' || rawCount === '--help') showUsage();

  let batchSize = DEFAULT_BATCH_SIZE;
  if (rawCount !== undefined) {
    batchSize = parseInt(rawCount, 10);
    if (Number.isNaN(batchSize) || batchSize <= 0) {
      showUsage(`count must be a positive integer, got "${rawCount}"`);
    }
    if (batchSize > MAX_BATCH_SIZE) {
      showUsage(`count cannot exceed ${MAX_BATCH_SIZE.toLocaleString()}, got ${batchSize.toLocaleString()}`);
    }
  }

  let outputPrefix = DEFAULT_OUTPUT_PREFIX;
  if (rawPrefix !== undefined) {
    // Prevent path traversal and shell-special filenames
    const safePrefix = rawPrefix.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.+/, '');
    if (!safePrefix) showUsage(`output_prefix is not a valid filename, got "${rawPrefix}"`);
    outputPrefix = safePrefix;
  }

  const seed = rawSeed !== undefined ? rawSeed : undefined;

  return { batchSize, outputPrefix, seed };
}

const { batchSize, outputPrefix, seed } = parseArgs();

// Load the same distribution config used by the browser app
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'distribution_config.json'), 'utf8'));

const allCases = [];
const progressInterval = Math.max(1, Math.floor(batchSize / 50));
const startTime = Date.now();

for (let i = 0; i < batchSize; i++) {
  allCases.push(generateBlendedCase(i, CONFIG, seed));
  if ((i + 1) % progressInterval === 0 || i === batchSize - 1) {
    const pct = ((i + 1) / batchSize * 100).toFixed(0);
    process.stdout.write(`\rGenerating cases... ${pct}% (${(i + 1).toLocaleString()} / ${batchSize.toLocaleString()})`);
  }
}
process.stdout.write('\n');

const stats = calculateStatistics(allCases);
const fraudCount = allCases.filter(c => c.label.fraud_risk_level !== 'NONE').length;

const metadata = {
  generator_version: '1.0.0',
  timestamp: new Date().toISOString(),
  count: batchSize,
  seed: seed ?? null,
  config_checksum: 'sha256:pending',
  statistics: stats,
  outcome_counts: allCases.reduce((acc, c) => {
    acc[c.label.expected_outcome] = (acc[c.label.expected_outcome] || 0) + 1;
    return acc;
  }, {})
};

fs.writeFileSync(`${outputPrefix}.json`, JSON.stringify({ metadata, cases: allCases }, null, 2));
fs.writeFileSync(`${outputPrefix}.csv`, casesToCsv(allCases));

const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`Generated ${batchSize.toLocaleString()} cases in ${elapsedSec}s`);
if (seed) console.log(`Seed: ${seed}`);
console.log(`Fraud cases: ${fraudCount} (${(fraudCount / batchSize * 100).toFixed(1)}%)`);
console.log('Outcomes:', metadata.outcome_counts);
console.log('Statistics:');
console.table(stats);
console.log(`Saved ${outputPrefix}.json and ${outputPrefix}.csv`);
