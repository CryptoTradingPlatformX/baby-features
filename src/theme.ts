/** Visual skins. Tokens live in CSS under `[data-theme]`. */
export const THEME_STORAGE_KEY = "baby-features-appearance";

export const THEME_IDS = ["clarity", "neon", "cozy", "command", "headline", "lavender"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type Appearance = ThemeId | "system";

export const APPEARANCES: Appearance[] = [...THEME_IDS, "system"];

export const DEFAULT_APPEARANCE: Appearance = "clarity";

/** Browser chrome color for each resolved skin. */
export const THEME_COLOR: Record<ThemeId, string> = {
  clarity: "#ffffff",
  neon: "#0b0b12",
  cozy: "#fff8f1",
  command: "#f1f5f9",
  headline: "#f4f1ea",
  lavender: "#f5f1ff",
};

/** One stylesheet for the active skin. System stacks cover the first paint. */
export const THEME_FONT_STYLESHEET: Record<ThemeId, string> = {
  clarity:
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap",
  neon: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
  cozy: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito:wght@400;600;700;800&display=swap",
  command:
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
  headline:
    "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap",
  lavender: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
};

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseAppearance(value: string | null | undefined): Appearance {
  if (value === "system") return "system";
  if (value && (THEME_IDS as readonly string[]).includes(value)) return value as ThemeId;
  return DEFAULT_APPEARANCE;
}

/** Match system uses Clarity in light mode and Neon Studio in dark mode. */
export function resolveTheme(appearance: Appearance, prefersDark: boolean): ThemeId {
  if (appearance === "system") return prefersDark ? "neon" : "clarity";
  return appearance;
}

function memory(): ThemeStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readAppearance(storage: ThemeStorage | null = memory()): Appearance {
  try {
    return parseAppearance(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Save the choice and paint it. Pass `prefersDark` in tests; the page uses the system setting.
 */
export function applyAppearance(
  choice: Appearance,
  prefersDark: boolean = systemPrefersDark(),
  storage: ThemeStorage | null = memory(),
): ThemeId {
  const appearance = parseAppearance(choice);
  const theme = resolveTheme(appearance, prefersDark);
  try {
    storage?.setItem(THEME_STORAGE_KEY, appearance);
  } catch {
    /* private mode can reject storage; the attribute still updates */
  }
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.setAttribute("data-appearance", appearance);
    root.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
    const link = document.querySelector<HTMLLinkElement>("#theme-font");
    const href = THEME_FONT_STYLESHEET[theme];
    if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
    window.dispatchEvent(new CustomEvent("baby-features-appearance", { detail: appearance }));
  }
  return theme;
}
