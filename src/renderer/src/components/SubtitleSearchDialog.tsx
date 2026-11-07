import { CloseRounded, SearchRounded, TuneRounded } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  InputAdornment,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import {
  SUBTITLE_PROVIDER_NAMES,
  type SubtitleQuery,
  type SubtitleSearchResponse,
  type SubtitleSearchResult,
  subtitleLanguageName,
} from '../../../shared/subtitleSearch';
import { errorMessage } from '../ipc';
import { tonalSx } from '../theme';
import LanguagesInput from './LanguagesInput';
import SubtitleSettingsDialog from './SubtitleSettingsDialog';
import type { SubtitleSearchBackend } from './subtitleBackends';

type Props = {
  open: boolean;
  // For the video ready or playing, from the window or the phone: also decides what a
  // download does. Keep it stable (memoized): a new one searches again.
  backend: SubtitleSearchBackend;
  onClose: () => void;
};

// The window's "Find online" (video ready or playing), and the phone remote's.
export default function SubtitleSearchDialog({ open, backend, onClose }: Props): React.JSX.Element {
  const compact = useMediaQuery((theme) => theme.breakpoints.down('sm'));
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [response, setResponse] = useState<SubtitleSearchResponse | undefined>();
  const [downloading, setDownloading] = useState<SubtitleSearchResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const search = useCallback(
    (query: SubtitleQuery): void => {
      setSearching(true);
      setError(undefined);
      backend
        .search(query)
        .then(setResponse)
        .catch((err: unknown) => setError(errorMessage(err)))
        .finally(() => setSearching(false));
    },
    [backend]
  );

  // Fill the form from the file name and search straight away.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResponse(undefined);
    setError(undefined);
    backend
      .guess()
      .then(({ guess, languages }) => {
        if (cancelled) return;
        setTitle(guess.title);
        setYear(guess.year ? String(guess.year) : '');
        setSeason(guess.season !== undefined ? String(guess.season) : '');
        setEpisode(guess.episode !== undefined ? String(guess.episode) : '');
        setLanguages(languages);
        search({ ...guess, languages });
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [open, backend, search]);

  function currentQuery(): SubtitleQuery {
    const s = Number.parseInt(season, 10);
    const e = Number.parseInt(episode, 10);
    const y = Number.parseInt(year, 10);
    const isEpisode = Number.isFinite(s) && Number.isFinite(e);
    return {
      title: title.trim(),
      year: Number.isFinite(y) ? y : undefined,
      season: isEpisode ? s : undefined,
      episode: isEpisode ? e : undefined,
      languages,
    };
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!title.trim()) return;
    search(currentQuery());
  }

  function download(result: SubtitleSearchResult): void {
    const { season: s, episode: e } = currentQuery();
    setDownloading(result);
    setError(undefined);
    backend
      .download(result, { season: s, episode: e })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setDownloading(undefined));
  }

  const exact = response?.results.filter((r) => r.hashMatch) ?? [];
  const others = response?.results.filter((r) => !r.hashMatch) ?? [];

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: compact
            ? { width: '100%', backgroundImage: 'none', bgcolor: 'tonal.surfaceContainerLow' }
            : {
                top: 44,
                right: 12,
                bottom: 12,
                height: 'auto',
                width: 'min(460px, calc(100% - 24px))',
                borderRadius: '28px',
                backgroundImage: 'none',
                bgcolor: 'tonal.surfaceContainerLow',
              },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ alignItems: 'center', pl: 3, pr: 1.5, pt: 2.25, pb: 1 }}
      >
        <Typography variant="h2" sx={{ flex: 1 }}>
          Find subtitles
        </Typography>
        {backend.settings && (
          <Tooltip title="Languages, accounts and API keys">
            <IconButton onClick={() => setSettingsOpen(true)} sx={{ color: 'text.secondary' }}>
              <TuneRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <IconButton onClick={onClose} aria-label="close" sx={{ color: 'text.secondary' }}>
          <CloseRounded fontSize="small" />
        </IconButton>
      </Stack>

      <Box
        component="form"
        onSubmit={submit}
        sx={{
          display: 'grid',
          // On a phone the title gets a row of its own.
          gridTemplateColumns: compact
            ? 'repeat(3, minmax(0, 1fr))'
            : 'minmax(0, 1fr) 64px 64px 76px',
          gap: 1,
          px: 3,
          pt: 1,
          pb: 2,
        }}
      >
        <TextField
          aria-label="Title"
          placeholder="Title"
          size="small"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={compact ? { gridColumn: '1 / -1' } : undefined}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          label="Season"
          size="small"
          value={season}
          onChange={(e) => setSeason(e.target.value.replace(/\D/g, ''))}
        />
        <TextField
          label="Ep."
          size="small"
          value={episode}
          onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ''))}
        />
        <TextField
          label="Year"
          size="small"
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
        />
        <Box sx={{ gridColumn: compact ? '1 / 3' : '1 / 4' }}>
          <LanguagesInput value={languages} onChange={setLanguages} />
        </Box>
        <Button
          type="submit"
          variant="contained"
          disabled={searching || !title.trim()}
          sx={{ height: 40, alignSelf: 'start', boxShadow: 'none' }}
        >
          Search
        </Button>
      </Box>

      {searching && <LinearProgress sx={{ mx: 3, borderRadius: 1 }} />}

      <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pb: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}

        {response && !searching && response.results.length === 0 && (
          <Typography sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
            Nothing found. Try fixing the title, or clearing the year.
          </Typography>
        )}

        {exact.length > 0 && <GroupLabel>Best for your file</GroupLabel>}
        {exact.map((r, i) => (
          <ResultRow
            key={`${r.provider}:${r.ref}`}
            result={r}
            highlight={i === 0 ? 'strong' : 'soft'}
            downloading={downloading === r}
            disabled={!!downloading}
            onUse={() => download(r)}
          />
        ))}

        {others.length > 0 && (
          <GroupLabel>{exact.length > 0 ? 'Other versions' : 'Results'}</GroupLabel>
        )}
        {others.map((r) => (
          <ResultRow
            key={`${r.provider}:${r.ref}`}
            result={r}
            downloading={downloading === r}
            disabled={!!downloading}
            onUse={() => download(r)}
          />
        ))}
      </Stack>

      {!!response?.notices.length && (
        <Stack
          spacing={0.25}
          sx={{ px: 3, py: 1.75, borderTop: '1px solid', borderColor: 'divider' }}
        >
          {response.notices.map((n) => (
            <Typography key={n.provider} sx={{ fontSize: 12, color: 'text.secondary' }}>
              {SUBTITLE_PROVIDER_NAMES[n.provider]}: {n.message}
            </Typography>
          ))}
        </Stack>
      )}

      <SubtitleSettingsDialog
        open={backend.settings && settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(settings) => {
          setLanguages(settings.languages);
          if (title.trim()) search({ ...currentQuery(), languages: settings.languages });
        }}
      />
    </Drawer>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Typography sx={{ px: 1, pt: 1, fontSize: 13, color: 'text.secondary' }}>{children}</Typography>
  );
}

