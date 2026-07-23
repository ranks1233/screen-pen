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
  colorHotkeyEnabled: boolean;
  shapeHotkey: string;
  shapeHotkeyEnabled: boolean;
  sizeScrollHotkey: string;
  toolbarX: number | null;
  toolbarY: number | null;
  settingsX: number | null;
  settingsY: number | null;
  /** Basic settings panel size (null height = fit content). */
  settingsWidth: number | null;
  settingsHeight: number | null;
  advancedSettingsX: number | null;
  advancedSettingsY: number | null;
  /** Advanced settings panel size (null height = fit content). */
  advancedSettingsWidth: number | null;
  advancedSettingsHeight: number | null;
  color: string;
  brushSize: number;
  sizeScrollSensitivity: number;
  /** Freehand/arrow auto-smooth strength on stroke release (0 = off). */
  smoothStrength: number;
  brushPersistence: BrushPersistence;
  presetColors: string[];
  showLineThicknessHandle: boolean;
  showLineOpacityHandle: boolean;
  showShapeThicknessHandle: boolean;
  showShapeOpacityHandle: boolean;
  applyThicknessToBrush: boolean;
  /** After finishing a rect/ellipse, switch tool back to freehand. */
  returnToFreehandAfterShape: boolean;
  /** Show the tip pivot handle on selected arrows. */
  showArrowTipPivot: boolean;
  /** Show moveable start/end nodes on straight lines and straight arrows. */
  showPathEndpointHandles: boolean;
  /** Selection node/handle size as percent of default (50–200). Spacing scales with it. */
  handleSizeScale: number;
  /** Global hotkey that disables the app (tray stays, drawing blocked). */
  disableHotkey: string;
};

