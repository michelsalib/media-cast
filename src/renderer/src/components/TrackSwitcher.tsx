import { CheckRounded } from '@mui/icons-material';
import { Button, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import type { PlayingTracks, SubtitleChoice, TrackChange } from '../../../shared/types';
import { audioTrackName, subtitleFileName, subtitleTrackName } from '../labels';
import { chipSx } from '../theme';
import SubtitleChoices, { type SubtitleOption } from './SubtitleChoices';

type Props = {
  tracks: PlayingTracks;
  onChange: (change: TrackChange) => Promise<void>;
  // False for a video not playing yet (the phone's ready card): nothing to reload.
  playing?: boolean;
};

// Audio and subtitles of the video playing. A TV reads both only at load, so a switch
// reloads the video where it was. The same in the window and on the phone remote, which
// also uses it to pick them for the video ready on the computer.
export default function TrackSwitcher({
  tracks,
  onChange,
  playing = true,
}: Props): React.JSX.Element {
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

  const subtitleChoices: (SubtitleOption & { value: SubtitleChoice })[] = [
    ...(tracks.externalName
      ? [
          {
            value: 'external' as const,
            label: 'Added subtitles',
            detail: tracks.externalName,
          },
        ]
      : []),
    ...tracks.subtitles.map((s, i) => ({
      value: i,
      label: subtitleTrackName(s, i),
      group: 'In the video',
      // Chromecast plays the file as is, with a text sidecar: no way to show images.
      disabled: s.bitmap && tracks.deviceType === 'chromecast',
      hint:
        s.bitmap && tracks.deviceType === 'chromecast'
          ? 'Image subtitles can’t be shown on a Chromecast'
          : undefined,
    })),
    ...tracks.files.map((f, i) => ({
      value: `file:${i}` as const,
      label: subtitleFileName(f.label),
      group: 'In the torrent',
      detail: f.folder ? `${f.folder}/${f.name}` : f.name,
    })),
    { value: null, label: 'Off' },
  ].map((c) => ({ ...c, key: String(c.value) }));

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
        <SubtitleChoices
          options={subtitleChoices}
          selected={String(tracks.selected.subtitles)}
          loading={pending?.subtitles !== undefined ? String(pending.subtitles) : undefined}
          disabled={!!pending}
          onPick={(key) => {
            const choice = subtitleChoices.find((c) => c.key === key);
            if (choice) void change({ subtitles: choice.value });
          }}
        />
      </Group>
      {playing && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          Switching reloads the video on the TV and picks up where it was.
        </Typography>
      )}
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
