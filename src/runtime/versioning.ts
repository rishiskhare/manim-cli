import path from "node:path";
import { getRuntimeInstallStatePath, getRuntimeVersionsPath } from "../config/paths.js";
import { fileExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import type { RuntimeBundle, RuntimePlatform } from "./manifest.js";

export type InstalledRuntimeState = {
  current?: {
    version: string;
    platform: RuntimePlatform;
    installDir: string;
    installedAt: string;
  };
  previous?: {
    version: string;
    platform: RuntimePlatform;
    installDir: string;
    installedAt: string;
  };
};

export type InstalledRuntimeRecord = NonNullable<InstalledRuntimeState["current"]>;

export async function loadInstalledRuntimeState(): Promise<InstalledRuntimeState> {
  const statePath = getRuntimeInstallStatePath();
  if (!(await fileExists(statePath))) {
    return {};
  }
  return readJsonFile<InstalledRuntimeState>(statePath);
}

export async function saveInstalledRuntimeState(state: InstalledRuntimeState): Promise<void> {
  await writeJsonFile(getRuntimeInstallStatePath(), state);
}

export function getRuntimeInstallDir(bundle: RuntimeBundle): string {
  return path.join(getRuntimeVersionsPath(), `${bundle.platform}-${bundle.version}`);
}

export function toRuntimeRecord(bundle: RuntimeBundle, installDir: string): InstalledRuntimeRecord {
  return {
    version: bundle.version,
    platform: bundle.platform,
    installDir,
    installedAt: new Date().toISOString()
  };
}