const DEFAULTS: Settings = {
  activateHotkey: "Ctrl+Alt+D",
  colorHotkey: "C",
  colorHotkeyEnabled: true,
  shapeHotkey: "S",
  shapeHotkeyEnabled: true,
  sizeScrollHotkey: "Shift",
  toolbarX: null,
  toolbarY: null,
  settingsX: null,
  settingsY: null,
  settingsWidth: null,
  settingsHeight: null,
  advancedSettingsX: null,
  advancedSettingsY: null,
  advancedSettingsWidth: null,
  advancedSettingsHeight: null,
  color: "#ff2d2d",
  brushSize: 4,
  sizeScrollSensitivity: 4,
  smoothStrength: 5,
  brushPersistence: "rememberLast",
  presetColors: [...DEFAULT_PRESET_COLORS],
  showLineThicknessHandle: true,
  showLineOpacityHandle: true,
  showShapeThicknessHandle: true,
  showShapeOpacityHandle: true,
  applyThicknessToBrush: true,
  returnToFreehandAfterShape: true,
  showArrowTipPivot: true,
  showPathEndpointHandles: true,
  handleSizeScale: 100,
  disableHotkey: "Ctrl+Alt+Shift+D",
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

/** Clamp selection-handle size percent (50–200, step 25). */
export function clampHandleSizeScale(percent: number): number {
  const stepped = Math.round(percent / 25) * 25;
  return Math.max(50, Math.min(200, stepped));
}

export const SETTINGS_PANEL_MIN_WIDTH = 220;
export const SETTINGS_PANEL_MIN_HEIGHT = 160;
export const SETTINGS_PANEL_DEFAULT_WIDTH = 250;

function normalizePanelSize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function normalizePanelPosition(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

export async function loadSettings(): Promise<Settings> {
  const saved = (await store.get<Partial<Settings>>("settings")) ?? {};
  const settings = { ...DEFAULTS, ...saved };
  settings.sizeScrollSensitivity = Math.max(
    1,
    Math.min(10, Math.round(settings.sizeScrollSensitivity || DEFAULTS.sizeScrollSensitivity)),
  );
  settings.smoothStrength = Math.max(
    0,
    Math.min(
      10,
      Math.round(
        typeof settings.smoothStrength === "number"
          ? settings.smoothStrength
          : DEFAULTS.smoothStrength,
      ),
    ),
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
  const legacy = saved as Partial<Settings> & {
    showThicknessHandle?: boolean;
    showOpacityHandle?: boolean;
  };
  const legacyThickness =
    typeof legacy.showThicknessHandle === "boolean"
      ? legacy.showThicknessHandle
      : undefined;
  const legacyOpacity =
    typeof legacy.showOpacityHandle === "boolean"
      ? legacy.showOpacityHandle
      : undefined;
  settings.showLineThicknessHandle =
    typeof settings.showLineThicknessHandle === "boolean"
      ? settings.showLineThicknessHandle
      : (legacyThickness ?? DEFAULTS.showLineThicknessHandle);
  settings.showLineOpacityHandle =
    typeof settings.showLineOpacityHandle === "boolean"
      ? settings.showLineOpacityHandle
      : (legacyOpacity ?? DEFAULTS.showLineOpacityHandle);
  settings.showShapeThicknessHandle =
    typeof settings.showShapeThicknessHandle === "boolean"
      ? settings.showShapeThicknessHandle
      : (legacyThickness ?? DEFAULTS.showShapeThicknessHandle);
  settings.showShapeOpacityHandle =
    typeof settings.showShapeOpacityHandle === "boolean"
      ? settings.showShapeOpacityHandle
      : (legacyOpacity ?? DEFAULTS.showShapeOpacityHandle);
  settings.applyThicknessToBrush =
    typeof settings.applyThicknessToBrush === "boolean"
      ? settings.applyThicknessToBrush
      : DEFAULTS.applyThicknessToBrush;
  settings.returnToFreehandAfterShape =
    typeof settings.returnToFreehandAfterShape === "boolean"
      ? settings.returnToFreehandAfterShape
      : DEFAULTS.returnToFreehandAfterShape;
  settings.showArrowTipPivot =
    typeof settings.showArrowTipPivot === "boolean"
      ? settings.showArrowTipPivot
      : DEFAULTS.showArrowTipPivot;
  settings.showPathEndpointHandles =
    typeof settings.showPathEndpointHandles === "boolean"
      ? settings.showPathEndpointHandles
      : DEFAULTS.showPathEndpointHandles;
  settings.handleSizeScale = clampHandleSizeScale(
    typeof settings.handleSizeScale === "number"
      ? settings.handleSizeScale
      : DEFAULTS.handleSizeScale,
  );
  settings.disableHotkey =
    typeof settings.disableHotkey === "string" && settings.disableHotkey.trim()
      ? settings.disableHotkey
      : DEFAULTS.disableHotkey;
  delete (settings as { showThicknessHandle?: boolean }).showThicknessHandle;
  delete (settings as { showOpacityHandle?: boolean }).showOpacityHandle;
  settings.colorHotkeyEnabled =
    typeof settings.colorHotkeyEnabled === "boolean"
      ? settings.colorHotkeyEnabled
      : DEFAULTS.colorHotkeyEnabled;
  settings.shapeHotkeyEnabled =
    typeof settings.shapeHotkeyEnabled === "boolean"
      ? settings.shapeHotkeyEnabled
      : DEFAULTS.shapeHotkeyEnabled;
  settings.settingsWidth = normalizePanelSize(settings.settingsWidth);
  settings.settingsHeight = normalizePanelSize(settings.settingsHeight);
  settings.settingsX = normalizePanelPosition(settings.settingsX);
  settings.settingsY = normalizePanelPosition(settings.settingsY);
  settings.advancedSettingsX = normalizePanelPosition(settings.advancedSettingsX);
  settings.advancedSettingsY = normalizePanelPosition(settings.advancedSettingsY);
  settings.advancedSettingsWidth = normalizePanelSize(
    settings.advancedSettingsWidth,
  );
  settings.advancedSettingsHeight = normalizePanelSize(
    settings.advancedSettingsHeight,
  );
  const color = normalizeHex(settings.color);
  settings.color = color ?? DEFAULTS.color;
  settings.shapeHotkey = settings.shapeHotkey || DEFAULTS.shapeHotkey;
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
