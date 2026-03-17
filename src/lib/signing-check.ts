import { getRegistryCredentials } from "@sigstore/oci";
import * as sigstore from "sigstore";
import type { Bundle as SerializedBundle } from "sigstore";

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const BUNDLE_ARTIFACT_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const OCI_INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json";
const MANIFEST_ACCEPT =
  "application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json";
const SPDX_PREDICATE_TYPE = "https://spdx.dev/Document";

type ImageKey = "webhook" | "rdp";

type RegistryName = "docker.io" | "registry.suse.com" | "stgregistry.suse.com";

export type SigningTagSource = RegistryName | "manual";

type Credentials = {
  username: string;
  password: string;
  headers?: Record<string, string>;
};

type SigningCheckOptions = {
  imageKey: ImageKey;
  version: string;
  includeStaging?: boolean;
};

type SigningBundleContentType = "message-signature" | "dsse-envelope" | "unknown";

type BundleDescriptor = {
  digest: string;
  contentType: SigningBundleContentType;
  predicateType?: string;
};

type VerificationStatus = {
  ok: boolean;
  detail: string;
};

type RegistryCheckResult = {
  reference: string;
  digest?: string;
  notes: string[];
  signature: VerificationStatus;
  sbom: VerificationStatus;
};

type Challenge = {
  scheme: "basic" | "bearer";
  realm?: string;
  service?: string;
  scope?: string;
};

type ManifestEnvelope = {
  body: unknown;
  digest?: string;
  mediaType?: string;
};

type OCIIndex = {
  manifests?: Array<{
    digest?: string;
    artifactType?: string;
    annotations?: Record<string, string>;
  }>;
};

type OCIIndexManifest = NonNullable<OCIIndex["manifests"]>[number];

type OCIManifest = {
  artifactType?: string;
  annotations?: Record<string, string>;
  layers?: Array<{
    digest?: string;
    mediaType?: string;
  }>;
};

const IMAGE_CATALOG: Record<
  ImageKey,
  { image: string; identity: string }
> = {
  webhook: {
    image: "rancher/rancher-webhook",
    identity: "https://github.com/rancher/webhook",
  },
  rdp: {
    image: "rancher/remotedialer-proxy",
    identity: "https://github.com/rancher/remotedialer-proxy",
  },
};

const REGISTRY_HOSTS: Record<RegistryName, string> = {
  "docker.io": "registry-1.docker.io",
  "registry.suse.com": "registry.suse.com",
  "stgregistry.suse.com": "stgregistry.suse.com",
};

const REGISTRY_ENV_PREFIXES: Record<RegistryName, string> = {
  "docker.io": "DOCKER_IO",
  "registry.suse.com": "REGISTRY_SUSE",
  "stgregistry.suse.com": "STGREGISTRY_SUSE",
};

const DEFAULT_REGISTRIES: RegistryName[] = ["docker.io", "registry.suse.com"];

class RegistryAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryAuthError";
  }
}

class RegistryHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RegistryHttpError";
    this.status = status;
  }
}

export function parseAuthenticateHeader(header: string | null): Challenge | null {
  if (!header) {
    return null;
  }

  const [schemePart, ...rest] = header.trim().split(/\s+/);
  const scheme = schemePart.toLowerCase();

  if (scheme !== "basic" && scheme !== "bearer") {
    return null;
  }

  const params = Object.fromEntries(
    [...rest.join(" ").matchAll(/([a-zA-Z]+)="([^"]*)"/g)].map((match) => [
      match[1].toLowerCase(),
      match[2],
    ]),
  );

  return {
    scheme,
    realm: params.realm,
    service: params.service,
    scope: params.scope,
  };
}

export function toReferrersFallbackTag(digest: string) {
  return digest.replace(":", "-");
}

export function toLegacySignatureTag(digest: string) {
  return `${toReferrersFallbackTag(digest)}.sig`;
}

export function toLegacyAttestationTag(digest: string) {
  return `${toReferrersFallbackTag(digest)}.att`;
}

