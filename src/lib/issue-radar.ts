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
  body?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
  labels: Array<{ name?: string }>;
  assignees: Array<{ login?: string }>;
  pull_request?: Record<string, unknown>;
};

type GitHubError = {
  message?: string;
};

class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export type IssueRadarDefaults = ReturnType<typeof getIssueRadarDefaults>;

export type IssueRadarConfig = {
  milestone: string;
  repo: string;
  label: string;
  users: string[];
  token?: string;
};

export type IssueRadarBriefConfig = IssueRadarConfig & {
  codeFreezeDate?: string;
  includeHistory?: boolean;
  historyLimit?: number;
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

export type IssueHistorySample = {
  number: number;
  title: string;
  url: string;
  closedAt: string;
  labels: string[];
  snippet: string;
};

export type IssueRadarBrief = {
  generatedAt: string;
  includeHistory: boolean;
  historyLimit: number;
  text: string;
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
    throw new GitHubApiError(message, response.status);
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

async function fetchClosedIssuesForUser(
  config: IssueRadarConfig,
  user: string,
  limit: number,
) {
  const { owner, repo } = parseRepo(config.repo);
  const token = resolveGitHubToken(config.token);
  const issues: GitHubIssue[] = [];

  try {
    for (let page = 1; issues.length < limit; page += 1) {
      const pageIssues = await githubRequest<GitHubIssue[]>(
        `/repos/${owner}/${repo}/issues`,
        {
          query: new URLSearchParams({
            state: "closed",
            labels: config.label,
            assignee: user,
            sort: "updated",
            direction: "desc",
            per_page: "100",
            page: String(page),
          }),
          token,
        },
      );

      issues.push(
        ...pageIssues.filter(
          (issue) => !issue.pull_request && typeof issue.closed_at === "string",
        ),
      );

      if (pageIssues.length < 100) {
        break;
      }
    }
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 422) {
      return [];
    }

    throw error;
  }

  return issues
    .sort((left, right) => {
      const leftTime = left.closed_at ? Date.parse(left.closed_at) : 0;
      const rightTime = right.closed_at ? Date.parse(right.closed_at) : 0;
      return rightTime - leftTime;
    })
    .slice(0, limit);
}

function contains(values: string[], target: string) {
  return values.includes(target);
}

function formatDateLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
      )
    : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string) {
  return normalizeWhitespace(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/^#+\s*/gm, "")
      .replace(/[*_>~-]/g, " "),
  );
}

function summarizeIssueBody(body?: string | null, limit = 240) {
  const cleaned = stripMarkdown(body ?? "");

  if (!cleaned) {
    return "No body snippet available.";
  }

  if (cleaned.length <= limit) {
    return cleaned;
  }

  return `${cleaned.slice(0, limit).trimEnd()}...`;
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

function formatIssueLine(issue: IssueSummary) {
  const labels = [issue.qaSize, issue.kind].join(", ");
  return `- #${issue.number} ${issue.title}\n  Link: ${issue.url}\n  Owners: ${issue.assignees.join(", ")}\n  Labels: ${labels}`;
}

function formatHistoryLine(issue: IssueHistorySample) {
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "None";
  return `- #${issue.number} ${issue.title}\n  Link: ${issue.url}\n  Closed: ${issue.closedAt}\n  Labels: ${labels}\n  Snippet: ${issue.snippet}`;
}

function buildHistorySamples(issues: GitHubIssue[]) {
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    closedAt: formatDateLabel(issue.closed_at),
    labels: issue.labels.flatMap((label) => (label.name ? [label.name] : [])),
    snippet: summarizeIssueBody(issue.body),
  }));
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

