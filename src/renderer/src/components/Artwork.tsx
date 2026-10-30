import { MovieRounded } from '@mui/icons-material';
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

// Shown until ffmpeg returns a frame, or when it can't.
const FALLBACK = 'linear-gradient(160deg, #2E3A78 0%, #3B2A6B 50%, #14162A 100%)';

export function Artwork({ url, sx }: { url?: string; sx?: SxProps<Theme> }): React.JSX.Element {
  return (
    <Box
      sx={[
        {
          aspectRatio: '16 / 9',
          flexShrink: 0,
          borderRadius: '18px',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          color: 'rgba(255,255,255,0.4)',
          background: url ? `center / cover no-repeat url(${url})` : FALLBACK,
          boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {!url && <MovieRounded sx={{ fontSize: 40 }} />}
    </Box>
  );
}

// The window's background: the video's own frame, blurred into colour.
export function AmbientBackdrop({ url }: { url?: string }): React.JSX.Element {
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}>
      {url ? (
        <Box
          sx={{
            position: 'absolute',
            inset: -120,
            background: `center / cover no-repeat url(${url})`,
            filter: 'blur(70px) saturate(1.3)',
            opacity: 0.6,
            transition: 'opacity 400ms ease',
          }}
        />
      ) : (
        <>
          <Glow
            color="#6C4CF5"
            opacity={0.35}
            sx={{ left: '25%', top: 40, width: 440, height: 300 }}
          />
          <Glow
            color="#5EF2C0"
            opacity={0.2}
            sx={{ left: '42%', top: 120, width: 300, height: 220 }}
          />
        </>
      )}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(11,12,20,0.35) 0%, rgba(11,12,20,0.65) 55%, #0B0C14 100%)',
        }}
      />
    </Box>
  );
}

function Glow({
  color,
  opacity,
  sx,
}: {
  color: string;
  opacity: number;
  sx: SxProps<Theme>;
}): React.JSX.Element {
  return (
    <Box
      sx={[
        {
          position: 'absolute',
          borderRadius: '50%',
          backgroundColor: color,
          opacity,
          filter: 'blur(90px)',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
