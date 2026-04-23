# Rancher QA Launcher

This repo now contains a Vercel-friendly Next.js app that:

- signs users in with GitHub
- checks an allowlist or repo access before allowing launches
- updates one of four GitHub environment profiles with the Rancher URL, token, and cluster name for that kickoff
- dispatches the selected GitHub Actions workflow
- shows recent workflow history grouped by Rancher version tag

It also includes a browser-triggered image signing check tool that runs through
native TypeScript Sigstore verification on the server.

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

## Signing Check Tool

The dashboard includes an image signing check form that:

- resolves the selected image tag to a digest in the registry you chose
- can load recent version tags from Docker Hub or supported OCI registries
- queries OCI referrers for Sigstore bundle artifacts
- verifies keyless image signatures and also falls back to downloadable SBOM attachments when registries publish them outside Sigstore attestation bundles

This is Vercel-friendly because it no longer shells out to `cosign` or `crane`.
If a registry requires auth, you can optionally provide credentials with env
vars:

- `DOCKER_IO_USERNAME` and `DOCKER_IO_PASSWORD`
- `REGISTRY_SUSE_USERNAME` and `REGISTRY_SUSE_PASSWORD`
- `STGREGISTRY_SUSE_USERNAME` and `STGREGISTRY_SUSE_PASSWORD`

If those env vars are absent, the app still tries anonymous access and will
report when a registry needs credentials. On local development, it also falls
back to any matching credentials found in `~/.docker/config.json`.

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
- Webhook Security Settings (2.14+)
- Hosted Tenant RBAC

Each launch can optionally report JUnit results into Qase. To use that, add
these in GitHub for the repository that owns the workflows:

- `QASE_AUTOMATION_TOKEN` as a GitHub secret
- `RM_QASE_PROJECT_ID` as a GitHub variable or secret

Then enable `Report this run to Qase` in the launcher. The workflow will create
or reuse a simple Qase run titled from the Rancher version and selected suite,
for example:

```text
[2.14.1] Frameworks: Regression
```

The launcher strips a leading `v` from the version when it builds the Qase run
title, so `v2.14.1` becomes `[2.14.1] ...`.

Their run titles are tagged like:

```text
rv:v2.14.0 | profile:qa-1 | suite:frameworks-reg
```

That lets the dashboard group GitHub Actions history by Rancher version without a separate database.
