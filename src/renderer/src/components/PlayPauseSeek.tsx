import {
  FastForwardRounded,
  FastRewindRounded,
  PauseRounded,
  PlayArrowRounded,
} from '@mui/icons-material';
import { Box, Button } from '@mui/material';
import { useEffect, useState } from 'react';
import type { PlayerStatus } from '../../../shared/types';

type BUTTON_STATE = 'PLAY' | 'PAUSE' | 'UNKNOWN';
type Props = {
  status?: PlayerStatus;
};

export default function PlayPauseSeek({ status }: Props): React.JSX.Element {
  const [state, setState] = useState<BUTTON_STATE>('UNKNOWN');

  useEffect(() => {
    switch (status?.playerState) {
      case 'PLAYING':
        setState('PLAY');
        return;
      case 'PAUSED':
        setState('PAUSE');
        return;
      default:
        setState('UNKNOWN');
    }
  }, [status]);

  function play(): void {
    window.api.play();
  }

  function pause(): void {
    window.api.pause();
  }

  function seekRewind(): void {
    if (!status) {
      return;
    }

    window.api.seek(status.currentTime - 10);
  }

  function seekForward(): void {
    if (!status) {
      return;
    }

    window.api.seek(status.currentTime + 10);
  }

  return (
    <Box>
      <Button onClick={seekRewind} disabled={state === 'UNKNOWN'}>
        <FastRewindRounded fontSize="large" />
      </Button>
      {state === 'PLAY' ? (
        <Button onClick={pause}>
          <PauseRounded sx={{ fontSize: '3rem' }} />
        </Button>
      ) : (
        <Button onClick={play} disabled={state === 'UNKNOWN'}>
          <PlayArrowRounded sx={{ fontSize: '3rem' }} />
        </Button>
      )}
      <Button onClick={seekForward} disabled={state === 'UNKNOWN'}>
        <FastForwardRounded fontSize="large" />
      </Button>
    </Box>
  );
}
