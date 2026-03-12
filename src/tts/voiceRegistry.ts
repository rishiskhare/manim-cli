import fs from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.js";
import { ensureDir, fileExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { getVoiceRegistryPath } from "../config/paths.js";

export type VoiceProfile = {
  name: string;
  language: string;
  samples: string[];
  consentFile: string;
  importedAt: string;
};

type VoiceRegistry = {
  voices: VoiceProfile[];
};

async function loadRegistry(): Promise<VoiceRegistry> {
  const registryPath = getVoiceRegistryPath();
  if (!(await fileExists(registryPath))) {
    return { voices: [] };
  }
  return readJsonFile<VoiceRegistry>(registryPath);
}

async function saveRegistry(registry: VoiceRegistry): Promise<void> {
  await ensureDir(path.dirname(getVoiceRegistryPath()));
  await writeJsonFile(getVoiceRegistryPath(), registry);
}

export async function importVoiceProfile(profile: VoiceProfile): Promise<void> {
  if (!(await fileExists(profile.consentFile))) {
    throw new CliError("VOICE_PROFILE_INVALID", `Consent file not found: ${profile.consentFile}`);
  }
  if (profile.samples.length === 0) {
    throw new CliError("VOICE_PROFILE_INVALID", "At least one sample is required.");
  }
  for (const sample of profile.samples) {
    if (!(await fileExists(sample))) {
      throw new CliError("VOICE_PROFILE_INVALID", `Sample file not found: ${sample}`);
    }
  }

  const registry = await loadRegistry();
  registry.voices = registry.voices.filter((voice) => voice.name !== profile.name);
  registry.voices.push(profile);
  await saveRegistry(registry);
}

export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  const registry = await loadRegistry();
  return registry.voices;
}

export async function getVoiceProfile(name: string): Promise<VoiceProfile | undefined> {
  const registry = await loadRegistry();
  return registry.voices.find((voice) => voice.name === name);
}

export async function removeVoiceProfile(name: string): Promise<void> {
  const registry = await loadRegistry();
  registry.voices = registry.voices.filter((voice) => voice.name !== name);
  await saveRegistry(registry);
}
