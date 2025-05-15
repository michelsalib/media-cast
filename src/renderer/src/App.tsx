import {
  AppBar,
  Collapse,
  createTheme,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography
} from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { useState } from 'react';
import { Connector } from './components/Connector';
import Dropper from './components/Dropper';
import Player from './components/Player';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

function App(): React.JSX.Element {
  const [connected, setConnected] = useState(false);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline>
        <Stack sx={{ height: '100%' }}>
          <AppBar position="relative" sx={{ appRegion: 'drag' }}>
            <Toolbar variant="dense" sx={{ minHeight: 'inherit', height: '32px' }}>
              <Typography variant="h6" sx={{ fontSize: 12 }}>
                Media Cast
              </Typography>
            </Toolbar>
          </AppBar>
          <Dropper connected={connected}>
            <Stack spacing={5} margin={5}>
              <Collapse in={!connected} unmountOnExit>
                <Connector onChange={(s) => setConnected(s == 'CONNECTED')}></Connector>
              </Collapse>
              <Collapse in={connected}>
                <Player onDisconnect={() => setConnected(false)}></Player>
              </Collapse>
            </Stack>
          </Dropper>
        </Stack>
      </CssBaseline>
    </ThemeProvider>
  );
}

export default App;
