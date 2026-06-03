import { expect, test, type Page } from "@playwright/test";

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN || "jss";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "123456";
const EMPLOYEE_LOGIN = process.env.E2E_EMPLOYEE_LOGIN;
const EMPLOYEE_PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD || "123456";

type CandidateUser = {
  login_name: string;
  employee_name?: string;
  employee_id?: number;
  roles?: string[];
};

async function clearSession(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("psa_access_token"));
}

async function login(page: Page, loginName: string, password: string, timeout = 20_000) {
  await clearSession(page);
  await page.reload();
  await expect(page.locator('input[name="login"]')).toBeVisible();
  await page.locator('input[name="login"]').fill(loginName);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="password"]').press("Enter");
  await expect(page.locator('input[name="login"]')).toHaveCount(0, { timeout });
  await expect(page).toHaveURL(/\/(dashboard|timesheet|review|report|employees)?$/);
}

async function waitForAppReady(page: Page) {
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Auth request failed|Supabase request failed|Bad Gateway|Not authenticated|加载失败|鍔犺浇澶辫触|鏁版嵁鍔犺浇澶辫触/i);
}

async function gotoAppPath(page: Page, path: string) {
  await page.goto(path);
  await waitForAppReady(page);
  await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
}

async function expectLoadedTableOrEmptyState(page: Page) {
  await expect(page.locator("table").first().or(page.locator('[class*="border-dashed"]').first())).toBeVisible();
}

async function expectReviewTables(page: Page) {
  const table = page.locator("table").first();
  const loadFailure = page.getByText(/加载失败|鍔犺浇澶辫触|鏁版嵁鍔犺浇澶辫触/).first();
  await expect(table.or(loadFailure)).toBeVisible({ timeout: 15_000 });
  if (await loadFailure.isVisible()) {
    throw new Error("Approval center data failed to load in production.");
  }
  await expect.poll(async () => page.locator("table").count()).toBeGreaterThan(0);
}

async function expectChartOrEmptyState(page: Page) {
  const tabpanel = page.locator('[role="tabpanel"]');
  const chart = tabpanel.locator(".recharts-wrapper, .recharts-responsive-container, svg.recharts-surface, [role='application']").first();
  const emptyState = page.locator('[class*="border-dashed"]').first().or(page.getByText(/暂无|鏆傛棤/).first());
  await expect(chart.or(emptyState)).toBeVisible({ timeout: 15_000 });
  if (await chart.isVisible()) {
    await expect(tabpanel.locator("svg").first()).toBeVisible();
  }
}

async function findEmployeeCandidates(page: Page): Promise<CandidateUser[]> {
  return page.evaluate(async () => {
    const token = localStorage.getItem("psa_access_token");
    if (!token) return [];
    const headers = { Authorization: `Bearer ${token}` };

    const viewResponse = await fetch("/rest/hr_employee_current_view?select=employee_id,employee_name,login_name,is_active&is_active=eq.true&order=employee_id.asc", { headers });
    if (!viewResponse.ok) return [];
    const users = await viewResponse.json() as CandidateUser[];

    const roleResponse = await fetch("/rest/user_roles?select=employee_id,role", { headers });
    const roleRows = roleResponse.ok ? await roleResponse.json() as Array<{ employee_id: number; role: string }> : [];
    const rolesByEmployee = new Map<number, string[]>();
    for (const row of roleRows) {
      const roles = rolesByEmployee.get(row.employee_id) || [];
      roles.push(row.role);
      rolesByEmployee.set(row.employee_id, roles);
    }

    const uniqueUsers = new Map<string, CandidateUser>();
    users
      .map((user) => ({ ...user, roles: rolesByEmployee.get(Number(user.employee_id)) || [] }))
      .filter((user) => user.login_name && user.login_name !== "jss" && !user.roles?.includes("admin") && !user.roles?.includes("manager"))
      .forEach((user) => uniqueUsers.set(user.login_name, user));
    return Array.from(uniqueUsers.values()).slice(0, 4);
  });
}

test.describe("production smoke acceptance", () => {
  test("admin can log in and see dashboard first screen", async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("aside button")).toHaveCount(5);
    await expectLoadedTableOrEmptyState(page);
  });

  test("admin approval center shows pending and reviewed surfaces", async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
    await gotoAppPath(page, "/review");
    await expectReviewTables(page);
    await page.getByRole("button").nth(1).click();
    await expectReviewTables(page);
  });

  test("dashboard analytics tab renders chart or a deliberate empty state", async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
    await gotoAppPath(page, "/dashboard");
    await page.getByRole("tab").nth(1).click();
    await expectChartOrEmptyState(page);
  });

  test("employee can log in and see timesheet first screen", async ({ page }) => {
    await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
    const candidates = EMPLOYEE_LOGIN
      ? [{ login_name: EMPLOYEE_LOGIN }]
      : await findEmployeeCandidates(page);

    test.skip(candidates.length === 0, "No normal employee account was discoverable. Set E2E_EMPLOYEE_LOGIN/E2E_EMPLOYEE_PASSWORD or ask the main agent to create one.");

    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        await login(page, candidate.login_name, EMPLOYEE_PASSWORD, 6_000);
        failures.length = 0;
        break;
      } catch {
        failures.push(candidate.login_name);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Could not authenticate a normal employee with password ${EMPLOYEE_PASSWORD}. Tried: ${failures.join(", ")}. Set E2E_EMPLOYEE_LOGIN/E2E_EMPLOYEE_PASSWORD or ask the main agent to create/reset a normal employee account.`);
    }

    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/timesheet$/);
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("aside button")).toHaveCount(1);
  });
});
