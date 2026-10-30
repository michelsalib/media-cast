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
import type { Device, PlayerStatus } from '../../../shared/types';
import type { Connection } from '../App';
import { api, errorMessage, onEvent, pathFor } from '../ipc';
import { episodeLabel, resolutionLabel, runtimeLabel } from '../labels';
import { cardSx, tonalSx } from '../theme';
import { Artwork, useObjectUrl } from './Artwork';
import type { AudioSelection } from './AudioSelection';
import AudioSelector from './AudioSelector';
import Player from './Player';
import SubtitleSearchDialog from './SubtitleSearchDialog';
import SubtitleSyncDialog, { type SyncSource } from './SubtitleSyncDialog';
import { NO_SUBTITLES, type SubtitlesFile, type SubtitlesSelection } from './SubtitlesSelection';
import SubtitlesSelector from './SubtitlesSelector';
import VideoInfoButton from './VideoInfoButton';

type Props = {
  connection: Connection | null;
  onConnect: (device: Device) => Promise<boolean>;
  onStop: () => void;
  // The device picker, labelled for the view it sits in.
  devices: (label: string) => React.ReactNode;
};

type ReleaseInfo = Awaited<ReturnType<typeof api.guessSubtitleQuery>>;

// What was sent to the TV, kept apart from the video being prepared next.
type NowPlaying = { thumbnail?: Uint8Array; title: string; details?: string };

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi'];
// Text formats main can extract or burn (see TEXT_SUBTITLE_EXTENSIONS in subtitleExtractor).
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa'];

export default function Dropper({
  connection,
  onConnect,
  onStop,
  devices,
}: Props): React.JSX.Element {
  const [isOver, setIsOver] = useState(false);
  const [video, setVideo] = useState<File | undefined>();
  const [subs, setSubs] = useState<SubtitlesFile | undefined>();
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
  // Image-based tracks can't be extracted as sidecar text — burning is the only option.
  const forceBurn =
    showBurnToggle && subtitlesSelection.type === 'internal' && subtitlesSelection.bitmap;
  const effectiveBurn = showBurnToggle && (forceBurn || burnSubtitles);
  const videoPath = useMemo(() => (video ? pathFor(video) : undefined), [video]);
  // Text tracks only: image subtitles have no lines to show or retime.
  const syncableSelection: SyncSource | undefined =
    subtitlesSelection.type === 'external'
      ? { name: subtitlesSelection.name, pathOrIndex: subtitlesSelection.path }
      : subtitlesSelection.type === 'internal' && !subtitlesSelection.bitmap
        ? { name: subtitlesSelection.name, pathOrIndex: subtitlesSelection.index }
        : undefined;

  useEffect(() => onEvent('status', setStatus), []);

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
        setVideo(file);
        setBrowsing(true);
      } else if (SUBTITLE_EXTENSIONS.includes(ext)) {
        setSubs({ name: file.name, path: pathFor(file) });
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length > 0) {
      setCastError(
        `Unsupported file: ${rejected.join(', ')} — expected ${[...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS].join(' ')}`
      );
    }
  }

  function drop(event: React.DragEvent): void {
    event.preventDefault();
    ingest(event.dataTransfer.files);
    setIsOver(false);
  }

  // One hidden input for every picker; `accept` narrows it to what the button offers.
  function browse(extensions = [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS]): void {
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
        setThumbnail(await api.thumbnail(pathFor(video)));
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
    api.probe(pathFor(video)).then((data) => {
      if (!cancelled) setProbeData(data);
    });
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
        ? 'Added subtitles'
        : undefined;

  const canPlay = !!video && !!device && !casting && connection?.state !== 'CONNECTING';

  async function play(): Promise<void> {
    if (!video || !device || !connection) {
      return;
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
      // After Stop the device stays picked but disconnected.
      if (connection.state !== 'CONNECTED' && !(await onConnect(device))) {
        return;
      }
      await api.load(pathFor(video), subsArg, audioSelection?.index, effectiveBurn);
      setNowPlaying({
        thumbnail,
        title,
        details: [eyebrow, subtitlesLabel].filter(Boolean).join(' · ') || undefined,
      });
      setBrowsing(false);
    } catch (err) {
      setCastError(errorMessage(err));
    } finally {
      setCasting(false);
    }
  }

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
        accept={[...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS].join(',')}
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
                A movie or an episode, in MP4, MKV or AVI. Drop its subtitle file along with it, or
                find subtitles online afterwards.
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
            {devices('Play on')}
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
                    <AudioSelector videoFile={video} onChange={setAudioSelection} />
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
                        <span>
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
                        </span>
                      </Tooltip>
                    </>
                  }
                >
                  <SubtitlesSelector
                    subFile={subs}
                    videoFile={video}
                    deviceType={device?.type}
                    onChange={setSubtitlesSelection}
                  />
                  {showBurnToggle && (
                    <Tooltip
                      placement="top"
                      enterDelay={300}
                      title={
                        forceBurn
                          ? 'These subtitles are images (e.g. Blu-ray PGS) — they can only be shown by burning them into the video.'
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

const linkSx = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
} as const;

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

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}