export function buildSimpleSigningPayloadCandidates(
  digest: string,
  repository: string,
  registry: RegistryName,
) {
  const dockerReferences = ["", repository, `${registry}/${repository}`];
  const candidates = new Map<string, Buffer>();

  for (const dockerReference of dockerReferences) {
    const withOptional = JSON.stringify({
      critical: {
        identity: {
          "docker-reference": dockerReference,
        },
        image: {
          "Docker-manifest-digest": digest,
        },
        type: "cosign container image signature",
      },
      optional: null,
    });

    const withoutOptional = JSON.stringify({
      critical: {
        identity: {
          "docker-reference": dockerReference,
        },
        image: {
          "Docker-manifest-digest": digest,
        },
        type: "cosign container image signature",
      },
    });

    candidates.set(withOptional, Buffer.from(withOptional, "utf8"));
    candidates.set(withoutOptional, Buffer.from(withoutOptional, "utf8"));
  }

  return [...candidates.values()];
}

export function normalizeTagList(tags: string[], limit = 20) {
  return [...new Set(tags)]
    .filter((tag) => tag && tag !== "latest" && tag.startsWith("v"))
    .sort((left, right) =>
      right.localeCompare(left, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function contentTypeFromBundle(bundle: unknown): SigningBundleContentType {
  if (!isRecord(bundle)) {
    return "unknown";
  }

  const content = bundle.content;

  if (!isRecord(content)) {
    return "unknown";
  }

  if ("messageSignature" in content) {
    return "message-signature";
  }

  if ("dsseEnvelope" in content) {
    return "dsse-envelope";
  }

  return "unknown";
}

function decodePredicateTypeFromBundle(bundle: unknown) {
  if (!isRecord(bundle) || !isRecord(bundle.content) || !("dsseEnvelope" in bundle.content)) {
    return undefined;
  }

  const dsseEnvelope = bundle.content.dsseEnvelope;

  if (!isRecord(dsseEnvelope) || typeof dsseEnvelope.payload !== "string") {
    return undefined;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(dsseEnvelope.payload, "base64").toString("utf8"),
    ) as Record<string, unknown>;

    return typeof decoded.predicateType === "string" ? decoded.predicateType : undefined;
  } catch {
    return undefined;
  }
}

function isSpdxPredicateType(predicateType: string | undefined) {
  if (!predicateType) {
    return false;
  }

  return predicateType === SPDX_PREDICATE_TYPE || predicateType.toLowerCase().includes("spdx");
}

export function describeBundleDescriptor(
  descriptor: OCIIndexManifest,
): BundleDescriptor | null {
  if (!descriptor?.digest) {
    return null;
  }

  if (descriptor.artifactType !== BUNDLE_ARTIFACT_TYPE) {
    return null;
  }

  const annotatedContent = descriptor.annotations?.["dev.sigstore.bundle.content"];
  const predicateType = descriptor.annotations?.["dev.sigstore.bundle.predicateType"];

  return {
    digest: descriptor.digest,
    contentType:
      annotatedContent === "message-signature" || annotatedContent === "dsse-envelope"
        ? annotatedContent
        : "unknown",
    predicateType,
  };
}

function cleanDetail(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isMissingBundleMessage(detail: string) {
  return (
    detail === "No Sigstore image signature bundles were found." ||
    detail === "No SPDX SBOM attestation bundles were found."
  );
}

function resolveRegistryCredentials(
  registry: RegistryName,
  repository: string,
): Credentials | null {
  const prefix = REGISTRY_ENV_PREFIXES[registry];
  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];

  if (username && password) {
    return { username, password };
  }

  try {
    return getRegistryCredentials(`${registry}/${repository}`);
  } catch {
    return null;
  }
}

class RegistryClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Headers;
  private bearerToken?: string;

  constructor(
    readonly registry: RegistryName,
    readonly repository: string,
    private readonly credentials: Credentials | null,
  ) {
    this.baseUrl = `https://${REGISTRY_HOSTS[registry]}/v2/${repository}`;
    this.defaultHeaders = new Headers(credentials?.headers ?? {});
  }

  private async fetchToken(challenge: Challenge) {
    if (challenge.scheme !== "bearer" || !challenge.realm) {
      throw new RegistryAuthError("Registry requested auth, but no bearer realm was provided.");
    }

    const tokenUrl = new URL(challenge.realm);

    if (challenge.service) {
      tokenUrl.searchParams.set("service", challenge.service);
    }

    if (challenge.scope) {
      tokenUrl.searchParams.set("scope", challenge.scope);
    }

    const headers = new Headers(this.defaultHeaders);

    if (this.credentials?.username && this.credentials.password) {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(
          `${this.credentials.username}:${this.credentials.password}`,
        ).toString("base64")}`,
      );
    }

    const response = await fetch(tokenUrl, { headers });

    if (response.status === 401 || response.status === 403) {
      throw new RegistryAuthError(`Authentication required for ${this.registry}.`);
    }

    if (!response.ok) {
      throw new RegistryHttpError(
        response.status,
        `Unable to fetch an auth token from ${tokenUrl.origin}.`,
      );
    }

    const payload = (await response.json()) as {
      token?: string;
      access_token?: string;
    };

    const token = payload.token ?? payload.access_token;

    if (!token) {
      throw new RegistryAuthError(`Registry ${this.registry} did not return an auth token.`);
    }

    this.bearerToken = token;
  }

  private async request(
    path: string,
    options: RequestInit & {
      accept?: string;
      allow404?: boolean;
    } = {},
  ) {
    const headers = new Headers(this.defaultHeaders);

    if (options.accept) {
      headers.set("accept", options.accept);
    }

    if (this.bearerToken) {
      headers.set("authorization", `Bearer ${this.bearerToken}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      const challenge = parseAuthenticateHeader(response.headers.get("www-authenticate"));

      if (!challenge) {
        throw new RegistryAuthError(`Authentication required for ${this.registry}.`);
      }

      if (challenge.scheme === "basic") {
        if (!this.credentials) {
          throw new RegistryAuthError(`Authentication required for ${this.registry}.`);
        }

        headers.set(
          "authorization",
          `Basic ${Buffer.from(
            `${this.credentials.username}:${this.credentials.password}`,
          ).toString("base64")}`,
        );
      } else {
        await this.fetchToken(challenge);
        headers.set("authorization", `Bearer ${this.bearerToken}`);
      }

      const retry = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
      });

      if (retry.status === 401 || retry.status === 403) {
        throw new RegistryAuthError(`Authentication required for ${this.registry}.`);
      }

      if (retry.status === 404 && options.allow404) {
        return null;
      }

      if (!retry.ok) {
        throw new RegistryHttpError(
          retry.status,
          `Registry request failed for ${this.registry}${path}.`,
        );
      }

      return retry;
    }

    if (response.status === 404 && options.allow404) {
      return null;
    }

    if (response.status === 401 || response.status === 403) {
      throw new RegistryAuthError(`Authentication required for ${this.registry}.`);
    }

    if (!response.ok) {
      throw new RegistryHttpError(
        response.status,
        `Registry request failed for ${this.registry}${path}.`,
      );
    }

    return response;
  }

  async getManifest(reference: string, accept = MANIFEST_ACCEPT): Promise<ManifestEnvelope | null> {
    const response = await this.request(`/manifests/${reference}`, {
      accept,
      allow404: true,
    });

    if (!response) {
      return null;
    }

    return {
      body: (await response.json()) as unknown,
      digest:
        response.headers.get("docker-content-digest") ??
        response.headers.get("Docker-Content-Digest") ??
        undefined,
      mediaType: response.headers.get("content-type") ?? undefined,
    };
  }

  async getBlobJson(digest: string) {
    const response = await this.request(`/blobs/${digest}`);

    if (!response) {
      throw new Error(`Blob ${digest} was not found.`);
    }

    return (await response.json()) as unknown;
  }

  async getReferrers(digest: string) {
    const referrers = await this.request(`/referrers/${digest}`, {
      accept: OCI_INDEX_MEDIA_TYPE,
      allow404: true,
    });

    if (referrers) {
      return (await referrers.json()) as OCIIndex;
    }

    const fallback = await this.getManifest(toReferrersFallbackTag(digest), OCI_INDEX_MEDIA_TYPE);

    if (!fallback || !isRecord(fallback.body)) {
      return null;
    }

    return fallback.body as OCIIndex;
  }

  async listTags(limit = 30) {
    const response = await this.request(`/tags/list?n=${limit}`);

    if (!response) {
      return [];
    }

    const payload = (await response.json()) as {
      tags?: string[];
    };

    return payload.tags ?? [];
  }
}

