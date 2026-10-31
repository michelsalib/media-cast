import {
  Alert,
  Box,
  Snackbar,
  Stack,
  ThemeProvider,
  Typography,
  useMediaQuery,
} from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import logo from '../../../build/icon.svg';
import type { Device, ThemeSource } from '../../shared/types';
import { Connector } from './components/Connector';
import Dropper from './components/Dropper';
import SettingsMenu from './components/SettingsMenu';
import UpdateButton from './components/UpdateButton';
import { api, errorMessage, onEvent } from './ipc';
import { DEFAULT_ACCENT, makeTheme } from './theme';

// The picked device stays picked after Stop (DISCONNECTED), so Play can reconnect to it.
export type Connection = {
  device: Device;
  state: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
};

function App(): React.JSX.Element {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectError, setConnectError] = useState<string | undefined>();
  const [themeSource, setThemeSource] = useState<ThemeSource>('system');
  const [accent, setAccent] = useState(DEFAULT_ACCENT);

  useEffect(() => {
    api
      .appearance()
      .then((a) => {
        setThemeSource(a.themeSource);
        if (a.accentColor) setAccent(a.accentColor);
      })
      .catch(() => {});
    return onEvent('accentColor', setAccent);
  }, []);

  // Main applies the choice to nativeTheme, which drives this media query.
  const dark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const theme = useMemo(() => makeTheme(dark ? 'dark' : 'light', accent), [dark, accent]);

  useEffect(() => {
    const { surface, onSurfaceVariant } = theme.palette.tonal;
    void api.setTitleBarColors(surface, onSurfaceVariant);
  }, [theme]);

  function chooseThemeSource(value: ThemeSource): void {
    setThemeSource(value);
    void api.setThemeSource(value);
  }

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

  useEffect(() => onEvent('remoteStop', stop), [stop]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline>
        <Box sx={{ height: '100%', position: 'relative', bgcolor: 'tonal.surface' }}>
          <Dropper
            connection={connection}
            onConnect={connect}
            onStop={stop}
            devices={(label, actions) => (
              <Connector
                label={label}
                actions={actions}
                connection={connection}
                onSelect={(device) => void connect(device)}
              />
            )}
          />
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              position: 'absolute',
              top: 0,
              zIndex: 2,
              alignItems: 'center',
              appRegion: 'drag',
              height: 32,
              pl: 1.5,
              pr: 1,
              // Sized to the draggable area so icons sit flush against the system
              // window controls without overlap (controls live outside this width).
              width: 'env(titlebar-area-width, 100%)',
              left: 'env(titlebar-area-x, 0px)',
            }}
          >
            <Box component="img" src={logo} alt="" sx={{ width: 18, height: 18, mr: 0.5 }} />
            <Typography
              sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', flexGrow: 1 }}
            >
              Media Cast
            </Typography>
            <UpdateButton />
            <SettingsMenu themeSource={themeSource} onThemeSourceChange={chooseThemeSource} />
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
