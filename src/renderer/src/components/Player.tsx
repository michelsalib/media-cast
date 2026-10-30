import { AutoAwesomeRounded, StopRounded, VideoLibraryRounded } from '@mui/icons-material';
import { Box, Button, Slider, Stack, Tooltip, Typography } from '@mui/material';
import format from 'format-duration';
import { useState } from 'react';
import type { Device, PlayerStatus } from '../../../shared/types';
import { api } from '../ipc';
import { glassSx } from '../theme';
import { Artwork } from './Artwork';
import PlayPause from './PlayPauseSeek';

type Props = {
  status: PlayerStatus;
  device: Device;
  artworkUrl?: string;
  title: string;
  details?: string;
  onBrowse: () => void;
  onStop: () => void;
};

const STATE_LABELS: Record<PlayerStatus['playerState'], string> = {
  PLAYING: 'Playing on',
  PAUSED: 'Paused on',
  BUFFERING: 'Loading on',
  IDLE: 'Ready on',
};

export default function Player({
  status,
  device,
  artworkUrl,
  title,
  details,
  onBrowse,
  onStop,
}: Props): React.JSX.Element {
  const [dragValue, setDragValue] = useState<number | undefined>();
  const duration = status.duration || 0;
  const position = dragValue ?? status.currentTime ?? 0;

  // Seek once on release. onChange fires continuously while dragging: every Seek makes a
  // UPnP TV re-request the stream, which restarts the transcoder each time. Meanwhile the
  // thumb follows the drag instead of snapping back to each 1 s status tick.
  function seek(_evt: unknown, value: number): void {
    setDragValue(undefined);
    void api.seek(value);
  }

  return (
    <Stack sx={{ height: '100%', alignItems: 'center', px: 5, pt: 1.5, pb: 3, minHeight: 0 }}>
      {/* Shrinks on short windows so the controls stay on screen. */}
      <Artwork
        url={artworkUrl}
        sx={{ width: 'min(420px, 100%, (100vh - 420px) * 16 / 9)', borderRadius: '20px' }}
      />

      <Stack direction="row" spacing={1} sx={{ mt: 2.5, alignItems: 'center' }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            height: 30,
            px: 1.75,
            alignItems: 'center',
            borderRadius: 999,
            bgcolor: 'rgba(255,255,255,0.1)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              boxShadow: '0 0 0 4px rgba(94,242,192,0.25)',
            }}
          />
          <span>
            {STATE_LABELS[status.playerState]} {device.name}
          </span>
        </Stack>
        {status.transcoded && (
          <Tooltip title="ffmpeg is re-encoding this file on the fly for the TV">
            <Stack
              direction="row"
              spacing={0.75}
              sx={{
                height: 30,
                px: 1.5,
                alignItems: 'center',
                borderRadius: 999,
                bgcolor: 'rgba(255,255,255,0.1)',
                fontSize: 13,
                color: 'text.secondary',
              }}
            >
              <AutoAwesomeRounded sx={{ fontSize: 14 }} />
              <span>Converting</span>
            </Stack>
          </Tooltip>
        )}
      </Stack>

      <Typography
        variant="h1"
        noWrap
        sx={{ mt: 1.5, fontSize: 32, maxWidth: '100%' }}
        title={title}
      >
        {title}
      </Typography>
      {details && (
        <Typography sx={{ mt: 0.5, color: 'text.secondary' }} noWrap>
          {details}
        </Typography>
      )}

      <Box sx={{ flex: 1, minHeight: 16 }} />

      <Box sx={{ alignSelf: 'stretch' }}>
        <Slider
          aria-label="Position"
          min={0}
          max={duration || 100}
          value={position}
          disabled={!duration}
          onChange={(_evt, value) => setDragValue(value)}
          onChangeCommitted={seek}
          sx={{
            height: 6,
            py: 1,
            '& .MuiSlider-rail': { bgcolor: 'rgba(255,255,255,0.15)', opacity: 1 },
            '& .MuiSlider-track': { border: 0 },
            '& .MuiSlider-thumb': {
              width: 16,
              height: 16,
              bgcolor: '#FFFFFF',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            },
          }}
        />
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span>{format(position * 1000)}</span>
          <span>{duration ? `−${format(Math.max(0, duration - position) * 1000)}` : ''}</span>
        </Stack>
      </Box>

      <Box
        sx={{
          alignSelf: 'stretch',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          alignItems: 'center',
          mt: 1,
        }}
      >
        <Box>
          <Button
            onClick={onBrowse}
            startIcon={<VideoLibraryRounded />}
            sx={{ ...glassSx, height: 38 }}
          >
            Another video
          </Button>
        </Box>
        <Stack sx={{ alignItems: 'center' }}>
          <PlayPause status={status} />
        </Stack>
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onStop} startIcon={<StopRounded />} sx={{ ...glassSx, height: 38 }}>
            Stop
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}
