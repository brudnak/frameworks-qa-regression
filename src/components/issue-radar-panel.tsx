"use client";

import { useMemo, useState, useTransition } from "react";
import type { IssueRadarDefaults, IssueRadarReport } from "@/lib/issue-radar";

type BannerState =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }
  | null;

type IssueRadarPanelProps = {
  defaults: IssueRadarDefaults;
};

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

export function IssueRadarPanel({ defaults }: IssueRadarPanelProps) {
  const defaultUsers =
    defaults.users.length > 0 ? defaults.users : ["brudnak", "fillipehmeireles"];
  const [isPending, startTransition] = useTransition();
  const [banner, setBanner] = useState<BannerState>(null);
  const [report, setReport] = useState<IssueRadarReport | null>(null);
  const [reportMessage, setReportMessage] = useState("");
  const [activeFilter, setActiveFilter] = useState<
    "all" | "problems" | "clean" | "qa-none"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({
    milestone: "",
    repo: defaults.repo,
    label: defaults.label,
    users: defaultUsers,
    githubToken: "",
    codeFreezeDate: "",
  });

  const countdown = useMemo(() => {
    const target = parseLocalDate(form.codeFreezeDate);

    if (!target) {
      return null;
    }

    const today = new Date();
    const todayAtMidnight = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const targetAtMidnight = new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
    );
    const days = Math.round(
      (targetAtMidnight.getTime() - todayAtMidnight.getTime()) / 86_400_000,
    );

    return {
      days,
      dateLabel: target.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    };
  }, [form.codeFreezeDate]);

  const visibleReport = useMemo(() => {
    if (!report) {
      return null;
    }

    const query = searchTerm.trim().toLowerCase();
    const matches = (title: string, number: number) =>
      !query ||
      title.toLowerCase().includes(query) ||
      String(number).includes(query.replace(/^#/, ""));

    const buckets = report.buckets
      .filter((bucket) => {
        if (activeFilter === "all") {
          return true;
        }

        if (activeFilter === "clean") {
          return bucket.kind === "clean";
        }

        if (activeFilter === "problems") {
          return bucket.kind === "problem";
        }

        return false;
      })
      .map((bucket) => ({
        ...bucket,
        issues: bucket.issues.filter((issue) => matches(issue.title, issue.number)),
      }));

    const qaNone =
      activeFilter === "all" || activeFilter === "qa-none"
        ? report.qaNone.filter((issue) => matches(issue.title, issue.number))
        : [];

    return {
      ...report,
      buckets,
      qaNone,
    };
  }, [activeFilter, report, searchTerm]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);

    startTransition(async () => {
      const response = await fetch("/api/issue-radar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          milestone: form.milestone,
          repo: form.repo,
          label: form.label,
          users: form.users,
          githubToken: form.githubToken,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        report?: IssueRadarReport;
      };

      if (!response.ok || !payload.report) {
        setBanner({
          kind: "error",
          message: payload.error ?? "Unable to run the issue radar right now.",
        });
        return;
      }

      setReport(payload.report);
      setReportMessage(payload.message ?? "Report generated from the GitHub API.");
      setBanner({
        kind: "success",
        message: "Issue radar loaded.",
      });
    });
  }

  function updateUser(index: number, value: string) {
    setForm((current) => ({
      ...current,
      users: current.users.map((user, userIndex) =>
        userIndex === index ? value : user,
      ),
    }));
  }

  function addUser() {
    setForm((current) => ({
      ...current,
      users:
        current.users.length >= 8
          ? current.users
          : [
              ...current.users,
              defaultUsers.find((user) => !current.users.includes(user)) ?? "",
            ],
    }));
  }

  function removeUser(index: number) {
    setForm((current) => ({
      ...current,
      users: current.users.length <= 1
        ? current.users
        : current.users.filter((_, userIndex) => userIndex !== index),
    }));
  }

  return (
    <section className="dashboard-shell">
      <div className="dashboard-grid radar-top-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Issue Radar</p>
              <h3 className="panel-title">Milestone assignment board</h3>
              <p className="field-help">
                Pull a live milestone report from GitHub and split issues into owner lanes,
                problem lanes, and QA/None.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="field-grid">
              <label className="field-shell">
                <span className="field-label">Milestone</span>
                <input
                  placeholder="v2.14.0"
                  value={form.milestone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      milestone: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field-shell">
                <span className="field-label">Repository</span>
                <input
                  placeholder="rancher/rancher"
                  value={form.repo}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repo: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field-shell">
                <span className="field-label">Team Label</span>
                <input
                  placeholder="team/frameworks"
                  value={form.label}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field-shell">
                <span className="field-label">GitHub Token</span>
                <input
                  type="password"
                  placeholder="Optional, used only for this request"
                  value={form.githubToken}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      githubToken: event.target.value,
                    }))
                  }
                />
              </label>

              <div className="field-shell full-width">
                <span className="field-label">Selected Owners</span>
                <div className="owner-list">
                  {form.users.map((user, index) => (
                    <div className="owner-row" key={`${index}-${user}`}>
                      <input
                        placeholder="GitHub login"
                        value={user}
                        onChange={(event) => updateUser(index, event.target.value)}
                      />
                      <button
                        className="ghost-button owner-remove"
                        onClick={() => removeUser(index)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="button-row">
                  <button
                    className="ghost-button"
                    disabled={form.users.length >= 8}
                    onClick={addUser}
                    type="button"
                  >
                    Add owner
                  </button>
                </div>
                <span className="field-help">
                  Use one to eight GitHub logins. Each in-scope issue should ideally land on exactly one person from this list.
                </span>
              </div>
            </div>

            <div className="button-row" style={{ marginTop: "18px" }}>
              <button className="primary-button" disabled={isPending} type="submit">
                {isPending ? "Loading..." : "Run Issue Radar"}
              </button>
            </div>

            {banner ? (
              <div className={`status-banner ${banner.kind}`}>{banner.message}</div>
            ) : null}
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Code Freeze</p>
              <h3 className="panel-title">Countdown</h3>
              <p className="field-help">
                Keep the milestone board grounded against the next freeze date.
              </p>
            </div>
          </div>

          <div className="field-grid">
            <label className="field-shell full-width">
              <span className="field-label">Freeze Date</span>
              <input
                type="date"
                value={form.codeFreezeDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    codeFreezeDate: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <article className="countdown-card">
            {countdown ? (
              <>
                <p className="small-label">Next code freeze</p>
                <p className="countdown-value">
                  {countdown.days > 0
                    ? `${countdown.days} day${countdown.days === 1 ? "" : "s"} left`
                    : countdown.days === 0
                      ? "Freeze is today"
                      : `${Math.abs(countdown.days)} day${Math.abs(countdown.days) === 1 ? "" : "s"} past`}
                </p>
                <p className="stat-meta">Target date: {countdown.dateLabel}</p>
              </>
            ) : (
              <>
                <p className="small-label">No freeze date yet</p>
                <p className="helper-text">Pick a date and this will show the countdown.</p>
              </>
            )}
          </article>
        </section>
      </div>

      {report ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Rule</p>
                <h3 className="panel-title">Assignment guardrail</h3>
                <p className="field-help">
                  Expected: exactly one selected owner on every non-QA/None issue.
                  Anything in Missing a selected owner or Assigned to multiple selected
                  owners needs attention before release.
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Report Status</p>
                <h3 className="panel-title">Live GitHub milestone data</h3>
                <p className="field-help">
                  {reportMessage}
                </p>
              </div>
            </div>

            <div className="stats-grid">
              <article className="stat-card">
                <p className="small-label">Fetched issues</p>
                <p className="stat-value">{report.totals.grandTotalFetched}</p>
              </article>
              <article className="stat-card">
                <p className="small-label">Categorized</p>
                <p className="stat-value">{report.totals.totalCategorized}</p>
              </article>
              <article className="stat-card">
                <p className="small-label">QA/None</p>
                <p className="stat-value">{report.totals.qaNone}</p>
              </article>
              <article className="stat-card">
                <p className="small-label">Over-assigned</p>
                <p className="stat-value">{report.totals.overAssigned}</p>
              </article>
              <article className="stat-card">
                <p className="small-label">Missing owner</p>
                <p className="stat-value">{report.totals.missingOwner}</p>
              </article>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Owners</p>
                <h3 className="panel-title">Single-owner loadout</h3>
              </div>
            </div>

            <div className="user-card-grid">
              {visibleReport?.userCards.map((card) => (
                <article className="user-card" key={card.displayName}>
                  <div className="user-card-header">
                    <div>
                      <p className="small-label">Owner</p>
                      <h4>{card.displayName}</h4>
                    </div>
                  </div>
                  <div className="user-metrics">
                    <p><strong>{card.issueCount}</strong> clean issues</p>
                    <p><strong>{card.enhanceCount}</strong> enhancements</p>
                    <p><strong>{card.bugCount}</strong> bugs</p>
                    <p><strong>{card.otherCount}</strong> other / untyped</p>
                  </div>
                  {card.lacksQaSize > 0 ? (
                    <>
                      <p className="user-warning">
                        Warning: missing QA size on {card.lacksQaSize} issues.
                      </p>
                      <p className="user-todo">
                        TODO: add sizing to {card.lacksQaSize} issues.
                      </p>
                    </>
                  ) : (
                    <p className="user-ok">QA sizing is clean for this owner lane.</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Breakdown</p>
                <h3 className="panel-title">Assignment lanes</h3>
                <p className="field-help">
                  Filter the board down to clean lanes, problem lanes, or QA/None.
                </p>
              </div>
            </div>

            <div className="radar-toolbar">
              <div className="badge-row">
                {[
                  ["all", "All lanes"],
                  ["problems", "Problems only"],
                  ["clean", "Clean only"],
                  ["qa-none", "QA/None"],
                ].map(([value, label]) => (
                  <button
                    className={`dashboard-tab ${activeFilter === value ? "active" : ""}`}
                    key={value}
                    onClick={() =>
                      setActiveFilter(value as "all" | "problems" | "clean" | "qa-none")
                    }
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="field-shell radar-search">
                <span className="field-label">Search issues</span>
                <input
                  placeholder="Search by issue title or number"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>

            {(activeFilter === "all" || activeFilter === "clean" || activeFilter === "problems") ? (
              <div className="bucket-grid">
                {visibleReport?.buckets.map((bucket) => (
                  <section
                    className={`bucket-card ${bucket.kind === "problem" ? "bucket-card-problem" : ""}`}
                    key={bucket.id}
                  >
                    <p className="small-label">{bucket.count} tracked</p>
                    <h4>{bucket.title}</h4>
                    {bucket.id === "missing-owner" ? (
                      <p className="bucket-warning">
                        These issues are in scope but nobody from the selected list is assigned.
                      </p>
                    ) : null}
                    {bucket.id === "over-assigned" ? (
                      <p className="bucket-warning">
                        These issues have more than one selected owner assigned and need to be narrowed down.
                      </p>
                    ) : null}

                    {bucket.issues.length > 0 ? (
                      <div className="issue-list">
                        {bucket.issues.map((issue) => (
                          <article className="issue-card" key={`${bucket.id}-${issue.number}`}>
                            <h5>
                              <a href={issue.url} rel="noreferrer" target="_blank">
                                #{issue.number} {issue.title}
                              </a>
                            </h5>
                            <div className="issue-meta">
                              <span className="pill">{issue.qaSize}</span>
                              <span className="pill">{issue.kind}</span>
                            </div>
                            <p className="issue-assignees">
                              Owners: {issue.assignees.join(", ")}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="helper-text">{bucket.emptyMessage}</p>
                    )}
                  </section>
                ))}
              </div>
            ) : null}

            {(activeFilter === "all" || activeFilter === "qa-none") ? (
              <section className="qa-none-section">
                <div className="panel-header">
                  <div>
                    <p className="section-label">Excluded</p>
                    <h3 className="panel-title">QA/None issues</h3>
                  </div>
                </div>

                {visibleReport && visibleReport.qaNone.length > 0 ? (
                  <div className="issue-list">
                    {visibleReport.qaNone.map((issue) => (
                      <article className="issue-card" key={`qa-none-${issue.number}`}>
                        <h5>
                          <a href={issue.url} rel="noreferrer" target="_blank">
                            #{issue.number} {issue.title}
                          </a>
                        </h5>
                        <div className="issue-meta">
                          <span className="pill">{issue.qaSize}</span>
                          <span className="pill">{issue.kind}</span>
                        </div>
                        <p className="issue-assignees">
                          Owners: {issue.assignees.join(", ")}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="helper-text">No QA/None issues matched the current filter.</p>
                )}
              </section>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Ownership</p>
                <h3 className="panel-title">Exactly-one-owner check</h3>
              </div>
            </div>

            <div className="table-wrap">
              <table className="radar-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Issue count</th>
                  </tr>
                </thead>
                <tbody>
                  {report.assigneeSummary.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">QA Size</p>
                <h3 className="panel-title">QA size by assignment state</h3>
              </div>
            </div>

            <div className="table-wrap">
              <table className="radar-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    {report.qaLabels.map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.qaRows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      {row.counts.map((count, index) => (
                        <td key={`${row.label}-${report.qaLabels[index]}`}>{count}</td>
                      ))}
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Issue Type</p>
                <h3 className="panel-title">Clean owner lanes by type</h3>
              </div>
            </div>

            <div className="table-wrap">
              <table className="radar-table">
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th>Enhancements</th>
                    <th>Bugs</th>
                    <th>Other / untyped</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.kindRows.map((row) => (
                    <tr key={row.displayName}>
                      <td>{row.displayName}</td>
                      <td>{row.enhancement}</td>
                      <td>{row.bug}</td>
                      <td>{row.other}</td>
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="helper-text">
              This table only counts issues assigned to exactly one selected owner.
            </p>
          </section>
        </>
      ) : null}
    </section>
  );
}
