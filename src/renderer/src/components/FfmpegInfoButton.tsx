import { InfoOutlined } from '@mui/icons-material';
import { Box, IconButton, Popover, Stack, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import type { FfmpegInfo } from '../../../shared/types';

export default function FfmpegInfoButton(): React.JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<FfmpegInfo>();
  const [error, setError] = useState<string>();

  async function show(): Promise<void> {
    setOpen(true);
    if (!info) {
      try {
        setInfo(await window.api.ffmpegInfo());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  return (
    <>
      <IconButton
        ref={anchorRef}
        onClick={show}
        size="small"
        sx={{
          appRegion: 'no-drag',
          color: 'white',
          // AppBar is only 32px tall — shrink the IconButton's default padding so the icon fits.
          padding: '4px',
        }}
      >
        <InfoOutlined fontSize="small" />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, maxWidth: 480 }}>
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : info ? (
            <Stack spacing={1}>
              <Typography variant="body2">{info.version}</Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                <strong>ffmpeg:</strong> {info.ffmpegPath}
              </Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                <strong>ffprobe:</strong> {info.ffprobePath}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2">Loading…</Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}
