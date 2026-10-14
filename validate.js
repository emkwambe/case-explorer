// validate.js — Backwards-compatible entry point. The authoritative validation is
// `npm run benchmark` (scripts/benchmark.js); this wrapper runs it in verbose mode on the same
// sample CI gates on (2,000 blended cases, seed 42, 150 per stratum, as-of 2026-01-15) and
// writes to reports/validate/ (git-ignored), so a local run never rewrites committed artifacts.
// Positional overrides are kept: node validate.js [count] [seed]
import { runBenchmark } from "./scripts/benchmark.js";

const rawCount = process.argv[2];
const rawSeed = process.argv[3];
if (rawCount === "-h" || rawCount === "--help") {
  console.log("Usage: node validate.js [count] [seed]\n  Runs the authoritative benchmark in verbose mode (default: CI sample, 2000 cases, seed 42) and writes to reports/validate/. See `npm run benchmark -- --help`.");
  process.exit(0);
}
const count = rawCount !== undefined ? Math.max(100, parseInt(rawCount, 10) || 2000) : 2000;
const seed = rawSeed !== undefined ? String(rawSeed) : "42";

const { gates } = await runBenchmark({ count, seed, out: "reports/validate", verbose: true, fail: true, stratified: 150, asOf: "2026-01-15" });
process.exit(gates.passed ? 0 : 1);
