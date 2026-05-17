import {
  AppBar,
  Box,
  Collapse,
  createTheme,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
} from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { useState } from 'react';
import { Connector } from './components/Connector';
import Dropper from './components/Dropper';
import AppInfoButton from './components/AppInfoButton';
import Player from './components/Player';
import type { Device } from '../../shared/types';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#7c4dff',
      light: '#b39dff',
      dark: '#4d2c99',
    },
    secondary: {
      main: '#22d3ee',
    },
    background: {
      default: '#0e0b1a',
      paper: '#161229',
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
});

function App(): React.JSX.Element {
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const connected = connectedDevice !== null;

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline>
        <Stack
          sx={{
            height: '100%',
            background:
              'radial-gradient(1200px 600px at 0% 0%, rgba(124,77,255,0.18), transparent 60%),' +
              'radial-gradient(900px 500px at 100% 100%, rgba(34,211,238,0.10), transparent 60%),' +
              '#0e0b1a',
          }}
        >
          <AppBar
            position="relative"
            elevation={0}
            sx={{
              appRegion: 'drag',
              background: 'transparent',
              backgroundImage: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Toolbar variant="dense" sx={{ minHeight: 'inherit', height: '32px' }}>
              <Typography variant="h6" sx={{ fontSize: 12, flexGrow: 1 }}>
                Media Cast
              </Typography>
              <AppInfoButton />
              {/* Spacer for the Windows/Linux titleBarOverlay window controls. */}
              <Box sx={{ width: '150px', flexShrink: 0 }} />
            </Toolbar>
          </AppBar>
          <Dropper connected={connected}>
            <Stack spacing={5} sx={{ margin: 5 }}>
              <Collapse in={!connected} unmountOnExit>
                <Connector
                  onChange={(s, device) => setConnectedDevice(s === 'CONNECTED' ? device : null)}
                ></Connector>
              </Collapse>
              <Collapse in={connected}>
                <Player
                  device={connectedDevice}
                  onDisconnect={() => setConnectedDevice(null)}
                ></Player>
              </Collapse>
            </Stack>
          </Dropper>
        </Stack>
      </CssBaseline>
    </ThemeProvider>
  );
}

export default App;
