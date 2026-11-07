import {
  AddRounded,
  ArrowBackRounded,
  Forward10Rounded,
  PauseRounded,
  PlayArrowRounded,
  RemoveRounded,
  Replay10Rounded,
} from '@mui/icons-material';
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  IconButton,
  Link,
  MenuItem,
  Select,
  Slider,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import format from 'format-duration';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SubtitleCue, SubtitleTiming } from '../../../shared/subtitleSearch';
import { errorMessage } from '../ipc';
import { tonalSx } from '../theme';
import type { PreviewUrls, SubtitleSyncBackend } from './subtitleBackends';

export type SyncSource = { name: string; pathOrIndex: string | number };

type Props = {
  open: boolean;
  // The subtitles' name, shown under the title.
  name?: string;
  // Previews the video ready with its subtitles and uses the timing picked, from the
  // window or the phone. Keep it stable (memoized): a new one starts over.
  backend: SubtitleSyncBackend;
  onClose: () => void;
};

// Subtitles timed for one frame rate played over a release at another drift linearly
// (PAL speed-up is 4%). ratio = subtitle fps / video fps.
const FRAME_RATE_FIXES = [
  { label: 'No frame rate fix', ratio: 1 },
  { label: '25 → 23.976 fps', ratio: 25 / (24000 / 1001) },
  { label: '23.976 → 25 fps', ratio: 24000 / 1001 / 25 },
  { label: '25 → 24 fps', ratio: 25 / 24 },
  { label: '24 → 25 fps', ratio: 24 / 25 },
  { label: '24 → 23.976 fps', ratio: 24 / (24000 / 1001) },
  { label: '23.976 → 24 fps', ratio: 24000 / 1001 / 24 },
];

const NO_TIMING: SubtitleTiming = { offset: 0, ratio: 1 };