async function listDockerHubTags(repository: string, limit = 30) {
  const response = await fetch(
    `https://hub.docker.com/v2/repositories/${repository}/tags/?page_size=${limit}&ordering=last_updated`,
  );

  if (!response.ok) {
    throw new Error(`Unable to load tags from Docker Hub for ${repository}.`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      name?: string;
    }>;
  };

  return (payload.results ?? []).flatMap((tag) => (tag.name ? [tag.name] : []));
}

function assertRegistrySource(source: string): source is RegistryName {
  return source === "docker.io" || source === "registry.suse.com" || source === "stgregistry.suse.com";
}

export function isSigningTagSource(source: string): source is SigningTagSource {
  return source === "manual" || assertRegistrySource(source);
}

export async function listAvailableTags(
  imageKey: ImageKey,
  source: RegistryName,
  limit = 20,
) {
  const image = IMAGE_CATALOG[imageKey];

  if (source === "docker.io") {
    return normalizeTagList(await listDockerHubTags(image.image, Math.max(limit, 30)), limit);
  }

  const client = new RegistryClient(
    source,
    image.image,
    resolveRegistryCredentials(source, image.image),
  );

  return normalizeTagList(await client.listTags(Math.max(limit, 100)), limit);
}

async function loadBundleDescriptors(client: RegistryClient, digest: string) {
  const referrers = await client.getReferrers(digest);

  if (!referrers?.manifests?.length) {
    return [];
  }

  return referrers.manifests
    .map(describeBundleDescriptor)
    .filter((descriptor): descriptor is BundleDescriptor => descriptor !== null);
}

