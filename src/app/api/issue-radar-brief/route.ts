import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAuthorizedUser } from "@/lib/authz";
import { generateIssueRadarBrief } from "@/lib/issue-radar";

type IssueRadarBriefRequest = {
  milestone?: string;
  repo?: string;
  label?: string;
  users?: string[];
  githubToken?: string;
  codeFreezeDate?: string;
  includeHistory?: boolean;
  historyLimit?: number;
};

export const runtime = "nodejs";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const login = session?.user?.login;

  if (!login) {
    return badRequest("You must sign in with GitHub before building a brief.", 401);
  }

  if (!(await isAuthorizedUser(login))) {
    return badRequest("Your GitHub account is not allowed to use this launcher.", 403);
  }

  const body = (await request.json()) as IssueRadarBriefRequest;

  try {
    const result = await generateIssueRadarBrief({
      milestone: body.milestone?.trim() ?? "",
      repo: body.repo?.trim() ?? "",
      label: body.label?.trim() ?? "",
      users: Array.isArray(body.users) ? body.users : [],
      token: body.githubToken?.trim() ?? "",
      codeFreezeDate: body.codeFreezeDate?.trim() ?? "",
      includeHistory: Boolean(body.includeHistory),
      historyLimit: body.historyLimit,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Unable to build the assignment brief right now.",
    );
  }
}
