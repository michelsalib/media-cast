import { CheckRounded } from '@mui/icons-material';
import {
  Autocomplete,
  Button,
  CircularProgress,
  createFilterOptions,
  ListItemText,
  ListSubheader,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import { Fragment } from 'react';
import { chipSx } from '../theme';

export type SubtitleOption = {
  key: string;
  label: string;
  // Where it comes from (a file's path in the torrent); searched and shown in the list.
  detail?: string;
  // "In the video", "In the torrent"; none for Off and an added file.
  group?: string;
  hint?: string;
  disabled?: boolean;
};

type Props = {
  options: SubtitleOption[];
  selected: string;
  // The option being switched to.
  loading?: string;
  disabled?: boolean;
  onPick: (key: string) => void;
};

// Past this many, chips give way to a searchable list (a torrent pack can bring hundreds).
const MAX_CHIPS = 12;

const filter = createFilterOptions<SubtitleOption>({
  stringify: (o) => `${o.label} ${o.group ?? ''} ${o.detail ?? ''}`,
});

// The subtitle choices of the ready view and of the player's track switcher.
export default function SubtitleChoices({
  options,
  selected,
  loading,
  disabled,
  onPick,
}: Props): React.JSX.Element {
  if (options.length <= MAX_CHIPS) {
    return (
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
        {options.map((o) => {
          const isSelected = o.key === selected;
          return (
            <Tooltip key={o.key} title={o.hint ?? o.detail ?? ''} placement="top">
              <span>
                <Button
                  aria-pressed={isSelected}
                  disabled={(disabled || o.disabled) && !isSelected}
                  onClick={isSelected ? undefined : () => onPick(o.key)}
                  sx={chipSx(isSelected)}
                  startIcon={
                    loading === o.key ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : isSelected ? (
                      <CheckRounded />
                    ) : undefined
                  }
                >
                  {o.label}
                </Button>
              </span>
            </Tooltip>
          );
        })}
      </Stack>
    );
  }

  // groupBy needs each group in one run: the ungrouped ones (Off, an added file) first.
  const sorted = [...options.filter((o) => !o.group), ...options.filter((o) => o.group)];
  const value = sorted.find((o) => o.key === selected) ?? sorted[0];
  return (
    <Autocomplete
      options={sorted}
      value={value}
      onChange={(_, o) => o.key !== selected && onPick(o.key)}
      disableClearable
      disabled={disabled}
      size="small"
      fullWidth
      groupBy={(o) => o.group ?? ''}
      getOptionLabel={(o) => (o.group ? `${o.label} · ${o.group}` : o.label)}
      getOptionDisabled={(o) => !!o.disabled}
      isOptionEqualToValue={(a, b) => a.key === b.key}
      filterOptions={filter}
      renderGroup={({ key, group, children }) =>
        group ? (
          <li key={key}>
            <ListSubheader sx={{ top: -8, bgcolor: 'tonal.surfaceContainerHigh' }}>
              {group}
            </ListSubheader>
            <ul style={{ padding: 0 }}>{children}</ul>
          </li>
        ) : (
          <Fragment key={key}>{children}</Fragment>
        )
      }
      renderOption={({ key: _, ...props }, o) => (
        <li key={o.key} {...props} title={o.hint}>
          <ListItemText
            primary={o.label}
            secondary={o.detail}
            slotProps={{ secondary: { sx: { wordBreak: 'break-all' } } }}
          />
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search subtitles"
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              startAdornment: loading ? (
                <CircularProgress size={16} color="inherit" sx={{ ml: 0.5 }} />
              ) : (
                params.slotProps.input.startAdornment
              ),
            },
          }}
        />
      )}
      // Like the menus and popovers (see theme.ts).
      slotProps={{
        paper: {
          sx: {
            borderRadius: '16px',
            backgroundImage: 'none',
            bgcolor: 'tonal.surfaceContainerHigh',
          },
        },
      }}
      sx={{ maxWidth: 520 }}
    />
  );
}
