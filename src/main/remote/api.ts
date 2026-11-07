import type { BrowserWindow } from 'electron';
import {
  resultKey,
  type SubtitleQuery,
  type SubtitleSearchResponse,
  type SubtitleSearchResult,
  type SubtitleTiming,
} from '../../shared/subtitleSearch';
import type { Device, DevicesScanner, PlayerStatus, TrackChange } from '../../shared/types';
import { sendEvent } from '../api';
import { appearance } from '../appearance';
import { type FFProbeData, probe } from '../ffmpeg';
import type { PlaybackController } from '../PlaybackController';
import type { PreviewServer } from '../PreviewServer';
import { parseReleaseName } from '../subtitles/releaseName';
import {
  downloadSubtitle,
  retimeSubtitles,
  searchSubtitles,
  subtitleCues,
} from '../subtitles/search';
import { subtitleSettingsView } from '../subtitles/settings';
import { torrentOf } from '../torrents';
import { sourceName } from '../videoSource';
import type { RemoteHub } from './RemoteHub';

export interface RemoteApiDeps {
  window: BrowserWindow;
  controller: PlaybackController;
  preview: PreviewServer;
  hub: RemoteHub;
  devices: () => Device[];
  scanners: readonly DevicesScanner[];
}

// Which video a call is about: the one the window has ready (by the id `state` gave), or
// null for the one playing.
type Target = string | null;

// What a phone may do, and nothing else: every call acts on the video already playing
// or the one the window has ready (named by the id `state` gave, so never one picked
// since), never on a path the phone sends (a magnet link is the one string it can give,
// opened by the window like a paste); each key is a POST /r/<token>/api/<key> with a JSON
// array of args; the phone client (src/renderer/src/remote/client.ts) is typed from
// `RemoteApi`.
export function createRemoteApi({
  window,
  controller,
  preview,
  hub,
  devices,
  scanners,
}: RemoteApiDeps) {
  const playing = () => {
    const now = controller.nowPlaying;
    if (!now) throw new Error('Nothing is playing');
    return now;
  };
  // The video ready, unless it's the one playing (the phone is shown the player instead).
  const ready = () => {
    const prepared = hub.current.prepared;
    return prepared && prepared.videoPath !== controller.nowPlaying?.videoPath
      ? prepared
      : undefined;
  };
  const checkReady = (preparedId: unknown) => {
    const prepared = ready();
    if (!prepared) throw new Error('Nothing is ready on the computer');
    hub.checkPrepared(String(preparedId));
    return prepared;
  };
  const videoOf = (target: Target): string =>
    target === null ? playing().videoPath : checkReady(target).videoPath;
  // The results of the last online search: a download names one of them, so main only
  // fetches what a provider listed (a `ref` can be a URL).
  let searched = new Map<string, SubtitleSearchResult>();

  // Paths relative to the page; the server proxies them to the preview server.
  const previewUrls = async (videoPath: string, audioIndex?: number) => {
    const source = await preview.start(videoPath, audioIndex);
    return {
      directUrl: source.directUrl ? 'preview/video' : undefined,
      transcodeUrl: 'preview/preview.mp4',
      duration: source.duration,
    };
  };

  return {
    state: () => {
      const now = controller.nowPlaying;
      const prepared = ready();
      const { torrentChoice, openingTorrent, deviceId } = hub.current;
      return {
        accentColor: appearance().accentColor,
        status: (controller.status ?? null) as PlayerStatus | null,
        position: controller.position(),
        nowPlaying: now
          ? {
              fileName: sourceName(now.videoPath),
              release: parseReleaseName(now.videoPath),
              deviceName: now.deviceName,
              infoHash: torrentOf(now.videoPath),
              hasSubtitles: now.subtitlesPathOrIndex !== undefined,
              resizableSubtitles: now.resizableSubtitles,
            }
          : null,
        prepared: prepared
          ? {
              id: hub.currentPreparedId ?? '',
              title: prepared.title,
              details: prepared.details,
              tracks: prepared.tracks,
              infoHash: torrentOf(prepared.videoPath),
              compat: prepared.compat,
              // Text subtitles picked: they can be retimed.
              retimable:
                prepared.subtitles !== undefined &&
                !(
                  typeof prepared.subtitles === 'number' &&
                  prepared.tracks?.subtitles[prepared.subtitles]?.bitmap
                ),
            }
          : null,
        torrentChoice,
        openingTorrent,
        devices: devices().map(({ id, name, type }) => ({ id, name, type })),
        deviceId,
        subtitleScale: controller.subtitleScale,
      };
    },
    // Plays what the window has ready (`preparedId`) on `deviceId`, as its own Play would.
    launch: async (preparedId: string, deviceId: string): Promise<void> => {
      checkReady(preparedId);
      const device = devices().find((d) => d.id === deviceId);
      if (!device) throw new Error('That screen can’t be found anymore');
      await hub.launch(device);
    },
    // Picks audio, subtitles or the DLNA switches for what the window has ready, as if
    // picked there.
    pickReadyTracks: async (preparedId: string, change: TrackChange): Promise<void> => {
      checkReady(preparedId);
      await hub.pickTracks(trackChange(change));
    },
    // Looks for screens again.
    refresh: (): void => {
      for (const s of scanners) s.refresh();
    },
    // A magnet link, opened by the window as if pasted there.
    openMagnet: async (link: string): Promise<void> => {
      if (typeof link !== 'string' || link.length > 8192 || !/^magnet:\?\S+$/i.test(link.trim())) {
        throw new Error('That isn’t a magnet link');
      }
      await hub.openTorrent(link.trim());
    },
    // Video `index` of the torrent with several videos the window offers to pick from.
    pickTorrentVideo: async (infoHash: string, index: number): Promise<void> => {
      if (!Number.isInteger(index) || index < 0) throw new Error('Unknown video');
      await hub.pickTorrentVideo(String(infoHash), index);
    },

    play: () => controller.play(),
    pause: () => controller.pause(),
    seek: (time: number) => controller.seek(finite(time)),
    setSubtitleScale: (scale: number) => controller.setSubtitleScale(finite(scale)),
    // The window owns the connection state, so it does the stopping.
    stop: (): void => sendEvent(window, 'remoteStop', null),

    // Empty for image subtitles (nothing to show as text) and when there are none.
    cues: () => controller.cues(),
    // Shifts the playing subtitles by `offset` seconds and reloads them on the TV.
    applyOffset: (offset: number) => controller.retime(finite(offset)),
    tracks: () => controller.tracks(),
    changeTracks: (change: TrackChange) => controller.changeTracks(trackChange(change)),
    startPreview: async () => {
      const now = playing();
      return previewUrls(now.videoPath, now.audioIndex);
    },
    stopPreview: (): void => preview.stop(),

    // What ffprobe says of the video, as the window's Details shows it (no local path).
    videoInfo: async (target: Target): Promise<FFProbeData> => {
      const data = await probe(videoOf(target));
      return { ...data, format: { ...data.format, filename: '' } };
    },

    // Online subtitles, for the video ready or playing (as the window's "Find online").
    // The query guessed from the file name, and the languages set on the computer.
    subtitleQuery: async (target: Target) => ({
      guess: parseReleaseName(videoOf(target)),
      languages: (await subtitleSettingsView()).languages,
    }),
    searchSubtitles: async (
      target: Target,
      query: SubtitleQuery
    ): Promise<SubtitleSearchResponse> => {
      const response = await searchSubtitles(videoOf(target), subtitleQuery(query));
      searched = new Map(response.results.map((r) => [resultKey(r), r]));
      return response;
    },
    // Downloads a result of the last search (by `resultKey`): added to the video ready, or
    // played with the video playing.
    downloadSubtitle: async (
      target: Target,
      key: string,
      episode: { season?: number; episode?: number }
    ): Promise<void> => {
      const result = searched.get(String(key));
      if (!result) throw new Error('Search again: that result is gone');
      const video = videoOf(target);
      const saved = await downloadSubtitle(result, {
        season: optionalInt(episode?.season),
        episode: optionalInt(episode?.episode),
      });
      if (target === null) {
        if (playing().videoPath !== video) throw new Error('Another video is playing now');
        await controller.playSubtitleFile(saved.path);
      } else {
        checkReady(target);
        await hub.addSubtitles(saved);
      }
    },

    // The timing fix for the subtitles picked for the video ready (as the window's "Fix
    // timing"): a preview of the video and the lines at their original timing.
    readyTiming: async (preparedId: string) => {
      const prepared = checkReady(preparedId);
      const subtitles = prepared.subtitles;
      if (subtitles === undefined) throw new Error('No subtitles are picked');
      const [source, cues] = await Promise.all([
        previewUrls(prepared.videoPath, prepared.audioIndex),
        subtitleCues(prepared.videoPath, subtitles),
      ]);
      return { preview: source, cues };
    },
    // A retimed copy of the subtitles picked, added to the video ready in their place.
    retimeReady: async (preparedId: string, timing: SubtitleTiming): Promise<void> => {
      const prepared = checkReady(preparedId);
      const subtitles = prepared.subtitles;
      if (subtitles === undefined) throw new Error('No subtitles are picked');
      const offset = finite(timing?.offset);
      const ratio = finite(timing?.ratio);
      if (ratio < 0.5 || ratio > 2) throw new Error('Unknown frame rate fix');
      const saved = await retimeSubtitles(prepared.videoPath, subtitles, { offset, ratio });
      checkReady(preparedId);
      await hub.addSubtitles(saved);
    },
  };
}

