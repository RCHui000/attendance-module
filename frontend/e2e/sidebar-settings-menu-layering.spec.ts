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

test("sidebar theme submenu is portaled above review content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);
  await page.goto("/review");
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("sidebar-settings-root").locator("button").hover();
  const settingsMenu = page.getByTestId("sidebar-settings-menu");
  await expect(settingsMenu).toBeVisible();

  await settingsMenu.locator('[role="menuitem"][aria-haspopup="menu"]').hover();
  const themeSubmenu = page.getByTestId("sidebar-theme-submenu");
  await expect(themeSubmenu).toBeVisible();

  const layering = await themeSubmenu.evaluate((submenu) => {
    const rect = submenu.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const style = window.getComputedStyle(submenu);
    const popoverZIndex = Number(window.getComputedStyle(document.documentElement).getPropertyValue("--z-popover"));

    return {
      insideAside: Boolean(submenu.closest("aside")),
      position: style.position,
      zIndex: Number(style.zIndex),
      popoverZIndex,
      inViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      topElementInsideSubmenu: Boolean(topElement && submenu.contains(topElement)),
    };
  });

  expect(layering).toMatchObject({
    insideAside: false,
    position: "fixed",
    inViewport: true,
    topElementInsideSubmenu: true,
  });
  expect(layering.zIndex).toBe(layering.popoverZIndex);
});
