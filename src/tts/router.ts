import { DEFAULT_PROVIDER } from "../constants.js";
import { CliError } from "../errors.js";
import { getProviderDefinition, providerCatalog, supportsLanguage } from "./metadata.js";
import type { RouteDecision, RoutingContext } from "./types.js";

export function selectTtsProvider(context: RoutingContext): RouteDecision {
  if (context.preferredProvider) {
    const provider = getProviderDefinition(context.preferredProvider);
    if (!provider) {
      throw new CliError("TTS_PROVIDER_UNAVAILABLE", `Unknown TTS provider: ${context.preferredProvider}`);
    }
    if (!supportsLanguage(provider.id, context.language)) {
      throw new CliError("TTS_LANGUAGE_UNSUPPORTED", `Provider ${provider.id} does not support ${context.language}`, {
        provider: provider.id,
        language: context.language
      });
    }
    if (context.cloningEnabled && !provider.supportsCloning) {
      throw new CliError("VOICE_CLONING_DISABLED", `Provider ${provider.id} does not support voice cloning.`);
    }
    return { provider: provider.id, reason: "explicit provider override" };
  }

  if (context.cloningEnabled) {
    const customVoiceProviders = providerCatalog.filter(
      (provider) =>
        provider.mode === "custom-voice" &&
        supportsLanguage(provider.id, context.language) &&
        (!provider.minGpuMemoryGb || (context.hardware.gpuMemoryGb ?? 0) >= provider.minGpuMemoryGb)
    );
    if (customVoiceProviders.length > 0) {
      const best = customVoiceProviders.sort((a, b) => (b.minGpuMemoryGb ?? 0) - (a.minGpuMemoryGb ?? 0))[0];
      return { provider: best.id, reason: "voice cloning requested" };
    }
  }

  if (context.language === "en-US" || context.language === "en-GB") {
    return { provider: DEFAULT_PROVIDER, reason: "default local narration path" };
  }

  const multilingualLocal = providerCatalog.find(
    (provider) =>
      provider.type === "local" &&
      provider.mode === "standard" &&
      provider.id.startsWith("qwen3-tts") &&
      supportsLanguage(provider.id, context.language) &&
      (!provider.minGpuMemoryGb || (context.hardware.gpuMemoryGb ?? 0) >= provider.minGpuMemoryGb)
  );
  if (multilingualLocal) {
    return { provider: multilingualLocal.id, reason: "multilingual local routing" };
  }

  if (context.allowCloudTts) {
    return { provider: "openai", reason: "cloud fallback" };
  }

  throw new CliError("TTS_LANGUAGE_UNSUPPORTED", `No available TTS provider supports ${context.language}`, {
    language: context.language
  });
}
