// validate.js — Backwards-compatible entry point. The authoritative validation is
// `npm run benchmark` (scripts/benchmark.js); this wrapper runs it in verbose mode
// and keeps the old positional CLI: node validate.js [count] [seed]
import { runBenchmark } from "./scripts/benchmark.js";

const rawCount = process.argv[2];
const rawSeed = process.argv[3];
if (rawCount === "-h" || rawCount === "--help") {
  console.log("Usage: node validate.js [count] [seed]\n  Runs the authoritative benchmark in verbose mode. See `npm run benchmark -- --help`.");
  process.exit(0);
}
const count = rawCount !== undefined ? Math.max(100, parseInt(rawCount, 10) || 1000) : 1000;
const seed = rawSeed !== undefined ? String(rawSeed) : "42";

const { gates } = await runBenchmark({ count, seed, out: "artifacts", verbose: true, fail: true, stratified: 100, asOf: "2026-01-15" });
process.exit(gates.passed ? 0 : 1);
