import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAuthorizedUser } from "@/lib/authz";
import { getDashboardData } from "@/lib/github";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const login = session?.user?.login;

  if (!login) {
    return jsonError("You must sign in with GitHub before viewing reports.", 401);
  }

  if (!(await isAuthorizedUser(login))) {
    return jsonError("Your GitHub account is not allowed to use this launcher.", 403);
  }

  const dashboardData = await getDashboardData();

  return NextResponse.json({
    recentRuns: dashboardData.recentRuns,
    versionSummaries: dashboardData.versionSummaries,
  });
}
