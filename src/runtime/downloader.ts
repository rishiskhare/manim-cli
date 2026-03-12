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
import { execFile } from "../utils/process.js";
import { readJsonFile } from "../utils/fs.js";
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

async function runCondaUnpackIfPresent(installDir: string, reporter?: ProgressReporter): Promise<void> {
  const candidates = process.platform === "win32"
    ? [
      path.join(installDir, "Scripts", "conda-unpack.exe"),
      path.join(installDir, "Scripts", "conda-unpack-script.py"),
      path.join(installDir, "Scripts", "conda-unpack")
    ]
    : [path.join(installDir, "bin", "conda-unpack")];

  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      continue;
    }
    reporter?.step("Relocating managed runtime", path.basename(candidate));
    const args = candidate.endsWith(".py") ? [candidate] : [];
    const command = candidate.endsWith(".py")
      ? path.join(installDir, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")
      : candidate;
    const result = await execFile(command, args, { allowFailure: true, cwd: installDir });
    if (result.code !== 0) {
      throw new CliError("RUNTIME_BOOTSTRAP_FAILED", "conda-unpack failed for the managed runtime.", {
        installDir,
        stdout: result.stdout,
        stderr: result.stderr
      });
    }
    return;
  }
}

type RuntimeBootstrapRecipe = {
  kind: "bootstrap";
  platform: string;
  pythonVersion: string;
  manimVersion: string;
  condaPackages: string[];
  pipPackages: string[];
  requirementsFiles: string[];
};

function runtimeManagerRoot(): string {
  return path.join(getRuntimeVersionsPath(), "..", "manager");
}

function runtimeManagerPackagesPath(): string {
  return path.join(runtimeManagerRoot(), "pkgs");
}

async function resolveEnvironmentManager(bundleRoot: string): Promise<string> {
  const bundledCandidates = process.platform === "win32"
    ? [path.join(bundleRoot, "tools", "micromamba.exe")]
    : [path.join(bundleRoot, "tools", "micromamba")];

  for (const candidate of bundledCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const commandNames = process.platform === "win32"
    ? ["micromamba.exe", "mamba.exe", "conda.exe", "micromamba", "mamba", "conda"]
    : ["micromamba", "mamba", "conda"];

  for (const entry of pathEntries) {
    for (const commandName of commandNames) {
      const candidate = path.join(entry, commandName);
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  }

  throw new CliError("RUNTIME_BOOTSTRAP_FAILED", "No supported environment manager was found. Runtime bootstrap bundles require bundled micromamba or a local micromamba/mamba/conda installation.");
}

function runtimeManagerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MAMBA_ROOT_PREFIX: runtimeManagerRoot(),
    CONDA_PKGS_DIRS: runtimeManagerPackagesPath()
  };
}

async function bootstrapRuntimeBundle(bundleRoot: string, targetDir: string, reporter?: ProgressReporter): Promise<void> {
  const recipePath = path.join(bundleRoot, "bootstrap.json");
  const recipe = await readJsonFile<RuntimeBootstrapRecipe>(recipePath);
  const envManager = await resolveEnvironmentManager(bundleRoot);
  const env = runtimeManagerEnv();
  await ensureDir(runtimeManagerRoot());
  await ensureDir(runtimeManagerPackagesPath());

  reporter?.step("Creating managed runtime", `${recipe.platform} ${recipe.manimVersion}`);
  await removeDir(targetDir);
  await ensureDir(path.dirname(targetDir));
  await execFile(envManager, ["create", "-y", "-p", targetDir, "-c", "conda-forge", ...recipe.condaPackages], {
    env,
    stdout: "inherit",
    stderr: "inherit"
  });

  const pipArgs = ["run", "-p", targetDir, "python", "-m", "pip", "install", ...recipe.pipPackages];
  for (const requirement of recipe.requirementsFiles) {
    pipArgs.push("-r", path.join(bundleRoot, requirement));
  }

  reporter?.step("Installing Python runtime packages", recipe.manimVersion);
  await execFile(envManager, pipArgs, {
    env,
    stdout: "inherit",
    stderr: "inherit"
  });

  await fsp.copyFile(path.join(bundleRoot, "runtime.json"), path.join(targetDir, "runtime.json"));
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
  if (bundle.installStrategy === "bootstrap" || await fileExists(path.join(extractedRoot, "bootstrap.json"))) {
    await bootstrapRuntimeBundle(extractedRoot, targetDir, reporter);
    await removeDir(tempDir);
  } else {
    if (extractedRoot !== tempDir) {
      await removeDir(targetDir);
      await movePath(extractedRoot, targetDir);
      await removeDir(tempDir);
    } else {
      await removeDir(targetDir);
      await movePath(tempDir, targetDir);
    }
    await runCondaUnpackIfPresent(targetDir, reporter);
  }
  return { installDir: targetDir, changed: true };
}

export async function repairInstalledRuntime(bundle: RuntimeBundle, reporter?: ProgressReporter): Promise<{ installDir: string; changed: boolean }> {
  const targetDir = getRuntimeInstallDir(bundle);
  await removeDir(targetDir);
  return installRuntimeBundle(bundle, reporter);
}
