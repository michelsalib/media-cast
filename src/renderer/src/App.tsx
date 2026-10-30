import { Alert, Box, Snackbar, Stack, ThemeProvider, Typography } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { useCallback, useState } from 'react';
import type { Device } from '../../shared/types';
import AppInfoButton from './components/AppInfoButton';
import { Connector } from './components/Connector';
import Dropper from './components/Dropper';
import UpdateButton from './components/UpdateButton';
import { api, errorMessage } from './ipc';
import { theme } from './theme';

// The picked device stays picked after Stop (DISCONNECTED), so Play can reconnect to it.
export type Connection = {
  device: Device;
  state: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
};

function App(): React.JSX.Element {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectError, setConnectError] = useState<string | undefined>();

  const connect = useCallback(async (device: Device): Promise<boolean> => {
    setConnectError(undefined);
    setConnection({ device, state: 'CONNECTING' });
    try {
      await api.connect(device.id);
      setConnection({ device, state: 'CONNECTED' });
      return true;
    } catch (err) {
      setConnection({ device, state: 'DISCONNECTED' });
      setConnectError(errorMessage(err));
      return false;
    }
  }, []);

  const stop = useCallback((): void => {
    void api.disconnect();
    setConnection((c) => c && { ...c, state: 'DISCONNECTED' });
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline>
        <Box sx={{ height: '100%', position: 'relative' }}>
          <Dropper
            connection={connection}
            onConnect={connect}
            onStop={stop}
            devices={(label) => (
              <Connector
                label={label}
                connection={connection}
                onSelect={(device) => void connect(device)}
              />
            )}
          />
          <Stack
            direction="row"
            sx={{
              position: 'absolute',
              top: 0,
              zIndex: 2,
              alignItems: 'center',
              appRegion: 'drag',
              height: 32,
              pl: 2,
              pr: 1,
              // Sized to the draggable area so icons sit flush against the system
              // window controls without overlap (controls live outside this width).
              width: 'env(titlebar-area-width, 100%)',
              left: 'env(titlebar-area-x, 0px)',
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 600, opacity: 0.85, flexGrow: 1 }}>
              Media Cast
            </Typography>
            <UpdateButton />
            <AppInfoButton />
          </Stack>
          <Snackbar
            open={!!connectError}
            onClose={() => setConnectError(undefined)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          >
            <Alert severity="error" variant="filled" onClose={() => setConnectError(undefined)}>
              Could not connect: {connectError}
            </Alert>
          </Snackbar>
        </Box>
      </CssBaseline>
    </ThemeProvider>
  );
}

export default App;
