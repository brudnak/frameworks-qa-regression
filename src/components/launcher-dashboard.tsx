"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VersionSummary, WorkflowRunSummary } from "@/lib/github";
import type { WorkflowDefinition } from "@/lib/config";

type DashboardProps = {
  login?: string;
  owner: string;
  repo: string;
  profiles: string[];
  workflows: WorkflowDefinition[];
  recentRuns: WorkflowRunSummary[];
  versionSummaries: VersionSummary[];
};

type BannerState =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }
  | null;

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getConclusionClass(run: WorkflowRunSummary) {
  if (run.conclusion === "success") {
    return "success";
  }

  if (run.conclusion === "failure") {
    return "failure";
  }

  return "pending";
}

export function LauncherDashboard({
  login,
  owner,
  repo,
  profiles,
  workflows,
  recentRuns,
  versionSummaries,
}: DashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [banner, setBanner] = useState<BannerState>(null);
  const [form, setForm] = useState({
    workflowId: workflows[0]?.id ?? "",
    profile: profiles[0] ?? "",
    rancherVersion: "",
    rancherHost: "",
    rancherAdminToken: "",
    clusterName: "",
    tenantRancherHost: "",
    tenantRancherAdminToken: "",
    tenantClusterName: "",
    notes: "",
  });

  const topSummary = useMemo(() => versionSummaries.slice(0, 4), [versionSummaries]);
  const selectedWorkflow = workflows.find(
    (workflow) => workflow.id === form.workflowId,
  );
  const needsTenantRancher = !!selectedWorkflow?.requiresTenantRancher;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);

    startTransition(async () => {
      const response = await fetch("/api/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setBanner({
          kind: "error",
          message: payload.error ?? "Unable to queue the workflow right now.",
        });
        return;
      }

      setBanner({
        kind: "success",
        message: payload.message ?? "Workflow queued successfully.",
      });

      setForm((current) => ({
        ...current,
        rancherAdminToken: "",
        tenantRancherAdminToken: "",
      }));

      router.refresh();
    });
  }

  return (
    <section className="dashboard-shell">
      <div className="dashboard-header">
        <div>
          <p className="section-label">Repository</p>
          <h2>
            {owner}/{repo}
          </h2>
          <p className="helper-text">
            Signed in as @{login ?? "unknown"} and ready to launch QA runs.
          </p>
        </div>

        <div className="badge-row">
          {profiles.map((profile) => (
            <span className="badge" key={profile}>
              profile:{profile}
            </span>
          ))}
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Launch</p>
              <h3 className="panel-title">Queue a workflow run</h3>
              <p className="field-help">
                Update one profile bucket, then dispatch the selected GitHub
                Actions suite tagged with the Rancher version you are
                validating.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="field-grid">
              <label className="field-shell">
                <span className="field-label">Workflow</span>
                <select
                  value={form.workflowId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      workflowId: event.target.value,
                    }))
                  }
                >
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.label}
                    </option>
                  ))}
                </select>
                <span className="field-help">
                  {selectedWorkflow?.description ?? "Choose the QA suite to launch."}
                </span>
              </label>

              <label className="field-shell">
                <span className="field-label">Profile Bucket</span>
                <select
                  value={form.profile}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      profile: event.target.value,
                    }))
                  }
                >
                  {profiles.map((profile) => (
                    <option key={profile} value={profile}>
                      {profile}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-shell">
                <span className="field-label">Rancher Version</span>
                <input
                  placeholder="v2.14.0"
                  value={form.rancherVersion}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rancherVersion: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field-shell">
                <span className="field-label">
                  {needsTenantRancher ? "Hosted Cluster Name" : "Cluster Name"}
                </span>
                <input
                  placeholder="qa-management-01"
                  value={form.clusterName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      clusterName: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field-shell full-width">
                <span className="field-label">
                  {needsTenantRancher ? "Hosted Rancher URL" : "Rancher URL"}
                </span>
                <input
                  placeholder="https://rancher.example.com"
                  value={form.rancherHost}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rancherHost: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field-shell full-width">
                <span className="field-label">
                  {needsTenantRancher
                    ? "Hosted Rancher Admin Token"
                    : "Rancher Admin Token"}
                </span>
                <input
                  type="password"
                  placeholder="token-abc123"
                  value={form.rancherAdminToken}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rancherAdminToken: event.target.value,
                    }))
                  }
                />
              </label>

              {needsTenantRancher ? (
                <>
                  <label className="field-shell full-width">
                    <span className="field-label">Tenant Rancher URL</span>
                    <input
                      placeholder="https://tenant-rancher.example.com"
                      value={form.tenantRancherHost}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          tenantRancherHost: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="field-shell full-width">
                    <span className="field-label">Tenant Rancher Admin Token</span>
                    <input
                      type="password"
                      placeholder="token-tenant-abc123"
                      value={form.tenantRancherAdminToken}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          tenantRancherAdminToken: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="field-shell">
                    <span className="field-label">Tenant Cluster Name</span>
                    <input
                      placeholder="local"
                      value={form.tenantClusterName}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          tenantClusterName: event.target.value,
                        }))
                      }
                    />
                    <span className="field-help">
                      This maps to `tenantRanchers.clients[0].clusterName` in
                      the hosted tenant config.
                    </span>
                  </label>
                </>
              ) : null}

              <label className="field-shell full-width">
                <span className="field-label">Notes</span>
                <textarea
                  placeholder="Optional note that helps distinguish this run."
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="button-row" style={{ marginTop: "18px" }}>
              <button className="primary-button" disabled={isPending} type="submit">
                {isPending ? "Queueing..." : "Queue GitHub Action"}
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
              <p className="section-label">Version View</p>
              <h3 className="panel-title">Recent Rancher pass rates</h3>
              <p className="field-help">
                This is derived from recent GitHub workflow conclusions grouped
                by the version tag in the run title.
              </p>
            </div>
          </div>

          <div className="stats-grid">
            {topSummary.length > 0 ? (
              topSummary.map((summary) => (
                <article className="stat-card" key={summary.version}>
                  <p className="small-label">Rancher</p>
                  <h4>{summary.version}</h4>
                  <p className="stat-value">{summary.passRate}%</p>
                  <p className="stat-meta">
                    {summary.successfulRuns}/{summary.completedRuns} completed runs
                    passed
                  </p>
                </article>
              ))
            ) : (
              <article className="stat-card">
                <p className="small-label">No data yet</p>
                <p className="helper-text">
                  Launch a tagged run and this view will start filling in.
                </p>
              </article>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="section-label">Recent Runs</p>
            <h3 className="panel-title">Workflow history</h3>
            <p className="field-help">
              Each card links back to GitHub Actions for the full job log.
            </p>
          </div>
        </div>

        <div className="run-list">
          {recentRuns.length > 0 ? (
            recentRuns.map((run) => (
              <article className="run-card" key={run.id}>
                <div className="run-card-head">
                  <div>
                    <p className="run-title">{run.title}</p>
                    <div className="run-meta">
                      <span>{run.workflowName}</span>
                      <span>{formatWhen(run.createdAt)}</span>
                      <span>@{run.actor}</span>
                    </div>
                  </div>
                  <span className={`badge ${getConclusionClass(run)}`}>
                    {run.conclusion ?? run.status}
                  </span>
                </div>

                <div className="badge-row">
                  {run.rancherVersion ? (
                    <span className="badge">rv:{run.rancherVersion}</span>
                  ) : null}
                  {run.profile ? <span className="badge">profile:{run.profile}</span> : null}
                  {run.workflowId ? (
                    <span className="badge">suite:{run.workflowId}</span>
                  ) : null}
                  <span className="badge">branch:{run.branch}</span>
                </div>

                <a className="ghost-button" href={run.url} rel="noreferrer" target="_blank">
                  Open in GitHub
                </a>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <h2>No runs yet</h2>
              <p>
                Once you queue a workflow, recent runs will appear here with a
                cleaner summary view than the raw Actions screen.
              </p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
