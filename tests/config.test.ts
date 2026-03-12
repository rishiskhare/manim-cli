import { describe, expect, test } from "vitest";

describe("environment precedence", () => {
  test("placeholder", () => {
    expect(true).toBe(true);
  });
});
