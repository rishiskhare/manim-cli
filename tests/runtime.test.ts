import crypto from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { promisify } from "node:util";
import { beforeEach, describe, expect, test, vi } from "vitest";
const execFile = promisify(execFileCb);

async function runtimeManifestModule() {
  return import("../src/runtime/manifest.js");
}

async function runtimePythonModule() {
  return import("../src/runtime/python.js");
}

async function runtimeDoctorModule() {
  return import("../src/runtime/doctor.js");
}

async function runtimeLocatorModule() {
  return import("../src/runtime/locator.js");
}

async function runtimeProbeModule() {
  return import("../src/runtime/probe.js");
}

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await fs.writeFile(filePath, body, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function createFakeRuntimeFixture(root: string, platform: string, features = { cairo: true, opengl: true }): Promise<string> {
  const bundleRoot = path.join(root, "bundle");
  const binDir = path.join(bundleRoot, "bin");
  await fs.mkdir(binDir, { recursive: true });

  const shell = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "$0 version"
  exit 0
fi
if [ "$1" = "-version" ]; then
  echo "$0 version"
  exit 0
fi
if [ "$1" = "-filters" ]; then
  echo "subtitles drawtext"
  exit 0
fi
if [ "$1" = "-c" ]; then
  exit 0
fi
exit 0
`;

  await writeExecutable(path.join(binDir, "python"), shell);
  await writeExecutable(path.join(binDir, "pip"), shell);
  await writeExecutable(path.join(binDir, "manim"), shell.replace("$0 version", "Manim Community v9.9.9"));
  await writeExecutable(path.join(binDir, "ffmpeg"), shell);
  await writeExecutable(path.join(binDir, "ffprobe"), shell);

  await fs.writeFile(path.join(bundleRoot, "runtime.json"), JSON.stringify({
    version: "9.9.9",
    platform,
    binaries: {
      python: "bin/python",
      pip: "bin/pip",
      manim: "bin/manim",
      ffmpeg: "bin/ffmpeg",
      ffprobe: "bin/ffprobe"
    },
    features
  }, null, 2));

  const archivePath = path.join(root, "runtime.tar.gz");
  await tar.create({ gzip: true, cwd: root, file: archivePath }, ["bundle"]);
  const archiveSha = crypto.createHash("sha256").update(await fs.readFile(archivePath)).digest("hex");
  const manifestPath = path.join(root, "runtime-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify({
    channel: "stable",
    generatedAt: new Date().toISOString(),
    bundles: [
      {
        version: "9.9.9",
        platform,
        archiveUrl: `file://${archivePath}`,
        sha256: archiveSha,
        minimumCliVersion: "0.1.0",
        archiveType: "tar.gz"
      }
    ]
  }, null, 2));

  return manifestPath;
}

