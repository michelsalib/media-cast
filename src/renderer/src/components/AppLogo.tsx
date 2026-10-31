import { Box, type SxProps, type Theme } from '@mui/material';
import { useId } from 'react';

// build/icon.svg in one colour (`color`, the accent by default): the tile, with the cast
// glyph cut out of it so the title bar shows through.
export default function AppLogo({ sx }: { sx?: SxProps<Theme> }): React.JSX.Element {
  const mask = useId();
  const cut = useId();
  return (
    <Box
      component="svg"
      viewBox="0 0 1024 1024"
      aria-hidden
      sx={[{ color: 'primary.main', flexShrink: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <mask id={cut}>
        <rect width="1024" height="1024" fill="#fff" />
        <circle cx="212" cy="722" r="262" fill="#000" />
      </mask>
      <mask id={mask}>
        <rect x="64" y="64" width="896" height="896" rx="200" fill="#fff" />
        <rect
          x="212"
          y="302"
          width="600"
          height="420"
          rx="72"
          fill="none"
          stroke="#000"
          strokeWidth="56"
          mask={`url(#${cut})`}
        />
        <g fill="none" stroke="#000" strokeWidth="52" strokeLinecap="round">
          <path d="M 212 612 A 110 110 0 0 1 322 722" />
          <path d="M 212 522 A 200 200 0 0 1 412 722" />
        </g>
        <path
          d="M 212 672 A 50 50 0 0 1 262 722 L 212 722 Z"
          fill="#000"
          stroke="#000"
          strokeWidth="16"
          strokeLinejoin="round"
        />
        <path
          d="M 461 424 L 461 600 L 613 512 Z"
          fill="#000"
          stroke="#000"
          strokeWidth="44"
          strokeLinejoin="round"
        />
      </mask>
      <rect width="1024" height="1024" fill="currentColor" mask={`url(#${mask})`} />
    </Box>
  );
}
