import { CheckRounded } from '@mui/icons-material';
import { Button, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import type { PlayingTracks, TrackChange } from '../../../shared/types';
import { audioTrackName, subtitleTrackName } from '../labels';
import { chipSx } from '../theme';

type Props = {
  tracks: PlayingTracks;
  onChange: (change: TrackChange) => Promise<void>;
};

type SubtitleChoice = PlayingTracks['selected']['subtitles'];

// Audio and subtitles of the video playing. A TV reads both only at load, so a switch
// reloads the video where it was. The same in the window and on the phone remote.
export default function TrackSwitcher({ tracks, onChange }: Props): React.JSX.Element {
  // What is being switched to, while the TV reloads.
  const [pending, setPending] = useState<TrackChange>();

  async function change(next: TrackChange): Promise<void> {
    setPending(next);
    try {
      await onChange(next);
    } finally {
      setPending(undefined);
    }
  }

  const subtitleChoices: { value: SubtitleChoice; label: string; hint?: string; off?: boolean }[] =
    [
      ...(tracks.externalName
        ? [{ value: 'external' as const, label: 'Added subtitles', hint: tracks.externalName }]
        : []),
      ...tracks.subtitles.map((s, i) => ({
        value: i,
        label: subtitleTrackName(s, i),
        // Chromecast plays the file as is, with a text sidecar: no way to show images.
        off: s.bitmap && tracks.deviceType === 'chromecast',
        hint:
          s.bitmap && tracks.deviceType === 'chromecast'
            ? 'Image subtitles can’t be shown on a Chromecast'
            : undefined,
      })),
      { value: null, label: 'Off' },
    ];

  return (
    <Stack spacing={1.5}>
      {tracks.audio.length > 1 && (
        <Group title="Audio">
          {tracks.audio.map((a, i) => (
            <Choice
              // biome-ignore lint/suspicious/noArrayIndexKey: tracks are addressed by index
              key={i}
              label={audioTrackName(a, i)}
              selected={tracks.selected.audioIndex === i}
              loading={pending?.audioIndex === i}
              disabled={!!pending}
              onClick={() => void change({ audioIndex: i })}
            />
          ))}
        </Group>
      )}
      <Group title="Subtitles">
        {subtitleChoices.map((c) => (
          <Choice
            key={String(c.value)}
            label={c.label}
            hint={c.hint}
            selected={tracks.selected.subtitles === c.value}
            loading={pending?.subtitles === c.value}
            disabled={!!pending || c.off}
            onClick={() => void change({ subtitles: c.value })}
          />
        ))}
      </Group>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
        Switching reloads the video on the TV and picks up where it was.
      </Typography>
    </Stack>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack spacing={1}>
      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary' }}>
        {title}
      </Typography>
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
        {children}
      </Stack>
    </Stack>
  );
}

function Choice({
  label,
  hint,
  selected,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Tooltip title={hint ?? ''} placement="top">
      <span>
        <Button
          aria-pressed={selected}
          disabled={disabled && !selected}
          onClick={selected ? undefined : onClick}
          sx={chipSx(selected)}
          startIcon={
            loading ? (
              <CircularProgress size={14} color="inherit" />
            ) : selected ? (
              <CheckRounded />
            ) : undefined
          }
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}
