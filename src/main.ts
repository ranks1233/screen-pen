import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DrawingBoard, type Corner, type PathEndpoint, type Tool } from "./draw";
import {
  DEFAULT_PRESET_COLORS,
  SETTINGS_PANEL_DEFAULT_WIDTH,
  SETTINGS_PANEL_MIN_HEIGHT,
  SETTINGS_PANEL_MIN_WIDTH,
  clampHandleSizeScale,
  formatHotkeyFromEvent,
  formatModifierHotkeyFromEvent,
  loadSettings,
  matchesSizeScrollHotkey,
  normalizeHex,
  saveSettings,
  type BrushPersistence,
  type Settings,
} from "./settings";

type HotkeyTarget = "activate" | "disable" | "color" | "shape" | "sizeScroll";
type SettingsResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const canvas = document.getElementById("draw-canvas") as HTMLCanvasElement;
const toolbar = document.getElementById("toolbar") as HTMLElement;
const drawBtn = document.getElementById("draw-btn") as HTMLButtonElement;
const colorBtn = document.getElementById("color-btn") as HTMLButtonElement;
const colorSwatch = document.getElementById("color-swatch") as HTMLElement;
const colorPanel = document.getElementById("color-panel") as HTMLElement;
const colorPresets = document.getElementById("color-presets") as HTMLElement;
const colorInput = document.getElementById("color-input") as HTMLInputElement;
const editColorInput = document.getElementById(
  "edit-color-input",
) as HTMLInputElement;
const editColorPresets = document.getElementById(
  "edit-color-presets",
) as HTMLElement;
const addPresetBtn = document.getElementById(
  "add-preset-btn",
) as HTMLButtonElement;
const shapeBtn = document.getElementById("shape-btn") as HTMLButtonElement;
const shapePanel = document.getElementById("shape-panel") as HTMLElement;
const shapeOptions = document.getElementById("shape-options") as HTMLElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const settingsPanel = document.getElementById("settings-panel") as HTMLElement;
const settingsBasic = document.getElementById("settings-basic") as HTMLElement;
const settingsTitle = document.getElementById("settings-title") as HTMLElement;
const settingsClose = document.getElementById("settings-close") as HTMLButtonElement;
const resetPresetsBtn = document.getElementById(
  "reset-presets-btn",
) as HTMLButtonElement;
const hotkeyBtn = document.getElementById("hotkey-btn") as HTMLButtonElement;
const disableHotkeyBtn = document.getElementById(
  "disable-hotkey-btn",
) as HTMLButtonElement;
const colorHotkeyBtn = document.getElementById(
  "color-hotkey-btn",
) as HTMLButtonElement;
const colorHotkeyEnabled = document.getElementById(
  "color-hotkey-enabled",
) as HTMLInputElement;
const shapeHotkeyBtn = document.getElementById(
  "shape-hotkey-btn",
) as HTMLButtonElement;
const shapeHotkeyEnabled = document.getElementById(
  "shape-hotkey-enabled",
) as HTMLInputElement;
const sizeHotkeyBtn = document.getElementById(
  "size-hotkey-btn",
) as HTMLButtonElement;
const sizeSensitivity = document.getElementById(
  "size-sensitivity",
) as HTMLInputElement;
const sensitivityValue = document.getElementById(
  "sensitivity-value",
) as HTMLElement;
const smoothStrengthInput = document.getElementById(
  "smooth-strength",
) as HTMLInputElement;
const smoothStrengthValue = document.getElementById(
  "smooth-strength-value",
) as HTMLElement;
const sizePreview = document.getElementById("size-preview") as HTMLElement;
const brushPersistDefault = document.getElementById(
  "brush-persist-default",
) as HTMLInputElement;
const brushPersistRemember = document.getElementById(
  "brush-persist-remember",
) as HTMLInputElement;
const brushDefaults = document.getElementById("brush-defaults") as HTMLElement;
const defaultColorPicker = document.getElementById(
  "default-color-picker",
) as HTMLElement;
const defaultColorBtn = document.getElementById(
  "default-color-btn",
) as HTMLButtonElement;
const defaultColorSwatch = document.getElementById(
  "default-color-swatch",
) as HTMLElement;
const defaultColorPresets = document.getElementById(
  "default-color-presets",
) as HTMLElement;
const defaultSize = document.getElementById("default-size") as HTMLInputElement;
const defaultSizeValue = document.getElementById(
  "default-size-value",
) as HTMLElement;
const showLineThicknessHandle = document.getElementById(
  "show-line-thickness-handle",
) as HTMLInputElement;
const showLineOpacityHandle = document.getElementById(
  "show-line-opacity-handle",
) as HTMLInputElement;
const showShapeThicknessHandle = document.getElementById(
  "show-shape-thickness-handle",
) as HTMLInputElement;
const showShapeOpacityHandle = document.getElementById(
  "show-shape-opacity-handle",
) as HTMLInputElement;
const applyThicknessToBrush = document.getElementById(
  "apply-thickness-to-brush",
) as HTMLInputElement;
const returnToFreehandAfterShape = document.getElementById(
  "return-to-freehand-after-shape",
) as HTMLInputElement;
const showArrowTipPivot = document.getElementById(
  "show-arrow-tip-pivot",
) as HTMLInputElement;
const showPathEndpointHandles = document.getElementById(
  "show-path-endpoint-handles",
) as HTMLInputElement;
const handleSizeScale = document.getElementById(
  "handle-size-scale",
) as HTMLInputElement;
const handleSizeValue = document.getElementById(
  "handle-size-value",
) as HTMLElement;
const advancedSettingsToggle = document.getElementById(
  "advanced-settings-toggle",
) as HTMLButtonElement;
const hideAdvancedSettings = document.getElementById(
  "hide-advanced-settings",
) as HTMLButtonElement;
const advancedSettings = document.getElementById(
  "advanced-settings",
) as HTMLElement;

