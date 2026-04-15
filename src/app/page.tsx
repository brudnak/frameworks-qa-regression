import { getServerSession } from "next-auth";
import { SignInButton } from "@/components/sign-in-button";
import { SignOutButton } from "@/components/sign-out-button";
import { LauncherDashboard } from "@/components/launcher-dashboard";
import { ThemeFrame } from "@/components/theme-frame";
import { authOptions } from "@/lib/auth";
import { isAuthorizedUser } from "@/lib/authz";
import { getDashboardData } from "@/lib/github";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const login = session?.user?.login;
  let isAuthorized = false;
  let dashboardData = null;
  let githubConfigError: string | null = null;

  if (login) {
    try {
      isAuthorized = await isAuthorizedUser(login);

      if (isAuthorized) {
        dashboardData = await getDashboardData();
      }
    } catch (error) {
      githubConfigError =
        error instanceof Error
          ? error.message
          : "The server-side GitHub configuration failed while loading the dashboard.";
    }
  }

  return (
    <ThemeFrame>
      <main className="page-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Rancher QA Workspace</p>
            <h1>One place for QA runs, milestone reporting, and release checks.</h1>
            <p className="hero-text">
              Launch workflows, review issue ownership, and run release
              utilities without bouncing between repos and dashboards.
            </p>
          </div>

          <div className="auth-panel">
            {session ? (
              <>
                <div>
                  <p className="panel-label">Signed in as</p>
                  <p className="panel-value">
                    {session.user?.name || session.user?.login || "GitHub user"}
                  </p>
                  <p className="panel-subtle">
                    @{session.user?.login || "unknown"}
                  </p>
                </div>
                <SignOutButton />
              </>
            ) : (
              <>
                <div>
                  <p className="panel-label">GitHub Sign-In</p>
                  <p className="panel-subtle">
                    Only approved users can launch runs or update environment
                    profile secrets.
                  </p>
                </div>
                <SignInButton />
              </>
            )}
          </div>
        </section>

        {!session ? (
          <section className="empty-state">
            <h2>Start with GitHub authentication</h2>
            <p>
              Sign in with GitHub to see the launch form and reporting view for
              your Rancher QA workflows.
            </p>
          </section>
        ) : githubConfigError ? (
          <section className="empty-state">
            <h2>GitHub server configuration needs attention</h2>
            <p>
              Your GitHub account is signed in, but the app could not verify
              repository access or load dashboard data with its server-side
              token.
            </p>
            <p>{githubConfigError}</p>
          </section>
        ) : !isAuthorized ? (
          <section className="empty-state">
            <h2>Access not approved yet</h2>
            <p>
              Your GitHub account is signed in, but it is not currently allowed
              to use this launcher. Add your username to the allowlist or grant
              repo access checks for this repository.
            </p>
          </section>
        ) : dashboardData ? (
          <LauncherDashboard
            login={login}
            owner={dashboardData.owner}
            repo={dashboardData.repo}
            profiles={dashboardData.profiles}
            workflows={dashboardData.workflows}
            recentRuns={dashboardData.recentRuns}
            versionSummaries={dashboardData.versionSummaries}
            issueRadarDefaults={dashboardData.issueRadarDefaults}
          />
        ) : null}
      </main>
    </ThemeFrame>
  );
}
