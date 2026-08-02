import { expect, test } from "@playwright/test";

test("login bundle reaches Supabase instead of failing on missing runtime config", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("账号").fill("__runtime_config_probe__");
  await page.locator("#loginPassword").fill("invalid-probe-password");

  const authResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/auth/") &&
      response.url().includes("token"),
  );

  await page.getByRole("button", { name: "登录", exact: true }).click();
  const response = await authResponse;

  expect([400, 401, 403, 429]).toContain(response.status());
  const error = page.locator("p.text-destructive");
  await expect(error).toBeVisible();
  await expect(error).not.toContainText("supabaseKey is required");
  await expect(error).not.toContainText("supabaseUrl is required");
});
