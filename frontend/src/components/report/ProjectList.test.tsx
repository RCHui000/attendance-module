import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectList } from "./ProjectList";

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => true,
}));

vi.mock("@/hooks/useReport", () => ({
  useProjectBase: () => ({
    data: [
      {
        id: 1,
        code: "CC26001",
        name: "移动端弹窗测试项目",
        business_type: "CONSULTING",
        work_kind: "project",
        status: "active",
        project_roles: [],
      },
    ],
    isLoading: false,
    isError: false,
  }),
  useEmployees: () => ({ data: [] }),
  useOrganizations: () => ({ data: [] }),
  useSaveProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProjectRoleRequirements: () => ({ data: [] }),
}));

vi.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [] }),
  useOrganizations: () => ({ data: [] }),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

describe("ProjectList mobile editor layering", () => {
  it("keeps the project editor above its blur backdrop", () => {
    render(<ProjectList />);

    fireEvent.click(screen.getByRole("button", { name: /CC26001/ }));

    const backdrop = screen.getAllByRole("button", { name: "关闭项目配置" })[0];
    const dialog = screen.getByRole("dialog", { name: "项目配置" });

    expect(backdrop).toHaveClass("z-modal");
    expect(dialog).toHaveClass("z-modal");
    expect(dialog).not.toHaveClass("max-[767px]:z-modal");
  });
});
