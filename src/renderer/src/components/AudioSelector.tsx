import { MenuItem, Select } from '@mui/material';
import { useEffect, useState } from 'react';
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

      const probeData = await window.api.probe(videoFile);
      const audio = probeData.streams
        .filter((s) => s.codec_type === 'audio')
        .map(
          (s, i): AudioSelection => ({
            index: i,
            name: formatLangTitle(s.tags.language, s.tags.title) ?? `Track ${i + 1}`,
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
    <Select
      variant="standard"
      value={choice?.index ?? 0}
      onChange={(e) => {
        const next = choices.find((c) => c.index === Number(e.target.value));
        if (next) {
          setChoice(next);
        }
      }}
    >
      {choices.map((c) => (
        <MenuItem key={c.index} value={c.index}>
          {c.name}
        </MenuItem>
      ))}
    </Select>
  );
}

function formatLangTitle(language?: string, title?: string): string | undefined {
  const lang = language ? language.toUpperCase() : undefined;
  if (lang && title) return `${lang} · ${title}`;
  return lang ?? title;
}
