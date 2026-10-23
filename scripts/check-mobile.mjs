// scripts/check-mobile.mjs — Phone-width layout check. Run: npm run check:mobile
//
// Builds the app, serves the build with `vite preview`, and opens ?profile=<slug> in headless
// Chromium at 375×812 and 2× scale. It visits Findings (with the seed-42 funded portfolio
// generated), Policy Sandbox, Public record, Dealer View, Funding & Rates (with the rate paths), and the case views with Credit Risk Mode
// on (Overview and Decision, with the underwriting sidebar and the case list), then challenge mode (the
// packs, a blind case with its answer form, and the reveal). On each it fails when
// the page scrolls sideways or a chart is wider than its container or draws text outside itself,
// and it saves a full-page screenshot. Screenshots go outside the repository. Run manually; there
// is no CI job for it.
//
// Options: --profile <slug> (default solar-prime), --out <dir> (default a new temporary directory),
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
const OUT = path.resolve(option("--out", fs.mkdtempSync(path.join(os.tmpdir(), "case-explorer-mobile-"))));
const BUILD = !args.includes("--no-build");
const PORT = 4180;
const WIDTH = 375;
const TIMEOUT = 15_000;
const PORTFOLIO_TIMEOUT = 180_000;
const MIN_FREE_MB = 3072;

class MissingTarget extends Error {}

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

/**
 * Layout problems on the current view: page-level horizontal overflow (with the widest elements
 * that cause it, ignoring content inside its own horizontal scroll container), and charts wider than
 * their container or with text drawn outside the chart.
 */
