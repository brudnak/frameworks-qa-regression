import { getAllowedUsers, getGitHubRepoConfig } from "@/lib/config";

export async function isAuthorizedUser(login: string): Promise<boolean> {
  const normalizedLogin = login.toLowerCase();
  const allowlist = getAllowedUsers();

  if (allowlist.includes(normalizedLogin)) {
    return true;
  }

  const { owner, repo, token } = getGitHubRepoConfig();

  if (!owner || !repo || !token) {
    return false;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/collaborators/${normalizedLogin}/permission`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error("Failed to verify repo permissions for the signed-in user.");
  }

  const data = (await response.json()) as {
    permission?: string;
    role_name?: string;
  };

  return ["admin", "maintain", "write"].includes(data.permission ?? "") ||
    ["admin", "maintain", "write"].includes(data.role_name ?? "");
}
