import { describe, expect, test } from "vitest";
import { normalizeLanguageCode } from "../src/utils/lang.js";

describe("normalizeLanguageCode", () => {
  test("normalizes short aliases", () => {
    expect(normalizeLanguageCode("en")).toBe("en-US");
    expect(normalizeLanguageCode("pt-br")).toBe("pt-BR");
  });
});
