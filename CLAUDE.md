# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Electron + React + TS app that streams local video to Chromecast and UPnP/DLNA, with sidecar or embedded subtitles.

## Commands

```bash
npm run dev               # electron-vite dev (HMR for main/preload/renderer)
npm run typecheck         # both projects; uses tsgo (@typescript/native-preview), NOT tsc
npm run check             # biome lint + format --write
npm run prepare:binaries  # fetch static ffmpeg/ffprobe into resources/bin/<platform>-<arch>/
npm run build:{win,mac,linux}  # runs typecheck → electron-vite build → electron-builder
```

No tests. `build` aborts on typecheck failure. Biome (not ESLint/Prettier) — see `biome.json`. TS root is references-only; edit `tsconfig.node.json` (main+preload+scripts) or `tsconfig.web.json` (renderer).

## ffmpeg/ffprobe

Run `prepare:binaries` once before `dev` or any `build:*`. `resolveBundledBinary` in [src/main/ffmpeg.ts](src/main/ffmpeg.ts) looks under `resources/bin/<platform>-<arch>/` (dev: `app.getAppPath()/resources/bin`, packaged: `process.resourcesPath/bin` via `extraResources`); falls back to `PATH`. The app shells out to ffmpeg for probe, thumbnails, subtitle extract/convert, and MPEG-TS transcoding for UPnP.

## Architecture

Three processes communicating only via the IPC bridge in [src/preload/index.ts](src/preload/index.ts):

- **main** ([src/main/index.ts](src/main/index.ts)) — discovery, HTTP media server, ffmpeg, playback `Renderer` instances.
- **preload** — wraps every IPC channel as `window.api.<method>`; type augmented onto `Window` by [src/preload/index.d.ts](src/preload/index.d.ts) (picked up by `tsconfig.web.json`).
- **renderer** ([src/renderer/src/](src/renderer/src/)) — React 19 + MUI 9 (Emotion `sx`, no Tailwind, no router, no store). Alias `@renderer` → `src/renderer/src`.

Shared types are in [src/shared/types.ts](src/shared/types.ts). The `Renderer` interface there (playback abstraction) is *not* the Electron renderer process — same word, different meaning.

### Playback: `Renderer` interface

Main holds at most one active `Renderer`. On `connect` it `.close()`s any prior one then instantiates the new one and wires `onStatus` → `status` IPC channel.

- **[CastPlayer](src/main/chromecast/Player.ts)** (`castv2-client`) — direct stream + sidecar WebVTT subs.
- **[UpnpPlayer](src/main/upnp/Player.ts)** — hand-rolled DLNA: SOAP control + GENA event subscription. Transport plumbing in `src/main/upnp/` (`soap.ts`, `eventing.ts`, `ssdp.ts`, `description.ts`, `xml.ts`). On `close`, `Stop` alone leaves the URI loaded on most renderers — also `SetAVTransportURI` with empty `CurrentURI` to unload.

### Discovery

Two scanners merge into one `knownDevices` map in `index.ts`:

- [ChromecastDevicesScanner](src/main/chromecast/DevicesScanner.ts) — mDNS `_googlecast._tcp` via `bonjour-service`.
- [UpnpDevicesScanner](src/main/upnp/DevicesScanner.ts) — SSDP M-SEARCH every 10s, evict past cache-control TTL.

### [MediaServer](src/main/MediaServer.ts)

Each session uses a fresh UUID URL prefix so old TVs don't cache prior content. Two modes per session:

- Direct (Chromecast) — `send` package, byte-range capable.
- Transcoded (UPnP) — pipes `ffmpeg` MPEG-TS output. `BurnSubtitles` option burns subs into the video stream (most DLNA TVs don't honor sidecar subs).

[pickLocalIpFor](src/main/network.ts) selects the LAN interface on the target's subnet — required for correct URLs on multi-homed hosts (VPN, WSL, virtual adapters).

### Subtitles ([subtitleExtractor.ts](src/main/subtitleExtractor.ts))

- ffmpeg has no SMI muxer → request SRT then convert in JS (`srtToSmi`).
- Old DLNA TVs (Samsung) reject UTF-8 SRT → re-encode Latin-1.
- Internal tracks by stream index, external by path.

`load` handler branching: UPnP → burn-in; Chromecast → sidecar WebVTT.

### Renderer UI

State is flat — `useState` only, ownership by component:

- [App.tsx](src/renderer/src/App.tsx) — `connectedDevice`; toggles `<Connector>` vs `<Player>`. Theme defined inline here.
- [Connector.tsx](src/renderer/src/components/Connector.tsx) — subscribes `onScan` and triggers an initial `refresh` on mount; owns `DISCONNECTED → LOADING → CONNECTED`.
- [Player.tsx](src/renderer/src/components/Player.tsx) — subscribes `onStatus`. The 1s ticker that drives between player-side status events lives in [PlaybackController](src/main/PlaybackController.ts), not the renderer.
- [Dropper.tsx](src/renderer/src/components/Dropper.tsx) — drag-and-drop ingestion. Discriminator is filename suffix: `.mp4`/`.mkv` → video, anything else → subs. Thumbnail regenerated per video via `window.api.thumbnail`.

[SubtitlesSelection.ts](src/renderer/src/components/SubtitlesSelection.ts) is a 3-arm union (`internal` / `external` / `no subtitles`); [SubtitlesSelector.tsx](src/renderer/src/components/SubtitlesSelector.tsx) builds choices from `window.api.probe` + the optional sidecar, auto-selects `external > internal > none`. Dropper maps it to the `load` IPC's `subtitlesPathOrIndex` (string | number | undefined) — that's what main keys on for burn-in vs sidecar.

Cross-process type imports (e.g. `import type { FFProbeData } from '../../../main/ffmpeg'`) are intentional but **must stay `import type`** — main-process runtime code would break the renderer bundle. `File` objects can't cross IPC; preload calls `webUtils.getPathForFile()` to extract OS paths before sending.

## IPC channels

Single contract in [src/shared/api.ts](src/shared/api.ts) — three interfaces `InvokeChannels`, `SendChannels`, `EventChannels` plus matching `*_CHANNELS` const arrays. Drift between main and preload becomes a compile error.

- `InvokeChannels` (renderer → main, awaited): `probe`, `appInfo`, `thumbnail`, `connect`, `disconnect`, `load`
- `SendChannels` (renderer → main, fire-and-forget): `play`, `pause`, `seek`, `refresh`
- `EventChannels` (main → renderer broadcasts): `status`, `scan`

[src/preload/index.ts](src/preload/index.ts) auto-derives bindings from the contract via `makeInvoke`/`makeSend`/`makeOn`, then overrides `load`/`probe`/`thumbnail` with `File`-accepting wrappers that call `webUtils.getPathForFile()` before crossing IPC.

[src/main/index.ts](src/main/index.ts) registers handlers through `registerInvokeHandlers`/`registerSendHandlers` from [src/main/ipc.ts](src/main/ipc.ts) — the handler maps are typed against `InvokeHandlers`/`SendHandlers`, so a missing or mis-typed handler fails to compile. Broadcasts use `sendEvent(window, channel, payload)` for typed pushes.

Most playback logic lives in [src/main/PlaybackController.ts](src/main/PlaybackController.ts) — `index.ts` is wiring. The controller owns the active `Renderer`, the 1s status tick, and the device-type branching in `load`.

Adding a channel: add to the contract → handler in main and preload wrapper become compile errors until implemented. Renderer gets the new method typed on `window.api` automatically.
