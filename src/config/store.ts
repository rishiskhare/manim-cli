import fs from "node:fs/promises";
import { ensureDir, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { getConfigPath } from "./paths.js";

export type AppConfig = {
  allowCloudTts: boolean;
  defaultProvider: string;
  defaultLanguage: string;
  defaultSubtitleMode: "none" | "srt" | "burned";
  voiceCloningEnabled: boolean;
};

const DEFAULT_CONFIG: AppConfig = {
  allowCloudTts: false,
  defaultProvider: "kokoro-82m",
  defaultLanguage: "en-US",
  defaultSubtitleMode: "none",
  voiceCloningEnabled: false
};

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  try {
    return { ...DEFAULT_CONFIG, ...(await readJsonFile<Partial<AppConfig>>(configPath)) };
  } catch {
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await writeJsonFile(getConfigPath(), config);
}

export async function setConfigValue(key: keyof AppConfig, value: unknown): Promise<AppConfig> {
  const current = await loadConfig();
  const updated = { ...current, [key]: value };
  await saveConfig(updated);
  return updated;
}

export async function getConfigValue(key: keyof AppConfig): Promise<unknown> {
  const current = await loadConfig();
  return current[key];
}

export async function resetConfig(): Promise<void> {
  const configPath = getConfigPath();
  await ensureDir(configPath);
  await fs.rm(configPath, { force: true });
}
