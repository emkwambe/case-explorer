// scripts/smoke.mjs — Production smoke test. Run: SMOKE_URL=https://… npm run smoke
//
// Checks that the deployed page returns HTTP 200, finds its main bundle, confirms the bundle
// contains each view and the compliance footer, then runs the five test scripts
// (test:credit, test:dealers, test:funding, test:sandbox and the vitest suite). Exits non-zero on any failure.
// The bundle is only read as text, so which profile the app opens on is checked by the vitest
// suite ("opens on Solar prime at the bare URL"), which this script runs.

import { spawnSync } from "node:child_process";

const REQUIRED_STRINGS = ["Credit Risk Mode", "Dealer View", "Funding & Rates", "Public record", "Findings", "Leverage and liquidity", "Policy Sandbox", "Rate paths during the hold", "Not a consumer report"];
const TEST_SCRIPTS = ["test:credit", "test:dealers", "test:funding", "test:sandbox", "test"];

const url = process.env.SMOKE_URL;
if (!url) {
  console.error("Set SMOKE_URL to the production URL, for example SMOKE_URL=https://example.github.io/case-explorer/");
  process.exit(2);
}

let failed = false;
function result(ok, message) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failed = true;
}

console.log(`smoke: ${url}`);
const page = await fetch(url);
result(page.status === 200, `page returns HTTP ${page.status}`);
const html = await page.text();
const bundlePath = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1];
result(Boolean(bundlePath), `main bundle referenced${bundlePath ? `: ${bundlePath}` : ""}`);

if (bundlePath) {
  const bundleUrl = new URL(bundlePath, url).href;
  const bundle = await fetch(bundleUrl);
  result(bundle.status === 200, `bundle returns HTTP ${bundle.status}`);
  const js = await bundle.text();
  for (const s of REQUIRED_STRINGS) result(js.includes(s), `bundle contains "${s}"`);
}

for (const script of TEST_SCRIPTS) {
  const run = spawnSync("npm", ["run", "--silent", script], { stdio: "inherit", shell: process.platform === "win32" });
  result(run.status === 0, `npm run ${script} exited ${run.status}`);
}

console.log(failed ? "\nsmoke FAILED" : "\nsmoke passed");
process.exit(failed ? 1 : 0);
