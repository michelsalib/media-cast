import { VolumeDownRounded, VolumeOffRounded, VolumeUpRounded } from '@mui/icons-material';
import { IconButton, Slider, Stack, type SxProps, type Theme } from '@mui/material';
import { useRef, useState } from 'react';
import type { Volume } from '../../../shared/types';

type Props = {
  // The TV's, from the status; nothing is drawn while it's unknown.
  volume?: Volume;
  onChange: (change: Partial<Volume>) => Promise<unknown>;
  sx?: SxProps<Theme>;
};

// The TV's volume and mute, for the window and the phone remote alike. Changes go out
// one at a time, the latest winning: a slider drag would otherwise pile up requests on a
// DLNA TV that answers each one in a few hundred ms.
export default function VolumeControl({ volume, onChange, sx }: Props): React.JSX.Element | null {
  // Shown while dragging, and until the last change has been sent.
  const [held, setHeld] = useState<number>();
  const dragging = useRef(false);
  const queue = useRef<{ busy: boolean; next?: Partial<Volume> }>({ busy: false });

  async function send(change: Partial<Volume>): Promise<void> {
    const q = queue.current;
    q.next = { ...q.next, ...change };
    if (q.busy) return;
    q.busy = true;
    while (q.next) {
      const next = q.next;
      q.next = undefined;
      await onChange(next).catch(() => {});
    }
    q.busy = false;
    if (!dragging.current) setHeld(undefined);
  }

  if (!volume) return null;
  const level = held ?? volume.level;
  const silent = volume.muted || level === 0;
  const Icon = silent ? VolumeOffRounded : level < 0.5 ? VolumeDownRounded : VolumeUpRounded;

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={[{ alignItems: 'center' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <IconButton
        aria-label={volume.muted ? 'Unmute the TV' : 'Mute the TV'}
        onClick={() => void send({ muted: !volume.muted })}
        sx={{ color: silent ? 'text.secondary' : 'primary.main' }}
      >
        <Icon />
      </IconButton>
      <Slider
        aria-label="TV volume"
        min={0}
        max={1}
        step={0.01}
        value={level}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => Math.round(v * 100)}
        onChange={(_e, value) => {
          dragging.current = true;
          setHeld(value);
          // Raising the volume of a muted TV means wanting to hear it.
          void send(volume.muted ? { level: value, muted: false } : { level: value });
        }}
        onChangeCommitted={(_e, value) => {
          dragging.current = false;
          void send({ level: value });
        }}
        sx={{ flex: 1, opacity: volume.muted ? 0.5 : 1 }}
      />
    </Stack>
  );
}
