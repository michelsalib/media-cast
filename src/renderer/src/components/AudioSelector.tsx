import { Button, Stack } from '@mui/material';
import { useEffect, useState } from 'react';
import { api, pathFor } from '../ipc';
import { channelsLabel, languageName } from '../labels';
import { pillSx } from '../theme';
import type { AudioSelection } from './AudioSelection';

type Props = {
  videoFile?: File;
  onChange?: (selection: AudioSelection | undefined) => void;
};

export default function AudioSelector({ videoFile, onChange }: Props): React.JSX.Element | null {
  const [choices, setChoices] = useState<AudioSelection[]>([]);
  const [choice, setChoice] = useState<AudioSelection | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function compute(): Promise<void> {
      if (!videoFile) {
        setChoices([]);
        setChoice(undefined);
        return;
      }

      const probeData = await api.probe(pathFor(videoFile));
      const audio = probeData.streams
        .filter((s) => s.codec_type === 'audio')
        .map(
          (s, i): AudioSelection => ({
            index: i,
            name:
              [languageName(s.tags?.language) ?? s.tags?.title, channelsLabel(s.channels)]
                .filter(Boolean)
                .join(' · ') || `Track ${i + 1}`,
          })
        );

      if (cancelled) {
        return;
      }

      setChoices(audio);
      setChoice(audio[0]);
    }

    compute();

    return () => {
      cancelled = true;
    };
  }, [videoFile]);

  useEffect(() => {
    onChange?.(choice);
  }, [choice, onChange]);

  if (choices.length === 0) {
    return null;
  }

  return (
    <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
      {choices.map((c) => {
        const selected = c.index === choice?.index;
        return (
          <Button
            key={c.index}
            aria-pressed={selected}
            onClick={() => setChoice(c)}
            sx={pillSx(selected)}
          >
            {c.name}
          </Button>
        );
      })}
    </Stack>
  );
}
