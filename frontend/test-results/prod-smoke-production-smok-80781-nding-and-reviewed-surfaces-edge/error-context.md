# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prod-smoke.spec.ts >> production smoke acceptance >> admin approval center shows pending and reviewed surfaces
- Location: e2e\prod-smoke.spec.ts:103:3

# Error details

```
Error: Approval center data failed to load in production.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [ref=e6]:
        - generic [ref=e7]: 勤
        - generic [ref=e8]:
          - strong [ref=e9]: 项目自动核算系统
          - text: 管理员
      - navigation [ref=e10]:
        - button "数据看板" [ref=e11]
        - button "审批中心" [ref=e12]
        - button "我的周表" [ref=e13]
        - button "项目列表" [ref=e14]
        - button "员工与组织" [ref=e15]
      - img "Logo" [ref=e18]
      - generic [ref=e20]: 鞠松松 · 造价二部
    - main [ref=e21]:
      - generic [ref=e22]:
        - generic [ref=e23]:
          - text: 审批中心
          - heading "周表与加班 OT" [level=1] [ref=e24]
        - generic [ref=e25]:
          - generic [ref=e26]: 鞠松松
          - button "修改密码" [ref=e27]:
            - img
            - text: 修改密码
          - button "退出" [ref=e28]:
            - img
            - text: 退出
      - generic [ref=e29]:
        - button "刷新" [ref=e31]:
          - img
          - text: 刷新
        - generic [ref=e32]: 数据加载失败，请点击刷新重试
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN || "jss";
  4   | const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "123456";
  5   | const EMPLOYEE_LOGIN = process.env.E2E_EMPLOYEE_LOGIN;
  6   | const EMPLOYEE_PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD || "123456";
  7   | 
  8   | type CandidateUser = {
  9   |   login_name: string;
  10  |   employee_name?: string;
  11  |   employee_id?: number;
  12  |   roles?: string[];
  13  | };
  14  | 
  15  | async function clearSession(page: Page) {
  16  |   await page.goto("/");
  17  |   await page.evaluate(() => localStorage.removeItem("psa_access_token"));
  18  | }
  19  | 
  20  | async function login(page: Page, loginName: string, password: string, timeout = 20_000) {
  21  |   await clearSession(page);
  22  |   await page.reload();
  23  |   await expect(page.locator('input[name="login"]')).toBeVisible();
  24  |   await page.locator('input[name="login"]').fill(loginName);
  25  |   await page.locator('input[name="password"]').fill(password);
  26  |   await page.locator('input[name="password"]').press("Enter");
  27  |   await expect(page.locator('input[name="login"]')).toHaveCount(0, { timeout });
  28  |   await expect(page).toHaveURL(/\/(dashboard|timesheet|review|report|employees)?$/);
  29  | }
  30  | 
  31  | async function waitForAppReady(page: Page) {
  32  |   await expect(page.locator("aside")).toBeVisible();
  33  |   await expect(page.locator("body")).not.toContainText(/Auth request failed|Supabase request failed|Bad Gateway|Not authenticated|加载失败|鍔犺浇澶辫触|鏁版嵁鍔犺浇澶辫触/i);
  34  | }
  35  | 
  36  | async function gotoAppPath(page: Page, path: string) {
  37  |   await page.goto(path);
  38  |   await waitForAppReady(page);
  39  |   await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
  40  | }
  41  | 
  42  | async function expectLoadedTableOrEmptyState(page: Page) {
  43  |   await expect(page.locator("table").first().or(page.locator('[class*="border-dashed"]').first())).toBeVisible();
  44  | }
  45  | 
  46  | async function expectReviewTables(page: Page) {
  47  |   const table = page.locator("table").first();
  48  |   const loadFailure = page.getByText(/加载失败|鍔犺浇澶辫触|鏁版嵁鍔犺浇澶辫触/).first();
  49  |   await expect(table.or(loadFailure)).toBeVisible({ timeout: 15_000 });
  50  |   if (await loadFailure.isVisible()) {
> 51  |     throw new Error("Approval center data failed to load in production.");
      |           ^ Error: Approval center data failed to load in production.
  52  |   }
  53  |   await expect.poll(async () => page.locator("table").count()).toBeGreaterThan(0);
  54  | }
  55  | 
  56  | async function expectChartOrEmptyState(page: Page) {
  57  |   const tabpanel = page.locator('[role="tabpanel"]');
  58  |   const chart = tabpanel.locator(".recharts-wrapper, .recharts-responsive-container, svg.recharts-surface, [role='application']").first();
  59  |   const emptyState = page.locator('[class*="border-dashed"]').first().or(page.getByText(/暂无|鏆傛棤/).first());
  60  |   await expect(chart.or(emptyState)).toBeVisible({ timeout: 15_000 });
  61  |   if (await chart.isVisible()) {
  62  |     await expect(tabpanel.locator("svg").first()).toBeVisible();
  63  |   }
  64  | }
  65  | 
  66  | async function findEmployeeCandidates(page: Page): Promise<CandidateUser[]> {
  67  |   return page.evaluate(async () => {
  68  |     const token = localStorage.getItem("psa_access_token");
  69  |     if (!token) return [];
  70  |     const headers = { Authorization: `Bearer ${token}` };
  71  | 
  72  |     const viewResponse = await fetch("/rest/hr_employee_current_view?select=employee_id,employee_name,login_name,is_active&is_active=eq.true&order=employee_id.asc", { headers });
  73  |     if (!viewResponse.ok) return [];
  74  |     const users = await viewResponse.json() as CandidateUser[];
  75  | 
  76  |     const roleResponse = await fetch("/rest/user_roles?select=employee_id,role", { headers });
  77  |     const roleRows = roleResponse.ok ? await roleResponse.json() as Array<{ employee_id: number; role: string }> : [];
  78  |     const rolesByEmployee = new Map<number, string[]>();
  79  |     for (const row of roleRows) {
  80  |       const roles = rolesByEmployee.get(row.employee_id) || [];
  81  |       roles.push(row.role);
  82  |       rolesByEmployee.set(row.employee_id, roles);
  83  |     }
  84  | 
  85  |     const uniqueUsers = new Map<string, CandidateUser>();
  86  |     users
  87  |       .map((user) => ({ ...user, roles: rolesByEmployee.get(Number(user.employee_id)) || [] }))
  88  |       .filter((user) => user.login_name && user.login_name !== "jss" && !user.roles?.includes("admin") && !user.roles?.includes("manager"))
  89  |       .forEach((user) => uniqueUsers.set(user.login_name, user));
  90  |     return Array.from(uniqueUsers.values()).slice(0, 4);
  91  |   });
  92  | }
  93  | 
  94  | test.describe("production smoke acceptance", () => {
  95  |   test("admin can log in and see dashboard first screen", async ({ page }) => {
  96  |     await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
  97  |     await waitForAppReady(page);
  98  |     await expect(page).toHaveURL(/\/dashboard$/);
  99  |     await expect(page.locator("aside button")).toHaveCount(5);
  100 |     await expectLoadedTableOrEmptyState(page);
  101 |   });
  102 | 
  103 |   test("admin approval center shows pending and reviewed surfaces", async ({ page }) => {
  104 |     await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
  105 |     await gotoAppPath(page, "/review");
  106 |     await expectReviewTables(page);
  107 |     await page.getByRole("button").nth(1).click();
  108 |     await expectReviewTables(page);
  109 |   });
  110 | 
  111 |   test("dashboard analytics tab renders chart or a deliberate empty state", async ({ page }) => {
  112 |     await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
  113 |     await gotoAppPath(page, "/dashboard");
  114 |     await page.getByRole("tab").nth(1).click();
  115 |     await expectChartOrEmptyState(page);
  116 |   });
  117 | 
  118 |   test("employee can log in and see timesheet first screen", async ({ page }) => {
  119 |     await login(page, ADMIN_LOGIN, ADMIN_PASSWORD);
  120 |     const candidates = EMPLOYEE_LOGIN
  121 |       ? [{ login_name: EMPLOYEE_LOGIN }]
  122 |       : await findEmployeeCandidates(page);
  123 | 
  124 |     test.skip(candidates.length === 0, "No normal employee account was discoverable. Set E2E_EMPLOYEE_LOGIN/E2E_EMPLOYEE_PASSWORD or ask the main agent to create one.");
  125 | 
  126 |     const failures: string[] = [];
  127 |     for (const candidate of candidates) {
  128 |       try {
  129 |         await login(page, candidate.login_name, EMPLOYEE_PASSWORD, 6_000);
  130 |         failures.length = 0;
  131 |         break;
  132 |       } catch (error) {
  133 |         failures.push(candidate.login_name);
  134 |       }
  135 |     }
  136 | 
  137 |     if (failures.length > 0) {
  138 |       throw new Error(`Could not authenticate a normal employee with password ${EMPLOYEE_PASSWORD}. Tried: ${failures.join(", ")}. Set E2E_EMPLOYEE_LOGIN/E2E_EMPLOYEE_PASSWORD or ask the main agent to create/reset a normal employee account.`);
  139 |     }
  140 | 
  141 |     await waitForAppReady(page);
  142 |     await expect(page).toHaveURL(/\/timesheet$/);
  143 |     await expect(page.locator("table")).toBeVisible();
  144 |     await expect(page.locator("aside button")).toHaveCount(1);
  145 |   });
  146 | });
  147 | 
```