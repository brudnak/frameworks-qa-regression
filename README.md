# Rancher QA Launcher

This repo now contains a Vercel-friendly Next.js app that:

- signs users in with GitHub
- checks an allowlist or repo access before allowing launches
- updates one of four GitHub environment profiles with the Rancher URL, token, and cluster name for that kickoff
- dispatches the selected GitHub Actions workflow
- shows recent workflow history grouped by Rancher version tag

## Local Development

1. Install dependencies:

```shell
npm install
```

2. Copy `.env.example` to `.env.local` and fill in:

```shell
cp .env.example .env.local
```

Required values:

- `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`: GitHub OAuth app credentials for sign-in
- `NEXTAUTH_SECRET`: random secret for NextAuth session signing
- `GITHUB_TOKEN`: GitHub token used server-side to update environment secrets and dispatch workflows
- `GITHUB_OWNER` and `GITHUB_REPO`: target repository for the workflows
- `GITHUB_REF`: branch to dispatch against, usually `main`
- `GITHUB_PROFILE_ENVIRONMENTS`: comma-separated environment profile names such as `qa-1,qa-2,qa-3,qa-4`
- `ALLOWED_GITHUB_USERS`: optional comma-separated allowlist of GitHub usernames

3. Start the app:

```shell
npm run dev
```

## GitHub Setup

Create the environment profiles named in `GITHUB_PROFILE_ENVIRONMENTS`, for example:

- `qa-1`
- `qa-2`
- `qa-3`
- `qa-4`

The app writes these environment secrets before each launch:

- `RANCHER_HOST`
- `RANCHER_ADMIN_TOKEN`
- `CLUSTER_NAME`

For the hosted tenant RBAC workflow, the app also writes:

- `TENANT_RANCHER_HOST`
- `TENANT_RANCHER_ADMIN_TOKEN`
- `TENANT_CLUSTER_NAME`

All workflows now accept:

- `profile`
- `rancher_version`
- `notes`

Available suites in the launcher:

- Frameworks Regression
- VAI Enabled
- Charts Webhook
- Hosted Tenant RBAC

Their run titles are tagged like:

```text
rv:v2.14.0 | profile:qa-1 | suite:frameworks-reg
```

That lets the dashboard group GitHub Actions history by Rancher version without a separate database.
