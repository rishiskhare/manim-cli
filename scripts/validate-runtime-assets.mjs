#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const manifestPath = path.resolve(process.argv[2] ?? path.join("runtime", "runtime-manifest.json"));
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const supportedPlatforms = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"]);
const seenPlatforms = new Set();

if (!Array.isArray(manifest.bundles) || manifest.bundles.length === 0) {
  throw new Error("runtime manifest contains no bundles");
}

for (const bundle of manifest.bundles) {
  if (!bundle.version || !bundle.platform || !bundle.archiveUrl || !bundle.sha256) {
    throw new Error(`runtime bundle entry is incomplete: ${JSON.stringify(bundle)}`);
  }
  if (!supportedPlatforms.has(bundle.platform)) {
    throw new Error(`runtime bundle platform is unsupported: ${bundle.platform}`);
  }
  if (seenPlatforms.has(bundle.platform)) {
    throw new Error(`runtime manifest contains duplicate platform entry: ${bundle.platform}`);
  }
  seenPlatforms.add(bundle.platform);
  if (!/^https?:\/\//.test(bundle.archiveUrl) && !/^file:\/\//.test(bundle.archiveUrl)) {
    throw new Error(`runtime bundle URL must be absolute: ${bundle.archiveUrl}`);
  }
  if (/^https:\/\/github\.com\//.test(bundle.archiveUrl) && !/\/releases\/download\//.test(bundle.archiveUrl)) {
    throw new Error(`runtime bundle URL is not a GitHub release asset URL: ${bundle.archiveUrl}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(bundle.sha256)) {
    throw new Error(`runtime bundle checksum is invalid for ${bundle.platform}`);
  }
  if (manifest.channel === "stable" && bundle.minimumCliVersion !== manifest.bundles[0].minimumCliVersion) {
    throw new Error(`runtime bundle minimum CLI versions must match in stable manifest: ${bundle.platform}`);
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, bundles: manifest.bundles.length }, null, 2)}\n`);
