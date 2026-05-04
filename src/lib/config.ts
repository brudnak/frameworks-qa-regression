export type WorkflowDefinition = {
  id: string;
  file: string;
  label: string;
  description: string;
  requiresTenantRancher?: boolean;
};

export const workflowDefinitions: WorkflowDefinition[] = [
  {
    id: "frameworks-reg",
    file: "frameworks-reg.yml",
    label: "Frameworks Regression",
    description: "Runs the config map, schema, and node annotation suites.",
  },
  {
    id: "vai-enabled",
    file: "vai-enabled.yml",
    label: "VAI Enabled",
    description: "Runs the VAI-enabled validation suite.",
  },
  {
    id: "vai-disabled",
    file: "vai-disabled.yml",
    label: "VAI Disabled",
    description: "Runs the VAI-disabled validation suite.",
  },
  {
    id: "charts-webhook",
    file: "charts-webhook.yml",
    label: "Charts Webhook",
    description: "Runs the webhook chart validation suite.",
  },
  {
    id: "webhook-security-settings",
    file: "webhook-security-settings.yml",
    label: "Webhook Security Settings (2.14+)",
    description: "Runs the webhook security settings validation suite for Rancher 2.14+.",
  },
  {
    id: "hosted-tenant-rbac",
    file: "hosted-tenant-rbac.yml",
    label: "Hosted Tenant RBAC",
    description:
      "Runs the hosted tenant RBAC suite and requires tenant Rancher connection details.",
    requiresTenantRancher: true,
  },
];

export function normalizeRancherVersionLabel(version: string) {
  const tag = version.trim().split(":").pop()?.trim() ?? "";
  const withoutPrefix = tag.replace(/^v/i, "");
  const headMatch = withoutPrefix.match(
    /^(\d+\.\d+)(?:[.-][a-z0-9]+)*-head(?:-(?:amd64|arm64))?$/i,
  );

  if (headMatch) {
    return `${headMatch[1]}-head`;
  }

  const releaseMatch = withoutPrefix.match(/^(\d+\.\d+\.\d+)(?:[-+].*)?$/);

  return releaseMatch ? releaseMatch[1] : withoutPrefix;
}

export function normalizeRancherHost(host: string) {
  const withoutProtocol = host
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^\/+/, "");
  const pathStart = withoutProtocol.search(/[/?#]/);

  return (pathStart === -1
    ? withoutProtocol
    : withoutProtocol.slice(0, pathStart)
  ).replace(/\/+$/, "");
}

export function normalizeQaseWorkflowLabel(workflowLabel: string) {
  return workflowLabel.trim().replace(/^Frameworks\s+/i, "");
}

export function buildQaseRunTitle(workflowLabel: string, rancherVersion: string) {
  const normalizedVersion = normalizeRancherVersionLabel(rancherVersion);
  const normalizedWorkflowLabel = normalizeQaseWorkflowLabel(workflowLabel);
  return `[${normalizedVersion}] Frameworks: ${normalizedWorkflowLabel}`;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getAllowedUsers(): string[] {
  return parseCsv(process.env.ALLOWED_GITHUB_USERS).map((user) =>
    user.toLowerCase(),
  );
}

export function getProfiles(): string[] {
  const envProfiles = parseCsv(process.env.GITHUB_PROFILE_ENVIRONMENTS);

  return envProfiles.length > 0
    ? envProfiles
    : ["qa-1", "qa-2", "qa-3", "qa-4"];
}

export function getGitHubRepoConfig() {
  return {
    owner: process.env.GITHUB_OWNER ?? "",
    repo: process.env.GITHUB_REPO ?? "",
    token: process.env.GITHUB_TOKEN ?? "",
    ref: process.env.GITHUB_REF ?? "main",
  };
}

export function requireGitHubRepoConfig() {
  const config = getGitHubRepoConfig();

  if (!config.owner || !config.repo || !config.token) {
    throw new Error(
      "Missing GitHub repo configuration. Set GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN.",
    );
  }

  return config;
}

export function getIssueRadarDefaults() {
  const users = parseCsv(
    process.env.ISSUE_RADAR_USERS ??
      [process.env.DEFAULT_USER_A, process.env.DEFAULT_USER_B]
        .filter(Boolean)
        .join(","),
  );

  return {
    repo: process.env.ISSUE_RADAR_REPO ?? process.env.DEFAULT_TARGET_REPO ?? "rancher/rancher",
    label:
      process.env.ISSUE_RADAR_LABEL ??
      process.env.DEFAULT_TARGET_LABEL ??
      "team/frameworks",
    users: users.length > 0 ? users : [""],
  };
}

export function getGitHubAuthConfig() {
  return {
    clientId: process.env.AUTH_GITHUB_ID ?? "",
    clientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
    nextAuthSecret: process.env.NEXTAUTH_SECRET ?? "",
  };
}
