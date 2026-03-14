import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAuthorizedUser } from "@/lib/authz";
import { getProfiles, workflowDefinitions } from "@/lib/config";
import {
  dispatchWorkflowRun,
  findActiveRunForProfile,
  setEnvironmentSecret,
} from "@/lib/github";

type LaunchRequest = {
  workflowId?: string;
  profile?: string;
  rancherVersion?: string;
  rancherHost?: string;
  rancherAdminToken?: string;
  clusterName?: string;
  notes?: string;
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const login = session?.user?.login;

  if (!login) {
    return badRequest("You must sign in with GitHub before launching runs.", 401);
  }

  if (!(await isAuthorizedUser(login))) {
    return badRequest("Your GitHub account is not allowed to use this launcher.", 403);
  }

  const body = (await request.json()) as LaunchRequest;
  const profiles = getProfiles();
  const workflow = workflowDefinitions.find(
    (definition) => definition.id === body.workflowId,
  );

  if (!workflow) {
    return badRequest("Choose a valid workflow.");
  }

  if (!body.profile || !profiles.includes(body.profile)) {
    return badRequest("Choose one of the configured GitHub environment profiles.");
  }

  if (!body.rancherVersion?.trim()) {
    return badRequest("Rancher version is required.");
  }

  if (!body.rancherHost?.trim()) {
    return badRequest("Rancher URL is required.");
  }

  if (!body.rancherAdminToken?.trim()) {
    return badRequest("Rancher admin token is required.");
  }

  if (!body.clusterName?.trim()) {
    return badRequest("Cluster name is required.");
  }

  const activeRun = await findActiveRunForProfile(body.profile);

  if (activeRun) {
    return badRequest(
      `Profile ${body.profile} already has an active run. Wait for it to finish before reusing that bucket.`,
      409,
    );
  }

  await Promise.all([
    setEnvironmentSecret(body.profile, "RANCHER_HOST", body.rancherHost.trim()),
    setEnvironmentSecret(
      body.profile,
      "RANCHER_ADMIN_TOKEN",
      body.rancherAdminToken.trim(),
    ),
    setEnvironmentSecret(body.profile, "CLUSTER_NAME", body.clusterName.trim()),
  ]);

  await dispatchWorkflowRun({
    workflowId: workflow.id,
    profile: body.profile,
    rancherVersion: body.rancherVersion.trim(),
    notes: body.notes?.trim(),
  });

  return NextResponse.json({
    ok: true,
    message: `Queued ${workflow.label} for ${body.rancherVersion.trim()} on ${body.profile}.`,
  });
}