describe("managed runtime bundles", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("resolves, installs, and probes a fake runtime bundle", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-runtime-"));
    process.env.XDG_CACHE_HOME = path.join(cwd, ".cache");
    process.env.XDG_CONFIG_HOME = path.join(cwd, ".config");
    process.env.XDG_DATA_HOME = path.join(cwd, ".data");
    const { getCurrentPlatform, resolveRuntimeBundle } = await runtimeManifestModule();
    process.env.MANIM_CLI_RUNTIME_MANIFEST = await createFakeRuntimeFixture(cwd, getCurrentPlatform());

    const bundle = await resolveRuntimeBundle("0.1.0");
    expect(bundle.version).toBe("9.9.9");

    const { bootstrapRuntime, runtimeBootstrapped } = await runtimePythonModule();
    await bootstrapRuntime();
    expect(await runtimeBootstrapped()).toBe(true);

    const { getManagedPythonBin, getManagedFfmpegBin } = await runtimeLocatorModule();
    expect(await getManagedPythonBin()).toContain("python");
    expect(await getManagedFfmpegBin()).toContain("ffmpeg");

    const { collectDoctorReport } = await runtimeDoctorModule();
    const report = await collectDoctorReport();
    expect(report.runtimeInstalled).toBe(true);
    expect(report.manim).toBe(true);
    expect(report.ffmpeg).toBe(true);
  });

  test("repairs an installed runtime", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-runtime-"));
    process.env.XDG_CACHE_HOME = path.join(cwd, ".cache");
    process.env.XDG_CONFIG_HOME = path.join(cwd, ".config");
    process.env.XDG_DATA_HOME = path.join(cwd, ".data");
    const { getCurrentPlatform } = await runtimeManifestModule();
    process.env.MANIM_CLI_RUNTIME_MANIFEST = await createFakeRuntimeFixture(cwd, getCurrentPlatform());

    const { bootstrapRuntime, repairRuntime } = await runtimePythonModule();
    await bootstrapRuntime();

    const { getManagedPythonBin } = await runtimeLocatorModule();
    await fs.rm(await getManagedPythonBin(), { force: true });
    await repairRuntime();

    const { collectDoctorReport } = await runtimeDoctorModule();
    const report = await collectDoctorReport();
    expect(report.python).toBe(true);
    expect(report.runtimeInstalled).toBe(true);
  });

  test("runtime upgrade is a no-op when already current", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-runtime-"));
    process.env.XDG_CACHE_HOME = path.join(cwd, ".cache");
    process.env.XDG_CONFIG_HOME = path.join(cwd, ".config");
    process.env.XDG_DATA_HOME = path.join(cwd, ".data");
    const { getCurrentPlatform } = await runtimeManifestModule();
    process.env.MANIM_CLI_RUNTIME_MANIFEST = await createFakeRuntimeFixture(cwd, getCurrentPlatform());

    const { ensureManagedRuntime } = await runtimePythonModule();
    const first = await ensureManagedRuntime();
    const second = await ensureManagedRuntime();
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.version).toBe("9.9.9");
  });

  test("marks OpenGL unavailable when runtime metadata disables it", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-runtime-"));
    process.env.XDG_CACHE_HOME = path.join(cwd, ".cache");
    process.env.XDG_CONFIG_HOME = path.join(cwd, ".config");
    process.env.XDG_DATA_HOME = path.join(cwd, ".data");
    const { getCurrentPlatform } = await runtimeManifestModule();
    process.env.MANIM_CLI_RUNTIME_MANIFEST = await createFakeRuntimeFixture(cwd, getCurrentPlatform(), {
      cairo: true,
      opengl: false
    });

    const { bootstrapRuntime } = await runtimePythonModule();
    await bootstrapRuntime();

    const { probeManagedRuntime } = await runtimeProbeModule();
    const probe = await probeManagedRuntime();
    expect(probe.renderers.opengl).toBe("unavailable");
  });

  test("rejects invalid published bundle metadata", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-runtime-"));
    process.env.XDG_CACHE_HOME = path.join(cwd, ".cache");
    process.env.XDG_CONFIG_HOME = path.join(cwd, ".config");
    process.env.XDG_DATA_HOME = path.join(cwd, ".data");
    const { getCurrentPlatform, resolveRuntimeBundle } = await runtimeManifestModule();
    const manifestPath = path.join(cwd, "runtime-manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify({
      channel: "stable",
      generatedAt: new Date().toISOString(),
      bundles: [
        {
          version: "9.9.9",
          platform: getCurrentPlatform(),
          archiveUrl: "https://downloads.example.com/runtime.tar.gz",
          sha256: "not-a-real-checksum",
          minimumCliVersion: "0.1.0",
          archiveType: "tar.gz"
        }
      ]
    }, null, 2));
    process.env.MANIM_CLI_RUNTIME_MANIFEST = manifestPath;

    await expect(resolveRuntimeBundle("0.1.0")).rejects.toThrow(/checksum is invalid/);
  });

  test("rejects empty manifests", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-runtime-"));
    process.env.XDG_CACHE_HOME = path.join(cwd, ".cache");
    process.env.XDG_CONFIG_HOME = path.join(cwd, ".config");
    process.env.XDG_DATA_HOME = path.join(cwd, ".data");
    const manifestPath = path.join(cwd, "runtime-manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify({
      channel: "stable",
      generatedAt: new Date().toISOString(),
      bundles: []
    }, null, 2));
    process.env.MANIM_CLI_RUNTIME_MANIFEST = manifestPath;
    const { resolveRuntimeBundle } = await runtimeManifestModule();
    await expect(resolveRuntimeBundle("0.1.0")).rejects.toThrow(/contains no bundles/);
  });

  test("generates GitHub-style release manifest and validates duplicate platforms", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-runtime-"));
    const distDir = path.join(cwd, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "darwin-arm64-1.2.3.tar.gz"), "one");
    await fs.writeFile(path.join(distDir, "linux-x64-1.2.3.tar.gz"), "two");
    const manifestPath = path.join(cwd, "runtime-manifest.json");

    await execFile("node", [
      "scripts/generate-runtime-manifest.mjs",
      "--bundles-dir",
      distDir,
      "--github-repo",
      "example/manim-cli",
      "--release-tag",
      "runtime-v1.2.3",
      "--version",
      "1.2.3",
      "--minimum-cli-version",
      "0.1.0",
      "--out",
      manifestPath
    ], { cwd: path.resolve(".") });

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.bundles).toHaveLength(2);
    expect(manifest.bundles[0].archiveUrl).toContain("https://github.com/example/manim-cli/releases/download/runtime-v1.2.3/");

    await execFile("node", ["scripts/validate-runtime-assets.mjs", manifestPath], { cwd: path.resolve(".") });

    const duplicateManifestPath = path.join(cwd, "duplicate-runtime-manifest.json");
    await fs.writeFile(duplicateManifestPath, JSON.stringify({
      channel: "stable",
      generatedAt: new Date().toISOString(),
      bundles: [
        manifest.bundles[0],
        { ...manifest.bundles[0], archiveUrl: `${manifest.bundles[0].archiveUrl}?duplicate=1` }
      ]
    }, null, 2));

    await expect(execFile("node", ["scripts/validate-runtime-assets.mjs", duplicateManifestPath], { cwd: path.resolve(".") }))
      .rejects.toThrow(/duplicate platform entry/);
  });
});
