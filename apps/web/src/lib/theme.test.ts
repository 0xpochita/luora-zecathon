import { describe, expect, it } from "vitest";
import { nextTheme, parseTheme } from "./theme";

describe("theme", () => {
  it("falls back to system for unknown stored values", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("cycles system, light, dark", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});
