import {
  CloseRounded,
  Forward30Rounded,
  PauseRounded,
  PlayArrowRounded,
  Replay10Rounded,
  StopRounded,
  TvRounded,
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  IconButton,
  Slider,
  Snackbar,
  Stack,
  ThemeProvider,
  Typography,
  useMediaQuery,
} from '@mui/material';
import format from 'format-duration';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SubtitleCue } from '../../../shared/subtitleSearch';
import type { PlayerStatus, PlayingTracks, TorrentStats } from '../../../shared/types';
import LiveSubtitles from '../components/LiveSubtitles';
import { TorrentChip } from '../components/Torrent';
import TrackSwitcher from '../components/TrackSwitcher';
import { episodeLabel } from '../labels';
import { SeekHold } from '../seekHold';
import { cardSx, DEFAULT_ACCENT, makeTheme, tonalSx } from '../theme';
import { connectEvents, type RemoteState, remote } from './client';
import ReadyCard from './ReadyCard';

// The TV's position as last reported, and when, so the phone can run it forward
// between the once-a-second status pushes.
type Clock = { time: number; at: number };

type Preview = { src: string; start: number; direct: boolean; transcodeUrl: string };

export default function RemoteApp(): React.JSX.Element {
  const [state, setState] = useState<RemoteState>();
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [clock, setClock] = useState<Clock>({ time: 0, at: 0 });
  const [seekHold] = useState(() => new SeekHold());
  const [now, setNow] = useState(() => performance.now());
  const [stats, setStats] = useState<TorrentStats[]>([]);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [offset, setOffset] = useState(0);
  const [subtitleScale, setSubtitleScale] = useState(1);
  const [tracks, setTracks] = useState<PlayingTracks>();
  const [connected, setConnected] = useState(true);
  const [loadCount, setLoadCount] = useState(0);
  const [dragValue, setDragValue] = useState<number>();
  const [preview, setPreview] = useState<Preview>();
  const [previewTime, setPreviewTime] = useState(0);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const video = useRef<HTMLVideoElement>(null);

  const dark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const theme = useMemo(
    () => makeTheme(dark ? 'dark' : 'light', state?.accentColor ?? DEFAULT_ACCENT),
    [dark, state?.accentColor]
  );

  const applyStatus = useCallback(
    (s: PlayerStatus | null, position: number) => {
      setStatus(s);
      // Keep running from a seek target until the TV reports getting there.
      if (seekHold.shown(position) !== position) return;
      setClock({ time: position, at: performance.now() });
    },
    [seekHold]
  );

  // `loaded`: the TV got a new video or subtitles (new cues, offset moot). `reconnected`:
  // anything may have changed meanwhile. Otherwise only the state is fetched again (a scan,
  // the window's context): extracting cues is costly.
  const refresh = useCallback(
    async (reason: 'loaded' | 'reconnected' | 'state') => {
      const loaded = reason === 'loaded';
      try {
        const s = await remote.state();
        setState(s);
        applyStatus(s.status, s.position);
        setSubtitleScale(s.subtitleScale);
        if (loaded) setLoadCount((n) => n + 1);
        if (reason !== 'state') {
          setCues(s.nowPlaying?.hasSubtitles ? await remote.cues() : []);
          const t = s.nowPlaying ? await remote.tracks() : undefined;
          setTracks(t);
          // A new load: start from what is applied, not from what was being tried.
          if (loaded) setOffset(t?.subtitleOffset ?? 0);
        }
      } catch (err) {
        setMessage({ text: messageOf(err), error: true });
      }
    },
    [applyStatus]
  );

  useEffect(
    () =>
      connectEvents({
        status: (s) => applyStatus(s, s.currentTime),
        torrents: setStats,
        subtitleScale: setSubtitleScale,
        nowPlaying: () => void refresh('loaded'),
        scan: () => void refresh('state'),
        context: () => void refresh('state'),
        // Also after a reconnect: whatever happened meanwhile was missed.
        open: () => {
          setConnected(true);
          void refresh('reconnected');
        },
        error: () => setConnected(false),
      }),
    [applyStatus, refresh]
  );

  const playing = status?.playerState === 'PLAYING';
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(timer);
  }, [playing]);

  const duration = status?.duration || 0;
  const elapsed = playing ? Math.max(0, now - clock.at) / 1000 : 0;
  const tvTime = Math.min(clock.time + elapsed, duration || Number.POSITIVE_INFINITY);
  const position = dragValue ?? tvTime;

  async function act(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (err) {
      setMessage({ text: messageOf(err), error: true });
    }
  }

  function seek(time: number): void {
    const target = Math.max(0, Math.min(time, duration || time));
    seekHold.hold(target);
    setClock({ time: target, at: performance.now() });
    void act(() => remote.seek(target));
  }

  async function applyOffset(value: number): Promise<void> {
    try {
      await remote.applyOffset(value);
      // The nowPlaying push that follows reloads the cues and resets the offset.
      setMessage({ text: 'Subtitles updated on the TV' });
    } catch (err) {
      setMessage({ text: messageOf(err), error: true });
    }
  }

  async function openPreview(): Promise<void> {
    try {
      const source = await remote.startPreview();
      const start = Math.floor(tvTime);
      setPreview(
        source.directUrl
          ? { src: source.directUrl, start: 0, direct: true, transcodeUrl: source.transcodeUrl }
          : {
              src: `${source.transcodeUrl}?t=${start}`,
              start,
              direct: false,
              transcodeUrl: source.transcodeUrl,
            }
      );
      setPreviewTime(start);
    } catch (err) {
      setMessage({ text: messageOf(err), error: true });
    }
  }

  function closePreview(): void {
    setPreview(undefined);
    void remote.stopPreview().catch(() => {});
  }

  // Back to where the TV is. The transcoded stream can't seek: restart it there.
  function previewToTv(): void {
    const el = video.current;
    if (!preview || !el) return;
    if (preview.direct) {
      el.currentTime = tvTime;
    } else {
      const start = Math.floor(tvTime);
      setPreview({ ...preview, src: `${preview.transcodeUrl}?t=${start}`, start });
    }
  }

  const nowPlaying = state?.nowPlaying;
  const release = nowPlaying?.release;
  const title = release?.title || nowPlaying?.fileName || '';
  const eyebrow = release ? episodeLabel(release) : undefined;
  const cueAt = (time: number): SubtitleCue | undefined =>
    cues.find((c) => time >= c.start + offset && time < c.end + offset);
  const previewLine = preview ? cueAt(previewTime) : undefined;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100dvh', bgcolor: 'tonal.surface' }}>
        <Stack spacing={1.5} sx={{ maxWidth: 560, mx: 'auto', p: 2, pb: 4 }}>
          {!connected && (
            <Alert severity="warning">Lost the connection to the computer. Retrying…</Alert>
          )}

          {!state && connected && (
            <Stack sx={{ alignItems: 'center', py: 8 }}>
              <CircularProgress />
            </Stack>
          )}

          {state && !nowPlaying && !state.prepared && (
            <Stack spacing={1} sx={{ ...cardSx, p: 3, alignItems: 'center', textAlign: 'center' }}>
              <TvRounded sx={{ fontSize: 40, color: 'text.secondary' }} />
              <Typography variant="h2">Nothing is ready</Typography>
              <Typography sx={{ color: 'text.secondary' }}>
                Pick a video on the computer. You can then start it from here.
              </Typography>
            </Stack>
          )}

          {state && !nowPlaying && state.prepared && (
            <ReadyCard
              prepared={state.prepared}
              devices={state.devices}
              deviceId={state.deviceId}
              secondary={false}
            />
          )}

          {nowPlaying && (
            <>
              <Stack spacing={1.5} sx={{ ...cardSx, p: 1.5, borderRadius: '28px' }}>
                <Box
                  component="img"
                  alt=""
                  src={`artwork?n=${loadCount}`}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    e.currentTarget.style.visibility = 'hidden';
                  }}
                  sx={{
                    width: '100%',
                    aspectRatio: '16 / 9',
                    objectFit: 'cover',
                    borderRadius: '20px',
                    bgcolor: 'tonal.surfaceContainerHigh',
                  }}
                />
                <Stack spacing={0.5} sx={{ px: 1 }}>
                  {eyebrow && (
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'primary.main' }}>
                      {eyebrow}
                    </Typography>
                  )}
                  <Typography variant="h2" sx={{ wordBreak: 'break-word' }}>
                    {title}
                  </Typography>
                  <Stack
                    direction="row"
                    useFlexGap
                    sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center', pt: 0.5 }}
                  >
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', flex: 1 }}>
                      {stateLabel(status)} {nowPlaying.deviceName}
                    </Typography>
                    {nowPlaying.infoHash && (
                      <TorrentChip stats={stats.find((s) => s.infoHash === nowPlaying.infoHash)} />
                    )}
                  </Stack>
                </Stack>
              </Stack>

              <Box sx={{ ...cardSx, px: 2.5, pt: 1.5, pb: 2 }}>
                <Slider
                  aria-label="Position"
                  min={0}
                  max={duration || 100}
                  value={position}
                  disabled={!duration}
                  onChange={(_e, value) => setDragValue(value)}
                  onChangeCommitted={(_e, value) => {
                    setDragValue(undefined);
                    seek(value);
                  }}
                  sx={{ height: 6, py: 1.5 }}
                />
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: 'text.secondary',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span>{format(position * 1000)}</span>
                  <span>
                    {duration ? `−${format(Math.max(0, duration - position) * 1000)}` : ''}
                  </span>
                </Stack>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ justifyContent: 'center', alignItems: 'center', mt: 1 }}
                >
                  <IconButton aria-label="Back 10 seconds" onClick={() => seek(tvTime - 10)}>
                    <Replay10Rounded sx={{ fontSize: 32 }} />
                  </IconButton>
                  <IconButton
                    aria-label={playing ? 'Pause' : 'Play'}
                    onClick={() => void act(() => (playing ? remote.pause() : remote.play()))}
                    sx={{
                      width: 72,
                      height: 72,
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': { bgcolor: 'primary.dark' },
                    }}
                  >
                    {playing ? (
                      <PauseRounded sx={{ fontSize: 40 }} />
                    ) : (
                      <PlayArrowRounded sx={{ fontSize: 40 }} />
                    )}
                  </IconButton>
                  <IconButton aria-label="Forward 30 seconds" onClick={() => seek(tvTime + 30)}>
                    <Forward30Rounded sx={{ fontSize: 32 }} />
                  </IconButton>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'center', mt: 1.5 }}>
                  <Button
                    startIcon={<StopRounded />}
                    onClick={() => void act(() => remote.stop())}
                    sx={tonalSx}
                  >
                    Stop
                  </Button>
                </Stack>
              </Box>

              {tracks && (
                <Stack spacing={1.5} sx={{ ...cardSx, p: 2 }}>
                  <Typography sx={{ fontWeight: 600 }}>Audio & subtitles</Typography>
                  <TrackSwitcher
                    tracks={tracks}
                    onChange={(change) => act(() => remote.changeTracks(change))}
                  />
                </Stack>
              )}

              {cues.length > 0 && (
                <Stack spacing={1.5} sx={{ ...cardSx, p: 2 }}>
                  <Typography sx={{ fontWeight: 600 }}>Subtitles</Typography>
                  <LiveSubtitles
                    cues={cues}
                    time={tvTime}
                    offset={offset}
                    applied={tracks?.subtitleOffset ?? 0}
                    onOffsetChange={setOffset}
                    onApplyOffset={applyOffset}
                    scale={nowPlaying.resizableSubtitles ? subtitleScale : undefined}
                    onScaleChange={(value) => {
                      setSubtitleScale(value);
                      void act(() => remote.setSubtitleScale(value));
                    }}
                  />
                </Stack>
              )}

              <Stack spacing={1.5} sx={{ ...cardSx, p: 2 }}>
                <Stack direction="row" sx={{ alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 600, flex: 1 }}>Watch on the phone</Typography>
                  {preview ? (
                    <IconButton aria-label="Close the preview" onClick={closePreview}>
                      <CloseRounded />
                    </IconButton>
                  ) : (
                    <Button onClick={() => void openPreview()} sx={tonalSx}>
                      Open
                    </Button>
                  )}
                </Stack>
                {!preview && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                    A small copy of the video, starting where the TV is, with the subtitles over it
                    — handy for checking their timing.
                  </Typography>
                )}
                {preview && (
                  <>
                    <Box sx={{ position: 'relative', borderRadius: '16px', overflow: 'hidden' }}>
                      <Box
                        component="video"
                        ref={video}
                        src={preview.src}
                        autoPlay
                        muted
                        playsInline
                        controls
                        onLoadedMetadata={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                          if (preview.direct) e.currentTarget.currentTime = tvTime;
                        }}
                        onTimeUpdate={(e: React.SyntheticEvent<HTMLVideoElement>) =>
                          setPreviewTime(preview.start + e.currentTarget.currentTime)
                        }
                        // Chromium can't decode it after all: fall back to the encoder.
                        onError={() => {
                          if (!preview.direct) return;
                          const start = Math.floor(tvTime);
                          setPreview({
                            ...preview,
                            src: `${preview.transcodeUrl}?t=${start}`,
                            start,
                            direct: false,
                          });
                        }}
                        sx={{ width: '100%', display: 'block', bgcolor: '#000' }}
                      />
                      {previewLine && (
                        <Box
                          sx={{
                            position: 'absolute',
                            left: 8,
                            right: 8,
                            bottom: 48,
                            textAlign: 'center',
                            pointerEvents: 'none',
                          }}
                        >
                          <Box
                            component="span"
                            sx={{
                              bgcolor: 'rgba(0,0,0,0.7)',
                              color: '#fff',
                              px: 1,
                              py: 0.25,
                              borderRadius: '4px',
                              fontSize: 14,
                              whiteSpace: 'pre-line',
                              boxDecorationBreak: 'clone',
                            }}
                          >
                            {previewLine.text}
                          </Box>
                        </Box>
                      )}
                    </Box>
                    <Button onClick={previewToTv} sx={[tonalSx, { alignSelf: 'flex-start' }]}>
                      Jump to where the TV is
                    </Button>
                  </>
                )}
              </Stack>
              {state?.prepared && (
                <ReadyCard
                  prepared={state.prepared}
                  devices={state.devices}
                  deviceId={state.deviceId}
                  secondary
                />
              )}
            </>
          )}
        </Stack>
      </Box>
      <Snackbar
        open={!!message}
        autoHideDuration={message?.error ? 6000 : 3000}
        onClose={() => setMessage(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={message?.error ? 'error' : 'success'}
          variant="filled"
          onClose={() => setMessage(undefined)}
        >
          {message?.text}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
}

function stateLabel(status: PlayerStatus | null): string {
  switch (status?.playerState) {
    case 'PLAYING':
      return 'Playing on';
    case 'PAUSED':
      return 'Paused on';
    case 'BUFFERING':
      return 'Loading on';
    default:
      return 'On';
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
