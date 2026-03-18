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
  const [isSigningPending, startSigningTransition] = useTransition();
  const [isTagPending, startTagTransition] = useTransition();
  const [banner, setBanner] = useState<BannerState>(null);
  const [signingBanner, setSigningBanner] = useState<BannerState>(null);
  const [tagBanner, setTagBanner] = useState<BannerState>(null);
  const [signingOutput, setSigningOutput] = useState("");
  const [availableSigningTags, setAvailableSigningTags] = useState<string[]>([]);
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
    reportToQase: false,
    qaseTestRunId: "",
  });
  const [signingForm, setSigningForm] = useState({
    imageKey: "webhook",
    tagSource: "manual",
    version: "",
    includeStaging: false,
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

  async function handleSigningSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningBanner(null);
    setSigningOutput("");

    startSigningTransition(async () => {
      const response = await fetch("/api/signing-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(signingForm),
      });

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        output?: string;
      };

      if (!response.ok) {
        setSigningBanner({
          kind: "error",
          message: payload.error ?? "Unable to run the signing check right now.",
        });
        setSigningOutput(payload.output ?? "");
        return;
      }

      setSigningBanner({
        kind: "success",
        message: "Signing check completed.",
      });
      setSigningOutput(payload.output ?? "");
    });
  }

  async function handleLoadSigningTags() {
    const tagSource = signingForm.tagSource;
    const imageKey = signingForm.imageKey;

    if (tagSource === "manual") {
      setTagBanner({
        kind: "error",
        message: "Choose Docker Hub, registry.suse.com, or stgregistry.suse.com first.",
      });
      return;
    }

    setTagBanner(null);

    startTagTransition(async () => {
      const response = await fetch("/api/signing-tags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageKey,
          source: tagSource,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        tags?: string[];
      };

      if (!response.ok) {
        setAvailableSigningTags([]);
        setTagBanner({
          kind: "error",
          message: payload.error ?? "Unable to load available tags right now.",
        });
        return;
      }

      const tags = payload.tags ?? [];
      setAvailableSigningTags(tags);
      setTagBanner({
        kind: "success",
        message:
          tags.length > 0
            ? `Loaded ${tags.length} recent tags from ${tagSource}.`
            : `No recent version tags were returned from ${tagSource}.`,
      });

      if (!signingForm.version && tags[0]) {
        setSigningForm((current) => ({
          ...current,
          version: tags[0],
        }));
      }
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

              <div className="field-context full-width">
                <p className="field-help">
                  {selectedWorkflow?.description ?? "Choose the QA suite to launch."}
                </p>
                <p className="field-help">
                  Each profile bucket maps to one GitHub Actions environment.
                </p>
              </div>

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

              <label className="check-shell full-width">
                <input
                  checked={form.reportToQase}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reportToQase: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>Report this run to Qase</span>
              </label>

              {form.reportToQase ? (
                <label className="field-shell full-width">
                  <span className="field-label">Qase Test Run ID</span>
                  <input
                    placeholder="1234"
                    value={form.qaseTestRunId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        qaseTestRunId: event.target.value,
                      }))
                    }
                  />
                  <span className="field-help">
                    Uses `RM_QASE_PROJECT_ID` plus `QASE_AUTOMATION_TOKEN` in GitHub
                    Actions to upload JUnit results into this existing Qase run.
                  </span>
                </label>
              ) : null}
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

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="section-label">Signing Check</p>
            <h3 className="panel-title">Check Rancher image signing</h3>
            <p className="field-help">
              This uses a native TypeScript Sigstore verifier, so it can run on
              Vercel too. Private registries can still need optional server-side
              credentials.
            </p>
          </div>
        </div>

        <form onSubmit={handleSigningSubmit}>
          <div className="signing-grid">
            <label className="field-shell">
              <span className="field-label">Image</span>
              <select
                value={signingForm.imageKey}
                onChange={(event) => {
                  setSigningForm((current) => ({
                    ...current,
                    imageKey: event.target.value,
                  }));
                  setAvailableSigningTags([]);
                  setTagBanner(null);
                }}
              >
                <option value="webhook">webhook (rancher-webhook)</option>
                <option value="rdp">rdp (remotedialer-proxy)</option>
              </select>
            </label>

            <label className="field-shell">
              <span className="field-label">Version</span>
              <input
                placeholder="v0.7.0"
                value={signingForm.version}
                onChange={(event) =>
                  setSigningForm((current) => ({
                    ...current,
                    version: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field-shell">
              <span className="field-label">Tag Source</span>
              <select
                value={signingForm.tagSource}
                onChange={(event) => {
                  const nextSource = event.target.value;
                  setSigningForm((current) => ({
                    ...current,
                    tagSource: nextSource,
                  }));
                  setAvailableSigningTags([]);
                  setTagBanner(null);
                }}
              >
                <option value="manual">enter manually</option>
                <option value="docker.io">Docker Hub</option>
                <option value="registry.suse.com">registry.suse.com (prime)</option>
                <option value="stgregistry.suse.com">
                  stgregistry.suse.com (staging)
                </option>
              </select>
            </label>

            <div className="field-shell">
              <span className="field-label">Recent Tags</span>
              <div className="inline-action-row">
                <button
                  className="ghost-button"
                  disabled={isTagPending || signingForm.tagSource === "manual"}
                  onClick={handleLoadSigningTags}
                  type="button"
                >
                  {isTagPending ? "Loading..." : "Load Recent Tags"}
                </button>

                <select
                  disabled={availableSigningTags.length === 0}
                  value={
                    availableSigningTags.includes(signingForm.version)
                      ? signingForm.version
                      : ""
                  }
                  onChange={(event) =>
                    setSigningForm((current) => ({
                      ...current,
                      version: event.target.value,
                    }))
                  }
                >
                  <option value="">
                    {availableSigningTags.length > 0
                      ? "Select a loaded tag"
                      : "Load tags or enter manually"}
                  </option>
                  {availableSigningTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="check-shell full-width">
              <input
                checked={signingForm.includeStaging}
                onChange={(event) =>
                  setSigningForm((current) => ({
                    ...current,
                    includeStaging: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>Also check `stgregistry.suse.com`</span>
            </label>
          </div>

          {tagBanner ? (
            <div className={`status-banner ${tagBanner.kind}`}>{tagBanner.message}</div>
          ) : null}

          <div className="button-row" style={{ marginTop: "18px" }}>
            <button className="primary-button" disabled={isSigningPending} type="submit">
              {isSigningPending ? "Running..." : "Run Signing Check"}
            </button>
          </div>

          {signingBanner ? (
            <div className={`status-banner ${signingBanner.kind}`}>
              {signingBanner.message}
            </div>
          ) : null}

          <pre className="terminal-output">
            {signingOutput ||
              "No signing check output yet. Choose an image and version, then run the verifier."}
          </pre>
        </form>
      </section>
    </section>
  );
}
