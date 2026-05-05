import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIssueRadarBriefText,
  buildIssueRadarReport,
  generateIssueRadarBrief,
} from "./issue-radar";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("builds a copy-ready assignment brief without history by default", () => {
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
          title: "Missing selected owner",
          html_url: "https://github.com/rancher/rancher/issues/102",
          labels: [{ name: "QA/S" }],
          assignees: [{ login: "someone-else" }],
        },
      ],
    );

    const brief = buildIssueRadarBriefText(report, {
      codeFreezeDate: "2026-04-01",
    });

    expect(brief).toContain("Assignment review brief");
    expect(brief).toContain("Code freeze: Apr 1, 2026");
    expect(brief).toContain("Missing a selected owner (1)");
    expect(brief).toContain("Link: https://github.com/rancher/rancher/issues/102");
    expect(brief).toContain("Clean owner lanes");
    expect(brief).not.toContain("Recent closed issue samples by owner");
  });

  it("includes recent closed issue samples when history is requested", () => {
    const report = buildIssueRadarReport(
      {
        milestone: "v2.14.0",
        repo: "rancher/rancher",
        label: "team/frameworks",
        users: ["brudnak"],
      },
      [
        {
          number: 101,
          title: "Single owner issue",
          html_url: "https://github.com/rancher/rancher/issues/101",
          labels: [{ name: "QA/M" }, { name: "kind/bug" }],
          assignees: [{ login: "brudnak" }],
        },
      ],
    );

    const brief = buildIssueRadarBriefText(report, {
      includeHistory: true,
      historyLimit: 30,
      historyByUser: {
        brudnak: [
          {
            number: 88,
            title: "Older issue",
            url: "https://github.com/rancher/rancher/issues/88",
            closedAt: "Mar 20, 2026",
            labels: ["kind/bug"],
            snippet: "Fixes an older frameworks-related bug.",
          },
        ],
      },
    });

    expect(brief).toContain("Recent closed issue samples by owner (last 30)");
    expect(brief).toContain("brudnak (1)");
    expect(brief).toContain("Link: https://github.com/rancher/rancher/issues/88");
    expect(brief).toContain("Snippet: Fixes an older frameworks-related bug.");
  });

  it("builds a history brief when one selected owner has no closed team-label history", async () => {
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        requestedUrls.push(url.toString());

        if (url.pathname === "/repos/rancher/rancher/milestones") {
          return Response.json([{ number: 9, title: "v2.14.0" }]);
        }

        if (url.pathname === "/repos/rancher/rancher/issues") {
          const state = url.searchParams.get("state");
          const assignee = url.searchParams.get("assignee");

          if (state === "open") {
            return Response.json([
              {
                number: 101,
                title: "Needs owner",
                html_url: "https://github.com/rancher/rancher/issues/101",
                labels: [{ name: "QA/M" }, { name: "kind/bug" }],
                assignees: [],
              },
            ]);
          }

          if (state === "closed" && assignee === "brudnak") {
            return Response.json([
              {
                number: 88,
                title: "Older issue",
                html_url: "https://github.com/rancher/rancher/issues/88",
                body: "Fixes an older frameworks-related bug.",
                closed_at: "2026-03-20T12:00:00Z",
                labels: [{ name: "team/frameworks" }],
                assignees: [{ login: "brudnak" }],
              },
            ]);
          }

          if (state === "closed" && assignee === "Josh-Diamond") {
            return Response.json({ message: "Validation Failed" }, { status: 422 });
          }
        }

        return Response.json({ message: "Unexpected request" }, { status: 500 });
      }),
    );

    const result = await generateIssueRadarBrief({
      milestone: "v2.14.0",
      repo: "rancher/rancher",
      label: "team/frameworks",
      users: ["brudnak", "Josh-Diamond"],
      includeHistory: true,
      historyLimit: 30,
    });

    expect(result.brief.text).toContain("Missing a selected owner (1)");
    expect(result.brief.text).toContain("Link: https://github.com/rancher/rancher/issues/101");
    expect(result.brief.text).toContain("brudnak (1)");
    expect(result.brief.text).toContain("Josh-Diamond (0)");
    expect(result.brief.text).toContain("- None collected.");
    expect(
      requestedUrls.some((url) => {
        const parsed = new URL(url);
        return (
          parsed.searchParams.get("state") === "closed" &&
          parsed.searchParams.get("labels") === "team/frameworks"
        );
      }),
    ).toBe(true);
  });
});