const board = new DrawingBoard(canvas);
let settings: Settings;
let recordingHotkey: HotkeyTarget | null = null;
let active = false;
let pointerPos = { x: 0, y: 0 };
function placeToolbarDefault() {
  const margin = 24;
  const x = window.innerWidth - toolbar.offsetWidth - margin;
  const y = Math.max(margin, window.innerHeight * 0.25);
  toolbar.style.left = `${x}px`;
  toolbar.style.top = `${y}px`;
}

function applyToolbarPosition() {
  if (settings.toolbarX == null || settings.toolbarY == null) {
    placeToolbarDefault();
    return;
  }
  const maxX = window.innerWidth - toolbar.offsetWidth - 8;
  const maxY = window.innerHeight - toolbar.offsetHeight - 8;
  const x = Math.min(Math.max(8, settings.toolbarX), maxX);
  const y = Math.min(Math.max(8, settings.toolbarY), maxY);
  toolbar.style.left = `${x}px`;
  toolbar.style.top = `${y}px`;
}

function applySettingsPanelPosition(anchor: HTMLElement = settingsBtn) {
  const advanced = isAdvancedSettingsOpen();
  const savedX = advanced ? settings.advancedSettingsX : settings.settingsX;
  const savedY = advanced ? settings.advancedSettingsY : settings.settingsY;
  if (savedX == null || savedY == null) {
    positionPanel(settingsPanel, anchor);
    return;
  }
  const maxX = window.innerWidth - settingsPanel.offsetWidth - 8;
  const maxY = window.innerHeight - settingsPanel.offsetHeight - 8;
  const x = Math.min(Math.max(8, savedX), Math.max(8, maxX));
  const y = Math.min(Math.max(8, savedY), Math.max(8, maxY));
  settingsPanel.style.left = `${x}px`;
  settingsPanel.style.top = `${y}px`;
}

function isAdvancedSettingsOpen(): boolean {
  return !advancedSettings.classList.contains("hidden");
}

function clampSettingsPanelWidth(width: number): number {
  const max = Math.max(
    SETTINGS_PANEL_MIN_WIDTH,
    window.innerWidth - 16,
  );
  return Math.min(
    Math.max(SETTINGS_PANEL_MIN_WIDTH, Math.round(width)),
    max,
  );
}

function clampSettingsPanelHeight(height: number): number {
  const max = Math.max(
    SETTINGS_PANEL_MIN_HEIGHT,
    window.innerHeight - 24,
  );
  return Math.min(
    Math.max(SETTINGS_PANEL_MIN_HEIGHT, Math.round(height)),
    max,
  );
}

function applySettingsPanelSize() {
  const advanced = isAdvancedSettingsOpen();
  const width = clampSettingsPanelWidth(
    (advanced ? settings.advancedSettingsWidth : settings.settingsWidth) ??
      SETTINGS_PANEL_DEFAULT_WIDTH,
  );
  const height = advanced
    ? settings.advancedSettingsHeight
    : settings.settingsHeight;

  settingsPanel.style.width = `${width}px`;
  if (height == null) {
    settingsPanel.style.removeProperty("height");
  } else {
    settingsPanel.style.height = `${clampSettingsPanelHeight(height)}px`;
  }
}

function saveSettingsPanelSize(width: number, height: number) {
  const w = clampSettingsPanelWidth(width);
  const h = clampSettingsPanelHeight(height);
  if (isAdvancedSettingsOpen()) {
    settings.advancedSettingsWidth = w;
    settings.advancedSettingsHeight = h;
  } else {
    settings.settingsWidth = w;
    settings.settingsHeight = h;
  }
}

function saveSettingsPanelPosition(x: number, y: number) {
  if (isAdvancedSettingsOpen()) {
    settings.advancedSettingsX = Math.round(x);
    settings.advancedSettingsY = Math.round(y);
  } else {
    settings.settingsX = Math.round(x);
    settings.settingsY = Math.round(y);
  }
}

function updateColorUi(color: string) {
  const hex = normalizeHex(color) ?? color;
  colorSwatch.style.background = hex;
  colorInput.value = hex;
  defaultColorSwatch.style.background =
    normalizeHex(settings.color) ?? settings.color;
  board.setColor(hex);
  sizePreview.style.background = hex;
  markSelectedPresets();
}

function positionSizePreview(x: number, y: number) {
  pointerPos = { x, y };
  sizePreview.style.left = `${x}px`;
  sizePreview.style.top = `${y}px`;
}

function showSizePreview() {
  sizePreview.classList.add("visible");
}

function hideSizePreview() {
  sizePreview.classList.remove("visible");
}

function syncSizePreviewVisibility(
  mods: Pick<WheelEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
) {
  if (!active || !matchesSizeScrollHotkey(mods, settings.sizeScrollHotkey)) {
    hideSizePreview();
    return;
  }
  positionSizePreview(pointerPos.x, pointerPos.y);
  showSizePreview();
}

function updateSizeUi(size: number) {
  board.setSize(size);
  const shown = board.getSize();
  sizePreview.style.width = `${shown}px`;
  sizePreview.style.height = `${shown}px`;
  sizePreview.style.background = board.getColor();
}

function updateSensitivityUi(value: number) {
  const clamped = Math.max(1, Math.min(10, Math.round(value)));
  settings.sizeScrollSensitivity = clamped;
  sizeSensitivity.value = String(clamped);
  sensitivityValue.textContent = String(clamped);
}

function updateSmoothStrengthUi(value: number) {
  const clamped = Math.max(0, Math.min(10, Math.round(value)));
  settings.smoothStrength = clamped;
  smoothStrengthInput.value = String(clamped);
  smoothStrengthValue.textContent = String(clamped);
  board.setSmoothStrength(clamped);
}

