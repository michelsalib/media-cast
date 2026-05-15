import { Close } from '@mui/icons-material';
import { Box, Fab, Slider, Stack, Typography } from '@mui/material';
import format from 'format-duration';
import { useEffect, useState } from 'react';
import type { PlayerStatus } from '../../../shared/types';
import PlayPause from './PlayPauseSeek';

type Props = {
  onDisconnect?: () => void;
};

export default function Player({ onDisconnect }: Props): React.JSX.Element {
  const [status, setStatus] = useState<PlayerStatus | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = window.api.onStatus(setStatus);
    const intervalId = setInterval(() => {
      window.api.status();
    }, 1000);
    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, []);

  function seek(_evt: Event, value: number): void {
    window.api.seek(value);
  }

  function disconnect(): void {
    window.api.disconnect();
    onDisconnect?.();
  }

  return (
    <Box>
      <Fab onClick={disconnect} color="info" size="small" sx={{ float: 'right' }}>
        <Close />
      </Fab>
      <Stack
        useFlexGap
        direction="column"
        sx={{
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="h3" noWrap sx={{ width: 1 }}>
          {status?.title || 'no media'}
        </Typography>
        <PlayPause status={status} />
        <Slider
          min={0}
          max={status?.duration || 100}
          value={status?.currentTime || 0}
          onChange={seek}
        />
        <Stack direction="row" sx={{ width: '100%', justifyContent: 'space-between' }}>
          <div>{status?.currentTime ? format(status.currentTime * 1000) : 'NA'}</div>
          <div>{status?.duration ? format(status.duration * 1000) : 'NA'}</div>
        </Stack>
      </Stack>
    </Box>
  );
}
