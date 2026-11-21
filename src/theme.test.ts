import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { peopleToBackup } from "./backup";
import { appearanceFromBackup } from "./backup";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  parseAppearance,
  readAppearance,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from "./theme";

function memory(): ThemeStorage & { dump(): string | null } {
  const box = new Map<string, string>();
  return {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => {
      box.set(key, value);
    },
    dump: () => box.get(THEME_STORAGE_KEY) ?? null,
  };
}

describe("appearance", () => {
  it("defaults to Clarity", () => {
    expect(DEFAULT_APPEARANCE).toBe("clarity");
    expect(parseAppearance(null)).toBe("clarity");
    expect(parseAppearance("")).toBe("clarity");
    expect(parseAppearance("nope")).toBe("clarity");
    expect(resolveTheme("clarity", true)).toBe("clarity");
    expect(readAppearance(memory())).toBe("clarity");
  });

  it("persists the choice", () => {
    const store = memory();
    expect(applyAppearance("cozy", false, store)).toBe("cozy");
    expect(readAppearance(store)).toBe("cozy");
    expect(store.dump()).toBe("cozy");
    applyAppearance("headline", false, store);
    expect(readAppearance(store)).toBe("headline");
  });

  it("uses Clarity in light mode and Neon Studio in dark mode", () => {
    expect(resolveTheme("system", false)).toBe("clarity");
    expect(resolveTheme("system", true)).toBe("neon");
    const store = memory();
    expect(applyAppearance("system", false, store)).toBe("clarity");
    expect(store.dump()).toBe("system");
    expect(applyAppearance("system", true, store)).toBe("neon");
    expect(readAppearance(store)).toBe("system");
  });

  it("round-trips the theme through a backup and ignores a file that has none", async () => {
    const backup = await peopleToBackup([], "lavender");
    expect(backup.appearance).toBe("lavender");
    expect(appearanceFromBackup(JSON.stringify(backup))).toBe("lavender");
    const without = { ...backup, appearance: undefined };
    expect(appearanceFromBackup(JSON.stringify(without))).toBeNull();
    expect(appearanceFromBackup(JSON.stringify({ ...backup, appearance: "nope" }))).toBe("clarity");
  });

  it("sets the theme in index.html before the app script", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const font = html.indexOf('id="theme-font"');
    const boot = html.indexOf(THEME_STORAGE_KEY);
    const app = html.indexOf("/src/main.tsx");
    expect(font).toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(font);
    expect(app).toBeGreaterThan(boot);
    expect(html).toContain('data-theme');
    expect(html).toContain("neon");
    expect(html).toContain("clarity");
  });
});
