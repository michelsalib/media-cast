# media-cast

Stream local video files from your computer to a TV — no setup on the TV side, no media library to configure, no account to create. Just drop a file in and play.

Works with **Chromecast** and **UPnP/DLNA** devices on your local network.

## Features

- Zero TV-side setup — discovers Chromecast and DLNA renderers automatically on your LAN
- External (`.srt`, `.smi`, …) and embedded subtitle tracks, with on-the-fly conversion
- Subtitle burn-in for older DLNA TVs that ignore sidecar subs
- MPEG-TS transcoding for renderers that can't play your source format directly
- Drag-and-drop interface — drop the video, drop the subs, hit play
- Bundled `ffmpeg` / `ffprobe` — nothing else to install

## Download

Grab the latest installer for your OS from the [Releases page](https://github.com/michelsalib/media-cast/releases/latest):

- **Windows** — `.exe` installer
- **macOS** — `.dmg` (universal, Intel + Apple Silicon)
- **Linux** — `.AppImage`

Auto-updates are built in, so once installed you'll be notified about new versions.

## How it works

1. Launch the app — it scans your network for compatible devices.
2. Pick a TV / speaker / Chromecast from the list.
3. Drop a video file (and optionally a subtitle file) onto the player.
4. Press play.

## Building from source

Requires Node.js 24+.

```bash
npm install
npm run prepare:binaries   # fetch static ffmpeg/ffprobe into resources/bin/
npm run dev                # electron-vite dev with HMR
```

To produce installers:

```bash
npm run build:win     # Windows
npm run build:mac     # macOS (universal)
npm run build:linux   # Linux
```

Tooling: [electron-vite](https://electron-vite.org/), [Biome](https://biomejs.dev/) for lint+format, [tsgo](https://github.com/microsoft/typescript-go) for typecheck. See [CLAUDE.md](CLAUDE.md) for an architecture overview.
