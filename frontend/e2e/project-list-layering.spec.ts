import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const bootstrap = [{
  id: 1,
  name: "测试管理员",
  role: "admin",
  department: "总工办",
  is_active: true,
  permissions: {
    dashboard: "write",
    review: "write",
    timesheet: "write",
    report: "write",
    system_management: "write",
  },
  sidebar_order: {},
}];

const project = [{
  id: 101,
  code: "PMCC26002",
  name: "图层回归项目",
  work_kind: "project",
  business_type: "PMCC",
  status: "active",
  contract_amount: 0,
  received_amount: 0,
  planned_labor_days: 0,
  labor_budget_amount: 0,
}];

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001", exp: 4_102_444_800 }));
    localStorage.setItem("psa_access_token", `header.${payload}.signature`);
  });

  await page.route("**/rest/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/rpc/psa_current_user_bootstrap")) return json(route, bootstrap);
    if (path.endsWith("/hr_employee_current_view")) {
      return json(route, [{
        employee_id: 7,
        employee_name: "陈京京",
        org_id: 1,
        org_name: "造价咨询部",
        cost_specialty: "civil",
        employment_status: "active",
        is_active: true,
      }]);
    }
    if (path.endsWith("/user_roles")) return json(route, [{ employee_id: 7, role: "manager" }]);
    if (path.endsWith("/projects")) return json(route, project);
    if (path.endsWith("/organizations")) {
      return json(route, [{ id: 1, org_code: "CC", org_name: "造价咨询部", parent_id: null, status: "active" }]);
    }
    if (path.endsWith("/employees")) return json(route, [{ id: 7, name: "陈京京" }]);
    if (path.endsWith("/project_role_requirements")) {
      return json(route, [{
        business_type: "PMCC",
        role_key: "cc_civil_project_owner",
        role_label: "QS土建负责人",
        sort_order: 10,
        is_required: true,
        is_active: true,
      }]);
    }
    return json(route, []);
  });
}

async function openServiceTypeSelect(page: Page) {
  await page.goto("/report");
  await expect(page.getByRole("heading", { name: "项目列表" })).toBeVisible();
  await page.getByRole("button", { name: /PMCC26002/ }).click();
  const editor = page
    .getByText("项目配置", { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'rounded-lg')][1]");
  const trigger = page.getByText("服务类型", { exact: true }).locator("..").locator('[data-slot="select-trigger"]');
  await trigger.click();
  const option = page.getByRole("option", { name: "项目管理" });
  await expect(option).toBeVisible();
  return { editor, option };
}

async function expectOptionOnTop(page: Page, option: Locator, expectedLayer: string) {
  const result = await option.evaluate((element) => {
    const popup = element.closest('[data-slot="select-content"]');
    const rect = element.getBoundingClientRect();
    const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      popupIsOnTop: Boolean(topElement && popup?.contains(topElement)),
      popupZIndex: popup ? getComputedStyle(popup).zIndex : "",
    };
  });
  expect(result).toEqual({ popupIsOnTop: true, popupZIndex: expectedLayer });
}

test("desktop project select stays above the editor card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  const { editor, option } = await openServiceTypeSelect(page);

  await expect(editor).not.toHaveCSS("z-index", "80");
  await expectOptionOnTop(page, option, "40");
});

test("mobile project select stays above the modal editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  const { option } = await openServiceTypeSelect(page);

  await expect(page.getByRole("dialog", { name: "项目配置" })).toBeVisible();
  await expectOptionOnTop(page, option, "85");
});