function updateHandleSizeScaleUi(value: number) {
  const clamped = clampHandleSizeScale(value);
  settings.handleSizeScale = clamped;
  handleSizeScale.value = String(clamped);
  handleSizeValue.textContent = `${clamped}%`;
  board.setHandleSizeScale(clamped);
}

function updateBrushDefaultsUi() {
  defaultSize.value = String(settings.brushSize);
  defaultSizeValue.textContent = String(settings.brushSize);
  defaultColorSwatch.style.background = settings.color;
  buildDefaultColorPresets();
}

function setDefaultColorFlyoutOpen(open: boolean) {
  defaultColorPicker.classList.toggle("open", open);
  defaultColorBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    positionDefaultColorFlyout();
  }
}

function positionDefaultColorFlyout() {
  const rect = defaultColorBtn.getBoundingClientRect();
  defaultColorPresets.style.top = `${rect.top + rect.height / 2}px`;
  defaultColorPresets.style.right = `${window.innerWidth - rect.left + 8}px`;
  defaultColorPresets.style.left = "auto";
}

function updateBrushPersistenceUi(mode: BrushPersistence) {
  settings.brushPersistence = mode;
  brushPersistDefault.checked = mode === "default";
  brushPersistRemember.checked = mode === "rememberLast";
  brushDefaults.classList.toggle("hidden", mode !== "default");
  if (mode !== "default") {
    setDefaultColorFlyoutOpen(false);
  }
  if (mode === "default") {
    updateBrushDefaultsUi();
  }
}

function updateHandleOptionsUi() {
  showLineThicknessHandle.checked = settings.showLineThicknessHandle;
  showLineOpacityHandle.checked = settings.showLineOpacityHandle;
  showShapeThicknessHandle.checked = settings.showShapeThicknessHandle;
  showShapeOpacityHandle.checked = settings.showShapeOpacityHandle;
  applyThicknessToBrush.checked = settings.applyThicknessToBrush;
  returnToFreehandAfterShape.checked = settings.returnToFreehandAfterShape;
  showArrowTipPivot.checked = settings.showArrowTipPivot;
  showPathEndpointHandles.checked = settings.showPathEndpointHandles;
  updateHandleSizeScaleUi(settings.handleSizeScale);
  board.setShowLineThicknessHandle(settings.showLineThicknessHandle);
  board.setShowLineOpacityHandle(settings.showLineOpacityHandle);
  board.setShowShapeThicknessHandle(settings.showShapeThicknessHandle);
  board.setShowShapeOpacityHandle(settings.showShapeOpacityHandle);
  board.setApplyThicknessToBrush(settings.applyThicknessToBrush);
  board.setReturnToFreehandAfterShape(settings.returnToFreehandAfterShape);
  board.setShowArrowTipPivot(settings.showArrowTipPivot);
  board.setShowPathEndpointHandles(settings.showPathEndpointHandles);
}

function setAdvancedSettingsOpen(open: boolean) {
  settingsBasic.classList.toggle("hidden", open);
  advancedSettings.classList.toggle("hidden", !open);
  advancedSettingsToggle.setAttribute("aria-expanded", String(open));
  hideAdvancedSettings.setAttribute("aria-expanded", String(open));
  settingsTitle.textContent = open ? "Advanced settings" : "Settings";
  settingsPanel.setAttribute(
    "aria-label",
    open ? "Advanced settings" : "Settings",
  );
  if (!open) {
    setDefaultColorFlyoutOpen(false);
  }
  if (open) {
    updateAddPresetBtn();
    buildEditColorPresets();
  }
  if (!settingsPanel.classList.contains("hidden")) {
    applySettingsPanelSize();
    applySettingsPanelPosition(settingsBtn);
  }
}

function syncBrushToSettings() {
  if (settings.brushPersistence !== "rememberLast") return;
  settings.color = board.getColor();
  settings.brushSize = board.getSize();
}

function hasPreset(color: string): boolean {
  const hex = normalizeHex(color);
  if (!hex) return false;
  return settings.presetColors.includes(hex);
}

function presetsMatchDefaults(): boolean {
  if (settings.presetColors.length !== DEFAULT_PRESET_COLORS.length) {
    return false;
  }
  return settings.presetColors.every(
    (color, i) => color === DEFAULT_PRESET_COLORS[i],
  );
}

function updateResetPresetsBtn() {
  resetPresetsBtn.disabled = presetsMatchDefaults();
}

function updateAddPresetBtn() {
  const hex = normalizeHex(editColorInput.value);
  addPresetBtn.disabled = !hex || hasPreset(hex);
}

function markSelectedPresets() {
  const current = normalizeHex(board.getColor());
  const defaultCurrent = normalizeHex(settings.color);
  for (const btn of colorPresets.querySelectorAll<HTMLElement>(".preset")) {
    const hex = normalizeHex(btn.dataset.color ?? "");
    btn.classList.toggle("selected", hex !== null && hex === current);
  }
  for (const btn of defaultColorPresets.querySelectorAll<HTMLElement>(".preset")) {
    const hex = normalizeHex(btn.dataset.color ?? "");
    btn.classList.toggle("selected", hex !== null && hex === defaultCurrent);
  }
}

function hotkeyButton(target: HotkeyTarget): HTMLButtonElement {
  if (target === "activate") return hotkeyBtn;
  if (target === "disable") return disableHotkeyBtn;
  if (target === "color") return colorHotkeyBtn;
  if (target === "shape") return shapeHotkeyBtn;
  return sizeHotkeyBtn;
}

