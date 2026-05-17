import {
  AppBar,
  Collapse,
  createTheme,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
} from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { useState } from 'react';
import type { Device } from '../../shared/types';
import AppInfoButton from './components/AppInfoButton';
import { Connector } from './components/Connector';
import Dropper from './components/Dropper';
import Player from './components/Player';
import UpdateButton from './components/UpdateButton';

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
            <Toolbar
              variant="dense"
              disableGutters
              sx={{
                minHeight: 'inherit',
                height: '32px',
                paddingLeft: 3,
                paddingRight: 1,
                // Sized to the draggable area so icons sit flush against the system
                // window controls without overlap (controls live outside this width).
                // disableGutters drops the default 24px right padding; we add a small
                // one back so the icons aren't crammed against the system controls.
                width: 'env(titlebar-area-width, 100%)',
                marginLeft: 'env(titlebar-area-x, 0px)',
              }}
            >
              <Typography variant="h6" sx={{ fontSize: 12, flexGrow: 1 }}>
                Media Cast
              </Typography>
              <UpdateButton />
              <AppInfoButton />
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
