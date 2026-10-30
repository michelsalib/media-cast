import { Close, Search, Settings } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import {
  SUBTITLE_PROVIDER_NAMES,
  type SubtitleQuery,
  type SubtitleSearchResponse,
  type SubtitleSearchResult,
  subtitleLanguageName,
} from '../../../shared/subtitleSearch';
import { api, errorMessage } from '../ipc';
import LanguagesInput from './LanguagesInput';
import SubtitleSettingsDialog from './SubtitleSettingsDialog';
import type { SubtitlesFile } from './SubtitlesSelection';

type Props = {
  open: boolean;
  videoPath: string;
  onClose: () => void;
  // A result was downloaded; the caller previews it before using it.
  onDownloaded: (file: SubtitlesFile) => void;
};

export default function SubtitleSearchDialog({
  open,
  videoPath,
  onClose,
  onDownloaded,
}: Props): React.JSX.Element {
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
      api
        .searchSubtitles(videoPath, query)
        .then(setResponse)
        .catch((err: unknown) => setError(errorMessage(err)))
        .finally(() => setSearching(false));
    },
    [videoPath]
  );

  // Fill the form from the file name and search straight away.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResponse(undefined);
    setError(undefined);
    Promise.all([api.guessSubtitleQuery(videoPath), api.subtitleSettings()])
      .then(([guess, settings]) => {
        if (cancelled) return;
        setTitle(guess.title);
        setYear(guess.year ? String(guess.year) : '');
        setSeason(guess.season !== undefined ? String(guess.season) : '');
        setEpisode(guess.episode !== undefined ? String(guess.episode) : '');
        setLanguages(settings.languages);
        search({ ...guess, languages: settings.languages });
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [open, videoPath, search]);

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
    api
      .downloadSubtitle(result, { season: s, episode: e })
      .then(onDownloaded)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setDownloading(undefined));
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>Search subtitles online</Box>
        <Tooltip title="Languages, accounts and API keys">
          <IconButton onClick={() => setSettingsOpen(true)}>
            <Settings />
          </IconButton>
        </Tooltip>
        <IconButton onClick={onClose} aria-label="close">
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 420 }}>
        <Box
          component="form"
          onSubmit={submit}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 80px 80px 80px auto',
            gap: 1.5,
            pt: 1,
            alignItems: 'start',
          }}
        >
          <TextField
            label="Title"
            size="small"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            label="Year"
            size="small"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
          />
          <TextField
            label="Season"
            size="small"
            value={season}
            onChange={(e) => setSeason(e.target.value.replace(/\D/g, ''))}
          />
          <TextField
            label="Episode"
            size="small"
            value={episode}
            onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ''))}
          />
          <Button
            type="submit"
            variant="contained"
            startIcon={<Search />}
            disabled={searching || !title.trim()}
            sx={{ height: 40 }}
          >
            Search
          </Button>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <LanguagesInput value={languages} onChange={setLanguages} />
          </Box>
        </Box>

        {searching && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}
        {response?.notices.map((n) => (
          <Alert key={n.provider} severity="info" sx={{ py: 0 }}>
            <strong>{SUBTITLE_PROVIDER_NAMES[n.provider]}:</strong> {n.message}
          </Alert>
        ))}

        {response && !searching && response.results.length === 0 && (
          <Typography sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
            No subtitles found. Try fixing the title, or clearing the year.
          </Typography>
        )}

        {response && response.results.length > 0 && (
          <List dense sx={{ overflowY: 'auto', mx: -1 }}>
            {response.results.map((r) => (
              <ListItemButton
                key={`${r.provider}:${r.ref}`}
                onClick={() => download(r)}
                disabled={!!downloading}
                sx={{ borderRadius: 1 }}
              >
                <ListItemText
                  primary={r.release}
                  slotProps={{
                    primary: { sx: { wordBreak: 'break-word' } },
                    secondary: { component: 'div' },
                  }}
                  secondary={
                    <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                      {r.hashMatch && (
                        <Tooltip title="Matched by file fingerprint: made for this exact release, so it should already be in sync">
                          <Chip size="small" color="success" label="Exact match" />
                        </Tooltip>
                      )}
                      <Chip size="small" label={subtitleLanguageName(r.language)} />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={SUBTITLE_PROVIDER_NAMES[r.provider]}
                      />
                      {r.hearingImpaired && (
                        <Tooltip title="Hearing impaired: includes sound descriptions">
                          <Chip size="small" variant="outlined" label="HI" />
                        </Tooltip>
                      )}
                      {r.downloads !== undefined && (
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', alignSelf: 'center' }}
                        >
                          {r.downloads.toLocaleString()} downloads
                        </Typography>
                      )}
                    </Stack>
                  }
                />
                {downloading === r && <CircularProgress size={20} sx={{ ml: 1 }} />}
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>

      <SubtitleSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(settings) => {
          setLanguages(settings.languages);
          if (title.trim()) search({ ...currentQuery(), languages: settings.languages });
        }}
      />
    </Dialog>
  );
}
