import { Close, Forward10, Pause, PlayArrow, Replay10, RestartAlt } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import format from 'format-duration';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SubtitleCue, SubtitleTiming } from '../../../shared/subtitleSearch';
import { api, errorMessage } from '../ipc';
import type { SubtitlesFile } from './SubtitlesSelection';

export type SyncSource = { name: string; pathOrIndex: string | number };

type Props = {
  videoPath: string;
  audioIndex?: number;
  // Open while set.
  source: SyncSource | undefined;
  onClose: () => void;
  // The subtitles to use: the source itself when untouched, else a resynced copy.
  onApply: (file: SubtitlesFile) => void;
};

type PreviewSource = Awaited<ReturnType<typeof api.startPreview>>;

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

export default function SubtitleSyncDialog({
  videoPath,
  audioIndex,
  source,
  onClose,
  onApply,
}: Props): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  // A transcoded seek swaps the stream; keep playing across it.
  const resumeAfterLoad = useRef(false);
  const [preview, setPreview] = useState<PreviewSource | undefined>();
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

  const open = !!source;
  const duration = preview?.duration ?? 0;
  const changed = timing.offset !== 0 || timing.ratio !== 1;

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setError(undefined);
    setTiming(NO_TIMING);
    setPlaying(false);
    setSrc(undefined);
    Promise.all([
      api.startPreview(videoPath, audioIndex),
      api.subtitleCues(videoPath, source.pathOrIndex),
    ])
      .then(([p, c]) => {
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
      void api.stopPreview();
    };
  }, [source, videoPath, audioIndex]);

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
    if (!source) return;
    if (!changed) {
      if (typeof source.pathOrIndex === 'string') {
        onApply({ name: source.name, path: source.pathOrIndex });
      } else {
        onClose();
      }
      return;
    }
    setApplying(true);
    api
      .retimeSubtitles(videoPath, source.pathOrIndex, timing)
      .then(onApply)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setApplying(false));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          Check subtitle sync
          <Typography noWrap variant="body2" sx={{ color: 'text.secondary' }}>
            {source?.name}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="close">
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box
          sx={{
            position: 'relative',
            // A flex child shrinks to whatever height is left; the controls below
            // should scroll instead. The cap keeps them reachable on short windows.
            flexShrink: 0,
            aspectRatio: '16 / 9',
            maxHeight: '62vh',
            backgroundColor: 'black',
            borderRadius: 1,
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
                bottom: '6%',
                textAlign: 'center',
                whiteSpace: 'pre-line',
                color: 'white',
                fontSize: 'clamp(14px, 2.6vw, 22px)',
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
          <IconButton onClick={togglePlay} disabled={!src}>
            {playing ? <Pause /> : <PlayArrow />}
          </IconButton>
          <IconButton onClick={() => seek(time - 10)} disabled={!src} size="small">
            <Replay10 />
          </IconButton>
          <IconButton onClick={() => seek(time + 10)} disabled={!src} size="small">
            <Forward10 />
          </IconButton>
          <Slider
            size="small"
            min={0}
            max={duration || 1}
            value={Math.min(time, duration || 1)}
            onChange={(_e, v) => setTime(v as number)}
            onChangeCommitted={(_e, v) => seek(v as number)}
            disabled={!src}
            sx={{ mx: 1 }}
          />
          <Typography
            variant="caption"
            sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
          >
            {format(time * 1000)} / {format(duration * 1000)}
          </Typography>
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1 }}>
              Delay
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <ButtonGroup size="small" variant="outlined">
                <Button onClick={() => nudge(-1)}>−1s</Button>
                <Button onClick={() => nudge(-0.1)}>−0.1</Button>
              </ButtonGroup>
              <Typography
                sx={{
                  minWidth: 64,
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                }}
              >
                {timing.offset > 0 ? '+' : ''}
                {timing.offset.toFixed(1)}s
              </Typography>
              <ButtonGroup size="small" variant="outlined">
                <Button onClick={() => nudge(0.1)}>+0.1</Button>
                <Button onClick={() => nudge(1)}>+1s</Button>
              </ButtonGroup>
              <Tooltip title="Reset">
                <span>
                  <IconButton size="small" onClick={() => setTiming(NO_TIMING)} disabled={!changed}>
                    <RestartAlt fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              + shows subtitles later, − earlier.
            </Typography>
            <Select
              size="small"
              value={timing.ratio}
              onChange={(e) => setTiming((t) => ({ ...t, ratio: Number(e.target.value) }))}
            >
              {FRAME_RATE_FIXES.map((f) => (
                <MenuItem key={f.label} value={f.ratio}>
                  {f.label}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Use a frame rate fix when subtitles drift further off as the video goes on.
            </Typography>
          </Stack>

          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1 }}>
              Sync on a line
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Pause right when a line is spoken, then click it.
            </Typography>
            <List dense disablePadding>
              {nearby.map((c) => (
                <ListItemButton
                  key={`${c.start}-${c.text}`}
                  selected={c === activeCue}
                  onClick={() => alignToNow(c)}
                  sx={{ borderRadius: 1, py: 0.25 }}
                >
                  <ListItemText
                    primary={c.text.replace(/\n/g, ' ')}
                    secondary={format(shown(c).start * 1000)}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Stack>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Back</Button>
        <Button variant="contained" onClick={apply} disabled={applying || !src}>
          {changed ? 'Use resynced subtitles' : 'Use these subtitles'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
