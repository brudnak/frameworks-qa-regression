import { describe, expect, it } from "vitest";
import {
  buildQaseRunTitle,
  normalizeQaseWorkflowLabel,
  normalizeRancherVersionLabel,
} from "./config";

describe("normalizeRancherVersionLabel", () => {
  it("strips a leading v from the Rancher version", () => {
    expect(normalizeRancherVersionLabel("v2.14.1")).toBe("2.14.1");
  });

  it("preserves versions that do not start with v", () => {
    expect(normalizeRancherVersionLabel("2.14.1")).toBe("2.14.1");
  });
});

describe("buildQaseRunTitle", () => {
  it("builds the simple Qase run title from the workflow label and version", () => {
    expect(buildQaseRunTitle("Frameworks Regression", "v2.14.1")).toBe(
      "[2.14.1] Frameworks: Regression",
    );
  });

  it("prefixes non-framework workflow labels under Frameworks", () => {
    expect(buildQaseRunTitle("Charts Webhook", "v2.14.1")).toBe(
      "[2.14.1] Frameworks: Charts Webhook",
    );
  });
});

describe("normalizeQaseWorkflowLabel", () => {
  it("drops a duplicated Frameworks prefix from the workflow label", () => {
    expect(normalizeQaseWorkflowLabel("Frameworks Regression")).toBe("Regression");
  });

  it("keeps other workflow labels unchanged", () => {
    expect(normalizeQaseWorkflowLabel("VAI Enabled")).toBe("VAI Enabled");
  });
});
