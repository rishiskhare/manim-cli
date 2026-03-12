#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

const bundleRoot = path.resolve(arg("--bundle-root") ?? "");
const platform = arg("--platform");
const version = arg("--version");
const pythonVersion = arg("--python-version") ?? "3.11";
const manimVersion = arg("--manim-version") ?? "0.20.1";
const providers = (arg("--providers") ?? "kokoro-82m,openai,qwen3-tts-12hz-0.6b-base,qwen3-tts-12hz-1.7b-base,qwen3-tts-12hz-0.6b-customvoice,qwen3-tts-12hz-1.7b-customvoice,chatterbox-turbo")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const micromambaPath = arg("--micromamba-path");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!bundleRoot || !platform || !version) {
  process.stderr.write("Usage: node scripts/prepare-runtime-bundle.mjs --bundle-root <dir> --platform <platform> --version <version> [--python-version <version>] [--manim-version <version>] [--providers a,b] [--micromamba-path <path>]\n");
  process.exit(1);
}

const unixCondaPackages = [
  `python=${pythonVersion}`,
  "ffmpeg",
  "pip",
  "pkg-config",
  "cairo",
  "pango",
  "pycairo",
  "zlib"
];

const windowsCondaPackages = [
  `python=${pythonVersion}`,
  "ffmpeg",
  "pip",
  "pycairo",
  "zlib"
];

const condaPackages = platform.startsWith("win32-") ? windowsCondaPackages : unixCondaPackages;
const pipPackages = [
  "av",
  `manim==${manimVersion}`
];

const requirementsDir = path.join(bundleRoot, "requirements");
const toolsDir = path.join(bundleRoot, "tools");
await fs.rm(bundleRoot, { recursive: true, force: true });
await fs.mkdir(requirementsDir, { recursive: true });
await fs.mkdir(toolsDir, { recursive: true });

const bundledRequirementFiles = [
  "runtime-bridge.txt",
  "base.txt",
  "kokoro-82m.txt",
  "openai.txt",
  "chatterbox-turbo.txt",
  "qwen3-tts-12hz-0.6b-base.txt",
  "qwen3-tts-12hz-1.7b-base.txt",
  "qwen3-tts-12hz-0.6b-customvoice.txt",
  "qwen3-tts-12hz-1.7b-customvoice.txt"
];

for (const fileName of bundledRequirementFiles) {
  await fs.copyFile(
    path.join(repoRoot, "python", "requirements", fileName),
    path.join(requirementsDir, fileName)
  );
}

if (micromambaPath) {
  const targetName = platform.startsWith("win32-") ? "micromamba.exe" : "micromamba";
  await fs.copyFile(path.resolve(micromambaPath), path.join(toolsDir, targetName));
  if (!platform.startsWith("win32-")) {
    await fs.chmod(path.join(toolsDir, targetName), 0o755);
  }
}

const runtimeMetadata = {
  version,
  platform,
  binaries: {
    python: platform.startsWith("win32-") ? "Scripts/python.exe" : "bin/python",
    pip: platform.startsWith("win32-") ? "Scripts/pip.exe" : "bin/pip",
    manim: platform.startsWith("win32-") ? "Scripts/manim.exe" : "bin/manim",
    ffmpeg: platform.startsWith("win32-") ? "Library/bin/ffmpeg.exe" : "bin/ffmpeg",
    ffprobe: platform.startsWith("win32-") ? "Library/bin/ffprobe.exe" : "bin/ffprobe"
  },
  features: {
    cairo: true,
    opengl: !platform.startsWith("win32-"),
    latex: false,
    providers
  }
};

const bootstrapRecipe = {
  kind: "bootstrap",
  platform,
  pythonVersion,
  manimVersion,
  condaPackages,
  pipPackages,
  requirementsFiles: [path.posix.join("requirements", "runtime-bridge.txt")]
};

await fs.writeFile(path.join(bundleRoot, "runtime.json"), `${JSON.stringify(runtimeMetadata, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(bundleRoot, "bootstrap.json"), `${JSON.stringify(bootstrapRecipe, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  bundleRoot,
  platform,
  version,
  micromambaBundled: Boolean(micromambaPath)
}, null, 2)}\n`);
