import { parseTheme, THEME_COOKIE } from "./theme";

describe("parseTheme", () => {
  it("defaults to light when undefined", () => {
    expect(parseTheme(undefined)).toBe("light");
  });
  it("returns dark when cookie is dark", () => {
    expect(parseTheme("dark")).toBe("dark");
  });
  it("falls back to light on garbage", () => {
    expect(parseTheme("purple")).toBe("light");
  });
  it("exposes the cookie name", () => {
    expect(THEME_COOKIE).toBe("theme");
  });
});
