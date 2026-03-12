import path from "node:path";
import { CliError } from "../errors.js";
import { fileExists, readJsonFile } from "../utils/fs.js";
import { loadInstalledRuntimeState } from "./versioning.js";

export type RuntimeMetadata = {
  version: string;
  platform: string;
  binaries: {
    python: string;
    pip: string;
    manim: string;
    ffmpeg: string;
    ffprobe: string;
  };
  features?: {
    cairo?: boolean;
    opengl?: boolean;
    latex?: boolean;
    providers?: string[];
  };
};

function metadataPath(installDir: string): string {
  return path.join(installDir, "runtime.json");
}

export async function getInstalledRuntimeRoot(): Promise<string> {
  const state = await loadInstalledRuntimeState();
  if (!state.current?.installDir || !(await fileExists(metadataPath(state.current.installDir)))) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", "Managed runtime is not installed.");
  }
  return state.current.installDir;
}

export async function loadRuntimeMetadata(installDir?: string): Promise<RuntimeMetadata> {
  const root = installDir ?? await getInstalledRuntimeRoot();
  const runtimeJson = metadataPath(root);
  if (!(await fileExists(runtimeJson))) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Runtime metadata is missing at ${runtimeJson}`);
  }
  return readJsonFile<RuntimeMetadata>(runtimeJson);
}

function withPrependedPath(current: string | undefined, entries: string[]): string {
  const unique = new Set(entries.filter(Boolean));
  if (current) {
    for (const part of current.split(path.delimiter)) {
      if (part) {
        unique.add(part);
      }
    }
  }
  return Array.from(unique).join(path.delimiter);
}

export async function getManagedRuntimeEnv(installDir?: string): Promise<NodeJS.ProcessEnv> {
  const root = installDir ?? await getInstalledRuntimeRoot();
  const metadata = await loadRuntimeMetadata(root);
  const binaryDirs = new Set<string>([
    path.dirname(path.join(root, metadata.binaries.python)),
    path.dirname(path.join(root, metadata.binaries.pip)),
    path.dirname(path.join(root, metadata.binaries.manim)),
    path.dirname(path.join(root, metadata.binaries.ffmpeg)),
    path.dirname(path.join(root, metadata.binaries.ffprobe))
  ]);
  const libDir = path.join(root, "lib");

  return {
    ...process.env,
    PATH: withPrependedPath(process.env.PATH, Array.from(binaryDirs)),
    CONDA_PREFIX: root,
    CONDA_DEFAULT_ENV: root,
    DYLD_FALLBACK_LIBRARY_PATH: withPrependedPath(process.env.DYLD_FALLBACK_LIBRARY_PATH, [libDir]),
    LD_LIBRARY_PATH: withPrependedPath(process.env.LD_LIBRARY_PATH, [libDir])
  };
}

export async function getManagedBinary(name: keyof RuntimeMetadata["binaries"]): Promise<string> {
  const root = await getInstalledRuntimeRoot();
  const metadata = await loadRuntimeMetadata(root);
  return path.join(root, metadata.binaries[name]);
}

export async function getManagedPythonBin(): Promise<string> {
  return getManagedBinary("python");
}

export async function getManagedPipBin(): Promise<string> {
  return getManagedBinary("pip");
}

export async function getManagedManimBin(): Promise<string> {
  return getManagedBinary("manim");
}

export async function getManagedFfmpegBin(): Promise<string> {
  return getManagedBinary("ffmpeg");
}

export async function getManagedFfprobeBin(): Promise<string> {
  return getManagedBinary("ffprobe");
}
