import { describe, expect, it } from "vitest";
import { buildIssueRadarReport } from "./issue-radar";

describe("buildIssueRadarReport", () => {
  it("splits issues into single-owner, over-assigned, missing-owner, and QA/None lanes", () => {
    const report = buildIssueRadarReport(
      {
        milestone: "v2.14.0",
        repo: "rancher/rancher",
        label: "team/frameworks",
        users: ["brudnak", "fillipehmeireles"],
      },
      [
        {
          number: 101,
          title: "Single owner issue",
          html_url: "https://github.com/rancher/rancher/issues/101",
          labels: [{ name: "QA/M" }, { name: "kind/bug" }],
          assignees: [{ login: "brudnak" }],
        },
        {
          number: 102,
          title: "Assigned to both",
          html_url: "https://github.com/rancher/rancher/issues/102",
          labels: [{ name: "QA/L" }, { name: "kind/enhancement" }],
          assignees: [{ login: "brudnak" }, { login: "fillipehmeireles" }],
        },
        {
          number: 103,
          title: "Missing selected owner",
          html_url: "https://github.com/rancher/rancher/issues/103",
          labels: [{ name: "QA/S" }],
          assignees: [{ login: "someone-else" }],
        },
        {
          number: 104,
          title: "QA none issue",
          html_url: "https://github.com/rancher/rancher/issues/104",
          labels: [{ name: "QA/None" }],
          assignees: [{ login: "fillipehmeireles" }],
        },
      ],
    );

    expect(report.totals.grandTotalFetched).toBe(4);
    expect(report.totals.totalCategorized).toBe(3);
    expect(report.totals.qaNone).toBe(1);
    expect(report.totals.exactlyOne).toBe(1);
    expect(report.totals.overAssigned).toBe(1);
    expect(report.totals.missingOwner).toBe(1);

    expect(report.buckets.find((bucket) => bucket.id === "solo-brudnak")?.count).toBe(1);
    expect(report.buckets.find((bucket) => bucket.id === "over-assigned")?.count).toBe(1);
    expect(report.buckets.find((bucket) => bucket.id === "missing-owner")?.count).toBe(1);
    expect(report.qaNone).toHaveLength(1);
  });
});
