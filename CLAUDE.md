# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Electron + React + TS app that streams local video to Chromecast and UPnP/DLNA, with sidecar or embedded subtitles.

## Commands

Package manager and script runner is **bun** (`bun install`, lockfile `bun.lock`). Electron's own tooling (electron-vite, electron-builder) still executes on Node (`.nvmrc`); bun only drives the scripts. Dependency postinstalls are blocked by bun except its default-trusted list (electron and sharp are on it) — do not add `trustedDependencies`, it *replaces* that list.

```bash
bun run dev               # electron-vite dev (HMR for main/preload/renderer)
bun run typecheck         # both projects; TypeScript 7 native `tsc`
bun run check             # biome lint + format --write
bun run prepare:binaries  # fetch static ffmpeg/ffprobe into resources/bin/<platform>-<arch>/
bun run build:{win,mac,linux}  # runs typecheck → electron-vite build → electron-builder
```

No tests. `build` aborts on typecheck failure. Biome (not ESLint/Prettier) — see `biome.json`. TS root is references-only; edit `tsconfig.node.json` (main+preload+scripts) or `tsconfig.web.json` (renderer). Electron 44+: macOS 13+ and 64-bit Windows only.

## ffmpeg/ffprobe

Run `prepare:binaries` once before `dev` or any `build:*`. `resolveBundledBinary` in [src/main/ffmpeg.ts](src/main/ffmpeg.ts) looks under `resources/bin/<platform>-<arch>/` (dev: `app.getAppPath()/resources/bin`, packaged: `process.resourcesPath/bin` via `extraResources`); falls back to `PATH`. The app shells out to ffmpeg for probe, thumbnails, subtitle extract/convert, and MPEG-TS transcoding for UPnP.

## Architecture

Three processes communicating only via the IPC bridge in [src/preload/index.ts](src/preload/index.ts):

- **main** ([src/main/index.ts](src/main/index.ts)) — discovery, HTTP media server, ffmpeg, playback `Renderer` instances. The `BrowserWindow` runs with `sandbox: true`, so the preload may only `require('electron')` and must stay CommonJS (no `"type": "module"` in `package.json`).
- **preload** — a generic bridge exposed as `window.ipc` with exactly three members: `invoke(channel, ...args)`, `on(channel, cb) → unsubscribe`, `pathFor(file)`. No per-method code lives here; typing is done in the renderer.
- **renderer** ([src/renderer/src/](src/renderer/src/)) — React 19 + MUI 9 (Emotion `sx`, no Tailwind, no router, no store). Alias `@renderer` → `src/renderer/src`.

Shared types are in [src/shared/types.ts](src/shared/types.ts). The `Renderer` interface there (playback abstraction) is *not* the Electron renderer process — same word, different meaning.

### Playback: `Renderer` interface

Main holds at most one active `Renderer`. On `connect` it `.close()`s any prior one then instantiates the new one and wires `onStatus` → `status` push.

- **[CastPlayer](src/main/chromecast/Player.ts)** (`castv2-client`) — direct stream + sidecar WebVTT subs.
- **[UpnpPlayer](src/main/upnp/Player.ts)** — hand-rolled DLNA: SOAP control + GENA event subscription. Transport plumbing in `src/main/upnp/` (`soap.ts`, `eventing.ts`, `ssdp.ts`, `description.ts`, `xml.ts`). On `close`, `Stop` alone leaves the URI loaded on most renderers — also `SetAVTransportURI` with empty `CurrentURI` to unload.

### Discovery

Two scanners merge into one `knownDevices` map in `index.ts`:

- [ChromecastDevicesScanner](src/main/chromecast/DevicesScanner.ts) — mDNS `_googlecast._tcp` via `bonjour-service`.
- [UpnpDevicesScanner](src/main/upnp/DevicesScanner.ts) — SSDP M-SEARCH every 10s, evict past cache-control TTL.

### [MediaServer](src/main/MediaServer.ts)

Each `load` calls `startSession()` for a fresh UUID URL prefix — a reused URI makes TVs (LG) reuse the previous file's cached state. It rotates right before serving, after probe/extract, so the TV can keep reading the old file until then. Two modes per session:

