import { describe, expect, test } from "vitest";
import { selectTtsProvider } from "../src/tts/router.js";

describe("selectTtsProvider", () => {
  test("defaults to kokoro for english", () => {
    const decision = selectTtsProvider({
      language: "en-US",
      allowCloudTts: false,
      cloningEnabled: false,
      hardware: { gpuAvailable: false, cpuOnly: true }
    });
    expect(decision.provider).toBe("kokoro-82m");
  });

  test("uses qwen multilingual for supported non-english languages", () => {
    const decision = selectTtsProvider({
      language: "fr-FR",
      allowCloudTts: false,
      cloningEnabled: false,
      hardware: { gpuAvailable: true, gpuMemoryGb: 16, cpuOnly: false }
    });
    expect(decision.provider).toBe("qwen3-tts-12hz-0.6b-base");
  });

  test("uses openai as cloud fallback", () => {
    const decision = selectTtsProvider({
      language: "ar-SA",
      allowCloudTts: true,
      cloningEnabled: false,
      hardware: { gpuAvailable: false, cpuOnly: true }
    });
    expect(decision.provider).toBe("openai");
  });

  test("uses custom voice provider when cloning is enabled", () => {
    const decision = selectTtsProvider({
      language: "en-US",
      allowCloudTts: false,
      cloningEnabled: true,
      hardware: { gpuAvailable: true, gpuMemoryGb: 16, cpuOnly: false }
    });
    expect(decision.provider).toBe("qwen3-tts-12hz-1.7b-customvoice");
  });
});
