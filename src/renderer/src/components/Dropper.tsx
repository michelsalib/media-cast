import {
  AddRounded,
  ArrowBackRounded,
  AutoAwesomeRounded,
  BoltRounded,
  FileDownloadRounded,
  PlayArrowRounded,
} from '@mui/icons-material';
import {
  Alert,
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
import { glassSx } from '../theme';
import { AmbientBackdrop, Artwork, useObjectUrl } from './Artwork';
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

  function browse(): void {
    fileInput.current?.click();
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
      <AmbientBackdrop url={view === 'playing' ? nowPlayingUrl : thumbnailUrl} />
      <input
        ref={fileInput}
        type="file"
        accept={[...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS].join(',')}
        multiple
        hidden
        onChange={onFilesPicked}
      />

      {/* 32px: the title bar drawn over this by App. */}
      <Stack sx={{ position: 'relative', zIndex: 1, height: '100%', pt: '32px' }}>
        {view === 'playing' && status && device && (
          <Player
            status={status}
            device={device}
            artworkUrl={nowPlayingUrl}
            title={nowPlaying?.title || status.title || 'Now playing'}
            details={nowPlaying?.details}
            onBrowse={browse}
            onStop={onStop}
          />
        )}

        {view === 'empty' && (
          <Stack sx={{ flex: 1, minHeight: 0, px: 4 }}>
            <Stack
              sx={{
                flex: 1,
                minHeight: 0,
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              <Illustration />
              <Typography variant="h1" sx={{ mt: 2.5 }}>
                What are we watching?
              </Typography>
              <Typography sx={{ mt: 1.25, fontSize: 16, color: 'text.secondary' }}>
                Drop a movie or an episode anywhere in this window.
              </Typography>
              <Button
                size="large"
                onClick={browse}
                startIcon={<AddRounded />}
                sx={{
                  mt: 3,
                  bgcolor: '#FFFFFF',
                  color: '#0B0C14',
                  '&:hover': { bgcolor: '#E8EAF2' },
                }}
              >
                Choose a video
              </Button>
              <Typography sx={{ mt: 1.5, fontSize: 12, color: '#9DA2B8' }}>
                Subtitles too — drop them in with the video, or find them online later.
              </Typography>
            </Stack>
            <Box sx={{ pb: 3.5 }}>{devices('Ready to play on')}</Box>
          </Stack>
        )}

        {view === 'ready' && video && (
          <Stack sx={{ flex: 1, minHeight: 0 }}>
            <Stack
              spacing={3.25}
              sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 4, pt: 2.25, pb: 2 }}
            >
              {active && (
                <Button
                  onClick={() => setBrowsing(false)}
                  startIcon={<ArrowBackRounded />}
                  sx={{ ...glassSx, alignSelf: 'flex-start', height: 32 }}
                >
                  Now playing
                </Button>
              )}
              <Stack direction="row" spacing={3.5} sx={{ alignItems: 'flex-end' }}>
                <Artwork url={thumbnailUrl} sx={{ width: 'min(320px, 38%)' }} />
                <Stack spacing={1} sx={{ flex: 1, minWidth: 0, pb: 0.5 }}>
                  {eyebrow && (
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'primary.light' }}>
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
                    sx={{
                      gap: 0.5,
                      mt: 0.75,
                      ml: compat && device ? 0 : -2,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    {compat && device && <CompatPill report={compat} deviceName={device.name} />}
                    <VideoInfoButton video={video} />
                    <Button
                      size="small"
                      onClick={browse}
                      sx={{ color: 'text.secondary', fontWeight: 500 }}
                    >
                      Change
                    </Button>
                  </Stack>
                </Stack>
              </Stack>

              <Stack spacing={2}>
                {hasAudio && (
                  <TrackRow label="Audio">
                    <AudioSelector videoFile={video} onChange={setAudioSelection} />
                  </TrackRow>
                )}
                <TrackRow label="Subtitles">
                  <Stack spacing={1.25}>
                    <SubtitlesSelector
                      subFile={subs}
                      videoFile={video}
                      deviceType={device?.type}
                      onChange={setSubtitlesSelection}
                    />
                    <Stack
                      direction="row"
                      useFlexGap
                      sx={{ gap: 2.25, alignItems: 'center', flexWrap: 'wrap', minHeight: 32 }}
                    >
                      <Link component="button" onClick={() => setSearchOpen(true)} sx={linkSx}>
                        Find more online
                      </Link>
                      {syncableSelection && (
                        <Link
                          component="button"
                          onClick={() => setSyncSource(syncableSelection)}
                          sx={linkSx}
                        >
                          Adjust timing
                        </Link>
                      )}
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
                            sx={{ m: 0, gap: 0.5 }}
                          />
                        </Tooltip>
                      )}
                    </Stack>
                  </Stack>
                </TrackRow>
              </Stack>
            </Stack>

            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'flex-end', px: 4, pt: 1, pb: 3.5 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>{devices('Play on')}</Box>
              <Button
                variant="contained"
                size="large"
                onClick={() => void play()}
                disabled={!canPlay}
                startIcon={
                  casting ? <CircularProgress size={18} color="inherit" /> : <PlayArrowRounded />
                }
                sx={{ flexShrink: 0, maxWidth: 300, mb: 0.75 }}
              >
                <Box
                  component="span"
                  sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {device ? `Play on ${device.name}` : 'Pick a screen'}
                </Box>
              </Button>
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
          backgroundColor: 'rgba(11,12,20,0.7)',
          backdropFilter: 'blur(6px)',
          flexDirection: 'column',
          gap: 2,
          zIndex: theme.zIndex.modal + 1,
        })}
      >
        <Box
          sx={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'primary.main',
            border: '2px dashed',
            borderColor: 'primary.main',
            bgcolor: 'rgba(94,242,192,0.1)',
          }}
        >
          <FileDownloadRounded sx={{ fontSize: 40 }} />
        </Box>
        <Typography variant="h2">Drop it here</Typography>
      </Backdrop>
    </Box>
  );
}