- Direct (Chromecast, and UPnP when `checkCompat` allows) — `send` package, byte-range capable.
- Transcoded (UPnP) — pipes `ffmpeg` MPEG-TS output. `BurnSubtitles` option burns subs into the video stream (most DLNA TVs don't honor sidecar subs). One encoder at a time: a new GET kills the previous one. Output capped at 1080p.

DLNA `protocolInfo` / `contentFeatures.dlna.org` values live in [upnp/dlna.ts](src/main/upnp/dlna.ts) — DIDL and HTTP headers must agree. Never set FLAGS bits 31/27/26 (live-stream semantics).

[pickLocalIpFor](src/main/network.ts) selects the LAN interface on the target's subnet — required for correct URLs on multi-homed hosts (VPN, WSL, virtual adapters).

### Subtitles ([subtitleExtractor.ts](src/main/subtitleExtractor.ts))

- ffmpeg has no SMI muxer → request SRT then convert in JS (`srtToSmi`).
- Text subtitles that aren't valid UTF-8 are treated as Windows-1252: decoded in JS for SMI/VTT, `-sub_charenc`/`charenc=CP1252` for ffmpeg. Everything is served as UTF-8.
- Internal tracks by stream index, external by path.

`load` handler branching: UPnP → burn-in; Chromecast → sidecar WebVTT.

### Online subtitle search ([src/main/subtitles/](src/main/subtitles/))

- Providers behind `SubtitleProvider` ([provider.ts](src/main/subtitles/provider.ts)): OpenSubtitles.com (REST v1, moviehash + title; optional login for download quota), Subdl (API key; zips unpacked with `fflate`, `.rar` results dropped), Gestdown (keyless Addic7ed proxy, TV only). Missing keys throw `ProviderSkipped` → shown as notices, not errors. Podnapisi was left out (unreachable / unreliable).
- Release builds ship without API keys: users type their own in settings. `MAIN_VITE_OPENSUBTITLES_API_KEY` / `MAIN_VITE_SUBDL_API_KEY` can still be baked in at build time (gitignored `.env.local` in dev only; CI doesn't set them), and a key typed in settings overrides them. Settings live in `userData/subtitle-settings.json`, password via `safeStorage`.
- Downloads and resyncs go to `userData/subtitle-cache/` and come back as a path; the renderer treats them as a dropped sidecar (`SubtitlesSelection` external is path-based).
- Sync preview: [PreviewServer](src/main/PreviewServer.ts) on `127.0.0.1` (CSP `media-src` allows it) serves the file directly when Chromium can play it, else `transcodePreview` (720p fMP4, always re-encoded so `-ss` is frame-accurate; the renderer restarts the stream with `?t=` per seek). Cues are drawn by the renderer, so retiming is live; `retimeSubtitles` writes `t·ratio + offset` to a new SRT.

### Renderer UI

State is flat — `useState` only, ownership by component:

- [App.tsx](src/renderer/src/App.tsx) — owns the `Connection` (`{ device, state: CONNECTING | CONNECTED | DISCONNECTED }`) and `connect`/`stop`; draws the title bar over `<Dropper>`. Stop is `api.disconnect()` (there is no stop call) but the device stays picked, so Play reconnects to it. Also owns appearance: the OS accent colour and the light/dark/system choice ([ThemeButton](src/renderer/src/components/ThemeButton.tsx) in the title bar).

### Theme

- [theme.ts](src/renderer/src/theme.ts) `makeTheme(mode, accent)` derives Material-style tonal roles (`theme.palette.tonal.*`: `primaryContainer`, `surfaceContainer`, `onSurfaceVariant`…) from one accent colour in OKLCH, so any accent gets readable light and dark palettes. Use the roles (`bgcolor: 'tonal.surfaceContainer'`) or `cardSx`/`chipSx`/`tonalSx`; never hard-code colours, both modes must work. Figtree is bundled via `@fontsource/figtree` (the CSP blocks font CDNs).
- Main side is [appearance.ts](src/main/appearance.ts): accent from `systemPreferences.getAccentColor()` (Windows/macOS; Linux falls back to `DEFAULT_ACCENT`), pushed again on Windows' `accent-color-changed`. The theme choice is persisted in `userData/appearance.json` and applied as `nativeTheme.themeSource`, which is what flips the renderer's `prefers-color-scheme`. The renderer sends its surface colour back via `setTitleBarColors` so the Windows caption buttons match.
- Driving the app with Playwright: call `page.emulateMedia({ colorScheme: null })` first, or its default light emulation masks `nativeTheme`. Launching Electron from a VS Code-spawned shell also needs `ELECTRON_RUN_AS_NODE` unset.
- [Connector.tsx](src/renderer/src/components/Connector.tsx) — the device tiles. Subscribes `onEvent('scan')` and triggers an initial `refresh` on mount; a click calls App's `connect`. Keeps the picked device listed when a scan drops it.
- [Dropper.tsx](src/renderer/src/components/Dropper.tsx) — the whole window below the title bar: views `empty` / `ready` / `playing`, the blurred-thumbnail backdrop, drag-and-drop ingestion, and subscribes `onEvent('status')`. Discriminator is filename suffix: `.mp4`/`.mkv`/`.avi` → video, `.srt`/`.vtt`/`.ass`/`.ssa` → subs, anything else is rejected with a message. AVI is UPnP-only (direct play if the Sink lists it, else transcode); a Chromecast load of an AVI throws. Thumbnail regenerated per video via `api.thumbnail`; the heading comes from `api.guessSubtitleQuery` (release-name parse), with the file name in Details.
- [Player.tsx](src/renderer/src/components/Player.tsx) — the now-playing view, props only. The 1s ticker that drives between player-side status events lives in [PlaybackController](src/main/PlaybackController.ts), not the renderer.

Labels shown to users are plain words ([labels.ts](src/renderer/src/labels.ts): language names, "5.1", "Full HD", "52 min"); codecs, containers and IPs stay in `VideoInfoButton`, the compat tooltip and tile hover titles.

[SubtitlesSelection.ts](src/renderer/src/components/SubtitlesSelection.ts) is a 3-arm union (`internal` / `external` / `no subtitles`); [SubtitlesSelector.tsx](src/renderer/src/components/SubtitlesSelector.tsx) builds choices from `api.probe` + the optional sidecar, auto-selects `external > internal > none`. Dropper maps it to the `load` call's `subtitlesPathOrIndex` (string | number | undefined) — that's what main keys on for burn-in vs sidecar.

Cross-process type imports (e.g. `import type { FFProbeData } from '../../../main/ffmpeg'`, `import type { MainApi } from '../../main/api'`) are intentional but **must stay `import type`** — main-process runtime code would break the renderer bundle. `File` objects can't cross IPC; the renderer calls `pathFor(file)` (preload's `webUtils.getPathForFile`) and sends the OS path.

## IPC

There is no channel list. The contract is the **handler map** returned by `createMainApi` in [src/main/api.ts](src/main/api.ts); its type `MainApi` is `ReturnType<typeof createMainApi>`.

- **main** — `registerMainApi(api)` loops `ipcMain.handle` over the map, once, inside `whenReady`. Main → renderer pushes go through `sendEvent(window, channel, payload)`, typed by the small hand-written `MainEvents` interface in [src/shared/types.ts](src/shared/types.ts) (`status`, `scan`, `updateReady`, `accentColor`).
- **preload** — generic `window.ipc` bridge (see Architecture). Never add per-method code here.
- **renderer** — [src/renderer/src/ipc.ts](src/renderer/src/ipc.ts) exports `api` (a `Proxy` typed as `MainApi` with returns promisified and `Buffer` → `Uint8Array`), `onEvent(channel, cb) → unsubscribe`, and `pathFor(file)`. Fire-and-forget calls are written `void api.play()`.

Adding a method: add a key to the object in `createMainApi`. The renderer's `api.<key>` is typed immediately; nothing else to touch. Adding a push: add a key to `MainEvents`, then `sendEvent` / `onEvent` are typed.

Rules: params and returns must survive structured clone (plain objects, strings, numbers, `Uint8Array`); errors cross as `message` only; never `await api`, spread it or log it (every property read is a call).
