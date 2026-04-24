import { describe, expect, it } from "vitest";
import {
  buildQaseRunTitle,
  normalizeRancherHost,
  normalizeQaseWorkflowLabel,
  normalizeRancherVersionLabel,
  workflowDefinitions,
} from "./config";

describe("normalizeRancherVersionLabel", () => {
  it("strips a leading v from the Rancher version", () => {
    expect(normalizeRancherVersionLabel("v2.14.1")).toBe("2.14.1");
  });

  it("preserves versions that do not start with v", () => {
    expect(normalizeRancherVersionLabel("2.14.1")).toBe("2.14.1");
  });
});

describe("normalizeRancherHost", () => {
  it("strips protocol and dashboard paths from pasted Rancher URLs", () => {
    expect(
      normalizeRancherHost(
        "https://atb-1-sheep-1a12.example.test/dashboard/account/create-key",
      ),
    ).toBe("atb-1-sheep-1a12.example.test");
  });

  it("preserves a clean host value", () => {
    expect(normalizeRancherHost("atb-1-sheep-1a12.example.test")).toBe(
      "atb-1-sheep-1a12.example.test",
    );
  });

  it("handles alternate schemes, query strings, and trailing slashes", () => {
    expect(
      normalizeRancherHost("httpps://atb-1-sheep-1a12.example.test/?foo=bar"),
    ).toBe("atb-1-sheep-1a12.example.test");
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

describe("workflowDefinitions", () => {
  it("includes VAI disabled as a launchable suite", () => {
    expect(workflowDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "vai-disabled.yml",
          id: "vai-disabled",
          label: "VAI Disabled",
        }),
      ]),
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
