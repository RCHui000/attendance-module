import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RefreshBadge } from "./feedback";

describe("RefreshBadge", () => {
  it("uses a foreground color distinct from its muted background", () => {
    render(<RefreshBadge show />);

    const badge = screen.getByText("更新中");
    expect(badge).toHaveClass("text-foreground");
    expect(badge).not.toHaveClass("text-muted-foreground");
  });
});
