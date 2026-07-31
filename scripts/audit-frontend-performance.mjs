import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("../frontend/node_modules/playwright");

const targetUrl = process.env.PERF_BASE_URL || process.argv[2] || "https://xpjs.asia/";
const runCount = Math.max(1, Number(process.env.PERF_RUNS || 3));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

const browser = await chromium.launch({ headless: true });
const runs = [];

for (let run = 0; run < runCount; run += 1) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.addInitScript(() => {
    window.__psaLcp = 0;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries[entries.length - 1];
      if (latest) window.__psaLcp = latest.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });

  const response = await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const scripts = resources.filter((entry) => entry.initiatorType === "script");
    const styles = resources.filter((entry) => entry.initiatorType === "link" && entry.name.includes(".css"));
    const firstPaint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime || 0;
    return {
      domContentLoaded: navigation.domContentLoadedEventEnd,
      load: navigation.loadEventEnd,
      firstContentfulPaint: firstPaint,
      largestContentfulPaint: window.__psaLcp || 0,
      transferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      encodedBodyBytes: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      decodedBodyBytes: resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      scriptEncodedBytes: scripts.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      styleEncodedBytes: styles.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      resourceCount: resources.length,
      renderedText: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 120),
    };
  });
  runs.push({ status: response?.status() || 0, ...metrics });
  await context.close();
}

await browser.close();

const summary = {
  url: targetUrl,
  runs: runCount,
  median: {
    domContentLoadedMs: Math.round(median(runs.map((run) => run.domContentLoaded))),
    loadMs: Math.round(median(runs.map((run) => run.load))),
    firstContentfulPaintMs: Math.round(median(runs.map((run) => run.firstContentfulPaint))),
    largestContentfulPaintMs: Math.round(median(runs.map((run) => run.largestContentfulPaint))),
    transferBytes: Math.round(median(runs.map((run) => run.transferBytes))),
    encodedBodyBytes: Math.round(median(runs.map((run) => run.encodedBodyBytes))),
    decodedBodyBytes: Math.round(median(runs.map((run) => run.decodedBodyBytes))),
    scriptEncodedBytes: Math.round(median(runs.map((run) => run.scriptEncodedBytes))),
    styleEncodedBytes: Math.round(median(runs.map((run) => run.styleEncodedBytes))),
    resourceCount: Math.round(median(runs.map((run) => run.resourceCount))),
  },
  samples: runs,
};

console.log(JSON.stringify(summary, null, 2));

if (runs.some((run) => run.status >= 400 || !run.renderedText)) {
  process.exit(1);
}
