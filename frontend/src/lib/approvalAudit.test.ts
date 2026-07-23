import { describe, expect, it } from "vitest";

import {
  isNonApplicableProjectAssignee,
  isNonApplicableProjectSkip,
} from "./approvalAudit";

describe("approval audit visibility", () => {
  it("hides source review stages bypassed for a department-owner submission", () => {
    expect(
      isNonApplicableProjectSkip("Source review bypassed for department-owner submission"),
    ).toBe(true);
    expect(
      isNonApplicableProjectAssignee({
        comment: null,
        assignee_route_source: "department_owner_submitter",
      }),
    ).toBe(true);
  });
});