function hotkeyLabel(target: HotkeyTarget): string {
  if (target === "activate") return settings.activateHotkey;
  if (target === "disable") return settings.disableHotkey;
  if (target === "color") return settings.colorHotkey;
  if (target === "shape") return settings.shapeHotkey;
  return settings.sizeScrollHotkey;
}

function updateSizeScrollHotkeyUi(hotkey: string) {
  settings.sizeScrollHotkey = hotkey;
  sizeHotkeyBtn.textContent = hotkey;
  sizePreview.title = `Brush size (${hotkey} + scroll)`;
}

function updatePanelHotkeyEnableUi() {
  colorHotkeyEnabled.checked = settings.colorHotkeyEnabled;
  shapeHotkeyEnabled.checked = settings.shapeHotkeyEnabled;
  colorHotkeyBtn.disabled = !settings.colorHotkeyEnabled;
  shapeHotkeyBtn.disabled = !settings.shapeHotkeyEnabled;
  if (!settings.colorHotkeyEnabled && recordingHotkey === "color") {
    stopHotkeyRecording();
  }
  if (!settings.shapeHotkeyEnabled && recordingHotkey === "shape") {
    stopHotkeyRecording();
  }
}

function stopHotkeyRecording() {
  if (!recordingHotkey) return;
  const btn = hotkeyButton(recordingHotkey);
  btn.classList.remove("recording");
  btn.textContent = hotkeyLabel(recordingHotkey);
  recordingHotkey = null;
}

function closePanels() {
  colorPanel.classList.add("hidden");
  shapePanel.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  setDefaultColorFlyoutOpen(false);
  setAdvancedSettingsOpen(false);
  stopHotkeyRecording();
}

function positionPanel(panel: HTMLElement, anchor: HTMLElement = toolbar) {
  const rect = anchor.getBoundingClientRect();
  const width = panel.offsetWidth || 220;
  let left = rect.left - width - 12;
  if (left < 12) left = rect.right + 12;
  let top = rect.top;
  const maxTop = window.innerHeight - panel.offsetHeight - 12;
  top = Math.min(Math.max(12, top), Math.max(12, maxTop));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function toggleColorPanel() {
  shapePanel.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  stopHotkeyRecording();
  colorPanel.classList.toggle("hidden");
  if (!colorPanel.classList.contains("hidden")) {
    positionPanel(colorPanel, colorBtn);
  }
}

function toggleShapePanel() {
  colorPanel.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  stopHotkeyRecording();
  shapePanel.classList.toggle("hidden");
  if (!shapePanel.classList.contains("hidden")) {
    markSelectedShapeOption();
    positionPanel(shapePanel, shapeBtn);
  }
}

function markSelectedShapeOption() {
  const tool = board.getTool();
  for (const btn of shapeOptions.querySelectorAll<HTMLElement>(".shape-option")) {
    btn.classList.toggle("selected", btn.dataset.shape === tool);
  }
  drawBtn.classList.toggle("active", tool === "freehand");
  shapeBtn.classList.toggle("active", tool !== "freehand");
}

function setShapeTool(tool: Tool) {
  board.selectTool(tool);
  markSelectedShapeOption();
  updateCanvasCursorClass();
}

function updateCanvasCursorClass(hoverHandle: Corner | null = null) {
  canvas.classList.remove(
    "shape-tool",
    "resize-nw",
    "resize-ne",
    "resize-sw",
    "resize-se",
    "thickness-grip",
    "fill-btn",
    "opacity-slider",
    "tip-pivot",
    "path-endpoint",
  );
  if (hoverHandle) {
    canvas.classList.add(`resize-${hoverHandle}`);
    return;
  }
  if (board.getTool() !== "freehand") {
    canvas.classList.add("shape-tool");
  }
}

function updateHoverCursor(point: { x: number; y: number }) {
  if (board.hitTestOpacitySlider(point)) {
    canvas.classList.remove(
      "shape-tool",
      "resize-nw",
      "resize-ne",
      "resize-sw",
      "resize-se",
      "thickness-grip",
      "fill-btn",
      "tip-pivot",
      "path-endpoint",
    );
    canvas.classList.add("opacity-slider");
    return;
  }
  if (board.hitTestArrowTipPivot(point)) {
    canvas.classList.remove(
      "shape-tool",
      "resize-nw",
      "resize-ne",
      "resize-sw",
      "resize-se",
      "thickness-grip",
      "fill-btn",
      "opacity-slider",
      "path-endpoint",
    );
    canvas.classList.add("tip-pivot");
    return;
  }
  if (board.hitTestFillBtn(point)) {
    canvas.classList.remove(
      "shape-tool",
      "resize-nw",
      "resize-ne",
      "resize-sw",
      "resize-se",
      "thickness-grip",
      "opacity-slider",
      "tip-pivot",
      "path-endpoint",
    );
    canvas.classList.add("fill-btn");
    return;
  }
  if (board.hitTestThicknessGrip(point)) {
    canvas.classList.remove(
      "shape-tool",
      "resize-nw",
      "resize-ne",
      "resize-sw",
      "resize-se",
      "fill-btn",
      "opacity-slider",
      "tip-pivot",
      "path-endpoint",
    );
    canvas.classList.add("thickness-grip");
    return;
  }
  const handle = board.hitTestHandle(point);
  if (handle) {
    updateCanvasCursorClass(handle);
    return;
  }
  const endpoint: PathEndpoint | null = board.hitTestPathEndpoint(point);
  if (endpoint) {
    canvas.classList.remove(
      "shape-tool",
      "resize-nw",
      "resize-ne",
      "resize-sw",
      "resize-se",
      "thickness-grip",
      "fill-btn",
      "opacity-slider",
      "tip-pivot",
    );
    canvas.classList.add("path-endpoint");
    return;
  }
  updateCanvasCursorClass(null);
}

function isUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "#toolbar, #color-panel, #shape-panel, #settings-panel, #default-color-presets",
    ),
  );
}

