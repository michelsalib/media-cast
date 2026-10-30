import {
  Forward10Rounded,
  PauseRounded,
  PlayArrowRounded,
  Replay10Rounded,
} from '@mui/icons-material';
import { CircularProgress, IconButton, Stack } from '@mui/material';
import type { PlayerStatus } from '../../../shared/types';
import { api } from '../ipc';

type Props = {
  status?: PlayerStatus;
};

export default function PlayPauseSeek({ status }: Props): React.JSX.Element {
  const state = status?.playerState;
  const known = state === 'PLAYING' || state === 'PAUSED';

  function seekBy(delta: number): void {
    if (!status) {
      return;
    }
    void api.seek(Math.max(0, status.currentTime + delta));
  }

  return (
    <Stack direction="row" spacing={2.25} sx={{ alignItems: 'center' }}>
      <IconButton aria-label="Back 10 seconds" onClick={() => seekBy(-10)} disabled={!known}>
        <Replay10Rounded sx={{ fontSize: 32 }} />
      </IconButton>
      <IconButton
        aria-label={state === 'PLAYING' ? 'Pause' : 'Play'}
        onClick={() => void (state === 'PLAYING' ? api.pause() : api.play())}
        disabled={!known}
        sx={{
          width: 68,
          height: 68,
          bgcolor: '#FFFFFF',
          color: '#0B0C14',
          boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
          '&:hover': { bgcolor: '#E8EAF2' },
          '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.85)', color: '#0B0C14' },
        }}
      >
        {!known ? (
          <CircularProgress size={26} sx={{ color: '#0B0C14' }} />
        ) : state === 'PLAYING' ? (
          <PauseRounded sx={{ fontSize: 34 }} />
        ) : (
          <PlayArrowRounded sx={{ fontSize: 38 }} />
        )}
      </IconButton>
      <IconButton aria-label="Forward 10 seconds" onClick={() => seekBy(10)} disabled={!known}>
        <Forward10Rounded sx={{ fontSize: 32 }} />
      </IconButton>
    </Stack>
  );
}
