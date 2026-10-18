// scripts/capture-findings.mjs — Captures the Findings images. Run: npm run capture:findings
//
// Builds the app, serves the build with `vite preview`, opens ?profile=<slug> in headless Chromium
// at 1280×800 and 2× scale, generates the seed-42 funded portfolio, and writes seven PNGs and a
// captions README to docs/findings/. It also prints the Findings tab to a PDF in a temporary
// directory and checks the brief fits on one page. Exits non-zero if any target element is missing
// or the brief needs more than one page. Run manually; there is no CI job for it.
//
// Options: --profile <slug> (default solar-prime), --out <dir> (default docs/findings),
//          --no-build (serve the existing dist/).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PROFILE = option("--profile", "solar-prime");
const OUT = path.resolve(ROOT, option("--out", path.join("docs", "findings")));
const BUILD = !args.includes("--no-build");
const PORT = 4179;
const TIMEOUT = 15_000;
const PORTFOLIO_TIMEOUT = 180_000;

class MissingTarget extends Error {}

/** Waits for a visible target; a missing one fails the run. */
async function need(locator, name, timeout = TIMEOUT) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    throw new MissingTarget(`target missing: ${name}`);
  }
  return locator.first();
}

async function openTab(page, section, tab) {
  await (await need(page.getByTestId(`section-${section}`), `section-${section}`)).click();
  await (await need(page.getByRole("tab", { name: tab, exact: true }), `tab "${tab}"`)).click();
}

const text = async (page, testId) => ((await need(page.getByTestId(testId), testId)).textContent()).then((t) => t.trim());

if (BUILD) {
  console.log("capture: building");
  const run = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) { console.error("capture: build failed"); process.exit(run.status ?? 1); }
}
if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) { console.error("capture: dist/index.html not found; run without --no-build"); process.exit(1); }

