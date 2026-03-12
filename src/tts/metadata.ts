import type { ProviderCapability } from "./types.js";

export type ProviderDefinition = {
  id: string;
  displayName: string;
  type: "local" | "cloud";
  mode: "standard" | "custom-voice";
  defaultVoice?: string;
  languages: string[];
  supportsCloning: boolean;
  minGpuMemoryGb?: number;
  pythonRequirement?: string;
  modelId?: string;
};

export const providerCatalog: ProviderDefinition[] = [
  {
    id: "kokoro-82m",
    displayName: "Kokoro-82M",
    type: "local",
    mode: "standard",
    defaultVoice: "af_heart",
    languages: ["en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "it-IT", "pt-BR", "ja-JP", "zh-CN"],
    supportsCloning: false,
    pythonRequirement: "kokoro"
  },
  {
    id: "chatterbox-turbo",
    displayName: "Chatterbox Turbo",
    type: "local",
    mode: "custom-voice",
    languages: ["en-US"],
    supportsCloning: true,
    minGpuMemoryGb: 6,
    pythonRequirement: "chatterbox"
  },
  {
    id: "qwen3-tts-12hz-0.6b-base",
    displayName: "Qwen3 TTS 0.6B Base",
    type: "local",
    mode: "standard",
    languages: ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR", "ru-RU", "pt-BR", "es-ES", "it-IT"],
    supportsCloning: true,
    minGpuMemoryGb: 8,
    pythonRequirement: "qwen_tts",
    modelId: "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
  },
  {
    id: "qwen3-tts-12hz-1.7b-base",
    displayName: "Qwen3 TTS 1.7B Base",
    type: "local",
    mode: "standard",
    languages: ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR", "ru-RU", "pt-BR", "es-ES", "it-IT"],
    supportsCloning: true,
    minGpuMemoryGb: 12,
    pythonRequirement: "qwen_tts",
    modelId: "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
  },
  {
    id: "qwen3-tts-12hz-0.6b-customvoice",
    displayName: "Qwen3 TTS 0.6B CustomVoice",
    type: "local",
    mode: "custom-voice",
    languages: ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR", "ru-RU", "pt-BR", "es-ES", "it-IT"],
    supportsCloning: true,
    minGpuMemoryGb: 8,
    pythonRequirement: "qwen_tts",
    modelId: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
  },
  {
    id: "qwen3-tts-12hz-1.7b-customvoice",
    displayName: "Qwen3 TTS 1.7B CustomVoice",
    type: "local",
    mode: "custom-voice",
    languages: ["zh-CN", "en-US", "ja-JP", "ko-KR", "de-DE", "fr-FR", "ru-RU", "pt-BR", "es-ES", "it-IT"],
    supportsCloning: true,
    minGpuMemoryGb: 12,
    pythonRequirement: "qwen_tts",
    modelId: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
  },
  {
    id: "openai",
    displayName: "OpenAI TTS",
    type: "cloud",
    mode: "standard",
    defaultVoice: "alloy",
    languages: ["*"],
    supportsCloning: false
  }
];

export function getProviderDefinition(providerId: string): ProviderDefinition | undefined {
  return providerCatalog.find((provider) => provider.id === providerId);
}

export function supportsLanguage(providerId: string, language: string): boolean {
  const provider = getProviderDefinition(providerId);
  if (!provider) {
    return false;
  }
  return provider.languages.includes("*") || provider.languages.includes(language);
}

export function capabilityFor(providerId: string): ProviderCapability {
  const provider = getProviderDefinition(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return {
    available: true,
    languages: provider.languages,
    supportsCloning: provider.supportsCloning,
    qualityTier: provider.id.includes("1.7b") ? "high" : provider.id === "kokoro-82m" ? "fast" : "balanced",
    runtime: provider.type === "cloud" ? "cloud" : "local"
  };
}
