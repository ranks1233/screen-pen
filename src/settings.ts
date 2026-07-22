import { LazyStore } from "@tauri-apps/plugin-store";

export type BrushPersistence = "default" | "rememberLast";

export const DEFAULT_PRESET_COLORS = [
  "#ff2d2d",
  "#ff8a00",
  "#ffd400",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
  "#111111",
];

export type Settings = {
  activateHotkey: string;
  colorHotkey: string;
  sizeScrollHotkey: string;
  toolbarX: number | null;
  toolbarY: number | null;
  color: string;
  brushSize: number;
  sizeScrollSensitivity: number;
  brushPersistence: BrushPersistence;
  presetColors: string[];
};

const DEFAULTS: Settings = {
  activateHotkey: "Ctrl+Alt+D",
  colorHotkey: "C",
  sizeScrollHotkey: "Shift",
  toolbarX: null,
  toolbarY: null,
  color: "#ff2d2d",
  brushSize: 4,
  sizeScrollSensitivity: 4,
  brushPersistence: "rememberLast",
  presetColors: [...DEFAULT_PRESET_COLORS],
};

const store = new LazyStore("settings.json");

/** Normalize to lowercase `#rrggbb`, or null if invalid. */
export function normalizeHex(color: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match) return null;
  return `#${match[1].toLowerCase()}`;
}

function normalizePresetColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) return [...DEFAULT_PRESET_COLORS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const color of colors) {
    if (typeof color !== "string") continue;
    const hex = normalizeHex(color);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
}

export async function loadSettings(): Promise<Settings> {
  const saved = (await store.get<Partial<Settings>>("settings")) ?? {};
  const settings = { ...DEFAULTS, ...saved };
  settings.sizeScrollSensitivity = Math.max(
    1,
    Math.min(10, Math.round(settings.sizeScrollSensitivity || DEFAULTS.sizeScrollSensitivity)),
  );
  settings.brushSize = Math.max(
    1,
    Math.min(80, Math.round(settings.brushSize || DEFAULTS.brushSize)),
  );
  if (
    settings.brushPersistence !== "default" &&
    settings.brushPersistence !== "rememberLast"
  ) {
    settings.brushPersistence = DEFAULTS.brushPersistence;
  }
  const color = normalizeHex(settings.color);
  settings.color = color ?? DEFAULTS.color;
  settings.presetColors = normalizePresetColors(
    saved.presetColors !== undefined ? saved.presetColors : DEFAULT_PRESET_COLORS,
  );
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await store.set("settings", settings);
  await store.save();
}

export function formatHotkeyFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");

  let key = e.key;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();
  if (key.startsWith("Arrow")) key = key.replace("Arrow", "");

  parts.push(key);
  return parts.join("+");
}

/** Modifier-only combo for size-change-with-scroll (e.g. "Shift", "Alt", "Ctrl+Shift"). */
export function formatModifierHotkeyFromEvent(e: KeyboardEvent): string | null {
  if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.key === "Control") parts.push("Ctrl");
  if (e.altKey || e.key === "Alt") parts.push("Alt");
  if (e.shiftKey || e.key === "Shift") parts.push("Shift");
  if (e.metaKey || e.key === "Meta") parts.push("Super");
  return parts.length ? parts.join("+") : null;
}

export function matchesSizeScrollHotkey(
  e: Pick<WheelEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  hotkey: string,
): boolean {
  const parts = new Set(
    hotkey
      .split("+")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
  if (parts.size === 0) return false;

  const wantCtrl = parts.has("ctrl");
  const wantAlt = parts.has("alt");
  const wantShift = parts.has("shift");
  const wantSuper = parts.has("super") || parts.has("meta");

  return (
    e.ctrlKey === wantCtrl &&
    e.altKey === wantAlt &&
    e.shiftKey === wantShift &&
    e.metaKey === wantSuper
  );
}