const server = await preview({ root: ROOT, logLevel: "warn", preview: { port: PORT, strictPort: true, open: false } });
const base = `http://localhost:${PORT}/`;
const browser = await chromium.launch();
const written = [];
let exitCode = 0;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const shot = async (locator, file, opts = {}) => {
    const target = path.join(OUT, file);
    await locator.screenshot({ path: target, animations: "disabled", ...opts });
    written.push(target);
  };
  await page.goto(`${base}?profile=${encodeURIComponent(PROFILE)}`, { waitUntil: "networkidle" });
  // Let the main column grow with its content, so each element is captured whole.
  await page.addStyleTag({ content: ".ce-layout > .ce-main, .ce-layout > .ce-library { max-height: none !important; overflow: visible !important; }" });
  fs.mkdirSync(OUT, { recursive: true });

  // Findings, with the seed-42 funded portfolio generated first.
  await openTab(page, "credit", "Findings");
  const view = await need(page.getByTestId("findings-view"), "findings-view");
  await (await need(page.getByTestId("findings-generate"), "findings-generate")).click();
  await need(page.getByTestId("findings-dealer-table"), "findings-dealer-table (portfolio generation)", PORTFOLIO_TIMEOUT);
  const fig = {
    corr: await text(page, "findings-correlation-value"),
    n: await text(page, "findings-correlation-n"),
    breakEven: await text(page, "findings-break-even"),
    dealer: await text(page, "findings-largest-dealer"),
    advanceShare: await text(page, "findings-largest-advance-share"),
    rating: await text(page, "findings-largest-rating"),
    delta: await text(page, "findings-failure-delta"),
    runway: await text(page, "findings-runway-months"),
    runwayQuarter: await text(page, "findings-runway-quarter"),
    chapter11: await text(page, "findings-event-date"),
    monthsToEvent: await text(page, "findings-months-to-event")
  };
  const dealerId = await (await need(page.getByTestId("findings-f2"), "findings-f2")).getAttribute("data-largest-advance-dealer");
  if (!dealerId) throw new MissingTarget("target missing: data-largest-advance-dealer on findings-f2");

  await shot(view, "findings-overview.png");
  await shot(await need(page.getByTestId("findings-f1-chart"), "findings-f1-chart"), "f1-take-rate-and-fed-funds.png");
  await shot(await need(page.getByTestId("findings-f3-chart"), "findings-f3-chart"), "f3-runway-timeline.png");

  // The printable brief: print the Findings tab and count the pages.
  const pdfPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "findings-brief-")), "brief.pdf");
  await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  const pages = (fs.readFileSync(pdfPath, "latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  console.log(`  print view: ${pages} page${pages === 1 ? "" : "s"} (${pdfPath})`);
  if (pages !== 1) { console.error("capture: the printed brief is not one page"); exitCode = 1; }

  // Funding & Rates, pricing-lag panel with its inputs.
  await openTab(page, "credit", "Funding & Rates");
  await shot(await need(page.getByTestId("panel-pricing-lag"), "panel-pricing-lag"), "f1-break-even.png");
  const tile = await text(page, "tile-break-even");

  // Dealer View: the table's caption, header and top ten rows, then the failure scenario.
  await openTab(page, "credit", "Dealer View");
  const table = await need(page.getByTestId("dealer-table"), "dealer-table");
  const rows = table.locator("tbody tr");
  await need(rows.nth(9), "dealer-table row 10");
  // The table is wider than its scroll container at 1280 px; let it overflow so the p-value and
  // rating columns are in the image.
  await table.evaluate((t) => { t.parentElement.style.overflow = "visible"; });
  await table.scrollIntoViewIfNeeded();
  const tableBox = await table.boundingBox();
  const rowBox = await rows.nth(9).boundingBox();
  // Bounding boxes are relative to the viewport; a full-page clip is in page coordinates.
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const clip = { x: tableBox.x + scroll.x, y: tableBox.y + scroll.y, width: tableBox.width, height: rowBox.y + rowBox.height - tableBox.y };
  const tablePng = path.join(OUT, "f2-dealer-table.png");
  await page.screenshot({ path: tablePng, clip, fullPage: true, animations: "disabled" });
  written.push(tablePng);
  await (await need(page.getByTestId(`fail-${dealerId}`), `fail-${dealerId}`)).click();
  const failFile = `f2-fail-${dealerId.toLowerCase().replace(/[^a-z0-9]/g, "")}.png`;
  await shot(await need(page.getByTestId("dealer-failure-result"), "dealer-failure-result"), failFile);

  // Public record, data provenance panel.
  await openTab(page, "credit", "Public record");
  await shot(await need(page.getByTestId("panel-provenance"), "panel-provenance", 30_000), "provenance.png");

  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT, encoding: "utf8" }).stdout.trim() !== "";
  const commit = dirty ? `${head} plus uncommitted changes` : head;
  const captions = [
    ["findings-overview.png", "The Findings tab under Solar prime: question, data, method, three findings and limits.", "Computed in the app from the pinned public-record snapshot (data/public-record/) and the synthetic seed-42 funded portfolio."],
    ["f1-take-rate-and-fed-funds.png", `Take rate (platform fees ÷ funded loans) above the quarterly average fed funds rate, two panels on one quarter axis; correlation ${fig.corr} (n = ${fig.n} quarters), descriptive, not causal.`, "Funded loans and platform fees typed from Sunlight Financial's 10-Q and 10-K filings with page references (data/public-record/manual-extractions.csv); FRED series DFF."],
    ["f1-break-even.png", `Funding & Rates pricing-lag panel at the Solar prime default inputs; break-even rate shock ${tile.replace(/^Break-even shock/, "").replace(/fee at sale reaches zero$/, "").trim()} (Findings shows ${fig.breakEven}).`, "src/fundingStress.js; inputs from src/profiles/solarPrime.js, each tagged as an assumption or a disclosed range from the FY2022 Form 10-K."],
    ["f2-dealer-table.png", "Dealer View table, top ten dealers by loan exposure, with 30+ DPD, p-values and ratings.", "Synthetic 10,000-loan funded book (seed 42) from src/dealers.js; dealers are fictional IDs and every metric is simulated under a set dealer-effect strength."],
    [failFile, `Failure scenario for ${fig.dealer}, the synthetic dealer holding the largest advance (${fig.advanceShare} of all advances, rated ${fig.rating}): change in expected loss ${fig.delta}.`, "simulateDealerFailure in src/dealers.js over the synthetic book; the largest advance is sized to Sunlight Financial's September 28, 2022 press release."],
    ["f3-runway-timeline.png", `Cash at quarter end with dated events; runway ${fig.runway} at ${fig.runwayQuarter}, the last quarter where it can be computed; Chapter 11 filed ${fig.chapter11}, ${fig.monthsToEvent} months later.`, "SEC XBRL cash and operating cash flow (data/public-record/sunlight-quarterly.json); each event's source is in data/public-record/events.json."],
    ["provenance.png", "Data provenance panel: sources and hashes, deduplication, gaps and reconciliation.", "data/public-record/manifest.json and data/public-record/sunlight-quarterly.json."]
  ];
  const readme = [
    "# Findings images",
    "",
    `Captured by \`npm run capture:findings\` (scripts/capture-findings.mjs) from the app built at commit ${commit}, profile \`${PROFILE}\`, at 1280×800 and 2× scale. The dealer figures come from the synthetic funded portfolio generated with seed 42 before capture, so they match the numbers on the Findings tab. Borrowers and dealers are synthetic; only the public-record facts are real, and each one is sourced in the app.`,
    "",
    "| Image | Caption | Source |",
    "|---|---|---|",
    ...captions.map(([file, caption, source]) => `| \`${file}\` | ${caption} | ${source} |`),
    ""
  ].join("\n");
  const readmePath = path.join(OUT, "README.md");
  fs.writeFileSync(readmePath, readme, "utf8");
  written.push(readmePath);
} catch (err) {
  console.error(`capture: ${err instanceof MissingTarget ? err.message : err.stack ?? err}`);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}

for (const f of written) console.log(`  ${path.relative(ROOT, f)}  ${fs.statSync(f).size.toLocaleString("en-US")} bytes`);
console.log(exitCode === 0 ? `capture: ${written.length} files written` : "capture: FAILED");
process.exit(exitCode);
