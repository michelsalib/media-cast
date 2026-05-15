# Bundled ffmpeg / ffprobe binaries

`npm run prepare:binaries` downloads the right pair for the current platform
into the directory below. CI runs the same script before each build. You only
need to drop binaries here by hand if you want a specific build the script
doesn't fetch (e.g. native macOS arm64 — see "Manual" section).

The app expects platform-specific binaries in subdirectories named
`<platform>-<arch>` (matching Node's `process.platform` / `process.arch`).

```
resources/bin/
├── win32-x64/        ffmpeg.exe   ffprobe.exe
├── darwin-x64/       ffmpeg       ffprobe
├── darwin-arm64/     ffmpeg       ffprobe
└── linux-x64/        ffmpeg       ffprobe
```

## Automatic (preferred)

`npm run prepare:binaries` — Node script at `scripts/download-ffmpeg.mjs`.
Idempotent (skips if both binaries already exist).

Sources it uses:

| Platform | Source |
|---|---|
| `win32-x64` | <https://github.com/GyanD/codexffmpeg/releases/latest> (release-essentials) |
| `darwin-*` | <https://evermeet.cx/ffmpeg/> (x86_64 only; runs under Rosetta on arm64) |
| `linux-x64` | <https://johnvansickle.com/ffmpeg/> (release static) |

## Manual

Binaries are gitignored. If the automatic script doesn't cover your platform
(e.g. native macOS arm64), drop `ffmpeg` and `ffprobe` into the matching
`<platform>-<arch>/` folder yourself. The app picks them up automatically;
if none are found it falls back to whatever's on PATH.

In packaged builds, electron-builder copies this folder to `<app>/resources/bin/`
via the `extraResources` rule in `electron-builder.yml`.
