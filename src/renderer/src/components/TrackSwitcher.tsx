import { CheckRounded } from '@mui/icons-material';
import {
  Button,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type {
  DeviceType,
  PlayingTracks,
  SubtitleChoice,
  TrackChange,
  TrackList,
} from '../../../shared/types';
import {
  audioTrackName,
  burnHint,
  NORMALIZE_AUDIO_HINT,
  subtitleFileName,
  subtitleTrackName,
} from '../labels';
import { chipSx } from '../theme';
import SubtitleChoices, { type SubtitleOption } from './SubtitleChoices';

type Props = {
  // With `burn` (the video playing on a DLNA TV), also offers burning the subtitles in.
  // With `normalizeAudio`, also offers evening out the volume.
  tracks: TrackList & Pick<PlayingTracks, 'burn' | 'normalizeAudio'>;
  // The screen it plays on, or will: a Chromecast can't show image subtitles.
  deviceType?: DeviceType;
  onChange: (change: TrackChange) => Promise<void>;
  // Whether a switch reloads the video on the TV (said under the choices): false for a
  // video not playing yet (the phone's ready card).
  reloads?: boolean;
};

// Audio and subtitles of the video playing. A TV reads both only at load, so a switch
// reloads the video where it was. The same in the window and on the phone remote, which
// also uses it to pick them for the video ready on the computer.
export default function TrackSwitcher({
  tracks,
  deviceType,
  onChange,
  reloads = true,
}: Props): React.JSX.Element {
  const chromecast = deviceType === 'chromecast';
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
      disabled: s.bitmap && chromecast,
      hint: s.bitmap && chromecast ? 'Image subtitles can’t be shown on a Chromecast' : undefined,
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
      {(tracks.audio.length > 1 || tracks.normalizeAudio !== undefined) && (
        <Stack spacing={1}>
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
          {tracks.normalizeAudio !== undefined && (
            <Toggle
              label="Even out volume"
              hint={NORMALIZE_AUDIO_HINT}
              checked={pending?.normalizeAudio ?? tracks.normalizeAudio}
              disabled={!!pending}
              onChange={(on) => void change({ normalizeAudio: on })}
            />
          )}
        </Stack>
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
      {tracks.burn && (
        <Toggle
          label="Burn into the picture"
          hint={burnHint(tracks.burn.forced)}
          checked={pending?.burnSubtitles ?? tracks.burn.on}
          disabled={!!pending || (!!tracks.burn.forced && tracks.burn.on)}
          onChange={(on) => void change({ burnSubtitles: on })}
        />
      )}
      {reloads && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          Switching reloads the video on the TV and picks up where it was.
        </Typography>
      )}
    </Stack>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <Tooltip placement="top" enterDelay={300} title={hint}>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
        }
        label={label}
        slotProps={{ typography: { sx: { fontSize: 13 } } }}
        sx={{ m: 0, gap: 0.5, alignSelf: 'flex-start' }}
      />
    </Tooltip>
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