function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const combo = formatHotkeyFromEvent(e);
  return combo !== null && combo.toLowerCase() === hotkey.toLowerCase();
}

async function persist() {
  syncBrushToSettings();
  await saveSettings(settings);
}

async function activate() {
  active = true;
  document.body.classList.add("active");
  closePanels();
  board.redraw();
  applyToolbarPosition();
  updateColorUi(settings.color);
  updateSizeUi(settings.brushSize);
  await getCurrentWindow().setFocus();
}

async function deactivate() {
  active = false;
  hideSizePreview();
  document.body.classList.remove("active");
  closePanels();
  setShapeTool("freehand");
  board.clear();
  await persist();
  await invoke("deactivate_drawing");
}

function createPresetButton(
  color: string,
  onSelect: (color: string) => void | Promise<void>,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "preset";
  btn.style.background = color;
  btn.title = color;
  btn.dataset.color = color;
  btn.addEventListener("click", () => {
    void onSelect(color);
  });
  return btn;
}

function buildColorPresets() {
  colorPresets.innerHTML = "";
  for (const color of settings.presetColors) {
    const btn = createPresetButton(color, async (picked) => {
      updateColorUi(picked);
      updateSizeUi(board.getSize());
      await persist();
      colorPanel.classList.add("hidden");
    });
    colorPresets.appendChild(btn);
  }
  markSelectedPresets();
}

function buildDefaultColorPresets() {
  defaultColorPresets.innerHTML = "";
  for (const color of settings.presetColors) {
    const btn = createPresetButton(color, async (picked) => {
      settings.color = picked;
      defaultColorSwatch.style.background = picked;
      updateColorUi(picked);
      updateSizeUi(board.getSize());
      markSelectedPresets();
      setDefaultColorFlyoutOpen(false);
      await saveSettings(settings);
    });
    defaultColorPresets.appendChild(btn);
  }
  markSelectedPresets();
}

function buildEditColorPresets() {
  editColorPresets.innerHTML = "";
  for (const color of settings.presetColors) {
    const wrap = document.createElement("div");
    wrap.className = "preset-wrap";

    const btn = createPresetButton(color, (picked) => {
      editColorInput.value = picked;
      updateAddPresetBtn();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "preset-remove";
    remove.title = "Remove from defaults";
    remove.setAttribute("aria-label", `Remove ${color}`);
    remove.textContent = "×";
    remove.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await removePresetColor(color);
    });

    wrap.append(btn, remove);
    editColorPresets.appendChild(wrap);
  }
  updateAddPresetBtn();
  updateResetPresetsBtn();
}

function rebuildPresetUi() {
  buildColorPresets();
  buildEditColorPresets();
  if (settings.brushPersistence === "default") {
    buildDefaultColorPresets();
  }
}

async function addPresetColor(color: string) {
  const hex = normalizeHex(color);
  if (!hex || hasPreset(hex)) return;
  settings.presetColors = [...settings.presetColors, hex];
  rebuildPresetUi();
  await saveSettings(settings);
}

async function removePresetColor(color: string) {
  const hex = normalizeHex(color);
  if (!hex) return;
  settings.presetColors = settings.presetColors.filter((c) => c !== hex);
  rebuildPresetUi();
  await saveSettings(settings);
}

async function resetPresetColors() {
  if (presetsMatchDefaults()) return;
  settings.presetColors = [...DEFAULT_PRESET_COLORS];
  rebuildPresetUi();
  await saveSettings(settings);
}

function isInteractiveUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, input, select, textarea, a, label, [role='button'], [contenteditable='true'], .settings-resize-handle",
    ),
  );
}

/** Top strip (to first field) and bottom strip (from advanced/hide button). */
function isSettingsDragZone(clientY: number): boolean {
  const advancedOpen = !advancedSettings.classList.contains("hidden");
  const contentRoot = advancedOpen ? advancedSettings : settingsBasic;
  const firstField = contentRoot.querySelector(".field");
  const bottomAnchor = advancedOpen
    ? hideAdvancedSettings
    : advancedSettingsToggle;
  const header = settingsPanel.querySelector(".panel-header");
  const actions = settingsPanel.querySelector(".settings-actions");
  if (!header || !actions) return false;

  const headerBottom = header.getBoundingClientRect().bottom;
  const topZoneEnd = firstField
    ? Math.max(headerBottom, firstField.getBoundingClientRect().top)
    : headerBottom;
  if (clientY < topZoneEnd) return true;

  const panelTop = settingsPanel.getBoundingClientRect().top;
  const actionsTop = actions.getBoundingClientRect().top;
  const anchorBottom = bottomAnchor.getBoundingClientRect().bottom;
  const bottomZoneStart =
    anchorBottom >= panelTop && anchorBottom <= actionsTop
      ? anchorBottom
      : actionsTop;
  return clientY >= bottomZoneStart;
}

function setupElementDrag(
  handle: HTMLElement,
  target: HTMLElement,
  onEnd?: (rect: DOMRect) => void | Promise<void>,
  canStart?: (e: PointerEvent) => boolean,
) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (isInteractiveUiTarget(e.target)) return;
    if (canStart && !canStart(e)) return;
    dragging = true;
    target.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
    const rect = target.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const maxX = window.innerWidth - target.offsetWidth;
    const maxY = window.innerHeight - target.offsetHeight;
    const x = Math.min(Math.max(0, e.clientX - offsetX), Math.max(0, maxX));
    const y = Math.min(Math.max(0, e.clientY - offsetY), Math.max(0, maxY));
    target.style.left = `${x}px`;
    target.style.top = `${y}px`;
    if (
      target === settingsPanel &&
      defaultColorPicker.classList.contains("open")
    ) {
      positionDefaultColorFlyout();
    }
  });

  const endDrag = async (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    target.classList.remove("dragging");
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (onEnd) await onEnd(target.getBoundingClientRect());
  };

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

