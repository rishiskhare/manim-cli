export type RenderOptions = {
  preview: boolean;
  quality?: string;
  renderer?: "cairo" | "opengl";
  tts: boolean;
  ttsProvider?: string;
  voice?: string;
  voiceProfile?: string;
  lang?: string;
  speed?: number;
  subtitleMode?: "none" | "srt" | "burned";
  captions?: boolean;
  allowCloudTts?: boolean;
  enableVoiceCloning?: boolean;
  referenceAudio?: string[];
  json?: boolean;
};

export function mapManimOptionsToArgs(options: RenderOptions): string[] {
  const args: string[] = [];
  if (options.preview) {
    args.push("-p");
  }
  if (options.quality) {
    args.push("-q", options.quality);
  }
  if (options.renderer) {
    args.push("--renderer", options.renderer);
  }
  return args;
}
