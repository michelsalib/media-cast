import {
  ArrowBackRounded,
  BoltRounded,
  FileDownloadOutlined,
  FolderOpenOutlined,
  MovieOutlined,
  PlayArrowRounded,
  SyncRounded,
} from '@mui/icons-material';
import {
  Alert,
  alpha,
  Backdrop,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Link,
  Snackbar,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FFProbeData } from '../../../main/ffmpeg';
import { type CompatReport, checkCompat } from '../../../shared/compat';
import { VIDEO_EXTENSIONS } from '../../../shared/media';
import { isBitmapSubtitleCodec } from '../../../shared/subtitles';
import type {
  Device,
  PlayerStatus,
  PlayingTracks,
  TorrentContents,
  TorrentStats,
  TrackChange,
  VideoSource,
} from '../../../shared/types';
import type { Connection } from '../App';
import { api, errorMessage, onEvent, pathFor } from '../ipc';
import { episodeLabel, resolutionLabel, runtimeLabel, subtitleFileName } from '../labels';
import { cardSx, linkSx, tonalSx } from '../theme';
import { Artwork, useObjectUrl } from './Artwork';
import { type AudioSelection, audioChoices } from './AudioSelection';
import AudioSelector from './AudioSelector';
import Player from './Player';
import RemoteButton from './RemoteButton';
import SubtitleSearchDialog from './SubtitleSearchDialog';
import SubtitleSizeButton from './SubtitleSizeButton';
import SubtitleSyncDialog, { type SyncSource } from './SubtitleSyncDialog';
import {
  bundledSelection,
  internalSubtitles,
  NO_SUBTITLES,
  type SubtitlesFile,
  type SubtitlesSelection,
} from './SubtitlesSelection';
import SubtitlesSelector, { isSupported } from './SubtitlesSelector';
import { TorrentChip, TorrentPicker } from './Torrent';
import VideoInfoButton from './VideoInfoButton';

type Props = {
  connection: Connection | null;
  onConnect: (device: Device) => Promise<boolean>;
  onStop: () => void;
  // The device picker, labelled for the view it sits in.
  devices: (label: string, actions?: React.ReactNode) => React.ReactNode;
};

type ReleaseInfo = Awaited<ReturnType<typeof api.guessSubtitleQuery>>;

// What was sent to the TV, kept apart from the video being prepared next.
type NowPlaying = { thumbnail?: Uint8Array; title: string; details?: string; infoHash?: string };

// Text formats main can extract or burn (see TEXT_SUBTITLE_EXTENSIONS in subtitleExtractor).
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa'];
const TORRENT_EXTENSIONS = ['.torrent', '.magnet'];
const ALL_EXTENSIONS = [...VIDEO_EXTENSIONS, ...TORRENT_EXTENSIONS, ...SUBTITLE_EXTENSIONS];