function setupToolbarDrag() {
  setupElementDrag(toolbar, toolbar, async (rect) => {
    settings.toolbarX = rect.left;
    settings.toolbarY = rect.top;
    await persist();
  });
}

function setupSettingsDrag() {
  setupElementDrag(
    settingsPanel,
    settingsPanel,
    async (rect) => {
      saveSettingsPanelPosition(rect.left, rect.top);
      await persist();
    },
    (e) => isSettingsDragZone(e.clientY),
  );

  settingsPanel.addEventListener("pointermove", (e) => {
    if (settingsPanel.classList.contains("dragging")) return;
    if (settingsPanel.classList.contains("resizing")) return;
    if (isInteractiveUiTarget(e.target)) {
      settingsPanel.style.removeProperty("cursor");
      return;
    }
    settingsPanel.style.cursor = isSettingsDragZone(e.clientY)
      ? "grab"
      : "default";
  });
}

function setupSettingsResize() {
  const handles = settingsPanel.querySelectorAll<HTMLElement>(
    ".settings-resize-handle",
  );

  for (const handle of handles) {
    const edge = handle.dataset.resize as SettingsResizeEdge | undefined;
    if (!edge) continue;

    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let startWidth = 0;
    let startHeight = 0;

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      resizing = true;
      settingsPanel.classList.add("resizing");
      handle.setPointerCapture(e.pointerId);
      const rect = settingsPanel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      startWidth = rect.width;
      startHeight = rect.height;
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let left = startLeft;
      let top = startTop;
      let width = startWidth;
      let height = startHeight;

      if (edge.includes("e")) {
        width = startWidth + dx;
      }
      if (edge.includes("w")) {
        width = startWidth - dx;
        left = startLeft + dx;
      }
      if (edge.includes("s")) {
        height = startHeight + dy;
      }
      if (edge.includes("n")) {
        height = startHeight - dy;
        top = startTop + dy;
      }

      width = clampSettingsPanelWidth(width);
      height = clampSettingsPanelHeight(height);

      if (edge.includes("w")) {
        left = startLeft + (startWidth - width);
      }
      if (edge.includes("n")) {
        top = startTop + (startHeight - height);
      }

      const maxLeft = window.innerWidth - width;
      const maxTop = window.innerHeight - height;
      left = Math.min(Math.max(0, left), Math.max(0, maxLeft));
      top = Math.min(Math.max(0, top), Math.max(0, maxTop));

      settingsPanel.style.width = `${width}px`;
      settingsPanel.style.height = `${height}px`;
      settingsPanel.style.left = `${left}px`;
      settingsPanel.style.top = `${top}px`;

      if (defaultColorPicker.classList.contains("open")) {
        positionDefaultColorFlyout();
      }
    });

    const endResize = async (e: PointerEvent) => {
      if (!resizing) return;
      resizing = false;
      settingsPanel.classList.remove("resizing");
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const rect = settingsPanel.getBoundingClientRect();
      saveSettingsPanelSize(rect.width, rect.height);
      saveSettingsPanelPosition(rect.left, rect.top);
      await persist();
    };

    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
  }
}

function setupDrawing() {
  canvas.addEventListener("pointerdown", (e) => {
    if (!active || isUiTarget(e.target)) return;
    if (e.button !== 0) return;
    closePanels();
    positionSizePreview(e.clientX, e.clientY);
    board.pointerDown(e);
    markSelectedShapeOption();
    updateCanvasCursorClass();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!active) return;
    positionSizePreview(e.clientX, e.clientY);
    board.continueStroke(e);
    if (e.buttons === 0) {
      updateHoverCursor({ x: e.clientX, y: e.clientY });
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!active) return;
    const thicknessChanged = board.endStroke(e);
    if (thicknessChanged && settings.applyThicknessToBrush) {
      updateSizeUi(board.getSize());
      void persist();
    }
    markSelectedShapeOption();
    updateCanvasCursorClass();
  });

  canvas.addEventListener("pointercancel", () => {
    const thicknessChanged = board.endStroke();
    if (thicknessChanged && settings.applyThicknessToBrush) {
      updateSizeUi(board.getSize());
      void persist();
    }
    markSelectedShapeOption();
    updateCanvasCursorClass();
  });
}

function startHotkeyRecording(target: HotkeyTarget) {
  stopHotkeyRecording();
  recordingHotkey = target;
  const btn = hotkeyButton(target);
  btn.classList.add("recording");
  btn.textContent = "Press keys…";
}

async function finishHotkeyRecording(combo: string) {
  if (!recordingHotkey) return;
  const target = recordingHotkey;
  const btn = hotkeyButton(target);

  if (target === "activate") {
    try {
      await invoke("set_activate_hotkey", { hotkey: combo });
      settings.activateHotkey = combo;
      btn.textContent = combo;
      btn.classList.remove("recording");
      recordingHotkey = null;
      await persist();
    } catch (err) {
      btn.textContent = `Invalid: ${String(err)}`;
      setTimeout(() => {
        btn.textContent = settings.activateHotkey;
        btn.classList.remove("recording");
        recordingHotkey = null;
      }, 1200);
    }
    return;
  }

  if (target === "disable") {
    try {
      await invoke("set_disable_hotkey", { hotkey: combo });
      settings.disableHotkey = combo;
      btn.textContent = combo;
      btn.classList.remove("recording");
      recordingHotkey = null;
      await persist();
    } catch (err) {
      btn.textContent = `Invalid: ${String(err)}`;
      setTimeout(() => {
        btn.textContent = settings.disableHotkey;
        btn.classList.remove("recording");
        recordingHotkey = null;
      }, 1200);
    }
    return;
  }

  if (target === "sizeScroll") {
    updateSizeScrollHotkeyUi(combo);
    btn.classList.remove("recording");
    recordingHotkey = null;
    await persist();
    return;
  }

  if (target === "shape") {
    settings.shapeHotkey = combo;
    btn.textContent = combo;
    btn.classList.remove("recording");
    recordingHotkey = null;
    await persist();
    return;
  }

  settings.colorHotkey = combo;
  btn.textContent = combo;
  btn.classList.remove("recording");
  recordingHotkey = null;
  await persist();
}

