import { describe, expect, it } from "vitest";
import {
  buildSimpleSigningPayloadCandidates,
  describeBundleDescriptor,
  normalizeTagList,
  parseAuthenticateHeader,
  toLegacyAttestationTag,
  toLegacySignatureTag,
  toReferrersFallbackTag,
} from "./signing-check";

describe("parseAuthenticateHeader", () => {
  it("parses bearer auth challenges", () => {
    expect(
      parseAuthenticateHeader(
        'Bearer realm="https://auth.example.com/token",service="registry.example.com",scope="repository:rancher/rancher-webhook:pull"',
      ),
    ).toEqual({
      scheme: "bearer",
      realm: "https://auth.example.com/token",
      service: "registry.example.com",
      scope: "repository:rancher/rancher-webhook:pull",
    });
  });

  it("returns null for unsupported schemes", () => {
    expect(parseAuthenticateHeader('Digest realm="nope"')).toBeNull();
  });
});

describe("tag helpers", () => {
  const digest =
    "sha256:8f5365575ed43fe6f76e4eb23bb733a29393355708d87c65650933ec916022df";

  it("builds the referrers fallback tag", () => {
    expect(toReferrersFallbackTag(digest)).toBe(
      "sha256-8f5365575ed43fe6f76e4eb23bb733a29393355708d87c65650933ec916022df",
    );
  });

  it("builds legacy signature and attestation tags", () => {
    expect(toLegacySignatureTag(digest)).toBe(
      "sha256-8f5365575ed43fe6f76e4eb23bb733a29393355708d87c65650933ec916022df.sig",
    );
    expect(toLegacyAttestationTag(digest)).toBe(
      "sha256-8f5365575ed43fe6f76e4eb23bb733a29393355708d87c65650933ec916022df.att",
    );
  });
});

describe("buildSimpleSigningPayloadCandidates", () => {
  it("includes the common simple-signing payload variants", () => {
    const payloads = buildSimpleSigningPayloadCandidates(
      "sha256:1234",
      "rancher/rancher-webhook",
      "docker.io",
    ).map((payload) => payload.toString("utf8"));

    expect(payloads.length).toBe(6);
    expect(payloads).toContain(
      JSON.stringify({
        critical: {
          identity: { "docker-reference": "" },
          image: { "Docker-manifest-digest": "sha256:1234" },
          type: "cosign container image signature",
        },
        optional: null,
      }),
    );
    expect(payloads).toContain(
      JSON.stringify({
        critical: {
          identity: { "docker-reference": "docker.io/rancher/rancher-webhook" },
          image: { "Docker-manifest-digest": "sha256:1234" },
          type: "cosign container image signature",
        },
      }),
    );
  });
});

describe("normalizeTagList", () => {
  it("filters, de-dupes, and sorts version-like tags", () => {
    expect(
      normalizeTagList([
        "latest",
        "v0.9.2",
        "v0.10.0-rc.11",
        "v0.10.0-rc.11",
        "foo",
        "v0.9.10",
        "v0.9.3",
      ]),
    ).toEqual(["v0.10.0-rc.11", "v0.9.10", "v0.9.3", "v0.9.2"]);
  });
});

describe("describeBundleDescriptor", () => {
  it("recognizes sigstore bundle descriptors", () => {
    expect(
      describeBundleDescriptor({
        digest: "sha256:cafebabe",
        artifactType: "application/vnd.dev.sigstore.bundle.v0.3+json",
        annotations: {
          "dev.sigstore.bundle.content": "dsse-envelope",
          "dev.sigstore.bundle.predicateType": "https://spdx.dev/Document",
        },
      }),
    ).toEqual({
      digest: "sha256:cafebabe",
      contentType: "dsse-envelope",
      predicateType: "https://spdx.dev/Document",
    });
  });

  it("ignores non-sigstore descriptors", () => {
    expect(
      describeBundleDescriptor({
        digest: "sha256:cafebabe",
        artifactType: "application/vnd.oci.image.manifest.v1+json",
      }),
    ).toBeNull();
  });
});