export default function Dropper({
  connection,
  onConnect,
  onStop,
  devices,
}: Props): React.JSX.Element {
  const [isOver, setIsOver] = useState(false);
  const [video, setVideo] = useState<VideoSource | undefined>();
  const [openingTorrent, setOpeningTorrent] = useState(false);
  // A torrent with several videos, waiting for the user to pick one.
  const [torrentChoice, setTorrentChoice] = useState<TorrentContents | undefined>();
  const [torrentStats, setTorrentStats] = useState<TorrentStats[]>([]);
  const [resizableSubtitles, setResizableSubtitles] = useState(false);
  const [subtitleScale, setSubtitleScale] = useState(1);
  const [subs, setSubs] = useState<SubtitlesFile | undefined>();
  // The subtitle files in the torrent of the video picked.
  const [torrentSubs, setTorrentSubs] = useState<SubtitlesFile[]>([]);
  const [subtitlesSelection, setSubtitlesSelection] = useState<SubtitlesSelection>(NO_SUBTITLES);
  const [audioSelection, setAudioSelection] = useState<AudioSelection | undefined>();
  const [thumbnail, setThumbnail] = useState<Uint8Array | undefined>(undefined);
  const [probeData, setProbeData] = useState<FFProbeData | undefined>(undefined);
  const [release, setRelease] = useState<ReleaseInfo | undefined>();
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [casting, setCasting] = useState(false);
  const [castError, setCastError] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [syncSource, setSyncSource] = useState<SyncSource | undefined>();
  const [status, setStatus] = useState<PlayerStatus | undefined>();
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | undefined>();
  // Preparing another video while one plays.
  const [browsing, setBrowsing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const device = connection?.device ?? null;
  const hasSubs = subtitlesSelection.type !== 'no subtitles';
  const showBurnToggle = device?.type === 'upnp' && hasSubs;
  const bitmapSubs = subtitlesSelection.type === 'internal' && subtitlesSelection.bitmap;
  // Image-based tracks can't be extracted as sidecar text, and a DLNA TV draws a subtitle
  // file at its own size: either way burning is the only option (main decides the same).
  const forceBurn = showBurnToggle && (bitmapSubs || subtitleScale !== 1);
  const effectiveBurn = !!device && burnOn(device);
  // Any subtitles can be resized: a Chromecast restyles them, a DLNA TV gets them burned in.
  const resizableOn = hasSubs && !!device;
  // Burning exists only on UPnP: the toggle's choice there, or forced (see forceBurn).
  function burnOn(target: Device): boolean {
    if (target.type !== 'upnp' || !hasSubs) return false;
    return bitmapSubs || subtitleScale !== 1 || burnSubtitles;
  }
  const videoPath = video?.path;
  // For the listeners registered once.
  const videoPathRef = useRef(videoPath);
  videoPathRef.current = videoPath;
  const torrentSubsRef = useRef(torrentSubs);
  torrentSubsRef.current = torrentSubs;
  const statsFor = (infoHash?: string): TorrentStats | undefined =>
    torrentStats.find((s) => s.infoHash === infoHash);
  // Text tracks only: image subtitles have no lines to show or retime.
  const syncableSelection: SyncSource | undefined =
    subtitlesSelection.type === 'external'
      ? { name: subtitlesSelection.name, pathOrIndex: subtitlesSelection.path }
      : subtitlesSelection.type === 'internal' && !subtitlesSelection.bitmap
        ? { name: subtitlesSelection.name, pathOrIndex: subtitlesSelection.index }
        : undefined;

  useEffect(() => onEvent('status', setStatus), []);
  useEffect(() => onEvent('torrents', setTorrentStats), []);
  useEffect(() => {
    api
      .subtitleScale()
      .then(setSubtitleScale)
      .catch(() => {});
    return onEvent('subtitleScale', setSubtitleScale);
  }, []);
  // The phone remote reloads the video with retimed subtitles: pick those up here too.
  // Also tells whether the size of the subtitles playing can change.
  useEffect(
    () =>
      onEvent('nowPlaying', (now) => {
        setResizableSubtitles(!!now?.resizableSubtitles);
        const path = now?.subtitlesPathOrIndex;
        if (now?.videoPath !== videoPathRef.current || typeof path !== 'string') return;
        // Already offered with the torrent.
        if (torrentSubsRef.current.some((s) => s.path === path)) return;
        setSubs((prev) =>
          prev?.path === path ? prev : { name: path.split(/[\\/]/).pop() ?? path, path }
        );
      }),
    []
  );

  // A magnet link pasted anywhere but a text field.
  // biome-ignore lint/correctness/useExhaustiveDependencies: openTorrent only uses setters
  useEffect(() => {
    function paste(event: ClipboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const text = event.clipboardData?.getData('text/plain').trim();
      if (text && isMagnetLink(text)) {
        event.preventDefault();
        void openTorrent(text);
      }
    }
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on device or connection change to clear stale status
  useEffect(() => {
    setStatus(undefined);
  }, [connection?.device.id, connection?.state]);

  const active = connection?.state === 'CONNECTED' && !!status && status.playerState !== 'IDLE';
  const view = active && (!browsing || !video) ? 'playing' : video ? 'ready' : 'empty';

  function ingest(files: Iterable<File>): void {
    const rejected: string[] = [];
    for (const file of files) {
      const ext = extensionOf(file.name);
      if (VIDEO_EXTENSIONS.includes(ext)) {
        pickVideo({ name: file.name, path: pathFor(file), size: file.size });
      } else if (TORRENT_EXTENSIONS.includes(ext)) {
        void openTorrent(pathFor(file));
      } else if (SUBTITLE_EXTENSIONS.includes(ext)) {
        setSubs({ name: file.name, path: pathFor(file) });
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length > 0) {
      setCastError(
        `Unsupported file: ${rejected.join(', ')} — expected ${ALL_EXTENSIONS.join(' ')}`
      );
    }
  }

  function pickVideo(source: VideoSource): void {
    setVideo(source);
    setBrowsing(true);
  }

  // `source` is a magnet link or a .torrent/.magnet path. Fetching the file list takes
  // a few seconds to a minute, depending on how fast peers turn up.
  async function openTorrent(source: string): Promise<void> {
    setOpeningTorrent(true);
    try {
      // Keep the current video streaming in case the user cancels the picker.
      const contents = await api.openTorrent(source, videoPathRef.current);
      if (contents.videos.length === 1) {
        pickVideo({ ...contents.videos[0], infoHash: contents.infoHash });
      } else {
        setTorrentChoice(contents);
      }
    } catch (err) {
      setCastError(errorMessage(err));
    } finally {
      setOpeningTorrent(false);
    }
  }

  function drop(event: React.DragEvent): void {
    event.preventDefault();
    setIsOver(false);
    if (event.dataTransfer.files.length > 0) {
      ingest(event.dataTransfer.files);
      return;
    }
    // A magnet link dragged from a browser.
    const text = event.dataTransfer.getData('text/plain').trim();
    if (isMagnetLink(text)) {
      void openTorrent(text);
    }
  }

  // One hidden input for every picker; `accept` narrows it to what the button offers.
  function browse(extensions = ALL_EXTENSIONS): void {
    const input = fileInput.current;
    if (!input) return;
    input.accept = extensions.join(',');
    input.click();
  }

  function onFilesPicked(event: React.ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) {
      ingest(event.target.files);
    }
    event.target.value = '';
  }

  function dragOver(event: React.DragEvent): void {
    event.preventDefault();
    setIsOver(true);
  }

  function dragLeave(event: React.DragEvent): void {
    event.preventDefault();
    setIsOver(false);
  }

  useEffect(() => {
    async function generate(): Promise<void> {
      if (!video) {
        return;
      }

      try {
        setThumbnail(await api.thumbnail(video.path));
      } catch {
        setThumbnail(undefined);
      }
    }

    void generate();
  }, [video]);

  useEffect(() => {
    if (!video) {
      setProbeData(undefined);
      return;
    }
    let cancelled = false;
    api.probe(video.path).then((data) => {
      if (!cancelled) setProbeData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [video]);

  useEffect(() => {
    setTorrentSubs([]);
    if (!video?.infoHash) return;
    let cancelled = false;
    api
      .torrentSubtitles(video.path)
      .then(
        (files) =>
          !cancelled &&
          setTorrentSubs(files.map((f) => ({ ...f, label: subtitleFileName(f.label) })))
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [video]);

  useEffect(() => {
    if (!videoPath) {
      setRelease(undefined);
      return;
    }
    let cancelled = false;
    api
      .guessSubtitleQuery(videoPath)
      .then((info) => !cancelled && setRelease(info))
      .catch(() => !cancelled && setRelease(undefined));
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  const compat = useMemo<CompatReport | undefined>(() => {
    if (!video || !probeData || !device) return undefined;
    return checkCompat({
      videoFileName: video.name,
      probeData,
      deviceType: device.type,
      acceptedVideoMimes: device.acceptedVideoMimes,
      acceptedWildcardVideoMimes: device.acceptedWildcardVideoMimes,
      burnSubtitles: effectiveBurn,
      audioIndex: audioSelection?.index,
    });
  }, [video, probeData, device, effectiveBurn, audioSelection]);

  const thumbnailUrl = useObjectUrl(thumbnail);
  const nowPlayingUrl = useObjectUrl(nowPlaying?.thumbnail);

  const title = release?.title || (video ? stripExtension(video.name) : '');
  const eyebrow = release ? episodeLabel(release) : undefined;
  const videoStream = probeData?.streams.find((s) => s.codec_type === 'video');
  const meta = [
    probeData ? runtimeLabel(Number(probeData.format.duration)) : undefined,
    resolutionLabel(videoStream?.height),
  ]
    .filter(Boolean)
    .join(' · ');
  const hasAudio = probeData?.streams.some((s) => s.codec_type === 'audio') ?? false;
  const subtitlesLabel =
    subtitlesSelection.type === 'internal'
      ? `${subtitlesSelection.name} subtitles`
      : subtitlesSelection.type === 'external'
        ? subtitlesSelection.label
          ? `${subtitlesSelection.label} subtitles`
          : 'Added subtitles'
        : undefined;

  const canPlay = !!video && !!device && !casting && connection?.state !== 'CONNECTING';
  const details = [eyebrow, subtitlesLabel].filter(Boolean).join(' · ') || undefined;

  // `target`: the picked screen, or the one a phone remote chose. Resolves to the error
  // (also shown here), or undefined once the TV has the video.
  async function play(target: Device | null = device): Promise<string | undefined> {
    if (!video || !target) {
      return 'Nothing is ready to play';
    }
    if (casting) {
      return 'A video is already starting';
    }
    const subsArg =
      subtitlesSelection.type === 'external'
        ? subtitlesSelection.path
        : subtitlesSelection.type === 'internal'
          ? subtitlesSelection.index
          : undefined;
    setCasting(true);
    setCastError(undefined);
    try {
      // After Stop the device stays picked but disconnected; a phone may pick another.
      const connected = connection?.device.id === target.id && connection.state === 'CONNECTED';
      if (!connected && !(await onConnect(target))) {
        return `Couldn’t connect to ${target.name}`;
      }
      await api.load(video.path, subsArg, audioSelection?.index, burnOn(target));
      setNowPlaying({ thumbnail, title, details, infoHash: video.infoHash });
      setBrowsing(false);
      return undefined;
    } catch (err) {
      const message = errorMessage(err);
      setCastError(message);
      return message;
    } finally {
      setCasting(false);
    }
  }

  // The phone remote's Play goes through the same play(), with the state of this render.
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(
    () =>
      onEvent('remoteLaunch', ({ requestId, device: target }) => {
        void playRef.current(target).then((error) => api.remoteDone(requestId, error));
      }),
    []
  );

  // The phone remote's audio/subtitle pick for what is ready, applied as if picked here.
  async function pickTracks(change: TrackChange): Promise<void> {
    if (!probeData) throw new Error('The video is still being read');
    if (change.audioIndex !== undefined) {
      const audio = audioChoices(probeData)[change.audioIndex];
      if (!audio) throw new Error('Unknown audio track');
      setAudioSelection(audio);
    }
    const choice = change.subtitles;
    if (choice === null) {
      setSubtitlesSelection(NO_SUBTITLES);
    } else if (choice === 'external') {
      if (!subs) throw new Error('No subtitle file was added to this video');
      setSubtitlesSelection({ type: 'external', name: subs.name, path: subs.path });
    } else if (typeof choice === 'number') {
      const track = internalSubtitles(probeData)[choice];
      if (!track) throw new Error('Unknown subtitle track');
      if (!isSupported(track, device?.type)) {
        throw new Error('Image subtitles can’t be shown on a Chromecast');
      }
      setSubtitlesSelection(track);
    } else if (typeof choice === 'string') {
      const file = torrentSubs[Number(choice.slice(5))];
      if (!file) throw new Error('Unknown subtitle file');
      await api.fetchTorrentSubtitles(file.path);
      setSubtitlesSelection(bundledSelection(file));
    }
  }
  const pickTracksRef = useRef(pickTracks);
  pickTracksRef.current = pickTracks;
  useEffect(
    () =>
      onEvent('remoteTracks', ({ requestId, change }) => {
        pickTracksRef.current(change).then(
          () => api.remoteDone(requestId),
          (err) => api.remoteDone(requestId, errorMessage(err))
        );
      }),
    []
  );

  // The tracks of what is ready, in the shape the phone shows for what plays.
  const readyTracks = useMemo<PlayingTracks | undefined>(() => {
    if (!probeData) return undefined;
    const streams = (type: string) => probeData.streams.filter((s) => s.codec_type === type);
    const file = torrentSubs.findIndex(
      (f) => subtitlesSelection.type === 'external' && f.path === subtitlesSelection.path
    );
    return {
      // Undecided before a screen is picked: nothing is ruled out.
      deviceType: device?.type ?? 'upnp',
      audio: streams('audio').map((s) => ({
        language: s.tags?.language,
        title: s.tags?.title,
        channels: s.channels,
      })),
      subtitles: streams('subtitle').map((s) => ({
        language: s.tags?.language,
        title: s.tags?.title,
        bitmap: isBitmapSubtitleCodec(s.codec_name),
      })),
      externalName: subs?.name,
      files: torrentSubs.map((f) => ({
        name: f.name,
        label: f.label ?? '',
        folder: f.folder ?? '',
      })),
      selected: {
        audioIndex: audioSelection?.index ?? 0,
        subtitles:
          subtitlesSelection.type === 'internal'
            ? subtitlesSelection.index
            : file >= 0
              ? `file:${file}`
              : subtitlesSelection.type === 'external'
                ? 'external'
                : null,
      },
      subtitleOffset: 0,
    };
  }, [probeData, torrentSubs, subs, subtitlesSelection, audioSelection, device?.type]);

  // What the phone remote shows as ready to play.
  useEffect(() => {
    void api.setRemoteContext({
      prepared: videoPath ? { videoPath, title, details, tracks: readyTracks } : null,
      deviceId: device?.id ?? null,
    });
  }, [videoPath, title, details, readyTracks, device?.id]);

  return (
    <Box
      onDrop={drop}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <input
        ref={fileInput}
        type="file"
        accept={ALL_EXTENSIONS.join(',')}
        multiple
        hidden
        onChange={onFilesPicked}
      />

      {/* 32px: the title bar drawn over this by App. */}
      <Stack sx={{ height: '100%', pt: '32px' }}>
        {view === 'playing' && status && device && (
          <Player
            status={status}
            device={device}
            artworkUrl={nowPlayingUrl}
            title={nowPlaying?.title || status.title || 'Now playing'}
            details={nowPlaying?.details}
            badges={nowPlaying?.infoHash && <TorrentChip stats={statsFor(nowPlaying.infoHash)} />}
            resizableSubtitles={resizableSubtitles}
            onBrowse={() => browse()}
            onStop={onStop}
          />
        )}

        {view === 'empty' && (
          <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, px: 2.5, pt: 1, pb: 2.5 }}>
            <Stack
              spacing={1.5}
              sx={{
                ...cardSx,
                borderRadius: '28px',
                flex: 1,
                minHeight: 0,
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                px: 3,
              }}
            >
              <Box
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: '24px',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'tonal.primaryContainer',
                  color: 'tonal.onPrimaryContainer',
                  mb: 1,
                }}
              >
                <MovieOutlined sx={{ fontSize: 36 }} />
              </Box>
              <Typography variant="h1">Drop a video here</Typography>
              <Typography sx={{ color: 'text.secondary', maxWidth: 420 }}>
                A movie or an episode, in MP4, MKV or AVI, or a torrent to stream (paste a magnet
                link anywhere). Drop its subtitle file along with it, or find subtitles online
                afterwards.
              </Typography>
              <Button
                variant="contained"
                onClick={() => browse()}
                startIcon={<FolderOpenOutlined />}
                sx={{ mt: 1.5, height: 48, px: 3, fontSize: 15 }}
              >
                Choose a video
              </Button>
            </Stack>
            {devices('Play on', <RemoteButton compact />)}
          </Stack>
        )}

        {view === 'ready' && video && (
          <Stack sx={{ flex: 1, minHeight: 0 }}>
            <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, pt: 1 }}>
              {active && (
                <Button
                  onClick={() => setBrowsing(false)}
                  startIcon={<ArrowBackRounded />}
                  sx={[tonalSx, { alignSelf: 'flex-start', flexShrink: 0 }]}
                >
                  Back to what’s playing
                </Button>
              )}

              <Stack
                direction="row"
                spacing={2.5}
                sx={{ ...cardSx, p: 2, borderRadius: '28px', alignItems: 'center', flexShrink: 0 }}
              >
                <Artwork url={thumbnailUrl} sx={{ width: 'min(272px, 40%)' }} />
                <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                  {eyebrow && (
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'primary.main' }}>
                      {eyebrow}
                    </Typography>
                  )}
                  <Typography
                    variant="h1"
                    title={video.name}
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                    }}
                  >
                    {title}
                  </Typography>
                  {meta && <Typography sx={{ color: 'text.secondary' }}>{meta}</Typography>}
                  <Stack
                    direction="row"
                    useFlexGap
                    sx={{ gap: 1, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    {compat && device && <CompatChip report={compat} deviceName={device.name} />}
                    <VideoInfoButton video={video} />
                    <Button
                      size="small"
                      onClick={() => browse()}
                      sx={{ height: 32, borderRadius: '8px', color: 'primary.main' }}
                    >
                      Change
                    </Button>
                    {/* Last: its live numbers change its width. */}
                    {video.infoHash && <TorrentChip stats={statsFor(video.infoHash)} />}
                  </Stack>
                </Stack>
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: hasAudio
                    ? 'repeat(auto-fit, minmax(280px, 1fr))'
                    : 'minmax(0, 1fr)',
                  gap: 1.5,
                  alignItems: 'start',
                  pb: 1.5,
                }}
              >
                {hasAudio && (
                  <Section title="Audio">
                    <AudioSelector
                      video={video}
                      value={audioSelection}
                      onChange={setAudioSelection}
                    />
                  </Section>
                )}
                <Section
                  title="Subtitles"
                  actions={
                    <>
                      <Tooltip title="Load an SRT, VTT, ASS or SSA file from your computer">
                        <Link
                          component="button"
                          onClick={() => browse(SUBTITLE_EXTENSIONS)}
                          sx={linkSx}
                        >
                          Load file
                        </Link>
                      </Tooltip>
                      <Link component="button" onClick={() => setSearchOpen(true)} sx={linkSx}>
                        Find online
                      </Link>
                      {/* Always shown so it can be found; text tracks only (image
                          subtitles have no lines to retime). */}
                      <Tooltip
                        title={
                          syncableSelection
                            ? 'Preview the subtitles over the video and shift them in sync'
                            : hasSubs
                              ? 'These subtitles are images (e.g. Blu-ray), so they can’t be retimed. Find text subtitles online instead.'
                              : 'Pick subtitles to check their timing'
                        }
                      >
                        <Box component="span" sx={{ display: 'flex' }}>
                          <Link
                            component="button"
                            disabled={!syncableSelection}
                            onClick={() => syncableSelection && setSyncSource(syncableSelection)}
                            sx={[
                              linkSx,
                              !syncableSelection && { color: 'text.disabled', cursor: 'default' },
                            ]}
                          >
                            Fix timing
                          </Link>
                        </Box>
                      </Tooltip>
                      {resizableOn && <SubtitleSizeButton link onError={setCastError} />}
                    </>
                  }
                >
                  <SubtitlesSelector
                    subFile={subs}
                    bundled={torrentSubs}
                    onError={setCastError}
                    video={video}
                    deviceType={device?.type}
                    value={subtitlesSelection}
                    onChange={setSubtitlesSelection}
                  />
                  {showBurnToggle && (
                    <Tooltip
                      placement="top"
                      enterDelay={300}
                      title={
                        bitmapSubs
                          ? 'These subtitles are images (e.g. Blu-ray PGS) — they can only be shown by burning them into the video.'
                          : forceBurn
                            ? 'The TV shows subtitle files at its own size: to change their size, they are burned into the video. Set the size back to Normal to send them as a file.'
                            : 'Re-encodes the video to embed subtitles. Needed only for TVs that ignore separate subtitle files.'
                      }
                    >
                      <FormControlLabel
                        control={
                          <Switch
                            size="small"
                            checked={effectiveBurn}
                            disabled={forceBurn}
                            onChange={(e) => setBurnSubtitles(e.target.checked)}
                          />
                        }
                        label="Burn into the picture"
                        slotProps={{ typography: { sx: { fontSize: 13 } } }}
                        sx={{ m: 0, mt: 1, gap: 0.5, alignSelf: 'flex-start' }}
                      />
                    </Tooltip>
                  )}
                </Section>
              </Box>
            </Stack>

            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'flex-end', px: 2.5, pt: 1, pb: 2.5 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>{devices('Play on')}</Box>
              {/* Stretched to the device column's height: the link lines up with its header
                  ("Look again") and Play with its tiles. */}
              <Stack
                sx={{
                  alignSelf: 'stretch',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                }}
              >
                <Box sx={{ height: 30, display: 'flex', alignItems: 'center' }}>
                  <RemoteButton compact />
                </Box>
                <Tooltip title={device ? '' : 'Pick a screen first'} placement="top">
                  <span>
                    <Button
                      variant="contained"
                      size="large"
                      onClick={() => void play()}
                      disabled={!canPlay}
                      startIcon={
                        casting ? (
                          <CircularProgress size={20} color="inherit" />
                        ) : (
                          <PlayArrowRounded sx={{ '&&': { fontSize: 26 } }} />
                        )
                      }
                      sx={{ mb: 0.5 }}
                    >
                      Play
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          </Stack>
        )}
      </Stack>

      {videoPath && (
        <>
          <SubtitleSearchDialog
            open={searchOpen}
            videoPath={videoPath}
            onClose={() => setSearchOpen(false)}
            onDownloaded={(file) => setSyncSource({ name: file.name, pathOrIndex: file.path })}
          />
          <SubtitleSyncDialog
            videoPath={videoPath}
            audioIndex={audioSelection?.index}
            source={syncSource}
            onClose={() => setSyncSource(undefined)}
            onApply={(file) => {
              setSubs(file);
              setSyncSource(undefined);
              setSearchOpen(false);
            }}
          />
        </>
      )}
      <TorrentPicker
        contents={torrentChoice}
        onPick={(v) => {
          if (torrentChoice) pickVideo({ ...v, infoHash: torrentChoice.infoHash });
          setTorrentChoice(undefined);
        }}
        onClose={() => setTorrentChoice(undefined)}
      />
      <Backdrop
        open={openingTorrent}
        sx={(theme) => ({
          backgroundColor: alpha(theme.palette.tonal.surface, 0.85),
          flexDirection: 'column',
          gap: 2,
          zIndex: theme.zIndex.modal + 1,
        })}
      >
        <CircularProgress />
        <Typography variant="h2">Opening the torrent…</Typography>
        <Typography sx={{ color: 'text.secondary' }}>
          Looking for people sharing it. This can take up to a minute.
        </Typography>
      </Backdrop>
      <Snackbar
        open={!!castError}
        onClose={() => setCastError(undefined)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={() => setCastError(undefined)}>
          {castError}
        </Alert>
      </Snackbar>
      <Backdrop
        open={isOver}
        sx={(theme) => ({
          backgroundColor: alpha(theme.palette.tonal.surface, 0.85),
          flexDirection: 'column',
          gap: 2,
          zIndex: theme.zIndex.modal + 1,
        })}
      >
        <Box
          sx={{
            width: 96,
            height: 96,
            borderRadius: '28px',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'tonal.primaryContainer',
            color: 'tonal.onPrimaryContainer',
          }}
        >
          <FileDownloadOutlined sx={{ fontSize: 44 }} />
        </Box>
        <Typography variant="h2">Drop it here</Typography>
      </Backdrop>
    </Box>
  );
}

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack spacing={1.5} sx={{ ...cardSx, p: 2, minWidth: 0 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography sx={{ fontWeight: 600, flex: 1 }}>{title}</Typography>
        {actions}
      </Stack>
      {children}
    </Stack>
  );
}

function CompatChip({
  report,
  deviceName,
}: {
  report: CompatReport;
  deviceName: string;
}): React.JSX.Element {
  const transcoding = report.needsTranscoding;

  return (
    <Tooltip
      placement="bottom-start"
      enterDelay={200}
      title={
        <Box sx={{ minWidth: 220, lineHeight: 1.5 }}>
          <Box sx={{ fontWeight: 600, fontSize: 13, mb: 0.75 }}>
            {transcoding ? 'Transcoding required' : 'Direct play'}
          </Box>
          <Stack spacing={0.25} sx={{ fontSize: 12 }}>
            <Box>Container: {report.container || 'unknown'}</Box>
            <Box>Video: {report.videoCodec ?? 'unknown'}</Box>
            <Box>Audio: {report.audioCodec ?? 'unknown'}</Box>
          </Stack>
          {report.issues.length > 0 && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: '1px solid', borderColor: 'currentColor' }}>
              <Box sx={{ fontSize: 11, opacity: 0.8, mb: 0.25 }}>Why re-encode</Box>
              <Stack component="ul" sx={{ pl: 2, m: 0, fontSize: 12 }} spacing={0.25}>
                {report.issues.map((issue) => (
                  <li key={issue.kind}>{issue.detail}</li>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      }
    >
      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          height: 32,
          px: 1.5,
          alignItems: 'center',
          borderRadius: '8px',
          bgcolor: 'tonal.secondaryContainer',
          color: 'tonal.onSecondaryContainer',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'help',
          minWidth: 0,
        }}
      >
        {transcoding ? (
          <SyncRounded sx={{ fontSize: 16 }} />
        ) : (
          <BoltRounded sx={{ fontSize: 16 }} />
        )}
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {transcoding ? `Converted for ${deviceName}` : `Plays directly on ${deviceName}`}
        </Box>
      </Stack>
    </Tooltip>
  );
}

function isMagnetLink(text: string): boolean {
  return /^magnet:\?/i.test(text) && !/\s/.test(text);
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}
