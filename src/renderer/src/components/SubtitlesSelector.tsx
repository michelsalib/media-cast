import { useEffect, useRef, useState } from 'react';
import type { DeviceType, VideoSource } from '../../../shared/types';
import { api, errorMessage } from '../ipc';
import SubtitleChoices, { type SubtitleOption } from './SubtitleChoices';
import {
  bundledSelection,
  internalSubtitles,
  NO_SUBTITLES,
  type SubtitlesFile,
  type SubtitlesSelection,
} from './SubtitlesSelection';

type Props = {
  video?: VideoSource;
  subFile?: SubtitlesFile;
  // The subtitle files in a torrent video's torrent: listed, downloaded when picked.
  bundled?: SubtitlesFile[];
  deviceType?: DeviceType;
  // Owned by the caller (the phone remote can pick too); a default is picked per video.
  value: SubtitlesSelection;
  onChange: (selection: SubtitlesSelection) => void;
  onError?: (message: string) => void;
};

// Chromecast always direct-plays with sidecar WebVTT, so image-based tracks have no
// path to the screen there.
export function isSupported(c: SubtitlesSelection, deviceType: DeviceType | undefined): boolean {
  return !(c.type === 'internal' && c.bitmap && deviceType === 'chromecast');
}

function choiceKey(c: SubtitlesSelection): string {
  switch (c.type) {
    case 'external':
      return `ext:${c.path}`;
    case 'internal':
      return `int:${c.index}`;
    default:
      return 'none';
  }
}

export default function SubtitlesSelector({
  value,
  onChange,
  onError,
  subFile,
  bundled,
  video,
  deviceType,
}: Props): React.JSX.Element {
  const [internal, setInternal] = useState<SubtitlesSelection[]>([]);
  // The torrent file being downloaded before it is picked.
  const [fetching, setFetching] = useState<string>();
  // Bumped per video, so a download finishing late doesn't pick for the next one.
  const generation = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  // biome-ignore lint/correctness/useExhaustiveDependencies: pickBundled only uses setters and refs
  useEffect(() => {
    let cancelled = false;
    const gen = ++generation.current;
    setFetching(undefined);

    async function compute(): Promise<void> {
      const tracks = video ? internalSubtitles(await api.probe(video.path)) : [];
      if (cancelled) return;

      const fallback =
        (subFile && { type: 'external' as const, name: subFile.name, path: subFile.path }) ??
        tracks.find((c) => c.type === 'internal' && isSupported(c, deviceType)) ??
        NO_SUBTITLES;
      setInternal(tracks);
      onChange(fallback);

      // A torrent's lone subtitle file goes with the video like a dropped one. Among
      // several (a pack, or one per language), nothing is guessed.
      const lone = !subFile && bundled?.length === 1 ? bundled[0] : undefined;
      if (lone) {
        const picked = await pickBundled(lone, gen).catch(() => undefined);
        // Unless something else was picked meanwhile.
        if (picked && !cancelled && valueRef.current === fallback) onChange(picked);
      }
    }

    void compute();

    return () => {
      cancelled = true;
    };
  }, [video, subFile, bundled, deviceType, onChange]);

  // Downloads a torrent file (main keeps it once fetched) and resolves to its selection.
  async function pickBundled(file: SubtitlesFile, gen: number): Promise<SubtitlesSelection> {
    setFetching(file.path);
    try {
      await api.fetchTorrentSubtitles(file.path);
      return bundledSelection(file);
    } finally {
      if (gen === generation.current) setFetching(undefined);
    }
  }

  const external: SubtitlesSelection | undefined = subFile && {
    type: 'external',
    name: subFile.name,
    path: subFile.path,
  };
  const options: (SubtitleOption & { selection?: SubtitlesSelection; file?: SubtitlesFile })[] = [
    ...(external
      ? [
          {
            key: choiceKey(external),
            label: 'Added subtitles',
            detail: external.name,
            selection: external,
          },
        ]
      : []),
    ...internal.map((c) => ({
      key: choiceKey(c),
      label: c.name,
      group: 'In the video',
      disabled: !isSupported(c, deviceType),
      hint: isSupported(c, deviceType)
        ? undefined
        : 'Image subtitles can’t be shown on a Chromecast',
      selection: c,
    })),
    ...(bundled ?? []).map((f) => ({
      key: choiceKey(bundledSelection(f)),
      label: f.label ?? f.name,
      group: 'In the torrent',
      detail: f.folder ? `${f.folder}/${f.name}` : f.name,
      file: f,
    })),
    { key: choiceKey(NO_SUBTITLES), label: 'Off', selection: NO_SUBTITLES },
  ];

  function pick(key: string): void {
    const option = options.find((o) => o.key === key);
    if (option?.selection) {
      onChange(option.selection);
    } else if (option?.file) {
      const gen = generation.current;
      pickBundled(option.file, gen)
        .then((picked) => gen === generation.current && onChange(picked))
        .catch((err) => onError?.(errorMessage(err)));
    }
  }

  return (
    <SubtitleChoices
      options={options}
      selected={choiceKey(value)}
      loading={fetching && `ext:${fetching}`}
      disabled={!!fetching}
      onPick={pick}
    />
  );
}
