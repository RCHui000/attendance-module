import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectList } from "./ProjectList";

const mediaQueryMock = vi.hoisted(() => ({ isMobile: true }));

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => mediaQueryMock.isMobile,
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
  beforeEach(() => {
    mediaQueryMock.isMobile = true;
  });

  it("keeps the project editor above its blur backdrop", () => {
    render(<ProjectList />);

    fireEvent.click(screen.getByRole("button", { name: /CC26001/ }));

    const backdrop = screen.getAllByRole("button", { name: "关闭项目配置" })[0];
    const dialog = screen.getByRole("dialog", { name: "项目配置" });

    expect(backdrop).toHaveClass("z-modal");
    expect(dialog).not.toHaveClass("z-modal");
    expect(dialog).toHaveClass("max-[767px]:z-[var(--z-modal)]");

    const trigger = dialog.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);
    const popup = Array.from(document.body.querySelectorAll('[data-slot="select-content"]')).at(-1);
    expect(popup).toHaveClass(
      "z-modal-popover",
    );
  });

  it("keeps desktop editor selects above the project configuration cards", () => {
    mediaQueryMock.isMobile = false;
    const { container } = render(<ProjectList />);

    fireEvent.click(within(container).getByRole("button", { name: /CC26001/ }));
    const editor = within(container).getByText("项目配置").closest("div.rounded-lg");
    expect(editor).not.toBeNull();
    expect(editor).not.toHaveClass("z-modal");

    const trigger = container.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    const popup = Array.from(document.body.querySelectorAll('[data-slot="select-content"]')).at(-1);
    expect(popup).toHaveClass("z-dropdown");
  });
});
