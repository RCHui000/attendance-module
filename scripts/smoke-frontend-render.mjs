import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let chromium;
try {
  ({ chromium } = require("../frontend/node_modules/playwright"));
} catch (error) {
  console.error("Missing Playwright. Run `npm --prefix frontend ci` before this smoke test.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const targetUrl = process.env.E2E_BASE_URL || process.argv[2] || "https://xpjs.asia/";
const expectedVersion = process.env.EXPECTED_VERSION || process.env.VITE_APP_VERSION || "";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const runtimeErrors = [];

page.on("pageerror", (error) => {
  runtimeErrors.push(error.stack || error.message);
});

page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    runtimeErrors.push(message.text());
  }
});

const response = await page.goto(targetUrl, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(2000);

const state = await page.evaluate(() => {
  const root = document.querySelector("#root");
  return {
    title: document.title,
    rootChildCount: root?.childElementCount ?? 0,
    rootText: root?.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "",
    scripts: Array.from(document.scripts).map((script) => script.src),
  };
});

await browser.close();

if (!response || response.status() >= 400) {
  console.error(`Frontend smoke failed: HTTP ${response?.status() ?? "no response"} from ${targetUrl}`);
  process.exit(1);
}

if (runtimeErrors.length > 0) {
  console.error("Frontend smoke failed: browser runtime errors detected.");
  for (const error of runtimeErrors.slice(0, 10)) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (state.rootChildCount < 1 || !state.rootText) {
  console.error("Frontend smoke failed: #root did not render visible application content.");
  console.error(JSON.stringify(state, null, 2));
  process.exit(1);
}

if (expectedVersion && !state.rootText.includes(expectedVersion)) {
  console.error(`Frontend smoke failed: expected version ${expectedVersion} was not visible in rendered text.`);
  console.error(JSON.stringify(state, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      url: targetUrl,
      status: response.status(),
      title: state.title,
      rootChildCount: state.rootChildCount,
      renderedTextPreview: state.rootText,
      scripts: state.scripts,
    },
    null,
    2,
  ),
);
