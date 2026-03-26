import { getIssueRadarDefaults } from "./config";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

const QA_SIZE_LABELS = ["QA/XS", "QA/S", "QA/M", "QA/L", "QA/XL"] as const;
const LACKS_QA_SIZE_LABEL = "Lacks QA Size";
const QA_NONE_LABEL = "QA/None";
const KIND_BUG_LABEL = "kind/bug";
const KIND_ENHANCEMENT_LABEL = "kind/enhancement";
const LACKS_KIND_LABEL = "Kind N/A";

type GitHubMilestone = {
  number: number;
  title: string;
};

type GitHubIssue = {
  number: number;
  title: string;
  html_url: string;
  labels: Array<{ name?: string }>;
  assignees: Array<{ login?: string }>;
  pull_request?: Record<string, unknown>;
};

type GitHubError = {
  message?: string;
};

export type IssueRadarDefaults = ReturnType<typeof getIssueRadarDefaults>;

export type IssueRadarConfig = {
  milestone: string;
  repo: string;
  label: string;
  users: string[];
  token?: string;
};

export type IssueSummary = {
  number: number;
  title: string;
  url: string;
  assignees: string[];
  qaSize: string;
  kind: string;
};

export type IssueBucket = {
  id: string;
  kind: "clean" | "problem";
  title: string;
  count: number;
  emptyMessage: string;
  issues: IssueSummary[];
  qaCounts: Record<string, number>;
};

export type KindRow = {
  displayName: string;
  enhancement: number;
  bug: number;
  other: number;
  total: number;
};

export type UserCard = {
  displayName: string;
  issueCount: number;
  bugCount: number;
  enhanceCount: number;
  otherCount: number;
  lacksQaSize: number;
};

export type SummaryRow = {
  label: string;
  total: number;
};

export type QaRow = {
  label: string;
  counts: number[];
  total: number;
};

export type IssueRadarReport = {
  generatedAt: string;
  config: {
    repo: string;
    label: string;
    milestone: string;
    users: string[];
  };
  totals: {
    grandTotalFetched: number;
    totalCategorized: number;
    qaNone: number;
    exactlyOne: number;
    overAssigned: number;
    missingOwner: number;
  };
  userCards: UserCard[];
  qaLabels: string[];
  assigneeSummary: SummaryRow[];
  qaRows: QaRow[];
  kindRows: KindRow[];
  qaNone: IssueSummary[];
  buckets: IssueBucket[];
};

function getHeaders(token?: string) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function normalizeUsers(values: string[]) {
  const seen = new Set<string>();
  const users: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    users.push(trimmed);
  }

  return users;
}

function parseRepo(repo: string) {
  const [owner, name] = repo.trim().split("/");

  if (!owner || !name) {
    throw new Error("Repository must be in owner/repo format.");
  }

  return { owner, repo: name };
}

function resolveGitHubToken(token?: string) {
  return token?.trim() || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
}

