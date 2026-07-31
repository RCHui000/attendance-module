import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

describe("SelectContent overlay layering", () => {
  it("automatically uses the modal popover layer inside a dialog", () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>测试弹窗</DialogTitle>
          <DialogDescription>验证弹窗内下拉菜单层级</DialogDescription>
          <Select defaultValue="one">
            <SelectTrigger aria-label="测试选择">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one">选项一</SelectItem>
              <SelectItem value="two">选项二</SelectItem>
            </SelectContent>
          </Select>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "测试选择" }));

    expect(document.body.querySelector('[data-slot="select-content"]')).toHaveClass(
      "z-modal-popover",
    );
  });
});
