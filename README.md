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

## Develop

```bash
cd D:\screen-pen
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

App lives in the system tray. Use the hotkey (or left-click the tray icon) to start drawing.