function setupHotkeys() {
  window.addEventListener("keydown", async (e) => {
    if (!active) return;

    if (recordingHotkey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stopHotkeyRecording();
        return;
      }
      const combo =
        recordingHotkey === "sizeScroll"
          ? formatModifierHotkeyFromEvent(e)
          : formatHotkeyFromEvent(e);
      if (!combo) return;
      await finishHotkeyRecording(combo);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      await deactivate();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      board.undo();
      return;
    }

    if (settings.colorHotkeyEnabled && matchesHotkey(e, settings.colorHotkey)) {
      e.preventDefault();
      toggleColorPanel();
      return;
    }

    if (settings.shapeHotkeyEnabled && matchesHotkey(e, settings.shapeHotkey)) {
      e.preventDefault();
      toggleShapePanel();
      return;
    }

    if (e.key === "Shift") {
      board.setShiftHeld(true);
    }

    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      syncSizePreviewVisibility(e);
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      board.setShiftHeld(false);
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      syncSizePreviewVisibility(e);
    }
  });

  window.addEventListener("pointermove", (e) => {
    if (!active) return;
    positionSizePreview(e.clientX, e.clientY);
    syncSizePreviewVisibility(e);
  });

  window.addEventListener(
    "wheel",
    async (e) => {
      if (!active || !matchesSizeScrollHotkey(e, settings.sizeScrollHotkey)) {
        return;
      }
      e.preventDefault();
      positionSizePreview(e.clientX, e.clientY);
      showSizePreview();
      const step = settings.sizeScrollSensitivity;
      const delta = e.deltaY < 0 ? step : -step;
      updateSizeUi(board.getSize() + delta);
      await persist();
    },
    { passive: false },
  );
}

