import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getRegistryCredentials } from "@sigstore/oci";
import * as sigstore from "sigstore";
import type { Bundle as SerializedBundle } from "sigstore";

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const BUNDLE_ARTIFACT_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const BUNDLE_LAYER_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const OCI_INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json";
const MANIFEST_ACCEPT =
  "application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json";
const SPDX_PREDICATE_TYPE = "https://spdx.dev/Document";
const COSIGN_SIGN_PREDICATE_TYPE = "https://sigstore.dev/cosign/sign/v1";
const SLSA_PROVENANCE_PREDICATE_TYPE = "https://slsa.dev/provenance/v1";
const SBOM_ATTACHMENT_SUFFIX = "sbom";
const SBOM_MEDIA_TYPES = new Set([
  "text/spdx",
  "text/spdx+json",
  "text/spdx+xml",
  "application/vnd.cyclonedx",
  "application/vnd.cyclonedx+json",
  "application/vnd.cyclonedx+xml",
  "application/vnd.syft+json",
]);

type ImageKey = "webhook" | "rdp";

export type RegistryName = "docker.io" | "registry.suse.com" | "stgregistry.suse.com";

type Credentials = {
  username: string;
  password: string;
  headers?: Record<string, string>;
};

type SigningCheckOptions = {
  imageKey: ImageKey;
  version: string;
  registry: RegistryName;
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
  checks: string[];
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

const SIGSTORE_TUF_CACHE_PATH = path.join(os.tmpdir(), "sigstore-js-cache");

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

  if ("messageSignature" in bundle) {
    return "message-signature";
  }

  if ("dsseEnvelope" in bundle) {
    return "dsse-envelope";
  }

  return "unknown";
}

