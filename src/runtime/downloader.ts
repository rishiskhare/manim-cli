import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { getRuntimeDownloadsPath, getRuntimeVersionsPath } from "../config/paths.js";
import { CliError } from "../errors.js";
import { ensureDir, fileExists, movePath, removeDir } from "../utils/fs.js";
import type { ProgressReporter } from "../ui/progress.js";
import type { RuntimeBundle } from "./manifest.js";
import { getRuntimeInstallDir } from "./versioning.js";

function archiveExtension(bundle: RuntimeBundle): "tar.gz" | "zip" {
  if (bundle.archiveType) {
    return bundle.archiveType;
  }
  if (bundle.archiveUrl.endsWith(".zip")) {
    return "zip";
  }
  return "tar.gz";
}

function downloadPath(bundle: RuntimeBundle): string {
  return path.join(getRuntimeDownloadsPath(), `${bundle.platform}-${bundle.version}.${archiveExtension(bundle) === "zip" ? "zip" : "tar.gz"}`);
}

async function downloadToFile(url: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  if (url.startsWith("file://")) {
    await fsp.copyFile(new URL(url), destination);
    return;
  }
  if (!/^https?:\/\//.test(url)) {
    await fsp.copyFile(path.resolve(url), destination);
    return;
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Failed to download runtime archive: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const raw = await fsp.readFile(filePath);
  hash.update(raw);
  return hash.digest("hex");
}

async function verifyChecksum(filePath: string, expectedSha256: string): Promise<void> {
  const actual = await sha256(filePath);
  if (actual !== expectedSha256) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Runtime archive checksum mismatch for ${path.basename(filePath)}.`, {
      expectedSha256,
      actualSha256: actual
    });
  }
}

async function extractArchive(bundle: RuntimeBundle, archivePath: string, destination: string): Promise<void> {
  await removeDir(destination);
  await ensureDir(destination);
  if (archiveExtension(bundle) === "zip") {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destination, true);
    return;
  }
  await tar.x({
    cwd: destination,
    file: archivePath
  });
}

async function normalizedExtractionRoot(destination: string): Promise<string> {
  const entries = await fsp.readdir(destination, { withFileTypes: true });
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(destination, entries[0].name);
  }
  return destination;
}

export async function installRuntimeBundle(bundle: RuntimeBundle, reporter?: ProgressReporter): Promise<{ installDir: string; changed: boolean }> {
  const targetDir = getRuntimeInstallDir(bundle);
  if (await fileExists(path.join(targetDir, "runtime.json"))) {
    return { installDir: targetDir, changed: false };
  }

  await ensureDir(getRuntimeDownloadsPath());
  await ensureDir(getRuntimeVersionsPath());
  const archivePath = downloadPath(bundle);
  const tempDir = `${targetDir}.tmp-${Date.now()}`;
  reporter?.step("Downloading managed runtime", `${bundle.platform} ${bundle.version}`);
  await downloadToFile(bundle.archiveUrl, archivePath);
  reporter?.step("Verifying managed runtime archive", bundle.version);
  await verifyChecksum(archivePath, bundle.sha256);
  reporter?.step("Unpacking managed runtime", bundle.version);
  await extractArchive(bundle, archivePath, tempDir);
  const extractedRoot = await normalizedExtractionRoot(tempDir);
  if (extractedRoot !== tempDir) {
    await removeDir(targetDir);
    await movePath(extractedRoot, targetDir);
    await removeDir(tempDir);
  } else {
    await removeDir(targetDir);
    await movePath(tempDir, targetDir);
  }
  return { installDir: targetDir, changed: true };
}

export async function repairInstalledRuntime(bundle: RuntimeBundle, reporter?: ProgressReporter): Promise<{ installDir: string; changed: boolean }> {
  const targetDir = getRuntimeInstallDir(bundle);
  await removeDir(targetDir);
  return installRuntimeBundle(bundle, reporter);
}
