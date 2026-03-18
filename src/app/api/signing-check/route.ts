import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAuthorizedUser } from "@/lib/authz";
import { isRegistryName, runSigningCheck } from "@/lib/signing-check";

type SigningCheckRequest = {
  imageKey?: string;
  version?: string;
  registry?: string;
};

export const runtime = "nodejs";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const login = session?.user?.login;

  if (!login) {
    return badRequest("You must sign in with GitHub before running signing checks.", 401);
  }

  if (!(await isAuthorizedUser(login))) {
    return badRequest("Your GitHub account is not allowed to use this launcher.", 403);
  }

  const body = (await request.json()) as SigningCheckRequest;
  const imageKey = body.imageKey?.trim();
  const version = body.version?.trim();
  const registry = body.registry?.trim();

  if (!imageKey || !["webhook", "rdp"].includes(imageKey)) {
    return badRequest("Choose either the webhook or rdp image.");
  }

  if (!version) {
    return badRequest("A version is required for browser-based signing checks.");
  }

  if (!registry || !isRegistryName(registry)) {
    return badRequest("Choose which registry to check.");
  }

  try {
    return NextResponse.json({
      ok: true,
      output: await runSigningCheck({
        imageKey: imageKey as "webhook" | "rdp",
        version,
        registry,
      }),
    });
  } catch (error) {
    const routeError = error as {
      message?: string;
    };

    return NextResponse.json(
      {
        error: routeError.message ?? "Signing check failed.",
      },
      { status: 500 },
    );
  }
}