async function githubRequest<T>(
  path: string,
  {
    query,
    token,
  }: {
    query?: URLSearchParams;
    token?: string;
  } = {},
): Promise<T> {
  const url = new URL(`${GITHUB_API_BASE}${path}`);

  if (query) {
    url.search = query.toString();
  }

  const response = await fetch(url, {
    headers: getHeaders(token),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as GitHubError | null;
    const message =
      body?.message ||
      `GitHub API request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function lookupMilestoneNumber(
  owner: string,
  repo: string,
  milestoneTitle: string,
  token?: string,
) {
  for (let page = 1; ; page += 1) {
    const milestones = await githubRequest<GitHubMilestone[]>(
      `/repos/${owner}/${repo}/milestones`,
      {
        query: new URLSearchParams({
          state: "all",
          per_page: "100",
          page: String(page),
        }),
        token,
      },
    );

    for (const milestone of milestones) {
      if (milestone.title === milestoneTitle) {
        return milestone.number;
      }
    }

    if (milestones.length < 100) {
      break;
    }
  }

  throw new Error(`Milestone "${milestoneTitle}" was not found in ${owner}/${repo}.`);
}

async function fetchIssues(config: IssueRadarConfig) {
  const { owner, repo } = parseRepo(config.repo);
  const token = resolveGitHubToken(config.token);
  const milestoneNumber = await lookupMilestoneNumber(
    owner,
    repo,
    config.milestone,
    token,
  );
  const issues: GitHubIssue[] = [];

  for (let page = 1; ; page += 1) {
    const pageIssues = await githubRequest<GitHubIssue[]>(
      `/repos/${owner}/${repo}/issues`,
      {
        query: new URLSearchParams({
          state: "open",
          labels: config.label,
          milestone: String(milestoneNumber),
          per_page: "100",
          page: String(page),
        }),
        token,
      },
    );

    issues.push(...pageIssues.filter((issue) => !issue.pull_request));

    if (pageIssues.length < 100) {
      break;
    }
  }

  return issues;
}

function contains(values: string[], target: string) {
  return values.includes(target);
}

function determineQaSize(labels: string[]) {
  return QA_SIZE_LABELS.find((label) => contains(labels, label)) ?? LACKS_QA_SIZE_LABEL;
}

function determineKind(labels: string[]) {
  if (contains(labels, KIND_BUG_LABEL)) {
    return KIND_BUG_LABEL;
  }

  if (contains(labels, KIND_ENHANCEMENT_LABEL)) {
    return KIND_ENHANCEMENT_LABEL;
  }

  return LACKS_KIND_LABEL;
}

function extractAssignees(assignees: GitHubIssue["assignees"]) {
  return assignees.flatMap((assignee) => (assignee.login ? [assignee.login] : []));
}

function intersectUsers(assignees: string[], selected: string[]) {
  return selected.filter((user) => assignees.includes(user));
}

function newIssueSummary(issue: GitHubIssue, qaSize: string, kind: string): IssueSummary {
  const assignees = extractAssignees(issue.assignees);

  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    assignees: assignees.length > 0 ? assignees : ["Unassigned"],
    qaSize,
    kind,
  };
}

function newBucket(
  id: string,
  kind: "clean" | "problem",
  title: string,
  emptyMessage: string,
): IssueBucket {
  return {
    id,
    kind,
    title,
    count: 0,
    emptyMessage,
    issues: [],
    qaCounts: Object.fromEntries(
      [...QA_SIZE_LABELS, LACKS_QA_SIZE_LABEL].map((label) => [label, 0]),
    ),
  };
}

function addIssueToBucket(bucket: IssueBucket, issue: IssueSummary) {
  bucket.issues.push(issue);
  bucket.count += 1;
  bucket.qaCounts[issue.qaSize] = (bucket.qaCounts[issue.qaSize] ?? 0) + 1;
}

function incrementKind(row: KindRow, kind: string) {
  if (kind === KIND_BUG_LABEL) {
    row.bug += 1;
  } else if (kind === KIND_ENHANCEMENT_LABEL) {
    row.enhancement += 1;
  } else {
    row.other += 1;
  }
}

function makeQaRow(label: string, bucket: IssueBucket): QaRow {
  const qaLabels = [...QA_SIZE_LABELS, LACKS_QA_SIZE_LABEL];

  return {
    label,
    counts: qaLabels.map((qaLabel) => bucket.qaCounts[qaLabel] ?? 0),
    total: bucket.count,
  };
}

export function buildIssueRadarReport(
  config: IssueRadarConfig,
  issues: GitHubIssue[],
): IssueRadarReport {
  const users = normalizeUsers(config.users);
  const soloBuckets = new Map<string, IssueBucket>();
  const kindRows = new Map<string, KindRow>();

  for (const user of users) {
    soloBuckets.set(
      user,
      newBucket(`solo-${user}`, "clean", `Assigned to ${user} only`, "Nothing landed in this lane."),
    );
    kindRows.set(user, {
      displayName: user,
      enhancement: 0,
      bug: 0,
      other: 0,
      total: 0,
    });
  }

  const sharedBucket = newBucket(
    "over-assigned",
    "problem",
    "Assigned to multiple selected owners",
    "Nothing landed in this lane.",
  );
  const outsideBucket = newBucket(
    "missing-owner",
    "problem",
    "Missing a selected owner",
    "Nothing landed in this lane.",
  );

  const qaNone: IssueSummary[] = [];
  let totalCategorized = 0;
  let exactlyOne = 0;
  let overAssigned = 0;
  let missingOwner = 0;

  for (const issue of issues) {
    const labels = issue.labels.flatMap((label) => (label.name ? [label.name] : []));
    const qaSize = determineQaSize(labels);
    const kind = determineKind(labels);
    const summary = newIssueSummary(issue, qaSize, kind);

    if (contains(labels, QA_NONE_LABEL)) {
      qaNone.push(summary);
      continue;
    }

    totalCategorized += 1;
    const assignees = extractAssignees(issue.assignees);
    const matchedUsers = intersectUsers(assignees, users);

    if (matchedUsers.length === 0) {
      addIssueToBucket(outsideBucket, summary);
      missingOwner += 1;
      continue;
    }

    if (matchedUsers.length > 1) {
      addIssueToBucket(sharedBucket, summary);
      overAssigned += 1;
      continue;
    }

    const user = matchedUsers[0];
    const bucket = soloBuckets.get(user);
    const kindRow = kindRows.get(user);

    if (bucket && kindRow) {
      addIssueToBucket(bucket, summary);
      incrementKind(kindRow, kind);
      exactlyOne += 1;
    }
  }

  const qaLabels = [...QA_SIZE_LABELS, LACKS_QA_SIZE_LABEL];
  const userCards = users.map((user) => {
    const bucket = soloBuckets.get(user)!;
    const row = kindRows.get(user)!;
    row.total = row.bug + row.enhancement + row.other;

    return {
      displayName: user,
      issueCount: bucket.count,
      bugCount: row.bug,
      enhanceCount: row.enhancement,
      otherCount: row.other,
      lacksQaSize: bucket.qaCounts[LACKS_QA_SIZE_LABEL] ?? 0,
    };
  });

  const buckets = [
    ...users.map((user) => soloBuckets.get(user)!),
    sharedBucket,
    outsideBucket,
  ];

  const assigneeSummary: SummaryRow[] = [
    ...users.map((user) => ({
      label: `Assigned to ${user} only`,
      total: soloBuckets.get(user)!.count,
    })),
    {
      label: "Assigned to multiple selected owners",
      total: sharedBucket.count,
    },
    {
      label: "Missing a selected owner",
      total: outsideBucket.count,
    },
    {
      label: "Total in scope",
      total: totalCategorized,
    },
  ];

  const qaRows: QaRow[] = [
    ...users.map((user) =>
      makeQaRow(`Assigned to ${user} only`, soloBuckets.get(user)!),
    ),
    makeQaRow("Assigned to multiple selected owners", sharedBucket),
    makeQaRow("Missing a selected owner", outsideBucket),
    {
      label: "Total by size",
      counts: qaLabels.map((label) =>
        buckets.reduce((sum, bucket) => sum + (bucket.qaCounts[label] ?? 0), 0),
      ),
      total: totalCategorized,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    config: {
      repo: config.repo,
      label: config.label,
      milestone: config.milestone,
      users,
    },
    totals: {
      grandTotalFetched: issues.length,
      totalCategorized,
      qaNone: qaNone.length,
      exactlyOne,
      overAssigned,
      missingOwner,
    },
    userCards,
    qaLabels,
    assigneeSummary,
    qaRows,
    kindRows: users.map((user) => {
      const row = kindRows.get(user)!;
      row.total = row.bug + row.enhancement + row.other;
      return { ...row };
    }),
    qaNone,
    buckets,
  };
}

export function validateIssueRadarConfig(config: IssueRadarConfig) {
  const normalizedUsers = normalizeUsers(config.users);

  if (!config.milestone.trim()) {
    throw new Error("Add a milestone to run the report.");
  }

  if (!config.repo.trim()) {
    throw new Error("Add a repository in owner/repo format.");
  }

  parseRepo(config.repo);

  if (!config.label.trim()) {
    throw new Error("Add the team label to filter the report.");
  }

  if (normalizedUsers.length === 0) {
    throw new Error("Add at least one owner login.");
  }

  if (normalizedUsers.length > 8) {
    throw new Error("Use up to eight owner logins at a time.");
  }

  return {
    ...config,
    users: normalizedUsers,
  };
}

export async function generateIssueRadarReport(config: IssueRadarConfig) {
  const normalized = validateIssueRadarConfig(config);
  const issues = await fetchIssues(normalized);
  const report = buildIssueRadarReport(normalized, issues);
  const usingToken = Boolean(resolveGitHubToken(normalized.token));

  return {
    report,
    message: usingToken
      ? "Live GitHub data loaded with authenticated API access."
      : "Live GitHub data loaded without a token. Public repos work fine, but rate limits are lower.",
  };
}

export function getIssueRadarDefaultFormState() {
  const defaults = getIssueRadarDefaults();

  return {
    milestone: "",
    repo: defaults.repo,
    label: defaults.label,
    users: defaults.users,
    githubToken: "",
    codeFreezeDate: "",
  };
}
