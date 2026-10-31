import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import type { SubtitleCue } from '../../../shared/subtitleSearch';
import { SUBTITLE_SCALES } from '../../../shared/subtitles';
import { chipSx, tonalSx } from '../theme';

type Props = {
  cues: SubtitleCue[];
  // Where the TV is, in seconds.
  time: number;
  // `cues` are at their original timing. `offset`: seconds added to every cue, the value
  // being tried; `applied`: the one on the TV now (both from the original timing).
  offset: number;
  applied: number;
  onOffsetChange: (offset: number) => void;
  onApplyOffset: (offset: number) => Promise<void>;
  // Set when the size can change on the TV (see NowPlaying.resizableSubtitles).
  scale?: number;
  onScaleChange?: (scale: number) => void;
};

// The subtitles playing, live: the current line, their size on the TV and a timing fix
// that reloads them shifted. The same in the window and on the phone remote.
export default function LiveSubtitles({
  cues,
  time,
  offset,
  applied,
  onOffsetChange,
  onApplyOffset,
  scale,
  onScaleChange,
}: Props): React.JSX.Element {
  const [applying, setApplying] = useState(false);
  const line = cues.find((c) => time >= c.start + offset && time < c.end + offset);

  async function apply(): Promise<void> {
    setApplying(true);
    try {
      await onApplyOffset(offset);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Stack spacing={1.5}>
      <SubtitleLine text={line?.text} />
      {scale !== undefined && onScaleChange && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mr: 0.5 }}>
            Size on the TV
          </Typography>
          {SUBTITLE_SCALES.map((s) => (
            <Button
              key={s.value}
              aria-label={s.label}
              title={s.label}
              onClick={() => onScaleChange(s.value)}
              sx={{ ...(chipSx(s.value === scale) as object), ...stepSx }}
            >
              {/* The letter grows with the size it stands for. */}
              <Box component="span" sx={{ fontSize: 11 * s.value + 3 }}>
                A
              </Box>
            </Button>
          ))}
        </Stack>
      )}
      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
        Lines appear here as the TV reaches them. Out of sync? Shift them until they match what you
        hear, then apply.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center' }}>
        {[-1, -0.1].map((step) => (
          <Button
            key={step}
            onClick={() => onOffsetChange(round(offset + step))}
            sx={[tonalSx, stepSx]}
          >
            {step}s
          </Button>
        ))}
        <Typography
          sx={{
            minWidth: 56,
            textAlign: 'center',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {offset > 0 ? '+' : ''}
          {offset.toFixed(1)}s
        </Typography>
        {[0.1, 1].map((step) => (
          <Button
            key={step}
            onClick={() => onOffsetChange(round(offset + step))}
            sx={[tonalSx, stepSx]}
          >
            +{step}s
          </Button>
        ))}
      </Stack>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>
        {offset !== applied
          ? `Not applied yet. On the TV now: ${timingLabel(applied)}.`
          : applied !== 0
            ? `On the TV now: ${timingLabel(applied)}.`
            : 'Original timing. Minus shows them earlier, plus later.'}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button disabled={offset === 0 || applying} onClick={() => onOffsetChange(0)}>
          Original timing
        </Button>
        <Button
          variant="contained"
          disabled={offset === applied || applying}
          onClick={() => void apply()}
          startIcon={applying ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Apply to TV
        </Button>
      </Stack>
    </Stack>
  );
}

// Fixed height for two lines, so the controls below don't jump as lines come and go.
function SubtitleLine({ text }: { text?: string }): React.JSX.Element {
  return (
    <Box
      sx={{
        minHeight: 96,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        px: 2,
        py: 1.5,
        borderRadius: '16px',
        bgcolor: '#000',
        color: '#fff',
        fontSize: 20,
        fontWeight: 500,
        lineHeight: 1.35,
        whiteSpace: 'pre-line',
      }}
    >
      {text ?? ''}
    </Box>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// Five controls in a row on a narrow phone: share the width.
const stepSx = { flex: 1, minWidth: 0, px: 0 };

// "1.5s later", "0.3s earlier", "the original timing".
function timingLabel(offset: number): string {
  if (offset === 0) return 'the original timing';
  return `${Math.abs(offset).toFixed(1)}s ${offset > 0 ? 'later' : 'earlier'}`;
}