async function fetchBundle(client: RegistryClient, descriptor: BundleDescriptor) {
  const manifestEnvelope = await client.getManifest(descriptor.digest);

  if (!manifestEnvelope || !isRecord(manifestEnvelope.body)) {
    throw new Error(`Bundle manifest ${descriptor.digest} could not be loaded.`);
  }

  const manifest = manifestEnvelope.body as OCIManifest;
  const layer = manifest.layers?.[0];

  if (!layer?.digest) {
    throw new Error(`Bundle manifest ${descriptor.digest} is missing its payload layer.`);
  }

  const bundle = (await client.getBlobJson(layer.digest)) as SerializedBundle;
  const contentType =
    descriptor.contentType === "unknown" ? contentTypeFromBundle(bundle) : descriptor.contentType;
  const predicateType = descriptor.predicateType ?? decodePredicateTypeFromBundle(bundle);

  return {
    bundle,
    contentType,
    predicateType,
  };
}

async function verifySignatureBundles(
  bundles: Array<{ bundle: SerializedBundle; contentType: SigningBundleContentType }>,
  identity: string,
  digest: string,
  repository: string,
  registry: RegistryName,
) {
  const signatureBundles = bundles.filter(
    (bundle) => bundle.contentType === "message-signature",
  );

  if (signatureBundles.length === 0) {
    return {
      ok: false,
      detail: "No Sigstore image signature bundles were found.",
    };
  }

  const payloads = buildSimpleSigningPayloadCandidates(digest, repository, registry);
  const failures: string[] = [];

  for (const candidate of payloads) {
    for (const bundle of signatureBundles) {
      try {
        await sigstore.verify(bundle.bundle, candidate, {
          certificateIssuer: OIDC_ISSUER,
          certificateIdentityURI: identity,
        });

        return {
          ok: true,
          detail: "Verified a keyless image signature bundle.",
        };
      } catch (error) {
        failures.push(cleanDetail(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  return {
    ok: false,
    detail: failures[0] ?? "Signature bundles were found, but verification failed.",
  };
}

async function verifySbomBundles(
  bundles: Array<{
    bundle: SerializedBundle;
    contentType: SigningBundleContentType;
    predicateType?: string;
  }>,
  identity: string,
) {
  const spdxBundles = bundles.filter(
    (bundle) =>
      bundle.contentType === "dsse-envelope" && isSpdxPredicateType(bundle.predicateType),
  );

  if (spdxBundles.length === 0) {
    return {
      ok: false,
      detail: "No SPDX SBOM attestation bundles were found.",
    };
  }

  const failures: string[] = [];

  for (const bundle of spdxBundles) {
    try {
      await sigstore.verify(bundle.bundle, {
        certificateIssuer: OIDC_ISSUER,
        certificateIdentityURI: identity,
      });

      return {
        ok: true,
        detail: "Verified an SPDX SBOM attestation bundle.",
      };
    } catch (error) {
      failures.push(cleanDetail(error instanceof Error ? error.message : String(error)));
    }
  }

  return {
    ok: false,
    detail: failures[0] ?? "SPDX attestation bundles were found, but verification failed.",
  };
}

async function findLegacyTags(client: RegistryClient, digest: string) {
  const [signatureManifest, attestationManifest] = await Promise.all([
    client.getManifest(toLegacySignatureTag(digest)),
    client.getManifest(toLegacyAttestationTag(digest)),
  ]);

  return {
    hasLegacySignature: Boolean(signatureManifest),
    hasLegacyAttestation: Boolean(attestationManifest),
  };
}

async function checkRegistry(
  registry: RegistryName,
  imageKey: ImageKey,
  version: string,
): Promise<RegistryCheckResult> {
  const image = IMAGE_CATALOG[imageKey];
  const reference = `${registry}/${image.image}:${version}`;
  const client = new RegistryClient(
    registry,
    image.image,
    resolveRegistryCredentials(registry, image.image),
  );

  const result: RegistryCheckResult = {
    reference,
    notes: [],
    signature: { ok: false, detail: "No check run." },
    sbom: { ok: false, detail: "No check run." },
  };

  const imageManifest = await client.getManifest(version);

  if (!imageManifest?.digest) {
    throw new Error(`Unable to resolve ${reference} to a digest.`);
  }

  result.digest = imageManifest.digest;

  const descriptors = await loadBundleDescriptors(client, imageManifest.digest);
  const loadedBundles = await Promise.all(descriptors.map((descriptor) => fetchBundle(client, descriptor)));

  result.signature = await verifySignatureBundles(
    loadedBundles,
    image.identity,
    imageManifest.digest,
    image.image,
    registry,
  );
  result.sbom = await verifySbomBundles(loadedBundles, image.identity);

  const legacy = await findLegacyTags(client, imageManifest.digest);

  if (!result.signature.ok && isMissingBundleMessage(result.signature.detail)) {
    result.signature.detail = legacy.hasLegacySignature
      ? "No Sigstore image signature bundles were found."
      : "No Sigstore image signature bundles or legacy cosign .sig tags were found.";
  }

  if (!result.sbom.ok && isMissingBundleMessage(result.sbom.detail)) {
    result.sbom.detail = legacy.hasLegacyAttestation
      ? "No SPDX SBOM attestation bundles were found."
      : "No SPDX SBOM attestation bundles or legacy cosign .att tags were found.";
  }

  if (legacy.hasLegacySignature && !result.signature.ok) {
    result.notes.push(
      "Legacy cosign signature tags were found, but the browser verifier only validates Sigstore bundle artifacts today.",
    );
  }

  if (legacy.hasLegacyAttestation && !result.sbom.ok) {
    result.notes.push(
      "Legacy attestation tags were found, but the browser verifier only validates Sigstore bundle artifacts today.",
    );
  }

  return result;
}

function formatStatus(label: string, status: VerificationStatus) {
  return `${status.ok ? "[pass]" : "[fail]"} ${label}: ${status.detail}`;
}

function formatRegistryResult(result: RegistryCheckResult) {
  const lines = [
    result.reference,
    `  digest: ${result.digest ?? "unknown"}`,
    `  ${formatStatus("signature", result.signature)}`,
    `  ${formatStatus("sbom", result.sbom)}`,
  ];

  for (const note of result.notes) {
    lines.push(`  [note] ${note}`);
  }

  return lines.join("\n");
}

export async function runSigningCheck(options: SigningCheckOptions) {
  const image = IMAGE_CATALOG[options.imageKey];
  const registries: RegistryName[] = options.includeStaging
    ? [...DEFAULT_REGISTRIES, "stgregistry.suse.com"]
    : [...DEFAULT_REGISTRIES];

  const output = [
    "Rancher image signing check",
    "",
    `Image: ${image.image}`,
    `Version: ${options.version}`,
    `Identity match: ${image.identity}`,
    "",
  ];

  for (const registry of registries) {
    try {
      const result = await checkRegistry(registry, options.imageKey, options.version);
      output.push(formatRegistryResult(result), "");
    } catch (error) {
      const message =
        error instanceof RegistryAuthError
          ? `${error.message} Add ${REGISTRY_ENV_PREFIXES[registry]}_USERNAME and ${REGISTRY_ENV_PREFIXES[registry]}_PASSWORD if this registry needs credentials.`
          : cleanDetail(error instanceof Error ? error.message : String(error));

      output.push(
        `${registry}/${image.image}:${options.version}`,
        `  [fail] registry check: ${message}`,
        "",
      );
    }
  }

  return output.join("\n").trim();
}
