import {
  Forward10Rounded,
  PauseRounded,
  PlayArrowRounded,
  Replay10Rounded,
} from '@mui/icons-material';
import { alpha, CircularProgress, IconButton, Stack } from '@mui/material';
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
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
      <IconButton
        aria-label="Back 10 seconds"
        onClick={() => seekBy(-10)}
        disabled={!known}
        sx={{ color: 'text.secondary' }}
      >
        <Replay10Rounded sx={{ fontSize: 30 }} />
      </IconButton>
      <IconButton
        aria-label={state === 'PLAYING' ? 'Pause' : 'Play'}
        onClick={() => void (state === 'PLAYING' ? api.pause() : api.play())}
        disabled={!known}
        sx={{
          width: 64,
          height: 64,
          borderRadius: '20px',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.88) },
          '&.Mui-disabled': {
            bgcolor: 'tonal.primaryContainer',
            color: 'tonal.onPrimaryContainer',
          },
        }}
      >
        {!known ? (
          <CircularProgress size={24} color="inherit" />
        ) : state === 'PLAYING' ? (
          <PauseRounded sx={{ fontSize: 32 }} />
        ) : (
          <PlayArrowRounded sx={{ fontSize: 36 }} />
        )}
      </IconButton>
      <IconButton
        aria-label="Forward 10 seconds"
        onClick={() => seekBy(10)}
        disabled={!known}
        sx={{ color: 'text.secondary' }}
      >
        <Forward10Rounded sx={{ fontSize: 30 }} />
      </IconButton>
    </Stack>
  );
}
