import { createWriteStream } from "node:fs";
import { chmod, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const version = process.env.SLSACTL_VERSION || "v0.1.31";
const shouldInstall = process.env.VERCEL || process.env.INSTALL_SLSACTL === "1";
const projectRoot = process.cwd();
const binDir = path.join(projectRoot, "bin");
const target = path.join(binDir, "slsactl");

if (!shouldInstall) {
  console.log("Skipping slsactl install outside Vercel. Set INSTALL_SLSACTL=1 to install locally.");
  process.exit(0);
}

await mkdir(binDir, { recursive: true });

try {
  const existing = await stat(target);

  if (existing.isFile()) {
    console.log(`slsactl already exists at ${target}`);
    process.exit(0);
  }
} catch {
  // Install below.
}

const apiUrl = `https://api.github.com/repos/rancherlabs/slsactl/releases/tags/${version}`;
const releaseResponse = await fetch(apiUrl, {
  headers: {
    Accept: "application/vnd.github+json",
    "User-Agent": "frameworks-qa-regression",
  },
});

if (!releaseResponse.ok) {
  throw new Error(`Unable to load slsactl release ${version}: ${releaseResponse.status}`);
}

const release = await releaseResponse.json();
const assets = Array.isArray(release.assets) ? release.assets : [];
const asset = assets.find((candidate) => {
  const name = String(candidate.name ?? "").toLowerCase();

  return (
    name.includes("linux") &&
    (name.includes("amd64") || name.includes("x86_64")) &&
    (name.endsWith(".tar.gz") || name.endsWith(".tgz") || name === "slsactl")
  );
});

if (!asset?.browser_download_url) {
  const names = assets.map((candidate) => candidate.name).filter(Boolean).join(", ");
  throw new Error(`No linux amd64 slsactl asset found for ${version}. Available assets: ${names}`);
}

const tmpDir = path.join(os.tmpdir(), `slsactl-${Date.now()}`);
await rm(tmpDir, { force: true, recursive: true });
await mkdir(tmpDir, { recursive: true });

const archivePath = path.join(tmpDir, String(asset.name));
const downloadResponse = await fetch(asset.browser_download_url);

if (!downloadResponse.ok || !downloadResponse.body) {
  throw new Error(`Unable to download ${asset.browser_download_url}: ${downloadResponse.status}`);
}

await pipeline(downloadResponse.body, createWriteStream(archivePath));

let binaryPath = archivePath;

if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
  execFileSync("tar", ["-xzf", archivePath, "-C", tmpDir], { stdio: "inherit" });
  binaryPath = await findSlsactlBinary(tmpDir);
}

await cp(binaryPath, target);
await chmod(target, 0o755);
await rm(tmpDir, { force: true, recursive: true });

console.log(`Installed slsactl ${version} to ${target}`);

async function findSlsactlBinary(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const found = await findSlsactlBinary(entryPath).catch(() => null);

      if (found) {
        return found;
      }
    }

    if (entry.isFile() && entry.name === "slsactl") {
      return entryPath;
    }
  }

  throw new Error(`Unable to find slsactl binary inside ${directory}`);
}