function decodePredicateTypeFromBundle(bundle: unknown) {
  if (!isRecord(bundle) || !("dsseEnvelope" in bundle)) {
    return undefined;
  }

  const dsseEnvelope = bundle.dsseEnvelope;

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

function isSbomPredicateType(predicateType: string | undefined) {
  if (!predicateType) {
    return false;
  }

  const normalized = predicateType.toLowerCase();

  return (
    predicateType === SPDX_PREDICATE_TYPE ||
    normalized.includes("spdx") ||
    normalized.includes("cyclonedx") ||
    normalized.includes("sbom")
  );
}

function isSbomMediaType(mediaType: string | undefined) {
  if (!mediaType) {
    return false;
  }

  return SBOM_MEDIA_TYPES.has(mediaType);
}

function isSignaturePredicateType(predicateType: string | undefined) {
  if (!predicateType) {
    return false;
  }

  return (
    predicateType === COSIGN_SIGN_PREDICATE_TYPE ||
    predicateType === SLSA_PROVENANCE_PREDICATE_TYPE ||
    predicateType.toLowerCase().includes("cosign/sign") ||
    predicateType.toLowerCase().includes("slsa.dev/provenance")
  );
}

export function describeBundleDescriptor(
  descriptor: OCIIndexManifest,
): BundleDescriptor | null {
  if (!descriptor?.digest) {
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

async function getSigstoreVerifyOptions(identity: string) {
  await mkdir(SIGSTORE_TUF_CACHE_PATH, { recursive: true });

  return {
    certificateIssuer: OIDC_ISSUER,
    certificateIdentityURI: identity,
    tufCachePath: SIGSTORE_TUF_CACHE_PATH,
  } as const;
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

  async getBlobText(digest: string) {
    const response = await this.request(`/blobs/${digest}`);

    if (!response) {
      throw new Error(`Blob ${digest} was not found.`);
    }

    return await response.text();
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

export function isRegistryName(source: string): source is RegistryName {
  return source === "docker.io" || source === "registry.suse.com" || source === "stgregistry.suse.com";
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

  if (
    manifest.artifactType !== BUNDLE_ARTIFACT_TYPE &&
    layer?.mediaType !== BUNDLE_LAYER_MEDIA_TYPE
  ) {
    return null;
  }

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
  bundles: Array<{
    bundle: SerializedBundle;
    contentType: SigningBundleContentType;
    predicateType?: string;
  }>,
  identity: string,
) {
  const signatureBundles = bundles.filter((bundle) => {
    if (bundle.contentType === "message-signature") {
      return true;
    }

    return bundle.contentType === "dsse-envelope" && isSignaturePredicateType(bundle.predicateType);
  });

  if (signatureBundles.length === 0) {
    return {
      ok: false,
      detail: "No Sigstore image signature bundles were found.",
    };
  }
  const failures: string[] = [];
  const verifiedPredicates = new Set<string>();

  for (const bundle of signatureBundles) {
    try {
      if (bundle.contentType === "message-signature") {
        failures.push("Message-signature bundles are not expected for these images.");
        continue;
      }

      await sigstore.verify(bundle.bundle, await getSigstoreVerifyOptions(identity));

      if (bundle.predicateType) {
        verifiedPredicates.add(bundle.predicateType);
      }
    } catch (error) {
      failures.push(cleanDetail(error instanceof Error ? error.message : String(error)));
    }
  }

  if (verifiedPredicates.size > 0) {
    return {
      ok: true,
      detail: `Verified Sigstore claims: ${[...verifiedPredicates].join(", ")}.`,
    };
  }

  return {
    ok: false,
    detail: failures[0] ?? "Signature bundles were found, but verification failed.",
  };
}

async function verifyMessageSignatureBundles(
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
    return null;
  }

  const payloads = buildSimpleSigningPayloadCandidates(digest, repository, registry);
  const failures: string[] = [];

  for (const candidate of payloads) {
    for (const bundle of signatureBundles) {
      try {
        await sigstore.verify(
          bundle.bundle,
          candidate,
          await getSigstoreVerifyOptions(identity),
        );

        return {
          ok: true,
          detail: "Verified a keyless image signature bundle.",
        };
      } catch (error) {
        failures.push(cleanDetail(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  return failures[0] ?? "Message-signature bundles were found, but verification failed.";
}

async function verifySbomBundles(
  bundles: Array<{
    bundle: SerializedBundle;
    contentType: SigningBundleContentType;
    predicateType?: string;
  }>,
  identity: string,
) {
  const sbomBundles = bundles.filter(
    (bundle) =>
      bundle.contentType === "dsse-envelope" && isSbomPredicateType(bundle.predicateType),
  );

  if (sbomBundles.length === 0) {
    return {
      ok: false,
      detail: "No SPDX SBOM attestation bundles were found.",
    };
  }

  const failures: string[] = [];

  for (const bundle of sbomBundles) {
    try {
      await sigstore.verify(bundle.bundle, await getSigstoreVerifyOptions(identity));

      return {
        ok: true,
        detail: `Verified an SBOM attestation bundle${bundle.predicateType ? ` (${bundle.predicateType})` : ""}.`,
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

function collectChildManifestDigests(manifestBody: unknown) {
  if (!isRecord(manifestBody) || !Array.isArray(manifestBody.manifests)) {
    return [] as string[];
  }

  return manifestBody.manifests.flatMap((manifest) => {
    if (!isRecord(manifest) || typeof manifest.digest !== "string") {
      return [];
    }

    return [manifest.digest];
  });
}

async function loadSbomAttachmentForTag(client: RegistryClient, tag: string) {
  const manifestEnvelope = await client.getManifest(tag);

  if (!manifestEnvelope || !isRecord(manifestEnvelope.body)) {
    return null;
  }

  return await loadSbomAttachmentFromManifest(client, manifestEnvelope.body as OCIManifest);
}

async function loadSbomAttachmentFromManifest(
  client: RegistryClient,
  manifest: OCIManifest,
) {
  const sbomLayer = manifest.layers?.find((layer) => isSbomMediaType(layer.mediaType));

  if (!sbomLayer?.digest) {
    return null;
  }

  return {
    mediaType: sbomLayer.mediaType ?? "unknown",
    document: await client.getBlobText(sbomLayer.digest),
  };
}

async function loadSbomAttachmentFromReferrers(client: RegistryClient, digest: string) {
  const referrers = await client.getReferrers(digest);

  if (!referrers?.manifests?.length) {
    return null;
  }

  for (const descriptor of referrers.manifests) {
    if (typeof descriptor.digest !== "string") {
      continue;
    }

    const manifestEnvelope = await client.getManifest(descriptor.digest);

    if (!manifestEnvelope || !isRecord(manifestEnvelope.body)) {
      continue;
    }

    const attachment = await loadSbomAttachmentFromManifest(
      client,
      manifestEnvelope.body as OCIManifest,
    );

    if (attachment) {
      return attachment;
    }
  }

  return null;
}

async function findSbomAttachment(
  client: RegistryClient,
  digest: string,
  manifestBody: unknown,
) {
  const referrerAttachment = await loadSbomAttachmentFromReferrers(client, digest);

  if (referrerAttachment) {
    return referrerAttachment;
  }

  const candidateTags = [
    `${toReferrersFallbackTag(digest)}.${SBOM_ATTACHMENT_SUFFIX}`,
    ...collectChildManifestDigests(manifestBody).map(
      (childDigest) => `${toReferrersFallbackTag(childDigest)}.${SBOM_ATTACHMENT_SUFFIX}`,
    ),
  ];

  for (const tag of new Set(candidateTags)) {
    const attachment = await loadSbomAttachmentForTag(client, tag);

    if (attachment) {
      return attachment;
    }
  }

  return null;
}

async function findSbomInImageAttestations(
  client: RegistryClient,
  manifestBody: unknown,
) {
  if (isRecord(manifestBody) && isRecord(manifestBody.annotations)) {
    for (const [key, value] of Object.entries(manifestBody.annotations)) {
      if (!key.toLowerCase().includes("sbom") || typeof value !== "string") {
        continue;
      }

      try {
        JSON.parse(value);
        return {
          source: "image annotation",
          predicateType: "embedded sbom annotation",
        };
      } catch {
        // Ignore annotations that are not embedded JSON payloads.
      }
    }
  }

  if (!isRecord(manifestBody) || !Array.isArray(manifestBody.manifests)) {
    return null;
  }

  for (const descriptor of manifestBody.manifests) {
    const annotations =
      isRecord(descriptor) && isRecord(descriptor.annotations) ? descriptor.annotations : null;

    if (
      !isRecord(descriptor) ||
      typeof descriptor.digest !== "string" ||
      annotations?.["vnd.docker.reference.type"] !== "attestation-manifest"
    ) {
      continue;
    }

    const attestationManifest = await client.getManifest(descriptor.digest);

    if (!attestationManifest || !isRecord(attestationManifest.body)) {
      continue;
    }

    const manifest = attestationManifest.body as OCIManifest;

    for (const layer of manifest.layers ?? []) {
      if (typeof layer.digest !== "string") {
        continue;
      }

      try {
        const payload = await client.getBlobJson(layer.digest);

        if (!isRecord(payload)) {
          continue;
        }

        const predicateType =
          typeof payload.predicateType === "string" ? payload.predicateType : undefined;

        if (!isSbomPredicateType(predicateType) || !("predicate" in payload)) {
          continue;
        }

        return {
          source: "image index attestation",
          predicateType: predicateType ?? "unknown predicate",
        };
      } catch {
        // Keep scanning the remaining attestation layers.
      }
    }
  }

  return null;
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
    checks: [],
    notes: [],
    signature: { ok: false, detail: "No check run." },
    sbom: { ok: false, detail: "No check run." },
  };

  const imageManifest = await client.getManifest(version);

  if (!imageManifest?.digest) {
    throw new Error(`Unable to resolve ${reference} to a digest.`);
  }

  result.digest = imageManifest.digest;
  result.checks.push(`Resolved the selected tag to digest ${imageManifest.digest}.`);

  const descriptors = await loadBundleDescriptors(client, imageManifest.digest);
  result.checks.push(
    `Signature lookup checked Sigstore referrers for ${toReferrersFallbackTag(imageManifest.digest)} plus legacy .sig tags.`,
  );
  result.checks.push(
    "SBOM lookup checked Sigstore bundles, image index attestations, downloadable .sbom attachments, and legacy .att tags.",
  );
  const loadedBundles = (
    await Promise.all(descriptors.map((descriptor) => fetchBundle(client, descriptor)))
  ).filter(Boolean) as Array<{
    bundle: SerializedBundle;
    contentType: SigningBundleContentType;
    predicateType?: string;
  }>;

  result.signature = await verifySignatureBundles(loadedBundles, image.identity);
  result.sbom = await verifySbomBundles(loadedBundles, image.identity);

  const messageSignatureFailure = await verifyMessageSignatureBundles(
    loadedBundles,
    image.identity,
    imageManifest.digest,
    image.image,
    registry,
  );

  if (!result.signature.ok && messageSignatureFailure && typeof messageSignatureFailure !== "string") {
    result.signature = messageSignatureFailure;
  }

  const legacy = await findLegacyTags(client, imageManifest.digest);
  const imageAttestationSbom = await findSbomInImageAttestations(
    client,
    imageManifest.body,
  );
  const sbomAttachment = await findSbomAttachment(
    client,
    imageManifest.digest,
    imageManifest.body,
  );

  if (!result.signature.ok && isMissingBundleMessage(result.signature.detail)) {
    result.signature.detail = legacy.hasLegacySignature
      ? "No Sigstore image signature bundles were found."
      : "No Sigstore image signature bundles or legacy cosign .sig tags were found.";
  }

  if (
    !result.signature.ok &&
    messageSignatureFailure &&
    typeof messageSignatureFailure === "string"
  ) {
    result.notes.push(messageSignatureFailure);
  }

  if (!result.sbom.ok && isMissingBundleMessage(result.sbom.detail)) {
    if (imageAttestationSbom) {
      result.sbom = {
        ok: true,
        detail: `Found an SBOM attestation in the ${imageAttestationSbom.source} (${imageAttestationSbom.predicateType}).`,
      };
    } else if (sbomAttachment) {
      result.sbom = {
        ok: true,
        detail: `Downloaded SBOM attachment (${sbomAttachment.mediaType}).`,
      };
    } else {
      result.sbom.detail = legacy.hasLegacyAttestation
        ? "No SPDX SBOM attestation bundles were found."
        : "No SPDX SBOM attestation bundles, downloadable .sbom attachments, or legacy cosign .att tags were found.";
    }
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

  for (const check of result.checks) {
    lines.push(`  [check] ${check}`);
  }

  for (const note of result.notes) {
    lines.push(`  [note] ${note}`);
  }

  return lines.join("\n");
}

function isResolveErrorMessage(message: string) {
  return message.includes("Unable to resolve") && message.includes("to a digest");
}

export async function runSigningCheck(options: SigningCheckOptions) {
  const image = IMAGE_CATALOG[options.imageKey];
  const registries: RegistryName[] = [options.registry];

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

      if (isResolveErrorMessage(message)) {
        output.push(
          `${registry}/${image.image}:${options.version}`,
          "  [note] registry check: This tag could not be resolved in this registry, so no signature lookup was attempted there.",
          "",
        );
      } else {
        output.push(
          `${registry}/${image.image}:${options.version}`,
          `  [fail] registry check: ${message}`,
          "",
        );
      }
    }
  }

  return output.join("\n").trim();
}
