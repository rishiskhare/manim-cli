#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as tar from "tar";
import AdmZip from "adm-zip";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

const runtimeRoot = arg("--runtime-root");
const outDir = arg("--out-dir") ?? path.resolve("runtime", "dist");
const platform = arg("--platform");
const version = arg("--version");
const archiveType = arg("--archive-type") ?? (platform?.startsWith("win32-") ? "zip" : "tar.gz");

if (!runtimeRoot || !platform || !version) {
  process.stderr.write("Usage: node scripts/pack-runtime.mjs --runtime-root <dir> --platform <platform> --version <version> [--out-dir <dir>] [--archive-type tar.gz|zip]\n");
  process.exit(1);
}

const absoluteRuntimeRoot = path.resolve(runtimeRoot);
const runtimeJsonPath = path.join(absoluteRuntimeRoot, "runtime.json");
const bootstrapJsonPath = path.join(absoluteRuntimeRoot, "bootstrap.json");
const runtimeJson = JSON.parse(await fs.readFile(runtimeJsonPath, "utf8"));
const expectedBinaries = ["python", "pip", "manim", "ffmpeg", "ffprobe"];
const condaMetaPath = path.join(absoluteRuntimeRoot, "conda-meta");
const hasBootstrapRecipe = await fs.access(bootstrapJsonPath).then(() => true).catch(() => false);

for (const name of expectedBinaries) {
  if (!runtimeJson.binaries?.[name]) {
    throw new Error(`runtime.json is missing binary path for ${name}`);
  }
  if (!hasBootstrapRecipe) {
    const resolved = path.join(absoluteRuntimeRoot, runtimeJson.binaries[name]);
    await fs.access(resolved);
  }
}

await fs.mkdir(outDir, { recursive: true });
const archiveBase = `${platform}-${version}`;
const archivePath = path.join(outDir, `${archiveBase}.${archiveType === "zip" ? "zip" : "tar.gz"}`);

const hasCondaMeta = await fs.access(condaMetaPath).then(() => true).catch(() => false);
if (hasCondaMeta) {
  execFileSync("conda-pack", [
    "-p",
    absoluteRuntimeRoot,
    "-o",
    archivePath,
    "--format",
    archiveType === "zip" ? "zip" : "tar.gz",
    "--ignore-missing-files",
    "--force"
  ], {
    stdio: "inherit"
  });
} else if (archiveType === "zip") {
  const zip = new AdmZip();
  zip.addLocalFolder(absoluteRuntimeRoot, path.basename(absoluteRuntimeRoot));
  zip.writeZip(archivePath);
} else {
  await tar.create({
    gzip: true,
    cwd: path.dirname(absoluteRuntimeRoot),
    file: archivePath
  }, [path.basename(absoluteRuntimeRoot)]);
}

const sha256 = crypto.createHash("sha256").update(await fs.readFile(archivePath)).digest("hex");
process.stdout.write(`${JSON.stringify({ archivePath, sha256 }, null, 2)}\n`);