const linkSx = { fontSize: 13, fontWeight: 500, fontFamily: 'inherit' } as const;

function TrackRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1.75} sx={{ alignItems: 'flex-start' }}>
      <Typography sx={{ width: 82, flexShrink: 0, pt: 1, fontSize: 13, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

// Decorative: a few poster cards fanned out, the front one with a play button.
function Illustration(): React.JSX.Element {
  const card = {
    position: 'absolute',
    top: 34,
    width: 150,
    height: 100,
    borderRadius: '16px',
    boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  } as const;
  return (
    <Box aria-hidden sx={{ position: 'relative', width: 300, height: 160, flexShrink: 0 }}>
      <Box
        sx={{
          ...card,
          left: 10,
          transform: 'rotate(-12deg)',
          background: 'linear-gradient(160deg, #FF8A5B 0%, #E5487A 55%, #5B2A86 100%)',
        }}
      />
      <Box
        sx={{
          ...card,
          right: 10,
          transform: 'rotate(12deg)',
          background: 'linear-gradient(160deg, #6FD3FF 0%, #2E6BE6 60%, #1A2A6B 100%)',
        }}
      />
      <Box
        sx={{
          ...card,
          top: 14,
          left: 65,
          width: 170,
          height: 114,
          borderRadius: '18px',
          display: 'grid',
          placeItems: 'center',
          background:
            'radial-gradient(120% 60% at 20% 20%, rgba(94,242,192,0.7), transparent 60%),' +
            'radial-gradient(90% 50% at 85% 10%, rgba(181,108,245,0.7), transparent 60%),' +
            'linear-gradient(180deg, #0A0F2C 0%, #162B5C 50%, #0B1622 100%)',
          boxShadow: '0 24px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12)',
        }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            bgcolor: 'rgba(255,255,255,0.92)',
            color: '#0B0C14',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <PlayArrowRounded />
        </Box>
      </Box>
    </Box>
  );
}

function CompatPill({
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
            <Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Container:{' '}
              </Box>
              {report.container || 'unknown'}
            </Box>
            <Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Video:{' '}
              </Box>
              {report.videoCodec ?? 'unknown'}
            </Box>
            <Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Audio:{' '}
              </Box>
              {report.audioCodec ?? 'unknown'}
            </Box>
          </Stack>
          {report.issues.length > 0 && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <Box sx={{ fontSize: 11, color: 'text.secondary', mb: 0.25 }}>Why re-encode</Box>
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
          height: 28,
          px: 1.5,
          mr: 0.5,
          alignItems: 'center',
          borderRadius: 999,
          bgcolor: 'rgba(255,255,255,0.1)',
          fontSize: 12,
          color: '#E4E6F0',
          cursor: 'help',
          minWidth: 0,
        }}
      >
        {transcoding ? (
          <AutoAwesomeRounded sx={{ fontSize: 14 }} />
        ) : (
          <BoltRounded sx={{ fontSize: 14, color: 'primary.main' }} />
        )}
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {transcoding ? `We’ll convert it for ${deviceName}` : `Plays directly on ${deviceName}`}
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
