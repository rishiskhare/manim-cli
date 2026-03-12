import path from "node:path";
import { CACHE_DIR, CONFIG_DIR, DATA_DIR } from "../constants.js";

export function getConfigPath(): string {
  return path.join(CONFIG_DIR, "config.json");
}

export function getSecretFallbackPath(): string {
  return path.join(CONFIG_DIR, "secrets.json");
}

export function getVoiceRegistryPath(): string {
  return path.join(DATA_DIR, "voices.json");
}

export function getRuntimePath(): string {
  return path.join(CACHE_DIR, "runtime");
}

export function getRuntimeVersionsPath(): string {
  return path.join(getRuntimePath(), "versions");
}

export function getRuntimeDownloadsPath(): string {
  return path.join(getRuntimePath(), "downloads");
}

export function getRuntimeInstallStatePath(): string {
  return path.join(getRuntimePath(), "install-state.json");
}

export function getModelCachePath(): string {
  return path.join(CACHE_DIR, "models");
}

export function getVenvPath(): string {
  return path.join(getRuntimePath(), "venv");
}
