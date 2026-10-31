import { useEffect, useMemo, useRef, useState } from 'react';
import type { FFProbeData } from '../../../main/ffmpeg';
import { describeTracks } from '../../../shared/tracks';
import type {
  DeviceType,
  TorrentSubtitles,
  TrackChange,
  TrackList,
  VideoSource,
} from '../../../shared/types';
import { api } from '../ipc';
import { type AudioSelection, audioChoices } from './AudioSelection';
import {
  bundledSelection,
  defaultSubtitles,
  externalSelection,
  internalSubtitles,
  isSupported,
  NO_SUBTITLES,
  type SubtitlesFile,
  type SubtitlesSelection,
  subtitlesArg,
} from './SubtitlesSelection';

// The audio and subtitles picked for the video ready, from the window or the phone remote,
// and the defaults a new video starts with. `probeData` must be the video's own (undefined
// while it's probed): the choices are read from it.
export function useTrackSelection(
  video: VideoSource | undefined,
  probeData: FFProbeData | undefined,
  deviceType: DeviceType | undefined
) {
  // The subtitle file added (dropped, found online, retimed).
  const [subs, setSubs] = useState<SubtitlesFile | undefined>();
  // The subtitle files in the torrent of the video.
  const [torrentSubs, setTorrentSubs] = useState<TorrentSubtitles[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitlesSelection>(NO_SUBTITLES);
  const [audio, setAudio] = useState<AudioSelection | undefined>();
  // The torrent file being downloaded before it is picked.
  const [fetching, setFetching] = useState<string>();
  // Bumped by every subtitle pick and per video, so a download finishing late never
  // overrides a newer pick, nor lands on another video.
  const subtitlePick = useRef(0);
  // Picked by hand (window or phone) since the video was picked: no default over it.
  const picked = useRef({ audio: false, subtitles: false });
  const latest = useRef({ subs, deviceType });
  latest.current = { subs, deviceType };

  const audioTracks = useMemo(() => (probeData ? audioChoices(probeData) : []), [probeData]);
  const internal = useMemo(() => (probeData ? internalSubtitles(probeData) : []), [probeData]);

  function chooseSubtitles(selection: SubtitlesSelection): void {
    subtitlePick.current++;
    picked.current.subtitles = true;
    setFetching(undefined);
    setSubtitles(selection);
  }

  function chooseAudio(selection: AudioSelection): void {
    picked.current.audio = true;
    setAudio(selection);
  }

  // Downloads a torrent's subtitle file (main keeps it once fetched), then picks it unless
  // something else was picked meanwhile. `auto`: the lone file of a torrent, which goes
  // with the video like an added one but doesn't count as picked by hand.
  async function pickFile(file: SubtitlesFile, auto = false): Promise<void> {
    const pick = ++subtitlePick.current;
    if (!auto) picked.current.subtitles = true;
    setFetching(file.path);
    try {
      await api.fetchTorrentSubtitles(file.path);
    } finally {
      if (pick === subtitlePick.current) setFetching(undefined);
    }
    if (pick === subtitlePick.current) setSubtitles(bundledSelection(file));
  }

  // A subtitle file added to the video goes with it.
  function addSubtitles(file: SubtitlesFile): void {
    setSubs(file);
    chooseSubtitles(externalSelection(file));
  }

  // A new video: nothing picked, and its torrent's subtitle files listed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pickFile only uses setters and refs
  useEffect(() => {
    subtitlePick.current++;
    picked.current = { audio: false, subtitles: false };
    setAudio(undefined);
    setSubtitles(NO_SUBTITLES);
    setFetching(undefined);
    setTorrentSubs([]);
    if (!video?.infoHash) return;
    let cancelled = false;
    api
      .torrentSubtitles(video.path)
      .then((files) => {
        if (cancelled) return;
        setTorrentSubs(files);
        // Among several (a pack, or one per language), nothing is guessed.
        if (files.length === 1 && !latest.current.subs) {
          void pickFile(files[0], true).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [video]);

  // Once probed: the defaults, unless picked by hand already.
  useEffect(() => {
    if (!probeData) return;
    if (!picked.current.audio) setAudio(audioTracks[0]);
    if (!picked.current.subtitles) {
      const { subs, deviceType } = latest.current;
      setSubtitles(defaultSubtitles(internal, subs, deviceType));
    }
  }, [probeData, audioTracks, internal]);

  // Another screen that can't show what is picked (image subtitles on a Chromecast).
  useEffect(() => {
    setSubtitles((current) =>
      isSupported(current, deviceType)
        ? current
        : defaultSubtitles(internal, latest.current.subs, deviceType)
    );
  }, [deviceType, internal]);

  // A pick from the phone remote, by the indexes of `tracks`.
  async function applyChange(change: TrackChange): Promise<void> {
    if (!probeData) throw new Error('The video is still being read');
    if (change.audioIndex !== undefined) {
      const track = audioTracks[change.audioIndex];
      if (!track) throw new Error('Unknown audio track');
      chooseAudio(track);
    }
    const choice = change.subtitles;
    if (choice === undefined) return;
    if (choice === null) {
      chooseSubtitles(NO_SUBTITLES);
    } else if (choice === 'external') {
      if (!subs) throw new Error('No subtitle file was added to this video');
      chooseSubtitles(externalSelection(subs));
    } else if (typeof choice === 'number') {
      const track = internal[choice];
      if (!track) throw new Error('Unknown subtitle track');
      chooseSubtitles(track);
    } else {
      const file = torrentSubs[Number(choice.slice(5))];
      if (!file) throw new Error('Unknown subtitle file');
      await pickFile(file);
    }
  }

  // What the phone remote shows; undefined until probed.
  const tracks = useMemo<TrackList | undefined>(
    () =>
      probeData &&
      describeTracks({
        streams: probeData.streams,
        files: torrentSubs,
        externalPath: subs?.path,
        subtitles: subtitlesArg(subtitles),
        audioIndex: audio?.index,
      }),
    [probeData, torrentSubs, subs, subtitles, audio]
  );

  return {
    audioTracks,
    audio,
    chooseAudio,
    internal,
    subs,
    addSubtitles,
    torrentSubs,
    subtitles,
    chooseSubtitles,
    pickFile,
    fetching,
    applyChange,
    tracks,
  };
}
