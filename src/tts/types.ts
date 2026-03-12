export type ProviderMode = "standard" | "custom-voice";

export type HardwareProfile = {
  gpuAvailable: boolean;
  gpuMemoryGb?: number;
  cpuOnly: boolean;
};

export type ProviderCapability = {
  available: boolean;
  languages: string[];
  supportsCloning: boolean;
  qualityTier: "fast" | "balanced" | "high";
  runtime: "local" | "cloud";
};

export type SynthesisRequest = {
  provider: string;
  text: string;
  language: string;
  voice?: string;
  voiceProfile?: string;
  speed: number;
  outputPath: string;
  referenceAudio?: string[];
  cloningEnabled: boolean;
  instructions?: string;
  openaiApiKey?: string | null;
  modelCacheDir: string;
};

export type RoutingContext = {
  language: string;
  allowCloudTts: boolean;
  cloningEnabled: boolean;
  hardware: HardwareProfile;
  preferredProvider?: string;
};

export type RouteDecision = {
  provider: string;
  reason: string;
};
