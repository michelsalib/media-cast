import { Autocomplete, Chip, TextField } from '@mui/material';
import { SUBTITLE_LANGUAGES, type SubtitleLanguage } from '../../../shared/subtitleSearch';

type Props = {
  value: string[];
  onChange: (codes: string[]) => void;
  label?: string;
};

export default function LanguagesInput({
  value,
  onChange,
  label = 'Languages',
}: Props): React.JSX.Element {
  const selected = value
    .map((code) => SUBTITLE_LANGUAGES.find((l) => l.code === code))
    .filter((l): l is SubtitleLanguage => !!l);

  return (
    <Autocomplete
      multiple
      size="small"
      options={SUBTITLE_LANGUAGES}
      value={selected}
      getOptionLabel={(l) => l.name}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      // At least one language: searching "all languages" floods every provider.
      onChange={(_e, langs) => langs.length > 0 && onChange(langs.map((l) => l.code))}
      disableClearable
      renderValue={(langs, getItemProps) =>
        langs.map((l, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} size="small" label={l.name} {...itemProps} />;
        })
      }
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}
