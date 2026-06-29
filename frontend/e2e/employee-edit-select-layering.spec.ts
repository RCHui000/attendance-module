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
    await page.goto("/employees");
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

test("employee edit select layering keeps modal dropdown above page content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);
  await page.goto("/employees");

  await expect(page.getByRole("heading", { name: "员工列表" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("tbody tr").filter({ hasNotText: "暂无人员" }).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "编辑员工" }).first().click();
  const dialog = page.getByRole("dialog", { name: "员工配置" });
  await expect(dialog).toBeVisible();

  const roleTrigger = dialog.locator('[data-slot="select-trigger"]').first();
  await roleTrigger.click();

  const roleList = page.locator('[data-slot="select-content"]').filter({ hasText: "管理员" }).last();
  await expect(roleList).toBeVisible();

  const adminOption = roleList.getByText("管理员", { exact: true });
  await expect(adminOption).toBeVisible();

  const layering = await adminOption.evaluate((option) => {
    const popup = option.closest('[data-slot="select-content"]');
    const rect = option.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const popupStyle = popup ? window.getComputedStyle(popup) : null;
    const modalPopoverZIndex = Number(
      window.getComputedStyle(document.documentElement).getPropertyValue("--z-modal-popover"),
    );

    return {
      optionIsOnTop: Boolean(topElement && option.contains(topElement)),
      popupIsOnTop: Boolean(topElement && popup?.contains(topElement)),
      zIndex: popupStyle ? Number(popupStyle.zIndex) : 0,
      modalPopoverZIndex,
    };
  });

  expect(layering).toMatchObject({
    popupIsOnTop: true,
  });
  expect(layering.zIndex).toBe(layering.modalPopoverZIndex);

  const selectedRowsBefore = await page.locator("tbody tr.bg-row-selected").count();
  await adminOption.click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("管理员", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr.bg-row-selected")).toHaveCount(selectedRowsBefore);
});
