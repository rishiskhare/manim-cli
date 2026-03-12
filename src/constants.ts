import os from "node:os";
import path from "node:path";

export const APP_NAME = "manim-cli";
export const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, APP_NAME)
  : path.join(os.homedir(), ".config", APP_NAME);
export const CACHE_DIR = process.env.XDG_CACHE_HOME
  ? path.join(process.env.XDG_CACHE_HOME, APP_NAME)
  : path.join(os.homedir(), ".cache", APP_NAME);
export const DATA_DIR = process.env.XDG_DATA_HOME
  ? path.join(process.env.XDG_DATA_HOME, APP_NAME)
  : path.join(os.homedir(), ".local", "share", APP_NAME);

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
export const DEFAULT_OPENAI_VOICE = "alloy";
export const DEFAULT_LANGUAGE = "en-US";
export const DEFAULT_PROVIDER = "kokoro-82m";
export const DEFAULT_SPEED = 1;
export const AUDIO_SAMPLE_RATE = 24000;
export const STAGE_ORDER = ["validate", "render", "tts", "compose"] as const;
export const PYTHON_MIN_VERSION = "3.10";
export const PYTHON_BRIDGE_TIMEOUT_MS = 20 * 60 * 1000;
export const RUNTIME_MANIFEST_FILENAME = "runtime-manifest.json";
export const RUNTIME_DEFAULT_CHANNEL = "stable";