function ResultRow({
  result,
  highlight,
  downloading,
  disabled,
  onUse,
}: {
  result: SubtitleSearchResult;
  highlight?: 'strong' | 'soft';
  downloading: boolean;
  disabled: boolean;
  onUse: () => void;
}): React.JSX.Element {
  const facts = [
    result.release,
    SUBTITLE_PROVIDER_NAMES[result.provider],
    result.downloads !== undefined ? `${result.downloads.toLocaleString()} downloads` : undefined,
  ].filter(Boolean);

  return (
    <Stack
      direction="row"
      spacing={1.75}
      sx={{
        alignItems: 'center',
        pl: 2,
        pr: 1.5,
        py: highlight ? 1.75 : 1.25,
        borderRadius: '16px',
        bgcolor: highlight ? 'tonal.primaryContainer' : 'tonal.surfaceContainerHigh',
        color: highlight ? 'tonal.onPrimaryContainer' : 'tonal.onSurface',
      }}
    >
      <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>
            {subtitleLanguageName(result.language)}
            {result.hearingImpaired && (
              <Box component="span" sx={{ fontWeight: 400, opacity: 0.8 }}>
                {' '}
                · with sound descriptions
              </Box>
            )}
          </Typography>
          {result.hashMatch && (
            <Tooltip title="Matched by file fingerprint: made for this exact release, so it should already be in sync">
              <Box
                sx={{
                  height: 20,
                  px: 1,
                  borderRadius: '6px',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                Perfect match
              </Box>
            </Tooltip>
          )}
        </Stack>
        <Typography noWrap title={result.release} sx={{ fontSize: 12, opacity: 0.75 }}>
          {facts.join(' · ')}
        </Typography>
      </Stack>
      <Button
        onClick={onUse}
        disabled={disabled}
        variant={highlight === 'strong' ? 'contained' : 'text'}
        sx={[{ height: 36, minWidth: 64, flexShrink: 0 }, highlight === 'strong' ? {} : tonalSx]}
      >
        {downloading ? <CircularProgress size={16} color="inherit" /> : 'Use'}
      </Button>
    </Stack>
  );
}
