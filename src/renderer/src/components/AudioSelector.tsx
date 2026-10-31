import { CheckRounded } from '@mui/icons-material';
import { Button, Stack } from '@mui/material';
import { chipSx } from '../theme';
import type { AudioSelection } from './AudioSelection';

type Props = {
  choices: AudioSelection[];
  value?: AudioSelection;
  onChange: (selection: AudioSelection) => void;
};

export default function AudioSelector({
  choices,
  value,
  onChange,
}: Props): React.JSX.Element | null {
  if (choices.length === 0) {
    return null;
  }

  return (
    <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
      {choices.map((c) => {
        const selected = c.index === value?.index;
        return (
          <Button
            key={c.index}
            aria-pressed={selected}
            onClick={() => onChange(c)}
            sx={chipSx(selected)}
            startIcon={selected ? <CheckRounded /> : undefined}
          >
            {c.name}
          </Button>
        );
      })}
    </Stack>
  );
}
