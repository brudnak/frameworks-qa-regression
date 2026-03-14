import sodium from "libsodium-wrappers";
import {
  getProfiles,
  requireGitHubRepoConfig,
  workflowDefinitions,
  type WorkflowDefinition,
} from "@/lib/config";

export type WorkflowRunSummary = {
  id: number;
  title: string;
  workflowName: string;
  workflowId: string | null;
  url: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  actor: string;
  branch: string;
  profile: string | null;
  rancherVersion: string | null;
};

export type VersionSummary = {
  version: string;
  totalRuns: number;
  completedRuns: number;
  successfulRuns: number;
  failedRuns: number;
  passRate: number;
};

type GitHubWorkflowRun = {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  head_branch: string;
  name?: string;
  display_title?: string;
  workflow_name?: string;
  actor?: {
    login?: string;
  };
};

function getHeaders() {
  const { token } = requireGitHubRepoConfig();

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { owner, repo } = requireGitHubRepoConfig();
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: {
      ...getHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${errorText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function getWorkflowDefinition(workflowId: string): WorkflowDefinition {
  const workflow = workflowDefinitions.find((item) => item.id === workflowId);

  if (!workflow) {
    throw new Error(`Unsupported workflow "${workflowId}".`);
  }

  return workflow;
}

function parseTaggedValue(title: string, key: string): string | null {
  const match = title.match(new RegExp(`${key}:([^|]+)`));
  return match ? match[1].trim() : null;
}

function mapRunToSummary(run: GitHubWorkflowRun): WorkflowRunSummary {
  const title = run.display_title ?? run.name ?? run.workflow_name ?? "Workflow run";

  return {
    id: run.id,
    title,
    workflowName: run.workflow_name ?? run.name ?? "Workflow",
    workflowId: parseTaggedValue(title, "suite"),
    url: run.html_url,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    actor: run.actor?.login ?? "unknown",
    branch: run.head_branch,
    profile: parseTaggedValue(title, "profile"),
    rancherVersion: parseTaggedValue(title, "rv"),
  };
}

function summarizeVersions(runs: WorkflowRunSummary[]): VersionSummary[] {
  const summaries = new Map<string, VersionSummary>();

  for (const run of runs) {
    if (!run.rancherVersion) {
      continue;
    }

    const current = summaries.get(run.rancherVersion) ?? {
      version: run.rancherVersion,
      totalRuns: 0,
      completedRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      passRate: 0,
    };

    current.totalRuns += 1;

    if (run.conclusion) {
      current.completedRuns += 1;
    }

    if (run.conclusion === "success") {
      current.successfulRuns += 1;
    }

    if (run.conclusion === "failure") {
      current.failedRuns += 1;
    }

    summaries.set(run.rancherVersion, current);
  }

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      passRate:
        summary.completedRuns > 0
          ? Math.round((summary.successfulRuns / summary.completedRuns) * 100)
          : 0,
    }))
    .sort((left, right) => right.version.localeCompare(left.version, undefined, {
      numeric: true,
      sensitivity: "base",
    }));
}

async function encryptSecret(value: string, key: string) {
  await sodium.ready;
  const publicKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const secretBytes = sodium.from_string(value);
  const encryptedBytes = sodium.crypto_box_seal(secretBytes, publicKey);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

export async function setEnvironmentSecret(
  environment: string,
  name: string,
  value: string,
) {
  const publicKey = await githubRequest<{ key: string; key_id: string }>(
    `/environments/${encodeURIComponent(environment)}/secrets/public-key`,
  );

  const encryptedValue = await encryptSecret(value, publicKey.key);

  await githubRequest<void>(
    `/environments/${encodeURIComponent(environment)}/secrets/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        encrypted_value: encryptedValue,
        key_id: publicKey.key_id,
      }),
    },
  );
}

export async function dispatchWorkflowRun(input: {
  workflowId: string;
  profile: string;
  rancherVersion: string;
  notes?: string;
}) {
  const workflow = getWorkflowDefinition(input.workflowId);
  const { ref } = requireGitHubRepoConfig();

  await githubRequest<void>(`/actions/workflows/${workflow.file}/dispatches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref,
      inputs: {
        profile: input.profile,
        rancher_version: input.rancherVersion,
        notes: input.notes ?? "",
      },
    }),
  });
}

export async function listRecentRuns(limit = 30): Promise<WorkflowRunSummary[]> {
  const data = await githubRequest<{ workflow_runs: GitHubWorkflowRun[] }>(
    `/actions/runs?event=workflow_dispatch&per_page=${limit}`,
  );

  return data.workflow_runs.map(mapRunToSummary);
}

export async function findActiveRunForProfile(
  profile: string,
): Promise<WorkflowRunSummary | null> {
  const recentRuns = await listRecentRuns(100);

  return (
    recentRuns.find(
      (run) =>
        run.profile === profile &&
        run.conclusion === null &&
        run.status !== "completed",
    ) ?? null
  );
}

export async function getDashboardData() {
  const { owner, repo } = requireGitHubRepoConfig();
  const recentRuns = await listRecentRuns();

  return {
    owner,
    repo,
    profiles: getProfiles(),
    workflows: workflowDefinitions,
    recentRuns,
    versionSummaries: summarizeVersions(recentRuns),
  };
}
