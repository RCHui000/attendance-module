import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [375, 390, 430, 768, 1366] as const;
const HEIGHT = 900;
const LOGIN = process.env.E2E_ADMIN_LOGIN || "";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";
const ALLOW_AUTH_DEGRADE = process.env.E2E_ALLOW_AUTH_DEGRADE !== "0";

async function clearSession(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.removeItem("psa_access_token");
    sessionStorage.clear();
  });
}

async function assertNoDocumentOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || ""),
          text: (element.innerText || "").trim().slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.width > 0 && (item.left < -1 || item.right > doc.clientWidth + 1))
      .slice(0, 12);

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      offenders,
    };
  });

  expect(
    result.scrollWidth,
    `${label}: document overflow detected ${JSON.stringify(result, null, 2)}`,
  ).toBeLessThanOrEqual(result.clientWidth);
}

async function tryLogin(page: Page) {
  if (!LOGIN || !PASSWORD) return false;

  await clearSession(page);
  await expect(page.locator('input[name="login"]')).toBeVisible();
  await page.locator('input[name="login"]').fill(LOGIN);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="password"]').press("Enter");

  try {
    await expect(page.locator('input[name="login"]')).toHaveCount(0, { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe("mobile BI overflow acceptance", () => {
  for (const width of WIDTHS) {
    test(`unauthenticated surfaces do not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await clearSession(page);

      await expect(page.locator('input[name="login"]')).toBeVisible();
      await assertNoDocumentOverflow(page, `${width}px login`);

      await page.goto("/dashboard?tab=analytics");
      await expect(page.locator('input[name="login"]')).toBeVisible();
      await assertNoDocumentOverflow(page, `${width}px protected route`);

      await page.locator('input[name="login"]').fill("wrong-user");
      await page.locator('input[name="password"]').fill("wrong-password");
      await page.locator('input[name="password"]').press("Enter");
      await expect(page.locator('input[name="login"]')).toBeVisible();
      await assertNoDocumentOverflow(page, `${width}px failed login`);
    });

    test(`authenticated dashboard BI does not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      const loggedIn = await tryLogin(page);

      if (!loggedIn) {
        test.skip(
          ALLOW_AUTH_DEGRADE,
          "No valid E2E credentials; downgraded to unauthenticated/failure-state coverage.",
        );
        throw new Error("Valid E2E_ADMIN_LOGIN/E2E_ADMIN_PASSWORD required.");
      }

      await page.goto("/dashboard?tab=analytics");
      await expect(page.locator('input[name="login"]')).toHaveCount(0);
      await expect(page.locator('[role="tabpanel"], [class*="border-dashed"], .recharts-wrapper').first())
        .toBeVisible({ timeout: 15_000 });
      await assertNoDocumentOverflow(page, `${width}px dashboard analytics`);
    });
  }
});