export type RemoteApi = ReturnType<typeof createRemoteApi>;

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Not a number');
  return value;
}

function optionalInt(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function subtitleQuery(value: unknown): SubtitleQuery {
  const q = (value ?? {}) as Record<string, unknown>;
  const title = typeof q.title === 'string' ? q.title.trim().slice(0, 200) : '';
  if (!title) throw new Error('Type a title');
  const languages = Array.isArray(q.languages)
    ? q.languages.filter(
        (l): l is string => typeof l === 'string' && /^[a-z]{2,3}(-[a-z]{2})?$/.test(l)
      )
    : [];
  const season = optionalInt(q.season);
  const episode = optionalInt(q.episode);
  const episodic = season !== undefined && episode !== undefined;
  return {
    title,
    year: optionalInt(q.year),
    season: episodic ? season : undefined,
    episode: episodic ? episode : undefined,
    languages,
  };
}

// Only the shapes TrackChange allows: the phone's JSON is untrusted.
function trackChange(value: unknown): TrackChange {
  const { subtitles, audioIndex, burnSubtitles, normalizeAudio } = (value ?? {}) as Record<
    string,
    unknown
  >;
  const index = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
  if (
    subtitles !== undefined &&
    subtitles !== null &&
    subtitles !== 'external' &&
    !index(subtitles) &&
    !(typeof subtitles === 'string' && /^file:\d+$/.test(subtitles))
  ) {
    throw new Error('Bad subtitle choice');
  }
  if (audioIndex !== undefined && !index(audioIndex)) throw new Error('Bad audio choice');
  const flag = (v: unknown): boolean | undefined => {
    if (v !== undefined && typeof v !== 'boolean') throw new Error('Bad switch');
    return v;
  };
  return {
    subtitles,
    audioIndex,
    burnSubtitles: flag(burnSubtitles),
    normalizeAudio: flag(normalizeAudio),
  } as TrackChange;
}
