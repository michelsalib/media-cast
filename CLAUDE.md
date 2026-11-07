# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Electron + React + TS app that streams local video to Chromecast and UPnP/DLNA, with sidecar or embedded subtitles.

## Commands

Package manager and script runner is **bun** (`bun install`, lockfile `bun.lock`). Electron's own tooling (electron-vite, electron-builder) still executes on Node (`.nvmrc`); bun only drives the scripts. Dependency postinstalls are blocked by bun except its default-trusted list (electron and sharp are on it) — do not add `trustedDependencies`, it _replaces_ that list. A native dependency whose install script matters gets it redone by our own `postinstall` instead: [download-datachannel.mjs](scripts/download-datachannel.mjs) fetches node-datachannel's N-API prebuild (lipo'd universal on macOS). N-API bindings load in Electron unchanged, so there is no `@electron/rebuild` / `install-app-deps` (`npmRebuild: false`); electron-builder unpacks `.node` files from the asar by itself.

```bash
bun run dev               # electron-vite dev (HMR for main/preload/renderer)
bun check                 # typecheck, both projects (built-in; no typescript package)
bun fmt                   # format (built-in; .prettierrc.json, shared with the VS Code Prettier extension)
bun lint                  # runs the `lint` script: biome check (lint + import order); --write fixes
bun run prepare:binaries  # fetch static ffmpeg/ffprobe into resources/bin/<platform>-<arch>/
bun run build:{win,mac}  # runs bun check → electron-vite build → electron-builder
```

No tests. `build` aborts on typecheck failure. No `check`/`fmt`/`typecheck` scripts: a script with a built-in's name shadows it. Biome is only the linter (its formatter is off, see `biome.json`) until a stable bun ships `bun lint` (canary-only as of 1.4.4); then drop `@biomejs/biome` and the `lint` script. TS root is references-only; edit `tsconfig.node.json` (main+preload+scripts) or `tsconfig.web.json` (renderer). Electron 45 (Node 24; keep `@types/node` at most one major ahead): macOS 13+ and 64-bit Windows only.

## ffmpeg/ffprobe

Run `prepare:binaries` once before `dev` or any `build:*`. `resolveBundledBinary` in [src/main/ffmpeg.ts](src/main/ffmpeg.ts) looks under `resources/bin/<platform>-<arch>/` (dev: `app.getAppPath()/resources/bin`, packaged: `process.resourcesPath/bin` via `extraResources`); falls back to `PATH`. The app shells out to ffmpeg for probe, thumbnails, subtitle extract/convert, and MPEG-TS transcoding for UPnP.

## Architecture

Three processes communicating only via the IPC bridge in [src/preload/index.ts](src/preload/index.ts):

- **main** ([src/main/index.ts](src/main/index.ts)) — discovery, HTTP media server, ffmpeg, playback `Renderer` instances. The `BrowserWindow` runs with `sandbox: true`, so the preload may only `require('electron')` and must stay CommonJS (no `"type": "module"` in `package.json`).
- **preload** — a generic bridge exposed as `window.ipc` with exactly three members: `invoke(channel, ...args)`, `on(channel, cb) → unsubscribe`, `pathFor(file)`. No per-method code lives here; typing is done in the renderer.
- **renderer** ([src/renderer/src/](src/renderer/src/)) — React 19 + MUI 9 (Emotion `sx`, no Tailwind, no router, no store). Alias `@renderer` → `src/renderer/src`.

Shared types are in [src/shared/types.ts](src/shared/types.ts). The `Renderer` interface there (playback abstraction) is _not_ the Electron renderer process — same word, different meaning.

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

### Torrents ([torrents.ts](src/main/torrents.ts))

- `TorrentStore` (WebTorrent: TCP, uTP via `utp-native`, WebRTC via `node-datachannel` — see Commands for how its binding is installed) opens a magnet link or a `.torrent`/`.magnet` file and serves each video in it on `http://127.0.0.1:<port>/<infoHash>/<fileIndex>/<name>` with byte ranges. Torrents are added `deselect`ed, so only ranges being read are downloaded. The client is created on the first open (dynamic `import('webtorrent')`, ESM-only); check `client.get()` before `add()`, which destroys a duplicate with an error instead of returning it.
- That URL **is** the video path everywhere: ffmpeg/ffprobe read it directly; [videoSource.ts](src/main/videoSource.ts) covers the rest (`sourceName`/`sourceStem` decode the name, `sendVideo` proxies it for direct play in MediaServer/PreviewServer, movieHash range-fetches it). Use those helpers, not `basename`/`send`, on video paths.
- Every subtitle file in the torrent is offered, no matching to the video (`subtitlesOf`, `api.torrentSubtitles`). Each is listed with the local path under `.subtitles/` it is downloaded to only when picked (`fetchSubtitles`, `api.fetchTorrentSubtitles`) — subtitle paths must be local, and a pack can hold hundreds. A lone one is auto-picked. While playing they are `PlayingTracks.files`, switched with `file:<i>`.
- [SubtitleChoices](src/renderer/src/components/SubtitleChoices.tsx) draws subtitle choices for both the ready view and `TrackSwitcher`: chips up to 12, then a searchable grouped list.
- Pieces live in `temp/media-cast-torrents/`, wiped at startup and quit. `openTorrent` drops every other torrent except the playing one and the renderer's current pick. Stats are pushed as `torrents` every second.

### Phone remote ([src/main/remote/](src/main/remote/))

- [RemoteServer](src/main/remote/RemoteServer.ts) listens on the LAN (port 4005, ephemeral fallback) only while enabled, everything under `/r/<token>/`. `userData/remote.json` holds `{ enabled, token }`; off by default; "New link" rotates the token and drops connected phones. The desktop side is [RemoteButton](src/renderer/src/components/RemoteButton.tsx) in the "Play on" header (Connector, `compact`) and the Player's control bar (switch + QR, generated by `qrcode` in main), so a phone can pair before any TV or video is picked.
- Its API is a separate, smaller map: [createRemoteApi](src/main/remote/api.ts) → `POST api/<key>` with a JSON array of args. Every call acts on the video already playing (`PlaybackController.nowPlaying`) or on the one the window has ready (`launch`, `pickReadyTracks`, named by the id `state` gave so never one picked since); none takes a path — keep it that way, the token is the only credential. Pushes are relayed as SSE (`events`) by `tapEvents` in `api.ts`; `nowPlaying` is relayed without its payload (local paths).
- The page is a second Vite input, [remote.html](src/renderer/remote.html) → [src/renderer/src/remote/](src/renderer/src/remote/) (own `client.ts`, no `window.ipc`; reuses `theme.ts`, `labels.ts`, `TorrentChip`). Packaged: served from `out/renderer` (relative `./assets/` URLs); dev: proxied to the Vite server.
- The window reports what it has ready (`api.setRemoteContext`: video, title, details, its `TrackList`, picked screen) to [RemoteHub](src/main/remote/RemoteHub.ts); the phone shows it with the screens (`ReadyCard`, with the same `TrackSwitcher` and size as while playing). A phone Play becomes a `remoteLaunch` push that the window runs through its own `play(target)` (same subtitles/audio/burn-in, same connection state); a phone track pick a `remoteTracks` push applied to the window's own selection. Both carry the video path main saw, refused if the window moved on, and are answered with `api.remoteDone`. Choosing the video, adding subtitle files and searching online stay on the computer.
- The window's picks for the video ready live in [useTrackSelection](src/renderer/src/components/useTrackSelection.ts) (Dropper probes once and passes the result; `AudioSelector`/`SubtitlesSelector` only draw): defaults per video unless picked by hand, torrent subtitle downloads guarded by a pick counter, phone picks via `applyChange`. [describeTracks](src/shared/tracks.ts) builds the `TrackList` for both the video ready and the one playing (`PlaybackController.tracks()`).
- No lock-screen / Media Session notification: a page only gets one while playing audio itself, and the looping silent clip that faked it was flaky across browsers (no notification until a tap, Edge pausing the clip on app switch → TV paused) and took the phone's audio focus. Removed; don't bring it back.
- No volume control: an LG with its sound on an HDMI ARC soundbar answers RenderingControl with a fixed 0, and DLNA has no relative volume up/down.
- While playing, the window and the phone have the same controls, both backed by `PlaybackController`: `tracks()` / `changeTracks()` (switch audio or subtitles), `cues()`, `retime(offset)` (a total from the original timing, always retimed from the original; 0 restores it; cues come back at the original timing and `tracks().subtitleOffset` is what is applied) and `setSubtitleScale()`. Every change except size reloads at the current position (`reloadAt`: load, wait for PLAYING, seek back). The UI is shared too: [TrackSwitcher](src/renderer/src/components/TrackSwitcher.tsx) and [LiveSubtitles](src/renderer/src/components/LiveSubtitles.tsx), in the player's "Audio & subtitles" dialog ([PlayingOptionsButton](src/renderer/src/components/PlayingOptionsButton.tsx)) and on the phone. The window picks up a retimed sidecar from the `nowPlaying` push.
- Subtitle size (`SUBTITLE_SCALES`, `userData/subtitle-size.json`): Chromecast restyles live (`EDIT_TRACKS_INFO` fontScale); burned-in text is scaled by libass `force_style='ScaleX=f,ScaleY=f'` (a factor, not a percent: overrides skip libass's /100) and applied with a seek, which starts a new encoder. A TV drawing a sidecar, or image subtitles, keep their size (`NowPlaying.resizableSubtitles`). Stop goes through the window (`remoteStop`), which owns the connection state. The phone preview proxies `PreviewServer` (one preview at a time, shared with the sync dialog).

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

- [App.tsx](src/renderer/src/App.tsx) — owns the `Connection` (`{ device, state: CONNECTING | CONNECTED | DISCONNECTED }`) and `connect`/`stop`; draws the title bar over `<Dropper>`. Stop is `api.disconnect()` (there is no stop call) but the device stays picked, so Play reconnects to it. Also owns appearance: the OS accent colour and the light/dark/system choice ([SettingsMenu](src/renderer/src/components/SettingsMenu.tsx), the title bar's gear menu, which also holds the about box).

### Theme

- [theme.ts](src/renderer/src/theme.ts) `makeTheme(mode, accent)` derives Material-style tonal roles (`theme.palette.tonal.*`: `primaryContainer`, `surfaceContainer`, `onSurfaceVariant`…) from one accent colour in OKLCH, so any accent gets readable light and dark palettes. Use the roles (`bgcolor: 'tonal.surfaceContainer'`) or `cardSx`/`chipSx`/`tonalSx`; never hard-code colours, both modes must work. Figtree is bundled via `@fontsource/figtree` (the CSP blocks font CDNs).
- Main side is [appearance.ts](src/main/appearance.ts): accent from `systemPreferences.getAccentColor()` (Windows/macOS; Linux falls back to `DEFAULT_ACCENT`), pushed again on Windows' `accent-color-changed`. The theme choice is persisted in `userData/appearance.json` and applied as `nativeTheme.themeSource`, which is what flips the renderer's `prefers-color-scheme`. The renderer sends its surface colour back via `setTitleBarColors` so the Windows caption buttons match.
- Driving the app with Playwright: call `page.emulateMedia({ colorScheme: null })` first, or its default light emulation masks `nativeTheme`. Launching Electron from a VS Code-spawned shell also needs `ELECTRON_RUN_AS_NODE` unset.
- [Connector.tsx](src/renderer/src/components/Connector.tsx) — the device tiles. Subscribes `onEvent('scan')` and triggers an initial `refresh` on mount; a click calls App's `connect`. Keeps the picked device listed when a scan drops it.
- [Dropper.tsx](src/renderer/src/components/Dropper.tsx) — the whole window below the title bar: views `empty` / `ready` / `playing`, the blurred-thumbnail backdrop, drag-and-drop ingestion, and subscribes `onEvent('status')`. Discriminator is filename suffix: `.mp4`/`.mkv`/`.avi` → video, `.torrent`/`.magnet` → `api.openTorrent` (also a pasted or dragged `magnet:` link; several videos → `TorrentPicker`), `.srt`/`.vtt`/`.ass`/`.ssa` → subs, anything else is rejected with a message. The picked video is a `VideoSource` (`{ name, path, infoHash? }`), not a `File`. AVI is UPnP-only (direct play if the Sink lists it, else transcode); a Chromecast load of an AVI throws. Thumbnail regenerated per video via `api.thumbnail`; the heading comes from `api.guessSubtitleQuery` (release-name parse), with the file name in Details.
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
