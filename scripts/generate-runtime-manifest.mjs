#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

const bundlesDir = path.resolve(arg("--bundles-dir") ?? path.join("runtime", "dist"));
const baseUrl = arg("--base-url");
const githubRepo = arg("--github-repo");
const releaseTag = arg("--release-tag");
const version = arg("--version");
const channel = arg("--channel") ?? "stable";
const minimumCliVersion = arg("--minimum-cli-version") ?? version;
const outPath = path.resolve(arg("--out") ?? path.join("runtime", "runtime-manifest.json"));
const installStrategy = arg("--install-strategy") ?? "archive";

const resolvedBaseUrl = baseUrl ?? (githubRepo && releaseTag ? `https://github.com/${githubRepo}/releases/download/${releaseTag}` : undefined);

if (!resolvedBaseUrl || !version) {
  process.stderr.write("Usage: node scripts/generate-runtime-manifest.mjs --bundles-dir <dir> (--base-url <url> | --github-repo <owner/repo> --release-tag <tag>) --version <version> [--minimum-cli-version <version>] [--channel <channel>] [--out <path>]\n");
  process.exit(1);
}

const entries = await fs.readdir(bundlesDir);
const bundles = [];
for (const entry of entries) {
  if (!entry.endsWith(".tar.gz") && !entry.endsWith(".zip")) {
    continue;
  }
  const filePath = path.join(bundlesDir, entry);
  const stem = entry.replace(/(\.tar\.gz|\.zip)$/, "");
  const versionSuffix = `-${version}`;
  if (!stem.endsWith(versionSuffix)) {
    throw new Error(`Archive ${entry} does not end with expected version suffix ${versionSuffix}`);
  }
  const platform = stem.slice(0, -versionSuffix.length);
  const archiveType = entry.endsWith(".zip") ? "zip" : "tar.gz";
  const sha256 = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
  bundles.push({
    version,
    platform,
      archiveUrl: `${resolvedBaseUrl.replace(/\/$/, "")}/${entry}`,
      sha256,
      minimumCliVersion,
      archiveType,
      installStrategy
    });
}

bundles.sort((left, right) => left.platform.localeCompare(right.platform));
const manifest = {
  channel,
  generatedAt: new Date().toISOString(),
  bundles
};

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outPath, bundleCount: bundles.length }, null, 2)}\n`);
