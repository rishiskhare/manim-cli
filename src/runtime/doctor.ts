import { getSecret } from "../config/secret.js";
import { DEFAULT_PROVIDER } from "../constants.js";
import { providerCatalog } from "../tts/metadata.js";
import { runtimeBootstrapped } from "./python.js";
import { getCurrentPlatform } from "./manifest.js";
import { probeManagedRuntime, type RendererProbe } from "./probe.js";

export type ProviderHealth = {
  id: string;
  status: "available" | "degraded" | "unavailable";
  reason?: string;
};

export type DoctorReport = {
  node: string;
  platform: string;
  runtimeInstalled: boolean;
  runtimeVersion: string | null;
  ffmpeg: boolean;
  ffprobe: boolean;
  manim: boolean;
  python: boolean;
  openaiConfigured: boolean;
  defaultProvider: string;
  renderers: RendererProbe;
  providers: ProviderHealth[];
};

export async function collectDoctorReport(): Promise<DoctorReport> {
  const installed = await runtimeBootstrapped();
  const openaiConfigured = Boolean(await getSecret("openai_api_key"));
  const probe = installed
    ? await probeManagedRuntime()
    : {
        runtimeVersion: null,
        python: false,
        manim: false,
        ffmpeg: false,
        ffprobe: false,
        renderers: {
          cairo: "unavailable",
          opengl: "unavailable"
        } as RendererProbe
      };

  const providers: ProviderHealth[] = providerCatalog.map((provider) => {
    if (provider.type === "cloud") {
      return {
        id: provider.id,
        status: openaiConfigured ? "available" : "degraded",
        reason: openaiConfigured ? undefined : "OpenAI API key not configured"
      };
    }
    if (!installed) {
      return {
        id: provider.id,
        status: "degraded",
        reason: "Managed runtime not installed"
      };
    }
    return {
      id: provider.id,
      status: "available"
    };
  });

  return {
    node: process.version,
    platform: getCurrentPlatform(),
    runtimeInstalled: installed,
    runtimeVersion: probe.runtimeVersion,
    ffmpeg: probe.ffmpeg,
    ffprobe: probe.ffprobe,
    manim: probe.manim,
    python: probe.python,
    openaiConfigured,
    defaultProvider: DEFAULT_PROVIDER,
    renderers: probe.renderers,
    providers
  };
}
