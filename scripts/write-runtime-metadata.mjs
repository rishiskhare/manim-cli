#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

const runtimeRoot = arg("--runtime-root");
const version = arg("--version");
const platform = arg("--platform");
const python = arg("--python") ?? "bin/python";
const pip = arg("--pip") ?? "bin/pip";
const manim = arg("--manim") ?? "bin/manim";
const ffmpeg = arg("--ffmpeg") ?? "bin/ffmpeg";
const ffprobe = arg("--ffprobe") ?? "bin/ffprobe";
const cairo = arg("--cairo") !== "false";
const opengl = arg("--opengl") !== "false";
const latex = arg("--latex") === "true";
const providers = (arg("--providers") ?? "").split(",").map((value) => value.trim()).filter(Boolean);

if (!runtimeRoot || !version || !platform) {
  process.stderr.write("Usage: node scripts/write-runtime-metadata.mjs --runtime-root <dir> --version <version> --platform <platform> [--python <rel>] [--pip <rel>] [--manim <rel>] [--ffmpeg <rel>] [--ffprobe <rel>] [--cairo true|false] [--opengl true|false] [--latex true|false] [--providers a,b]\n");
  process.exit(1);
}

const absoluteRoot = path.resolve(runtimeRoot);
const metadata = {
  version,
  platform,
  binaries: {
    python,
    pip,
    manim,
    ffmpeg,
    ffprobe
  },
  features: {
    cairo,
    opengl,
    latex,
    providers
  }
};

await fs.mkdir(absoluteRoot, { recursive: true });
await fs.writeFile(path.join(absoluteRoot, "runtime.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ runtimeRoot: absoluteRoot, metadata }, null, 2)}\n`);
