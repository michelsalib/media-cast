// Human wording for what ffprobe reports. Technical names stay in VideoInfoButton.

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

// ffprobe tags are ISO 639-2 ("eng", "fre"); Intl canonicalizes those to "en", "fr".
export function languageName(code: string | undefined): string | undefined {
  if (!code || code === 'und') return undefined;
  try {
    const name = languageNames.of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function channelsLabel(channels: number | undefined): string | undefined {
  switch (channels) {
    case 1:
      return 'Mono';
    case 2:
      return 'Stereo';
    case 6:
      return '5.1';
    case 8:
      return '7.1';
    default:
      return undefined;
  }
}

export function resolutionLabel(height: number | undefined): string | undefined {
  if (!height) return undefined;
  if (height >= 2000) return '4K';
  if (height >= 1000) return 'Full HD';
  if (height >= 700) return 'HD';
  return 'SD';
}

export function runtimeLabel(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function episodeLabel(info: {
  season?: number;
  episode?: number;
  year?: number;
}): string | undefined {
  if (info.season !== undefined && info.episode !== undefined) {
    return `Season ${info.season} · Episode ${info.episode}`;
  }
  return info.year ? String(info.year) : undefined;
}
