import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DrawingBoard, type Corner, type ShapeKind, type Tool } from "./draw";
import {
  formatHotkeyFromEvent,
  formatModifierHotkeyFromEvent,
  loadSettings,
  matchesSizeScrollHotkey,
  normalizeHex,
  saveSettings,
  type BrushPersistence,
  type Settings,
} from "./settings";

type HotkeyTarget = "activate" | "color" | "shape" | "sizeScroll";

const canvas = document.getElementById("draw-canvas") as HTMLCanvasElement;
const toolbar = document.getElementById("toolbar") as HTMLElement;
const dragHandle = document.getElementById("drag-handle") as HTMLButtonElement;
const drawBtn = document.getElementById("draw-btn") as HTMLButtonElement;
const colorBtn = document.getElementById("color-btn") as HTMLButtonElement;
const colorSwatch = document.getElementById("color-swatch") as HTMLElement;
const colorPanel = document.getElementById("color-panel") as HTMLElement;
const colorPresets = document.getElementById("color-presets") as HTMLElement;
const colorInput = document.getElementById("color-input") as HTMLInputElement;
const addPresetBtn = document.getElementById(
  "add-preset-btn",
) as HTMLButtonElement;
const shapeBtn = document.getElementById("shape-btn") as HTMLButtonElement;
const shapePanel = document.getElementById("shape-panel") as HTMLElement;
const shapeOptions = document.getElementById("shape-options") as HTMLElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const settingsPanel = document.getElementById("settings-panel") as HTMLElement;
const settingsClose = document.getElementById("settings-close") as HTMLButtonElement;
const settingsHint = document.getElementById("settings-hint") as HTMLElement;
const hotkeyBtn = document.getElementById("hotkey-btn") as HTMLButtonElement;
const colorHotkeyBtn = document.getElementById(
  "color-hotkey-btn",
) as HTMLButtonElement;
const shapeHotkeyBtn = document.getElementById(
  "shape-hotkey-btn",
) as HTMLButtonElement;
const sizeHotkeyBtn = document.getElementById(
  "size-hotkey-btn",
) as HTMLButtonElement;
const sizeSensitivity = document.getElementById(
  "size-sensitivity",
) as HTMLInputElement;
const sensitivityValue = document.getElementById(
  "sensitivity-value",
) as HTMLElement;
const sizePreview = document.getElementById("size-preview") as HTMLElement;
const brushPersistDefault = document.getElementById(
  "brush-persist-default",
) as HTMLInputElement;
const brushPersistRemember = document.getElementById(
  "brush-persist-remember",
) as HTMLInputElement;
const brushDefaults = document.getElementById("brush-defaults") as HTMLElement;
const defaultColorPresets = document.getElementById(
  "default-color-presets",
) as HTMLElement;
const defaultSize = document.getElementById("default-size") as HTMLInputElement;
const defaultSizeValue = document.getElementById(
  "default-size-value",
) as HTMLElement;

const board = new DrawingBoard(canvas);
let settings: Settings;
let recordingHotkey: HotkeyTarget | null = null;
let active = false;

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

function updateColorUi(color: string) {
  const hex = normalizeHex(color) ?? color;
  colorSwatch.style.background = hex;
  colorInput.value = hex;
  board.setColor(hex);
  updateAddPresetBtn();
  markSelectedPresets();
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

function updateBrushDefaultsUi() {
  defaultSize.value = String(settings.brushSize);
  defaultSizeValue.textContent = String(settings.brushSize);
  buildDefaultColorPresets();
}

function updateBrushPersistenceUi(mode: BrushPersistence) {
  settings.brushPersistence = mode;
  brushPersistDefault.checked = mode === "default";
  brushPersistRemember.checked = mode === "rememberLast";
  brushDefaults.classList.toggle("hidden", mode !== "default");
  if (mode === "default") {
    updateBrushDefaultsUi();
  }
  if (!settingsPanel.classList.contains("hidden")) {
    positionPanel(settingsPanel);
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

function updateAddPresetBtn() {
  const hex = normalizeHex(colorInput.value);
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
  if (target === "color") return colorHotkeyBtn;
  if (target === "shape") return shapeHotkeyBtn;
  return sizeHotkeyBtn;
}

function hotkeyLabel(target: HotkeyTarget): string {
  if (target === "activate") return settings.activateHotkey;
  if (target === "color") return settings.colorHotkey;
  if (target === "shape") return settings.shapeHotkey;
  return settings.sizeScrollHotkey;
}

function updateSizeScrollHotkeyUi(hotkey: string) {
  settings.sizeScrollHotkey = hotkey;
  sizeHotkeyBtn.textContent = hotkey;
  sizePreview.title = `Brush size (${hotkey} + scroll)`;
  settingsHint.textContent = `${hotkey} + scroll changes brush size. Click a hotkey button, then press a new shortcut. Esc cancels. Size change accepts modifier keys only.`;
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
    updateAddPresetBtn();
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
    );
    canvas.classList.add("opacity-slider");
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
    );
    canvas.classList.add("thickness-grip");
    return;
  }
  const handle = board.hitTestHandle(point);
  updateCanvasCursorClass(handle);
}

function isUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("#toolbar, #color-panel, #shape-panel, #settings-panel"),
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
    const wrap = document.createElement("div");
    wrap.className = "preset-wrap";

    const btn = createPresetButton(color, async (picked) => {
      updateColorUi(picked);
      updateSizeUi(board.getSize());
      await persist();
      colorPanel.classList.add("hidden");
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
    colorPresets.appendChild(wrap);
  }
  markSelectedPresets();
  updateAddPresetBtn();
}

function buildDefaultColorPresets() {
  defaultColorPresets.innerHTML = "";
  for (const color of settings.presetColors) {
    const btn = createPresetButton(color, async (picked) => {
      settings.color = picked;
      updateColorUi(picked);
      updateSizeUi(board.getSize());
      markSelectedPresets();
      await saveSettings(settings);
    });
    defaultColorPresets.appendChild(btn);
  }
  markSelectedPresets();
}

function rebuildPresetUi() {
  buildColorPresets();
  if (settings.brushPersistence === "default") {
    buildDefaultColorPresets();
  }
  if (!colorPanel.classList.contains("hidden")) {
    positionPanel(colorPanel);
  }
  if (!settingsPanel.classList.contains("hidden")) {
    positionPanel(settingsPanel);
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

function setupToolbarDrag() {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  dragHandle.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragHandle.setPointerCapture(e.pointerId);
    const rect = toolbar.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  dragHandle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${y}px`;
  });

  const endDrag = async (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      dragHandle.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const rect = toolbar.getBoundingClientRect();
    settings.toolbarX = rect.left;
    settings.toolbarY = rect.top;
    await persist();
  };

  dragHandle.addEventListener("pointerup", endDrag);
  dragHandle.addEventListener("pointercancel", endDrag);
}

function setupDrawing() {
  canvas.addEventListener("pointerdown", (e) => {
    if (!active || isUiTarget(e.target)) return;
    if (e.button !== 0) return;
    closePanels();
    board.pointerDown(e);
    markSelectedShapeOption();
    updateCanvasCursorClass();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!active) return;
    board.continueStroke(e);
    if (e.buttons === 0) {
      updateHoverCursor({ x: e.clientX, y: e.clientY });
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!active) return;
    board.endStroke(e);
    updateCanvasCursorClass();
  });

  canvas.addEventListener("pointercancel", () => {
    board.endStroke();
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

    if (matchesHotkey(e, settings.colorHotkey)) {
      e.preventDefault();
      toggleColorPanel();
      return;
    }

    if (matchesHotkey(e, settings.shapeHotkey)) {
      e.preventDefault();
      toggleShapePanel();
      return;
    }

    if (e.key === "Shift") {
      board.setShiftHeld(true);
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      board.setShiftHeld(false);
    }
  });

  window.addEventListener(
    "wheel",
    async (e) => {
      if (!active || !matchesSizeScrollHotkey(e, settings.sizeScrollHotkey)) {
        return;
      }
      e.preventDefault();
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
  updateBrushPersistenceUi(settings.brushPersistence);
  hotkeyBtn.textContent = settings.activateHotkey;
  colorHotkeyBtn.textContent = settings.colorHotkey;
  shapeHotkeyBtn.textContent = settings.shapeHotkey;
  updateSizeScrollHotkeyUi(settings.sizeScrollHotkey);
  markSelectedShapeOption();
  applyToolbarPosition();
  setupToolbarDrag();
  setupDrawing();
  setupHotkeys();

  try {
    await invoke("set_activate_hotkey", { hotkey: settings.activateHotkey });
  } catch (err) {
    console.warn("Could not register saved hotkey, using default", err);
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
    const kind = btn.dataset.shape as ShapeKind;
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

  addPresetBtn.addEventListener("click", async () => {
    await addPresetColor(colorInput.value);
  });

  settingsBtn.addEventListener("click", () => {
    colorPanel.classList.add("hidden");
    shapePanel.classList.add("hidden");
    settingsPanel.classList.toggle("hidden");
    if (!settingsPanel.classList.contains("hidden")) {
      updateBrushPersistenceUi(settings.brushPersistence);
      positionPanel(settingsPanel, settingsBtn);
    } else {
      stopHotkeyRecording();
    }
  });

  settingsClose.addEventListener("click", () => {
    closePanels();
  });

  hotkeyBtn.addEventListener("click", () => {
    startHotkeyRecording("activate");
  });

  colorHotkeyBtn.addEventListener("click", () => {
    startHotkeyRecording("color");
  });

  shapeHotkeyBtn.addEventListener("click", () => {
    startHotkeyRecording("shape");
  });

  sizeHotkeyBtn.addEventListener("click", () => {
    startHotkeyRecording("sizeScroll");
  });

  sizeSensitivity.addEventListener("input", async () => {
    updateSensitivityUi(Number(sizeSensitivity.value));
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
  });

  await listen("drawing-activated", async () => {
    await activate();
  });

  await listen("drawing-deactivated", () => {
    active = false;
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
