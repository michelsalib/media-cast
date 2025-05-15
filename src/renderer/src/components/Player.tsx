import { Close } from '@mui/icons-material';
import { Box, Fab, Slider, Stack, Typography } from '@mui/material';
import { Media, MediaStatus } from 'castv2-client';
import format from 'format-duration';
import { useEffect, useState } from 'react';
import PlayPause from './PlayPauseSeek';

type Props = {
  onDisconnect?: () => void;
};

export default function Player({ onDisconnect }: Props): React.JSX.Element {
  const [status, setStatus] = useState<MediaStatus | undefined>(undefined);
  const [media, setMedia] = useState<Media | undefined>(undefined);

  useEffect(() => {
    window.api.onStatus((s) => {
      setStatus(s);
    });
    setInterval(() => {
      window.api.status();
    }, 1000);
  }, []);

  useEffect(() => {
    if (status?.media) {
      setMedia(status.media);
    }
  }, [status]);

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
        <Close></Close>
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
          {media?.metadata?.title || 'no media'}
        </Typography>
        <PlayPause status={status}></PlayPause>
        <Slider
          min={0}
          max={media?.duration || 100}
          value={status?.currentTime || 0}
          onChange={seek}
        ></Slider>
        <Stack direction="row" sx={{ width: '100%', justifyContent: 'space-between' }}>
          <div>{status?.currentTime ? format(status.currentTime * 1000) : 'NA'}</div>
          <div>{media?.duration ? format(media.duration * 1000) : 'NA'}</div>
        </Stack>
      </Stack>
    </Box>
  );
}
