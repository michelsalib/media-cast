import { alpha, createTheme, type SxProps, type Theme } from '@mui/material';

// Material-style tonal roles, all derived from one accent colour (the OS accent).
export interface Tonal {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  surface: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    tonal: Tonal;
  }
  interface PaletteOptions {
    tonal?: Tonal;
  }
}

// Windows' default accent; used where the OS has none (Linux).
export const DEFAULT_ACCENT = '#0078d4';

export type Mode = 'light' | 'dark';

// Lightness (OKLab L) of each role, per mode. Chroma comes from the accent, capped so
// a loud accent still yields calm surfaces.
const TONES: Record<Mode, Record<keyof Tonal, number>> = {
  dark: {
    primary: 0.82,
    onPrimary: 0.3,
    primaryContainer: 0.38,
    onPrimaryContainer: 0.93,
    secondaryContainer: 0.34,
    onSecondaryContainer: 0.92,
    surface: 0.17,
    surfaceContainerLow: 0.2,
    surfaceContainer: 0.225,
    surfaceContainerHigh: 0.26,
    surfaceContainerHighest: 0.3,
    onSurface: 0.93,
    onSurfaceVariant: 0.8,
    outline: 0.62,
    outlineVariant: 0.4,
  },
  light: {
    primary: 0.48,
    onPrimary: 1,
    primaryContainer: 0.9,
    onPrimaryContainer: 0.27,
    secondaryContainer: 0.9,
    onSecondaryContainer: 0.26,
    surface: 0.985,
    surfaceContainerLow: 0.965,
    surfaceContainer: 0.95,
    surfaceContainerHigh: 0.93,
    surfaceContainerHighest: 0.91,
    onSurface: 0.22,
    onSurfaceVariant: 0.42,
    outline: 0.58,
    outlineVariant: 0.85,
  },
};

const CHROMA: Record<keyof Tonal, 'primary' | 'container' | 'secondary' | 'neutral' | 'variant'> = {
  primary: 'primary',
  onPrimary: 'container',
  primaryContainer: 'container',
  onPrimaryContainer: 'container',
  secondaryContainer: 'secondary',
  onSecondaryContainer: 'secondary',
  surface: 'neutral',
  surfaceContainerLow: 'neutral',
  surfaceContainer: 'neutral',
  surfaceContainerHigh: 'neutral',
  surfaceContainerHighest: 'neutral',
  onSurface: 'neutral',
  onSurfaceVariant: 'variant',
  outline: 'variant',
  outlineVariant: 'variant',
};

export function tonalPalette(mode: Mode, accent: string): Tonal {
  const { c, h } = hexToOklch(accent);
  // A grey accent has no meaningful hue: keep it grey rather than boosting a random one.
  const chroma = {
    primary: c < 0.02 ? c : Math.min(Math.max(c, 0.05), 0.14),
    container: Math.min(c, 0.08),
    secondary: Math.min(c, 0.035),
    neutral: Math.min(c, 0.008),
    variant: Math.min(c, 0.018),
  };
  const roles = {} as Tonal;
  for (const role of Object.keys(TONES[mode]) as (keyof Tonal)[]) {
    roles[role] = oklchToHex(TONES[mode][role], chroma[CHROMA[role]], h);
  }
  return roles;
}

export function makeTheme(mode: Mode, accent: string): Theme {
  const t = tonalPalette(mode, accent);
  return createTheme({
    palette: {
      mode,
      tonal: t,
      primary: { main: t.primary, contrastText: t.onPrimary },
      secondary: { main: t.onSecondaryContainer, contrastText: t.secondaryContainer },
      background: { default: t.surface, paper: t.surfaceContainerHigh },
      text: { primary: t.onSurface, secondary: t.onSurfaceVariant },
      divider: t.outlineVariant,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Figtree", system-ui, sans-serif',
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
      h1: { fontSize: 30, fontWeight: 600, lineHeight: 1.15 },
      h2: { fontSize: 22, fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: t.surface },
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          '*::-webkit-scrollbar-thumb': { background: alpha(t.onSurface, 0.2), borderRadius: 4 },
          '*::-webkit-scrollbar-thumb:hover': { background: alpha(t.onSurface, 0.3) },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 12, paddingInline: 16 },
          sizeLarge: {
            height: 64,
            borderRadius: 20,
            paddingInline: 24,
            fontSize: 16,
            fontWeight: 700,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 28,
            backgroundImage: 'none',
            backgroundColor: t.surfaceContainerHigh,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            backgroundImage: 'none',
            backgroundColor: t.surfaceContainerHigh,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            backgroundImage: 'none',
            backgroundColor: t.surfaceContainerHigh,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          // Material's "plain tooltip": the inverse of the surface.
          tooltip: {
            backgroundColor: t.onSurface,
            color: t.surface,
            borderRadius: 8,
            fontSize: 12,
            padding: '6px 10px',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: t.outline },
          },
        },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: 12 } },
      },
      MuiSlider: {
        styleOverrides: {
          rail: { backgroundColor: t.surfaceContainerHighest, opacity: 1 },
        },
      },
    },
  });
}

// A filter chip: picked = filled container with a check, otherwise outlined.
export function chipSx(selected: boolean): SxProps<Theme> {
  return {
    height: 32,
    px: 1.5,
    borderRadius: '8px',
    fontSize: 13,
    fontWeight: selected ? 600 : 500,
    border: '1px solid',
    borderColor: selected ? 'transparent' : 'tonal.outlineVariant',
    bgcolor: selected ? 'tonal.primaryContainer' : 'transparent',
    color: selected ? 'tonal.onPrimaryContainer' : 'tonal.onSurface',
    '& .MuiButton-startIcon': { mr: 0.5, ml: -0.5 },
    '&:hover': {
      bgcolor: (theme: Theme) =>
        selected
          ? alpha(theme.palette.tonal.primaryContainer, 0.85)
          : alpha(theme.palette.tonal.onSurface, 0.08),
    },
    '&.Mui-disabled': { opacity: 0.38, color: 'tonal.onSurface' },
  };
}

// Medium-emphasis button: the secondary container.
export const tonalSx = {
  bgcolor: 'tonal.secondaryContainer',
  color: 'tonal.onSecondaryContainer',
  '&:hover': {
    bgcolor: (theme: Theme) => alpha(theme.palette.tonal.secondaryContainer, 0.8),
  },
} as const;

// A content group on the surface.
export const cardSx = {
  bgcolor: 'tonal.surfaceContainer',
  borderRadius: '24px',
} as const;

// --- OKLCH <-> sRGB -------------------------------------------------------------

function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

// Out-of-gamut colours keep their lightness and hue and lose chroma.
function oklchToHex(l: number, c: number, h: number): string {
  let lo = 0;
  let hi = c;
  let rgb = oklchToLinear(l, c, h);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(l, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear(l, lo, h);
  }
  return `#${rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function inGamut(rgb: number[]): boolean {
  return rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

// A text link that acts as a button (section actions such as "Load file"). Fixed line
// box and flex centring, so links line up whatever wraps them (a disabled one needs a
// <span> for its tooltip).
export const linkSx = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 24,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
} as const;
