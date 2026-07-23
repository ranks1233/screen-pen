# Screen Pen

Lightweight on-screen drawing for Windows (Tauri).

## Download & Install (Windows)

1. Open the latest **[Release](https://github.com/ranks1233/screen-pen/releases/latest)**
2. Download **`Screen Pen_*_x64-setup.exe`**
3. Double-click the file and follow the installer prompts
4. Find **Screen Pen** in the system tray (near the clock)

Use the hotkey (default `Ctrl+Alt+D`) or left-click the tray icon to start drawing. Press `Esc` to exit drawing mode.

> Do not use the green **Code → Download ZIP** button — that is source code only, not an installer.

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
npm install
npm run tauri dev
```

## Build locally

```bash
npm install
npm run build:app
```

This creates:

- `releases/Screen Pen_*_x64-setup.exe` — NSIS installer
- `releases/screen-pen.exe` — portable binary

To publish a new GitHub Release for colleagues, bump the version in `package.json` and `src-tauri/tauri.conf.json`, then:

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions builds the installer and attaches it to the release.