function layoutProblems() {
  const MIN_TEXT_PX = 8;
  const vw = document.documentElement.clientWidth;
  const out = [];
  const pageWidth = document.documentElement.scrollWidth;
  const describe = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : ""}`;
  const scrolls = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
  if (pageWidth > vw) {
    const wide = [...document.body.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > vw + 0.5 && !scrolls(el))
      .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 0.5 || el.parentElement === document.body)
      .slice(0, 6)
      .map((el) => `${describe(el)} right edge ${Math.round(el.getBoundingClientRect().right)}px`);
    out.push(`page scrolls sideways: ${pageWidth}px wide at a ${vw}px viewport${wide.length ? ` (${wide.join("; ")})` : ""}`);
  }
  for (const svg of document.querySelectorAll("svg[viewBox]")) {
    const box = svg.getBoundingClientRect();
    if (box.width === 0) continue;
    const name = describe(svg.closest("[data-testid]") ?? svg);
    const parent = svg.parentElement.getBoundingClientRect();
    // A chart wider than its frame is allowed only inside its own horizontal scroll frame.
    const framed = ["auto", "scroll"].includes(getComputedStyle(svg.parentElement).overflowX);
    if (box.width > parent.width + 1 && !framed) out.push(`${name}: chart ${Math.round(box.width)}px wide in a ${Math.round(parent.width)}px container`);
    const clipped = [...svg.querySelectorAll("text")].filter((t) => {
      const b = t.getBoundingClientRect();
      return b.width > 0 && (b.left < box.left - 1 || b.right > box.right + 1);
    }).map((t) => `"${t.textContent.slice(0, 30)}"`);
    if (clipped.length) out.push(`${name}: text outside the chart: ${clipped.slice(0, 4).join(", ")}`);
    // Readability: chart text is drawn in viewBox units, so its on-screen size shrinks with the chart.
    const scale = box.width / svg.viewBox.baseVal.width;
    const sizes = [...svg.querySelectorAll("text")].filter((t) => t.getBoundingClientRect().width > 0).map((t) => parseFloat(getComputedStyle(t).fontSize) * scale);
    if (sizes.length && Math.min(...sizes) < MIN_TEXT_PX) out.push(`${name}: chart text renders at ${Math.min(...sizes).toFixed(1)}px, below ${MIN_TEXT_PX}px`);
  }
  return out;
}

const freeMb = Math.round(os.freemem() / 2 ** 20);
if (freeMb < MIN_FREE_MB) { console.error(`check:mobile: ${freeMb} MB free, below ${MIN_FREE_MB} MB; close other programs and retry`); process.exit(1); }

if (BUILD) {
  console.log("check:mobile: building");
  const run = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) { console.error("check:mobile: build failed"); process.exit(run.status ?? 1); }
}
if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) { console.error("check:mobile: dist/index.html not found; run without --no-build"); process.exit(1); }

const server = await preview({ root: ROOT, logLevel: "warn", preview: { port: PORT, strictPort: true, open: false } });
const browser = await chromium.launch();
const failures = [];
let exitCode = 0;

try {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/?profile=${encodeURIComponent(PROFILE)}`, { waitUntil: "networkidle" });
  fs.mkdirSync(OUT, { recursive: true });

  // Self-test: a planted 600px element must be reported, so a pass is never vacuous.
  await page.evaluate(() => {
    const el = Object.assign(document.createElement("div"), { style: "width:600px;height:1px" });
    el.dataset.testid = "planted-wide";
    document.body.appendChild(el);
  });
  const planted = await page.evaluate(layoutProblems);
  await page.evaluate(() => document.querySelector("[data-testid=planted-wide]").remove());
  if (!planted.some((p) => p.includes("page scrolls sideways") && p.includes("planted-wide"))) throw new Error(`self-test: the overflow check missed a planted 600px element (${JSON.stringify(planted)})`);
  console.log("  ok   self-test: a planted 600px element is reported");

  const check = async (name, file) => {
    await page.waitForTimeout(300);
    const problems = await page.evaluate(layoutProblems);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: "disabled" });
    if (problems.length) { failures.push(...problems.map((p) => `${name}: ${p}`)); console.log(`  FAIL ${name}`); for (const p of problems) console.log(`         ${p}`); }
    else console.log(`  ok   ${name}`);
  };

  await openTab(page, "credit", "Findings");
  await need(page.getByTestId("findings-view"), "findings-view", 30_000);
  await (await need(page.getByTestId("findings-generate"), "findings-generate")).click();
  await need(page.getByTestId("findings-dealer-table"), "findings-dealer-table (portfolio generation)", PORTFOLIO_TIMEOUT);
  await check("Findings", "findings.png");

  // The pool comes from the same portfolio pass, so the sandbox is ready; a preset fills every panel.
  await openTab(page, "credit", "Policy Sandbox");
  await (await need(page.getByTestId("preset-dti50"), "preset-dti50")).click();
  await need(page.getByTestId("swap-table"), "swap-table");
  await check("Policy Sandbox", "policy-sandbox.png");

  await openTab(page, "credit", "Public record");
  await need(page.getByTestId("public-record-view"), "public-record-view", 30_000);
  await check("Public record", "public-record.png");

  await openTab(page, "credit", "Dealer View");
  await need(page.getByTestId("dealer-table"), "dealer-table");
  await check("Dealer View", "dealer-view.png");

  await openTab(page, "credit", "Funding & Rates");
  await need(page.getByTestId("panel-pricing-lag"), "panel-pricing-lag");
  await need(page.getByTestId("historical-table"), "historical-table (rate paths)", 30_000);
  await check("Funding & Rates", "funding-rates.png");

  const toggle = await need(page.getByTestId("credit-risk-mode"), "credit-risk-mode");
  if (!(await toggle.isChecked())) await toggle.check();
  await openTab(page, "case", "Overview");
  await need(page.getByTestId("case-list"), "case-list");
  await check("Credit lab: Overview with Credit Risk Mode", "credit-overview.png");
  await openTab(page, "case", "Decision");
  await check("Credit lab: Decision with Credit Risk Mode", "credit-decision.png");

  // Challenge mode: the pack list, a blind case with its answer form, and the reveal.
  await (await need(page.getByTestId("challenge-mode"), "challenge-mode")).click();
  await need(page.getByTestId("challenge-view"), "challenge-view", 30_000);
  await check("Challenge mode: packs and progress", "challenge-packs.png");
  await (await need(page.getByTestId("start-first-week"), "start-first-week")).click();
  await need(page.getByTestId("challenge-blind-case"), "challenge-blind-case");
  await check("Challenge mode: blind case and answer form", "challenge-blind.png");
  const form = page.getByTestId("challenge-attempt");
  await form.getByLabel("Review", { exact: true }).check();
  await form.locator('input[name="evidence"]').first().check();
  await (await need(page.getByTestId("challenge-commit"), "challenge-commit")).click();
  await need(page.getByTestId("challenge-reveal"), "challenge-reveal");
  await check("Challenge mode: reveal", "challenge-reveal.png");
} catch (err) {
  console.error(`check:mobile: ${err instanceof MissingTarget ? err.message : err.stack ?? err}`);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) exitCode = 1;
console.log(`  screenshots: ${OUT}`);
console.log(exitCode === 0 ? `check:mobile: passed at ${WIDTH}px` : `check:mobile: FAILED (${failures.length} problem${failures.length === 1 ? "" : "s"})`);
process.exit(exitCode);
