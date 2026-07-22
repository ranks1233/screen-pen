# Screen Pen

Lightweight on-screen drawing for Windows (Tauri), inspired by Epic Pen — fewer features, faster to use.

## Features

- Global hotkey to enter drawing mode (default: `Ctrl+Alt+D`)
- Fully clear fullscreen canvas (desktop stays visible underneath)
- Small movable toolbar (position saved across restarts)
- Color picker + settings
- Instant line smoothing when you release the mouse
- `Ctrl+Z` undo (repeatable)
- Hold `Shift` to snap strokes to 0° / 45° / 90° / …
- `Alt` + scroll to change brush size (size preview next to toolbar)
- `Esc` exits and clears everything

## Install

Build the Windows installer, then run it:

```bash
npm install
npm run build:app
```

Artifacts are copied to `releases/`:

- `Screen Pen_*_x64-setup.exe` — NSIS installer (double-click to install)
- `screen-pen.exe` — portable binary (run without installing)

After install, the app lives in the system tray. Use the hotkey (or left-click the tray icon) to start drawing.

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Raw build output still lands under `src-tauri/target/release/`. Prefer `npm run build:app` when you want installers in `releases/`.
