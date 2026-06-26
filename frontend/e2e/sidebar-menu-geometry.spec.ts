import { expect, test } from "@playwright/test";
import { isPointerInsideSubmenuGraceArea } from "../src/components/layout/sidebarMenuGeometry";

test.describe("sidebar submenu grace area", () => {
  test("keeps submenu open while the pointer moves diagonally toward it", () => {
    const submenu = { left: 220, top: 100, bottom: 220 };

    expect(
      isPointerInsideSubmenuGraceArea({
        previous: { x: 160, y: 160 },
        current: { x: 205, y: 175 },
        submenu,
      }),
    ).toBe(true);
  });

  test("does not keep submenu open when the pointer moves away from it", () => {
    const submenu = { left: 220, top: 100, bottom: 220 };

    expect(
      isPointerInsideSubmenuGraceArea({
        previous: { x: 160, y: 160 },
        current: { x: 130, y: 175 },
        submenu,
      }),
      ).toBe(false);
  });

  test("keeps a left-flipped submenu open while the pointer moves diagonally toward it", () => {
    const submenu = { left: 24, right: 168, top: 100, bottom: 220, side: "left" as const };

    expect(
      isPointerInsideSubmenuGraceArea({
        previous: { x: 230, y: 160 },
        current: { x: 182, y: 175 },
        submenu,
      }),
    ).toBe(true);
  });
});
