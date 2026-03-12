import { describe, expect, test } from "vitest";
import { mapManimOptionsToArgs } from "../src/manim/options.js";

describe("mapManimOptionsToArgs", () => {
  test("maps preview, quality, and renderer", () => {
    expect(
      mapManimOptionsToArgs({
        preview: true,
        quality: "l",
        renderer: "opengl",
        tts: false
      })
    ).toEqual(["-p", "-q", "l", "--renderer", "opengl"]);
  });
});
