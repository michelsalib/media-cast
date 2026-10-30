import { alpha, createTheme } from '@mui/material';

const MINT = '#5EF2C0';
const VIOLET = '#B56CF5';
const INK = '#0B0C14';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: MINT, light: '#9BFFE0', dark: '#2FB585', contrastText: '#062A1F' },
    secondary: { main: VIOLET },
    background: { default: INK, paper: '#181A28' },
    text: { primary: '#FFFFFF', secondary: '#C3C7D9' },
    divider: 'rgba(255,255,255,0.08)',
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Outfit", system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    h1: { fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 },
    h2: { fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: INK },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.15)', borderRadius: 4 },
        '*::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.25)' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 999,
          paddingInline: 16,
          variants: [
            {
              props: { variant: 'contained', color: 'primary' },
              style: {
                boxShadow: `0 10px 30px ${alpha(MINT, 0.3)}`,
                '&:hover': { boxShadow: `0 10px 30px ${alpha(MINT, 0.45)}` },
                '&.Mui-disabled': { boxShadow: 'none' },
              },
            },
          ],
        },
        sizeLarge: { height: 52, paddingInline: 26, fontSize: 16, fontWeight: 700 },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { color: 'inherit' } },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 999 } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.06)',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 24,
          backgroundImage: 'none',
          backgroundColor: '#181A28',
          border: '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          backgroundImage: 'none',
          backgroundColor: '#1E2032',
          border: '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1E2032',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          fontSize: 12,
          padding: '8px 10px',
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: { root: { borderRadius: 14 } },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 14 } },
    },
  },
});

// A pill that toggles between picked (white) and not picked (glass).
export function pillSx(selected: boolean) {
  return {
    height: 36,
    px: 2,
    borderRadius: 999,
    fontWeight: selected ? 600 : 500,
    fontSize: 14,
    color: selected ? INK : 'text.primary',
    backgroundColor: selected ? '#FFFFFF' : 'rgba(255,255,255,0.1)',
    '&:hover': { backgroundColor: selected ? '#FFFFFF' : 'rgba(255,255,255,0.16)' },
    '&.Mui-disabled': {
      color: 'rgba(255,255,255,0.35)',
      backgroundColor: 'rgba(255,255,255,0.05)',
    },
  } as const;
}

// Low-emphasis round or pill buttons on top of artwork.
export const glassSx = {
  color: 'text.primary',
  backgroundColor: 'rgba(255,255,255,0.1)',
  '&:hover': { backgroundColor: 'rgba(255,255,255,0.16)' },
} as const;
