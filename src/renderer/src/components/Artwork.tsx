import { MovieOutlined } from '@mui/icons-material';
import { Box, type SxProps, type Theme } from '@mui/material';
import { useEffect, useState } from 'react';

// A Blob URL, not a base64 data URL: spreading a large frame into
// String.fromCharCode overflows the argument limit. Created in the same effect that
// revokes it — StrictMode runs the cleanup once on mount, which would otherwise
// revoke a memoized URL that is still on screen.
export function useObjectUrl(bytes: Uint8Array | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (!bytes) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes]);
  return url;
}

// The video's frame, or a placeholder until ffmpeg returns one (or when it can't).
export function Artwork({ url, sx }: { url?: string; sx?: SxProps<Theme> }): React.JSX.Element {
  return (
    <Box
      sx={[
        {
          aspectRatio: '16 / 9',
          flexShrink: 0,
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          color: 'tonal.onSurfaceVariant',
          bgcolor: 'tonal.surfaceContainerHighest',
          background: url ? `center / cover no-repeat url(${url})` : undefined,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {!url && <MovieOutlined sx={{ fontSize: 40 }} />}
    </Box>
  );
}
