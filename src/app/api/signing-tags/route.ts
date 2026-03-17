import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isAuthorizedUser } from "@/lib/authz";
import { isSigningTagSource, listAvailableTags } from "@/lib/signing-check";

type SigningTagRequest = {
  imageKey?: string;
  source?: string;
};

export const runtime = "nodejs";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const login = session?.user?.login;

  if (!login) {
    return badRequest("You must sign in with GitHub before loading available tags.", 401);
  }

  if (!(await isAuthorizedUser(login))) {
    return badRequest("Your GitHub account is not allowed to use this launcher.", 403);
  }

  const body = (await request.json()) as SigningTagRequest;
  const imageKey = body.imageKey?.trim();
  const source = body.source?.trim();

  if (!imageKey || !["webhook", "rdp"].includes(imageKey)) {
    return badRequest("Choose either the webhook or rdp image.");
  }

  if (!source || !isSigningTagSource(source) || source === "manual") {
    return badRequest("Choose a registry source to load tags.");
  }

  try {
    return NextResponse.json({
      ok: true,
      tags: await listAvailableTags(imageKey as "webhook" | "rdp", source),
    });
  } catch (error) {
    const routeError = error as { message?: string };

    return NextResponse.json(
      {
        error: routeError.message ?? "Unable to load tags right now.",
      },
      { status: 500 },
    );
  }
}
