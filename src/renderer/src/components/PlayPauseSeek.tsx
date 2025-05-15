import {
  FastForwardRounded,
  FastRewindRounded,
  Pause,
  PauseRounded,
  PlayArrow,
  PlayArrowRounded,
} from '@mui/icons-material';
import { Box, Button, IconButton } from '@mui/material';
import { MediaStatus } from 'castv2-client';
import { useEffect, useState } from 'react';

type BUTTON_STATE = 'PLAY' | 'PAUSE' | 'UNKNOWN';
type Props = {
  status?: MediaStatus;
};

export default function PlayPauseSeek({ status }: Props): React.JSX.Element {
  const [state, setState] = useState<BUTTON_STATE>('UNKNOWN');

  useEffect(() => {
    switch (status?.playerState) {
      case 'PLAYING':
        setState('PLAY');
        return;
        return;
      case 'PAUSED':
        setState('PAUSE');
        return;
      case 'BUFFERING':
      case 'IDLE':
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
      <Button onClick={seekRewind} disabled={state == 'UNKNOWN'}>
        <FastRewindRounded fontSize="large" />
      </Button>
      {state == 'PLAY' ? (
        <Button onClick={pause}>
          <PauseRounded sx={{ fontSize: '3rem' }} />
        </Button>
      ) : (
        <Button onClick={play} disabled={state == 'UNKNOWN'}>
          <PlayArrowRounded sx={{ fontSize: '3rem' }} />
        </Button>
      )}
      <Button onClick={seekForward} disabled={state == 'UNKNOWN'}>
        <FastForwardRounded fontSize="large" />
      </Button>
    </Box>
  );

  if (state == 'UNKNOWN') {
    return (
      <Button>
        <PlayArrow />
      </Button>
    );
  }

  if (state == 'PLAY') {
    return (
      <IconButton onClick={pause}>
        <Pause />
      </IconButton>
    );
  }

  return (
    <IconButton onClick={play}>
      <PlayArrow />
    </IconButton>
  );
}
