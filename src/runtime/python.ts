import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import pkg from "../../package.json" with { type: "json" };
import { CACHE_DIR, PYTHON_BRIDGE_TIMEOUT_MS } from "../constants.js";
import { getModelCachePath, getRuntimePath } from "../config/paths.js";
import { CliError } from "../errors.js";
import { ensureDir, fileExists, removeDir } from "../utils/fs.js";
import { execFile } from "../utils/process.js";
import { getPackageRoot } from "../utils/packageRoot.js";
import type { ProgressReporter } from "../ui/progress.js";
import { installRuntimeBundle, repairInstalledRuntime } from "./downloader.js";
import { resolveRuntimeBundle, resolveRuntimeBundleByVersion } from "./manifest.js";
import { getManagedManimBin, getManagedPipBin, getManagedPythonBin, getInstalledRuntimeRoot, getManagedRuntimeEnv } from "./locator.js";
import { probeManagedRuntime, probeRuntimeAt } from "./probe.js";
import { loadInstalledRuntimeState, saveInstalledRuntimeState, toRuntimeRecord } from "./versioning.js";

export { getManagedManimBin, getManagedPipBin, getManagedPythonBin };

async function runtimeStatePath(scope: string, signature: string): Promise<string> {
  return path.join(getRuntimePath(), "state", `${scope}-${signature}.json`);
}

async function fileSignature(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, "utf8");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

async function markInstalled(scope: string, signature: string): Promise<void> {
  const markerPath = await runtimeStatePath(scope, signature);
  await ensureDir(path.dirname(markerPath));
  await fs.writeFile(markerPath, JSON.stringify({ installedAt: new Date().toISOString() }), "utf8");
}

async function isInstalled(scope: string, signature: string): Promise<boolean> {
  return fileExists(await runtimeStatePath(scope, signature));
}

async function runtimeEnv(runtimeRoot: string): Promise<NodeJS.ProcessEnv> {
  const modelCache = getModelCachePath();
  const baseEnv = await getManagedRuntimeEnv(runtimeRoot);
  return {
    ...baseEnv,
    MANIM_CLI_RUNTIME_ROOT: runtimeRoot,
    HF_HOME: modelCache,
    HUGGINGFACE_HUB_CACHE: path.join(modelCache, "hub"),
    TRANSFORMERS_CACHE: path.join(modelCache, "transformers")
  };
}

export async function runtimeBootstrapped(): Promise<boolean> {
  try {
    await getInstalledRuntimeRoot();
    return true;
  } catch {
    return false;
  }
}

async function validateRuntimeAt(installDir: string): Promise<void> {
  const scriptsDir = process.platform === "win32" ? "Scripts" : "bin";
  const pythonBin = path.join(installDir, scriptsDir, process.platform === "win32" ? "python.exe" : "python");
  const manimBin = path.join(installDir, scriptsDir, process.platform === "win32" ? "manim.exe" : "manim");
  const ffmpegBin = path.join(installDir, scriptsDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const ffprobeBin = path.join(installDir, scriptsDir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  const probe = await probeRuntimeAt({ pythonBin, manimBin, ffmpegBin, ffprobeBin });
  if (!probe.python || !probe.manim || !probe.ffmpeg || !probe.ffprobe) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", "Managed runtime smoke test failed.", { probe });
  }
}

async function ensureRuntimeBundleInstalled(version: string | undefined, reporter?: ProgressReporter): Promise<{
  installDir: string;
  changed: boolean;
  version: string;
}> {
  await ensureDir(getRuntimePath());
  await ensureDir(CACHE_DIR);
  await ensureDir(getModelCachePath());
  const bundle = version
    ? await resolveRuntimeBundleByVersion(version, pkg.version)
    : await resolveRuntimeBundle(pkg.version);
  const state = await loadInstalledRuntimeState();
  if (state.current?.version === bundle.version && state.current.platform === bundle.platform && (await fileExists(path.join(state.current.installDir, "runtime.json")))) {
    return { installDir: state.current.installDir, changed: false, version: bundle.version };
  }
  const result = await installRuntimeBundle(bundle, reporter);
  try {
    await validateRuntimeAt(result.installDir);
  } catch (error) {
    await removeDir(result.installDir);
    throw error;
  }
  await saveInstalledRuntimeState({
    previous: state.current,
    current: toRuntimeRecord(bundle, result.installDir)
  });
  return { installDir: result.installDir, changed: true, version: bundle.version };
}

export async function ensureManagedRuntime(reporter?: ProgressReporter): Promise<{ runtimeRoot: string; changed: boolean; version: string }> {
  const runtime = await ensureRuntimeBundleInstalled(undefined, reporter);
  return {
    runtimeRoot: runtime.installDir,
    changed: runtime.changed,
    version: runtime.version
  };
}

export async function bootstrapRuntime(reporter?: ProgressReporter): Promise<{ runtimeRoot: string; changed: boolean; version: string }> {
  const runtime = await ensureManagedRuntime(reporter);
  const probe = await probeManagedRuntime();
  if (!probe.python || !probe.manim || !probe.ffmpeg || !probe.ffprobe) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", "Managed runtime smoke test failed.", { probe });
  }
  reporter?.step("Managed runtime ready", runtime.runtimeRoot);
  return runtime;
}

export async function repairRuntime(reporter?: ProgressReporter): Promise<{ runtimeRoot: string; changed: boolean; version: string }> {
  const state = await loadInstalledRuntimeState();
  const bundle = state.current
    ? await resolveRuntimeBundleByVersion(state.current.version, pkg.version)
    : await resolveRuntimeBundle(pkg.version);
  const repaired = await repairInstalledRuntime(bundle, reporter);
  try {
    await validateRuntimeAt(repaired.installDir);
  } catch (error) {
    await removeDir(repaired.installDir);
    throw error;
  }
  await saveInstalledRuntimeState({
    previous: state.previous,
    current: toRuntimeRecord(bundle, repaired.installDir)
  });
  reporter?.step("Managed runtime ready", repaired.installDir);
  return { runtimeRoot: repaired.installDir, changed: true, version: bundle.version };
}

export async function ensureProviderInstalled(provider: string, reporter?: ProgressReporter): Promise<void> {
  const requirements = path.resolve(getPackageRoot(), "python", "requirements", `${provider}.txt`);
  if (!(await fileExists(requirements))) {
    return;
  }
  await bootstrapRuntime(reporter);
  const runtimeRoot = await getInstalledRuntimeRoot();
  const providerSignature = await fileSignature(requirements);
  if (await isInstalled(provider, providerSignature)) {
    return;
  }
  reporter?.step("Installing provider runtime", provider);
  await execFile(await getManagedPipBin(), ["install", "-r", requirements], {
    env: await runtimeEnv(runtimeRoot),
    stdout: "inherit",
    stderr: "inherit"
  });
  await markInstalled(provider, providerSignature);
}

export async function runPythonBridge(args: string[], inherit = false, timeoutMs = PYTHON_BRIDGE_TIMEOUT_MS): Promise<string> {
  await bootstrapRuntime();
  const runtimeRoot = await getInstalledRuntimeRoot();
  const bridge = path.resolve(getPackageRoot(), "python", "runtime_bridge.py");
  const result = await execFile(await getManagedPythonBin(), [bridge, ...args], {
    env: await runtimeEnv(runtimeRoot),
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    timeoutMs
  });
  return result.stdout.trim();
}