export function buildIssueRadarBriefText(
  report: IssueRadarReport,
  {
    codeFreezeDate,
    includeHistory = false,
    historyLimit = 30,
    historyByUser = {},
  }: {
    codeFreezeDate?: string;
    includeHistory?: boolean;
    historyLimit?: number;
    historyByUser?: Record<string, IssueHistorySample[]>;
  } = {},
) {
  const lines: string[] = [];
  const bucketById = new Map(report.buckets.map((bucket) => [bucket.id, bucket]));
  const missingOwner = bucketById.get("missing-owner");
  const overAssigned = bucketById.get("over-assigned");

  lines.push("Assignment review brief");
  lines.push("");
  lines.push(`Repo: ${report.config.repo}`);
  lines.push(`Milestone: ${report.config.milestone}`);
  lines.push(`Team label: ${report.config.label}`);
  lines.push(`Selected owners: ${report.config.users.join(", ")}`);

  if (codeFreezeDate?.trim()) {
    lines.push(`Code freeze: ${formatDateLabel(codeFreezeDate)}`);
  }

  lines.push(
    "Assignment rule: every non-QA/None issue should have exactly one selected owner.",
  );
  lines.push("");
  lines.push("Current milestone snapshot");
  lines.push(`- Fetched issues: ${report.totals.grandTotalFetched}`);
  lines.push(`- Categorized issues: ${report.totals.totalCategorized}`);
  lines.push(`- Exactly one selected owner: ${report.totals.exactlyOne}`);
  lines.push(`- Missing a selected owner: ${report.totals.missingOwner}`);
  lines.push(`- Assigned to multiple selected owners: ${report.totals.overAssigned}`);
  lines.push(`- QA/None: ${report.totals.qaNone}`);
  lines.push("");

  lines.push("Single-owner load");
  for (const card of report.userCards) {
    lines.push(
      `- ${card.displayName}: ${card.issueCount} clean issues, ${card.bugCount} bugs, ${card.enhanceCount} enhancements, ${card.otherCount} other/untyped, ${card.lacksQaSize} missing QA size`,
    );
  }

  lines.push("");
  lines.push("Issues needing attention");

  if (missingOwner) {
    lines.push(`Missing a selected owner (${missingOwner.count})`);
    if (missingOwner.issues.length > 0) {
      lines.push(...missingOwner.issues.map((issue) => formatIssueLine(issue)));
    } else {
      lines.push("- None.");
    }
    lines.push("");
  }

  if (overAssigned) {
    lines.push(`Assigned to multiple selected owners (${overAssigned.count})`);
    if (overAssigned.issues.length > 0) {
      lines.push(...overAssigned.issues.map((issue) => formatIssueLine(issue)));
    } else {
      lines.push("- None.");
    }
    lines.push("");
  }

  lines.push("Clean owner lanes");
  for (const user of report.config.users) {
    const bucket = bucketById.get(`solo-${user}`);

    lines.push(`${user} (${bucket?.count ?? 0})`);
    if (bucket && bucket.issues.length > 0) {
      lines.push(...bucket.issues.map((issue) => formatIssueLine(issue)));
    } else {
      lines.push("- None.");
    }
    lines.push("");
  }

  if (report.qaNone.length > 0) {
    lines.push(`QA/None (${report.qaNone.length})`);
    lines.push(...report.qaNone.map((issue) => formatIssueLine(issue)));
    lines.push("");
  }

  if (includeHistory) {
    lines.push(`Recent closed issue samples by owner (last ${historyLimit})`);
    for (const user of report.config.users) {
      const history = historyByUser[user] ?? [];
      lines.push(`${user} (${history.length})`);
      if (history.length > 0) {
        lines.push(...history.map((issue) => formatHistoryLine(issue)));
      } else {
        lines.push("- None collected.");
      }
      lines.push("");
    }
  }

  lines.push(
    "Review this board and recommend the best owner for each issue that still needs attention while keeping work balanced across the selected owners.",
  );

  if (includeHistory) {
    lines.push(
      "Use the recent closed issue samples as background for the kinds of issues each person has handled before.",
    );
  }

  return lines.join("\n");
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

function normalizeHistoryLimit(value?: number) {
  return value === 50 ? 50 : 30;
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

export async function generateIssueRadarBrief(config: IssueRadarBriefConfig) {
  const normalized = validateIssueRadarConfig(config);
  const issues = await fetchIssues(normalized);
  const report = buildIssueRadarReport(normalized, issues);
  const includeHistory = Boolean(config.includeHistory);
  const historyLimit = normalizeHistoryLimit(config.historyLimit);
  const historyByUser: Record<string, IssueHistorySample[]> = {};

  if (includeHistory) {
    await Promise.all(
      normalized.users.map(async (user) => {
        const closedIssues = await fetchClosedIssuesForUser(
          normalized,
          user,
          historyLimit,
        );
        historyByUser[user] = buildHistorySamples(closedIssues);
      }),
    );
  }

  return {
    brief: {
      generatedAt: new Date().toISOString(),
      includeHistory,
      historyLimit,
      text: buildIssueRadarBriefText(report, {
        codeFreezeDate: config.codeFreezeDate,
        includeHistory,
        historyLimit,
        historyByUser,
      }),
    },
    message: includeHistory
      ? "Assignment brief built with recent closed issue samples."
      : "Assignment brief built from the live milestone board.",
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
