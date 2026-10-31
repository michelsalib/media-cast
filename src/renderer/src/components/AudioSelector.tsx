import { CheckRounded } from '@mui/icons-material';
import { Button, Stack } from '@mui/material';
import { useEffect, useState } from 'react';
import type { VideoSource } from '../../../shared/types';
import { api } from '../ipc';
import { chipSx } from '../theme';
import { type AudioSelection, audioChoices } from './AudioSelection';

type Props = {
  video?: VideoSource;
  // Owned by the caller (the phone remote can pick too); reset to the first track per video.
  value?: AudioSelection;
  onChange: (selection: AudioSelection | undefined) => void;
};

export default function AudioSelector({ video, value, onChange }: Props): React.JSX.Element | null {
  const [choices, setChoices] = useState<AudioSelection[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function compute(): Promise<void> {
      if (!video) {
        setChoices([]);
        onChange(undefined);
        return;
      }

      const audio = audioChoices(await api.probe(video.path));
      if (cancelled) {
        return;
      }

      setChoices(audio);
      onChange(audio[0]);
    }

    compute();

    return () => {
      cancelled = true;
    };
  }, [video, onChange]);

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
