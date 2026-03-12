import fs from "node:fs/promises";
import path from "node:path";
import { getSecret } from "../config/secret.js";
import { DEFAULT_SPEED } from "../constants.js";
import { CliError } from "../errors.js";
import { getModelCachePath } from "../config/paths.js";
import { ensureProviderInstalled, runPythonBridge } from "../runtime/python.js";
import { getVoiceProfile } from "../tts/voiceRegistry.js";
import { normalizeLanguageCode } from "../utils/lang.js";
import { selectTtsProvider } from "../tts/router.js";
import type { RenderOptions } from "../manim/options.js";
import { loadNarration, loadStoryboard, saveManifest, loadManifest } from "../workspace/runs.js";
import type { ProgressReporter } from "../ui/progress.js";

export async function synthesizeRun(
  runId: string,
  options: RenderOptions,
  cwd = process.cwd(),
  reporter?: ProgressReporter
): Promise<string[]> {
  const runPath = path.join(cwd, ".manim-cli", "runs", runId);
  const storyboard = await loadStoryboard(runId, cwd);
  const narration = await loadNarration(runId, cwd);
  const manifest = await loadManifest(runId, cwd);
  const openaiApiKey = await getSecret("openai_api_key");
  const outputs: string[] = [];
  const voiceProfile = options.voiceProfile ? await getVoiceProfile(options.voiceProfile) : undefined;
  if (options.voiceProfile && !voiceProfile) {
    throw new CliError("VOICE_PROFILE_INVALID", `Unknown voice profile: ${options.voiceProfile}`);
  }
  if (voiceProfile && !options.enableVoiceCloning) {
    throw new CliError("VOICE_CLONING_DISABLED", "Voice profiles require --enable-voice-cloning.");
  }

  for (const [index, scene] of storyboard.scenes.entries()) {
    reporter?.scene(index + 1, storyboard.scenes.length, scene.id);
    const sceneConfig = narration.scenes.find((entry) => entry.id === scene.id);
    const language = normalizeLanguageCode(sceneConfig?.language ?? scene.language ?? options.lang ?? narration.language);
    const decision = selectTtsProvider({
      language,
      allowCloudTts: Boolean(options.allowCloudTts),
      cloningEnabled: Boolean(options.enableVoiceCloning),
      preferredProvider: options.ttsProvider ?? sceneConfig?.provider ?? narration.provider,
      hardware: {
        gpuAvailable: false,
        cpuOnly: true
      }
    });
    reporter?.provider(scene.id, decision.provider, language);
    await ensureProviderInstalled(decision.provider, reporter);
    const outputPath = path.join(runPath, "artifacts", `${scene.id}.wav`);
    const bridgePayload = {
      provider: decision.provider,
      text: scene.narrationText,
      language,
      voice: options.voice ?? sceneConfig?.voice ?? narration.voice,
      voiceProfile: voiceProfile?.name,
      speed: options.speed ?? narration.speed ?? DEFAULT_SPEED,
      outputPath,
      referenceAudio: options.referenceAudio ?? voiceProfile?.samples ?? [],
      cloningEnabled: Boolean(options.enableVoiceCloning),
      instructions: undefined,
      openaiApiKey,
      modelCacheDir: getModelCachePath()
    };
    if (decision.provider === "openai" && !openaiApiKey) {
      throw new CliError("OPENAI_KEY_MISSING", "OpenAI fallback selected but no API key is configured.");
    }
    reporter?.step("Synthesizing narration", scene.id);
    await runPythonBridge(["synth", "--payload", JSON.stringify(bridgePayload)], true);
    outputs.push(outputPath);
    manifest.routingDecisions.push({
      sceneId: scene.id,
      language,
      provider: decision.provider,
      reason: decision.reason
    });
  }
  await saveManifest(runId, manifest, cwd);
  return outputs;
}