async function boot() {
  settings = await loadSettings();
  rebuildPresetUi();
  updateColorUi(settings.color);
  updateSizeUi(settings.brushSize);
  updateSensitivityUi(settings.sizeScrollSensitivity);
  updateSmoothStrengthUi(settings.smoothStrength);
  updateBrushPersistenceUi(settings.brushPersistence);
  updateHandleOptionsUi();
  hotkeyBtn.textContent = settings.activateHotkey;
  disableHotkeyBtn.textContent = settings.disableHotkey;
  colorHotkeyBtn.textContent = settings.colorHotkey;
  shapeHotkeyBtn.textContent = settings.shapeHotkey;
  updatePanelHotkeyEnableUi();
  updateSizeScrollHotkeyUi(settings.sizeScrollHotkey);
  markSelectedShapeOption();
  applyToolbarPosition();
  setupToolbarDrag();
  setupSettingsDrag();
  setupSettingsResize();
  setupDrawing();
  setupHotkeys();

  try {
    await invoke("set_activate_hotkey", { hotkey: settings.activateHotkey });
  } catch (err) {
    console.warn("Could not register activate hotkey, using default", err);
  }
  try {
    await invoke("set_disable_hotkey", { hotkey: settings.disableHotkey });
  } catch (err) {
    console.warn("Could not register disable hotkey, using default", err);
  }

  colorBtn.addEventListener("click", () => {
    toggleColorPanel();
  });

  drawBtn.addEventListener("click", () => {
    closePanels();
    setShapeTool("freehand");
  });

  shapeBtn.addEventListener("click", () => {
    toggleShapePanel();
  });

  shapeOptions.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>(".shape-option");
    if (!btn?.dataset.shape) return;
    const kind = btn.dataset.shape as Exclude<Tool, "freehand">;
    if (board.getTool() === kind) {
      setShapeTool("freehand");
    } else {
      setShapeTool(kind);
    }
    shapePanel.classList.add("hidden");
  });

  colorInput.addEventListener("input", async () => {
    updateColorUi(colorInput.value);
    updateSizeUi(board.getSize());
    await persist();
  });

  editColorInput.addEventListener("input", () => {
    updateAddPresetBtn();
  });

  addPresetBtn.addEventListener("click", async () => {
    await addPresetColor(editColorInput.value);
  });

  resetPresetsBtn.addEventListener("click", async () => {
    await resetPresetColors();
  });

  settingsBtn.addEventListener("click", () => {
    colorPanel.classList.add("hidden");
    shapePanel.classList.add("hidden");
    settingsPanel.classList.toggle("hidden");
    if (!settingsPanel.classList.contains("hidden")) {
      setAdvancedSettingsOpen(false);
      updateBrushPersistenceUi(settings.brushPersistence);
      updateHandleOptionsUi();
    } else {
      setDefaultColorFlyoutOpen(false);
      stopHotkeyRecording();
    }
  });

  advancedSettingsToggle.addEventListener("click", () => {
    setAdvancedSettingsOpen(true);
  });

  hideAdvancedSettings.addEventListener("click", () => {
    setAdvancedSettingsOpen(false);
  });

  settingsClose.addEventListener("click", () => {
    closePanels();
  });

  hotkeyBtn.addEventListener("click", () => {
    startHotkeyRecording("activate");
  });

  disableHotkeyBtn.addEventListener("click", () => {
    startHotkeyRecording("disable");
  });

  colorHotkeyBtn.addEventListener("click", () => {
    if (!settings.colorHotkeyEnabled) return;
    startHotkeyRecording("color");
  });

  shapeHotkeyBtn.addEventListener("click", () => {
    if (!settings.shapeHotkeyEnabled) return;
    startHotkeyRecording("shape");
  });

  colorHotkeyEnabled.addEventListener("change", async () => {
    settings.colorHotkeyEnabled = colorHotkeyEnabled.checked;
    updatePanelHotkeyEnableUi();
    await saveSettings(settings);
  });

  shapeHotkeyEnabled.addEventListener("change", async () => {
    settings.shapeHotkeyEnabled = shapeHotkeyEnabled.checked;
    updatePanelHotkeyEnableUi();
    await saveSettings(settings);
  });

  sizeHotkeyBtn.addEventListener("click", () => {
    startHotkeyRecording("sizeScroll");
  });

  sizeSensitivity.addEventListener("input", async () => {
    updateSensitivityUi(Number(sizeSensitivity.value));
    await persist();
  });

  smoothStrengthInput.addEventListener("input", async () => {
    updateSmoothStrengthUi(Number(smoothStrengthInput.value));
    await persist();
  });

  const onBrushPersistenceChange = async () => {
    const mode: BrushPersistence = brushPersistDefault.checked
      ? "default"
      : "rememberLast";
    if (mode === "rememberLast") {
      settings.color = board.getColor();
      settings.brushSize = board.getSize();
    }
    updateBrushPersistenceUi(mode);
    await saveSettings(settings);
  };

  brushPersistDefault.addEventListener("change", onBrushPersistenceChange);
  brushPersistRemember.addEventListener("change", onBrushPersistenceChange);

  showLineThicknessHandle.addEventListener("change", async () => {
    settings.showLineThicknessHandle = showLineThicknessHandle.checked;
    board.setShowLineThicknessHandle(settings.showLineThicknessHandle);
    await saveSettings(settings);
  });

  showLineOpacityHandle.addEventListener("change", async () => {
    settings.showLineOpacityHandle = showLineOpacityHandle.checked;
    board.setShowLineOpacityHandle(settings.showLineOpacityHandle);
    await saveSettings(settings);
  });

  showShapeThicknessHandle.addEventListener("change", async () => {
    settings.showShapeThicknessHandle = showShapeThicknessHandle.checked;
    board.setShowShapeThicknessHandle(settings.showShapeThicknessHandle);
    await saveSettings(settings);
  });

  showShapeOpacityHandle.addEventListener("change", async () => {
    settings.showShapeOpacityHandle = showShapeOpacityHandle.checked;
    board.setShowShapeOpacityHandle(settings.showShapeOpacityHandle);
    await saveSettings(settings);
  });

  applyThicknessToBrush.addEventListener("change", async () => {
    settings.applyThicknessToBrush = applyThicknessToBrush.checked;
    board.setApplyThicknessToBrush(settings.applyThicknessToBrush);
    await saveSettings(settings);
  });

  returnToFreehandAfterShape.addEventListener("change", async () => {
    settings.returnToFreehandAfterShape = returnToFreehandAfterShape.checked;
    board.setReturnToFreehandAfterShape(settings.returnToFreehandAfterShape);
    await saveSettings(settings);
  });

  showArrowTipPivot.addEventListener("change", async () => {
    settings.showArrowTipPivot = showArrowTipPivot.checked;
    board.setShowArrowTipPivot(settings.showArrowTipPivot);
    await saveSettings(settings);
  });

  showPathEndpointHandles.addEventListener("change", async () => {
    settings.showPathEndpointHandles = showPathEndpointHandles.checked;
    board.setShowPathEndpointHandles(settings.showPathEndpointHandles);
    await saveSettings(settings);
  });

  handleSizeScale.addEventListener("input", async () => {
    updateHandleSizeScaleUi(Number(handleSizeScale.value));
    await saveSettings(settings);
  });

  defaultColorBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !defaultColorPicker.classList.contains("open");
    setDefaultColorFlyoutOpen(open);
  });

  document.addEventListener("pointerdown", (e) => {
    if (!defaultColorPicker.classList.contains("open")) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (defaultColorPicker.contains(target)) return;
    if (defaultColorPresets.contains(target)) return;
    setDefaultColorFlyoutOpen(false);
  });

  defaultSize.addEventListener("input", async () => {
    const size = Math.max(1, Math.min(80, Number(defaultSize.value)));
    settings.brushSize = size;
    defaultSizeValue.textContent = String(size);
    updateSizeUi(size);
    await saveSettings(settings);
  });

  window.addEventListener("resize", () => {
    board.resize();
    applyToolbarPosition();
    if (!settingsPanel.classList.contains("hidden")) {
      applySettingsPanelSize();
      applySettingsPanelPosition(settingsBtn);
    }
    if (defaultColorPicker.classList.contains("open")) {
      positionDefaultColorFlyout();
    }
  });

  const settingsScroll = settingsPanel.querySelector(".settings-scroll");
  settingsScroll?.addEventListener(
    "scroll",
    () => {
      if (defaultColorPicker.classList.contains("open")) {
        positionDefaultColorFlyout();
      }
    },
    { passive: true },
  );

  await listen("drawing-activated", async () => {
    await activate();
  });

  await listen("drawing-deactivated", () => {
    active = false;
    hideSizePreview();
    document.body.classList.remove("active");
    closePanels();
    setShapeTool("freehand");
    board.clear();
  });

  // If window is already visible (e.g. debug), activate UI
  const visible = await getCurrentWindow().isVisible();
  if (visible) {
    await activate();
  }
}

boot().catch((err) => {
  console.error(err);
});
