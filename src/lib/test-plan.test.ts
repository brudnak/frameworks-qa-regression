import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEST_PLAN_PRIORITY,
  generateTestPlanMarkdown,
  getTestEnvironmentTemplateMarkdown,
  parseTestScenarioLines,
} from "./test-plan";

describe("test plan generator", () => {
  it("parses one scenario title per non-empty line", () => {
    expect(parseTestScenarioLines(" First Case \n\nSecond Case\r\n  ")).toEqual([
      "First Case",
      "Second Case",
    ]);
  });

  it("generates a GitHub comment markdown test plan", () => {
    const markdown = generateTestPlanMarkdown(
      ["First Test Case", "Second Test Case"],
      DEFAULT_TEST_PLAN_PRIORITY,
    );

    expect(markdown).toContain("### 🧪 Test Cases");
    expect(markdown).toContain(
      "| 1   | P0       | [First Test Case](#test-1)  | ⏸️ NOT TESTED YET |",
    );
    expect(markdown).toContain(
      "🚨 2 test cases... CLICK TO EXPAND! (For table links to work) ⬅️",
    );
    expect(markdown).toContain("# 2 / Second Test Case Status: ⏸️ NOT TESTED YET");
  });

  it("adds the selected environment template to the top details block", () => {
    const markdown = generateTestPlanMarkdown(["Upgrade Rancher"], "P1", "rke2-ha");

    expect(markdown).toContain("## Reproduction Environment");
    expect(markdown).toContain("| RKE2 Local K8s Version           |");
    expect(markdown).toContain("## Reproduction steps");
    expect(markdown).toContain("| 1   | P1       | [Upgrade Rancher](#test-1)");
  });

  it("keeps the blank environment template empty", () => {
    expect(getTestEnvironmentTemplateMarkdown("none")).toBe("");
  });
});