// The window's "Fix timing", and the phone remote's.
export default function SubtitleSyncDialog({
  open,
  name,
  backend,
  onClose,
}: Props): React.JSX.Element {
  // A phone, or a narrow window: the lines go under the video.
  const compact = useMediaQuery((theme) => theme.breakpoints.down('md'));
  const videoRef = useRef<HTMLVideoElement>(null);
  // A transcoded seek swaps the stream; keep playing across it.
  const resumeAfterLoad = useRef(false);
  const [preview, setPreview] = useState<PreviewUrls | undefined>();
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  // Transcoded streams restart at the seek point: `base` is where the current one began.
  const [mode, setMode] = useState<'direct' | 'transcode'>('direct');
  const [base, setBase] = useState(0);
  const [src, setSrc] = useState<string | undefined>();
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [timing, setTiming] = useState<SubtitleTiming>(NO_TIMING);
  const [error, setError] = useState<string | undefined>();
  const [applying, setApplying] = useState(false);
  const [showRateFix, setShowRateFix] = useState(false);

  const duration = preview?.duration ?? 0;
  const changed = timing.offset !== 0 || timing.ratio !== 1;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(undefined);
    setTiming(NO_TIMING);
    setShowRateFix(false);
    setPlaying(false);
    setSrc(undefined);
    backend
      .start()
      .then(({ preview: p, cues: c }) => {
        if (cancelled) return;
        setPreview(p);
        setCues(c);
        // Land on dialogue rather than on opening credits.
        const start = c.length > 0 ? Math.max(0, c[Math.floor(c.length / 10)].start - 2) : 0;
        if (p.directUrl) {
          setMode('direct');
          setBase(0);
          setSrc(`${p.directUrl}#t=${start}`);
        } else {
          setMode('transcode');
          setBase(start);
          setSrc(`${p.transcodeUrl}?t=${start}`);
        }
        setTime(start);
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
      backend.stop();
    };
  }, [open, backend]);

  // Smooth clock for the overlay: timeupdate only fires ~4×/s.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (): void => {
      const video = videoRef.current;
      if (video) setTime(base + video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, base]);

  function seek(target: number): void {
    const t = Math.min(Math.max(0, target), duration || target);
    setTime(t);
    if (!preview) return;
    if (mode === 'direct') {
      if (videoRef.current) videoRef.current.currentTime = t;
    } else {
      resumeAfterLoad.current = playing;
      setBase(t);
      setSrc(`${preview.transcodeUrl}?t=${t}`);
    }
  }

  function togglePlay(): void {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }

  // Chromium couldn't decode the file after all: fall back to the transcoder.
  function onVideoError(): void {
    if (mode === 'direct' && preview) {
      resumeAfterLoad.current = playing;
      setMode('transcode');
      setBase(time);
      setSrc(`${preview.transcodeUrl}?t=${time}`);
    } else {
      setError('The preview could not be played.');
    }
  }

  const shown = (c: SubtitleCue): { start: number; end: number } => ({
    start: c.start * timing.ratio + timing.offset,
    end: c.end * timing.ratio + timing.offset,
  });
  const activeCue = cues.find((c) => {
    const s = shown(c);
    return s.start <= time && time < s.end;
  });

  // The lines around now, to click "this line starts now" on.
  const nearby = useMemo(() => {
    const next = cues.findIndex((c) => c.start * timing.ratio + timing.offset > time);
    const at = next === -1 ? cues.length : next;
    return cues.slice(Math.max(0, at - 3), at + 2);
  }, [cues, timing, time]);

  function nudge(delta: number): void {
    setTiming((t) => ({ ...t, offset: Math.round((t.offset + delta) * 10) / 10 }));
  }

  function alignToNow(cue: SubtitleCue): void {
    setTiming((t) => ({ ...t, offset: Math.round((time - cue.start * t.ratio) * 10) / 10 }));
  }

  function apply(): void {
    setApplying(true);
    backend
      .apply(timing, changed)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setApplying(false));
  }

  const offsetWord = timing.offset > 0 ? 'later' : timing.offset < 0 ? 'earlier' : 'on time';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      slotProps={{
        paper: {
          sx: {
            borderRadius: 0,
            bgcolor: 'tonal.surface',
          },
        },
      }}
    >
      {/* The window's title bar area: keep it draggable, the system controls sit over it. */}
      {!compact && <Box sx={{ height: 32, flexShrink: 0, appRegion: 'drag' }} />}

      <Stack
        direction="row"
        spacing={1.75}
        sx={{ alignItems: 'center', px: compact ? 1.5 : 4, pt: 1.5, pb: compact ? 1.5 : 2.25 }}
      >
        <IconButton onClick={onClose} aria-label="Back" sx={{ color: 'text.secondary' }}>
          <ArrowBackRounded />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h1" sx={{ fontSize: compact ? 20 : 26 }}>
            Are the subtitles in time?
          </Typography>
          <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>
            {name}
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={apply}
          disabled={applying || !src}
          startIcon={applying ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ height: 46, px: compact ? 2 : 3, fontSize: 15, fontWeight: 700, flexShrink: 0 }}
        >
          {changed ? 'Use new timing' : 'Looks good'}
        </Button>
      </Stack>

      <Stack
        direction={compact ? 'column' : 'row'}
        spacing={2.5}
        sx={{
          flex: 1,
          minHeight: 0,
          px: compact ? 1.5 : 4,
          pb: 3,
          overflowY: compact ? 'auto' : undefined,
        }}
      >
        <Stack
          spacing={1.5}
          sx={{
            flex: compact ? undefined : 1,
            minWidth: 0,
            minHeight: 0,
            overflowY: compact ? undefined : 'auto',
          }}
        >
          <Box
            sx={{
              position: 'relative',
              // A flex child shrinks to whatever height is left; the controls below
              // should scroll instead. The cap keeps them reachable on short windows.
              flexShrink: 0,
              aspectRatio: '16 / 9',
              maxHeight: '52vh',
              backgroundColor: 'black',
              borderRadius: '16px',
              overflow: 'hidden',
            }}
          >
            {src && (
              <video
                ref={videoRef}
                src={src}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onWaiting={() => setBuffering(true)}
                onPlaying={() => setBuffering(false)}
                onCanPlay={(e) => {
                  setBuffering(false);
                  if (resumeAfterLoad.current) {
                    resumeAfterLoad.current = false;
                    void e.currentTarget.play().catch(() => {});
                  }
                }}
                onLoadStart={() => setBuffering(true)}
                onTimeUpdate={(e) => !playing && setTime(base + e.currentTarget.currentTime)}
                onError={onVideoError}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              >
                <track kind="captions" />
              </video>
            )}
            {(!src || buffering) && !error && (
              <CircularProgress
                sx={{ position: 'absolute', top: '50%', left: '50%', mt: -2.5, ml: -2.5 }}
              />
            )}
            {activeCue && (
              <Typography
                sx={{
                  position: 'absolute',
                  left: '5%',
                  right: '5%',
                  bottom: '7%',
                  textAlign: 'center',
                  whiteSpace: 'pre-line',
                  color: 'white',
                  fontSize: 'clamp(14px, 2.4vw, 22px)',
                  fontWeight: 500,
                  textShadow: '0 0 4px black, 0 0 2px black, 1px 1px 2px black',
                  pointerEvents: 'none',
                }}
              >
                {activeCue.text}
              </Typography>
            )}
          </Box>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <IconButton
              onClick={togglePlay}
              disabled={!src}
              aria-label={playing ? 'Pause' : 'Play'}
              sx={{
                borderRadius: '14px',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.88) },
              }}
            >
              {playing ? <PauseRounded /> : <PlayArrowRounded />}
            </IconButton>
            <IconButton
              onClick={() => seek(time - 10)}
              disabled={!src}
              aria-label="Back 10 seconds"
            >
              <Replay10Rounded />
            </IconButton>
            <IconButton
              onClick={() => seek(time + 10)}
              disabled={!src}
              aria-label="Forward 10 seconds"
            >
              <Forward10Rounded />
            </IconButton>
            <Slider
              size="small"
              aria-label="Position"
              min={0}
              max={duration || 1}
              value={Math.min(time, duration || 1)}
              onChange={(_e, v) => setTime(v as number)}
              onChangeCommitted={(_e, v) => seek(v as number)}
              disabled={!src}
              sx={{ mx: 1.5 }}
            />
            <Typography
              sx={{
                fontSize: 12,
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {format(time * 1000)} / {format(duration * 1000)}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{
              alignItems: 'center',
              flexWrap: 'wrap',
              px: 2.25,
              py: 1.5,
              borderRadius: '24px',
              bgcolor: 'tonal.surfaceContainer',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ color: 'text.secondary' }}>Subtitles show</Typography>
            <Stack
              direction="row"
              spacing={1.25}
              sx={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <Button
                onClick={() => nudge(-1)}
                sx={[tonalSx, { minWidth: 0, px: 1.25, height: 32 }]}
              >
                −1 s
              </Button>
              <IconButton
                onClick={() => nudge(-0.1)}
                aria-label="Earlier by 0.1 second"
                sx={tonalSx}
              >
                <RemoveRounded />
              </IconButton>
              <Stack sx={{ minWidth: 104, alignItems: 'center' }}>
                <Typography
                  sx={{
                    fontSize: 26,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    color: changed ? 'primary.main' : 'text.primary',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.abs(timing.offset).toFixed(1)} s
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{offsetWord}</Typography>
              </Stack>
              <IconButton onClick={() => nudge(0.1)} aria-label="Later by 0.1 second" sx={tonalSx}>
                <AddRounded />
              </IconButton>
              <Button
                onClick={() => nudge(1)}
                sx={[tonalSx, { minWidth: 0, px: 1.25, height: 32 }]}
              >
                +1 s
              </Button>
            </Stack>
            <Link
              component="button"
              onClick={() => setTiming(NO_TIMING)}
              disabled={!changed}
              sx={{
                fontSize: 13,
                fontFamily: 'inherit',
                visibility: changed ? 'visible' : 'hidden',
              }}
            >
              Reset
            </Link>
          </Stack>

          {showRateFix || timing.ratio !== 1 ? (
            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}
            >
              <Select
                size="small"
                value={timing.ratio}
                onChange={(e) => setTiming((t) => ({ ...t, ratio: Number(e.target.value) }))}
                sx={{ minWidth: 200 }}
              >
                {FRAME_RATE_FIXES.map((f) => (
                  <MenuItem key={f.label} value={f.ratio}>
                    {f.label}
                  </MenuItem>
                ))}
              </Select>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                For subtitles that drift further off as the video goes on.
              </Typography>
            </Stack>
          ) : (
            <Link
              component="button"
              onClick={() => setShowRateFix(true)}
              sx={{ alignSelf: 'flex-start', fontSize: 13, fontFamily: 'inherit' }}
            >
              Getting worse as it plays? Fix the frame rate
            </Link>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>

        <Stack spacing={1.25} sx={{ width: compact ? 'auto' : 270, flexShrink: 0, minHeight: 0 }}>
          <Typography sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
            Or pause right as someone speaks, then tap that line:
          </Typography>
          <Stack spacing={0.75} sx={{ overflowY: 'auto', minHeight: 0 }}>
            {nearby.map((c) => {
              const current = c === activeCue;
              return (
                <ButtonBase
                  key={`${c.start}-${c.text}`}
                  onClick={() => alignToNow(c)}
                  sx={{
                    display: 'block',
                    textAlign: 'left',
                    px: 1.75,
                    py: current ? 1.5 : 1.25,
                    borderRadius: '16px',
                    fontSize: current ? 14 : 13,
                    fontWeight: current ? 600 : 400,
                    color: current ? 'tonal.onPrimaryContainer' : 'tonal.onSurface',
                    bgcolor: current ? 'tonal.primaryContainer' : 'tonal.surfaceContainer',
                    '&:hover': {
                      bgcolor: current ? 'tonal.primaryContainer' : 'tonal.surfaceContainerHigh',
                    },
                  }}
                >
                  <Box
                    component="span"
                    sx={{ display: 'block', fontSize: 11, opacity: 0.6, mb: 0.25 }}
                  >
                    {format(shown(c).start * 1000)}
                  </Box>
                  {c.text.replace(/\n/g, ' ')}
                </ButtonBase>
              );
            })}
          </Stack>
        </Stack>
      </Stack>
    </Dialog>
  );
}
