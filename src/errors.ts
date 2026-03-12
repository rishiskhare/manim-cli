export type ErrorCode =
  | "ENV_PYTHON_MISSING"
  | "ENV_FFMPEG_MISSING"
  | "RUNTIME_BOOTSTRAP_FAILED"
  | "MANIM_RENDER_FAILED"
  | "RENDERER_UNAVAILABLE"
  | "SCHEMA_INVALID"
  | "SCENE_MAPPING_MISSING"
  | "PROPOSAL_APPROVAL_REQUIRED"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_SECTION_MISMATCH"
  | "PROPOSAL_VERSION_CONFLICT"
  | "PROPOSAL_REJECTED"
  | "PYTHON_IMPORT_FAILED"
  | "KOKORO_MODEL_DOWNLOAD_FAILED"
  | "TTS_SYNTH_FAILED"
  | "TTS_LANGUAGE_UNSUPPORTED"
  | "TTS_PROVIDER_UNAVAILABLE"
  | "AUDIO_VIDEO_DURATION_MISMATCH"
  | "COMPOSE_FAILED"
  | "VOICE_CLONING_DISABLED"
  | "VOICE_PROFILE_INVALID"
  | "OPENAI_KEY_MISSING";

export class CliError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CliError";
  }
}
