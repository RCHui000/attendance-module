import { expect, test, type Page } from "@playwright/test";

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "123456";
const ACCESS_TOKEN = process.env.E2E_ACCESS_TOKEN;

async function clearSession(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("psa_access_token"));
}

async function login(page: Page) {
  await clearSession(page);
  if (ACCESS_TOKEN) {
    await page.evaluate((token) => localStorage.setItem("psa_access_token", token), ACCESS_TOKEN);
    await page.goto("/dashboard");
    await expect(page.locator('input[name="login"]')).toHaveCount(0, { timeout: 20_000 });
    return;
  }
  await page.reload();
  await expect(page.locator('input[name="login"]')).toBeVisible();
  await page.locator('input[name="login"]').fill(ADMIN_LOGIN);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await page.locator('input[name="password"]').press("Enter");
  await expect(page.locator('input[name="login"]')).toHaveCount(0, { timeout: 20_000 });
}

async function gotoReview(page: Page) {
  await login(page);
  await page.goto("/review");
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 });
}

async function expectNoDocumentOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
    };
  });
  expect(
    metrics.scrollWidth,
    `${label} overflowed document width: ${metrics.scrollWidth} > ${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 2);
}

function timesheetRows(page: Page) {
  return page.locator("tbody tr").filter({ has: page.locator("td:nth-child(1) svg") });
}

test("admin review rows stay contained and do not duplicate identical pending tasks", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoReview(page);
  await expectNoDocumentOverflow(page, "review list");

  const rowCount = await timesheetRows(page).count();
  test.skip(rowCount === 0, "No visible review rows to exercise.");

  const duplicateRows = await page.locator("tbody tr").evaluateAll((rows) => {
    const seen = new Map<string, number>();
    const duplicates: string[] = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll(":scope > td"));
      if (cells.length !== 7 || !cells[0].querySelector("svg")) continue;

      const key = cells
        .slice(1, 6)
        .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() || "")
        .join("|");
      if (!key.replace(/\|/g, "").trim()) continue;

      const count = seen.get(key) || 0;
      if (count > 0) duplicates.push(key);
      seen.set(key, count + 1);
    }

    return duplicates;
  });
  expect(duplicateRows).toEqual([]);

  const firstRow = timesheetRows(page).first();
  await firstRow.click();
  const expandedRows = page.locator("tbody tr").filter({ has: page.locator("section[aria-label='审批链路']") });
  await expect(expandedRows).toHaveCount(1);
  const detailBeforeChain = await expandedRows.first().evaluate((row) => {
    const detailTable = row.querySelector("td table");
    const approvalChain = row.querySelector("section[aria-label='审批链路']");
    if (!detailTable || !approvalChain) return false;
    return Boolean(detailTable.compareDocumentPosition(approvalChain) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(detailBeforeChain).toBe(true);
  await expectNoDocumentOverflow(page, "expanded review row");

  await firstRow.click();
  await expect(expandedRows).toHaveCount(0);
  await expectNoDocumentOverflow(page, "collapsed review row");
});
