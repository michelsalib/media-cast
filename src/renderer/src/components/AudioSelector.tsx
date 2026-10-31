import { CheckRounded } from '@mui/icons-material';
import { Button, Stack } from '@mui/material';
import { useEffect, useState } from 'react';
import type { VideoSource } from '../../../shared/types';
import { api } from '../ipc';
import { audioTrackName } from '../labels';
import { chipSx } from '../theme';
import type { AudioSelection } from './AudioSelection';

type Props = {
  video?: VideoSource;
  onChange?: (selection: AudioSelection | undefined) => void;
};

export default function AudioSelector({ video, onChange }: Props): React.JSX.Element | null {
  const [choices, setChoices] = useState<AudioSelection[]>([]);
  const [choice, setChoice] = useState<AudioSelection | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function compute(): Promise<void> {
      if (!video) {
        setChoices([]);
        setChoice(undefined);
        return;
      }

      const probeData = await api.probe(video.path);
      const audio = probeData.streams
        .filter((s) => s.codec_type === 'audio')
        .map(
          (s, i): AudioSelection => ({
            index: i,
            name: audioTrackName({ ...s.tags, channels: s.channels }, i),
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
  }, [video]);

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
