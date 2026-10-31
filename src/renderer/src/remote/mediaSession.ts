import { useEffect, useRef, useState } from 'react';

type Session = {
  // What the TV has loaded; null takes the notification away.
  media: { title: string; artist: string; album?: string; artwork: string } | null;
  playing: boolean;
  duration: number;
  // Where the TV was at its last status.
  position: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  // From where the TV is now.
  onSeekBy: (delta: number) => void;
};

// The phone's media notification (lock screen, notification shade, Control Centre) for
// what plays on the TV, through the Media Session API. A page only gets one while it is
// playing audio itself, so a silent clip loops along with the TV: playing while the TV
// plays, paused while it's paused. Browsers only let audio start after a tap, so the
// notification shows from the first tap on the page.
export function useMediaSession(session: Session): void {
  const supported = 'mediaSession' in navigator;
  const latest = useRef(session);
  latest.current = session;
  const [audio] = useState(() => {
    const el = new Audio();
    el.loop = true;
    return el;
  });
  const [src] = useState(() => (supported ? URL.createObjectURL(silentWav(10)) : ''));
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const unlock = (): void => {
      const { media, playing } = latest.current;
      audio.src = src;
      audio
        .play()
        .then(() => {
          // Started once from a tap, it can start again later without one.
          if (!media || !playing) audio.pause();
          setUnlocked(true);
          document.removeEventListener('click', unlock, true);
        })
        .catch(() => {});
    };
    document.addEventListener('click', unlock, true);
    return () => document.removeEventListener('click', unlock, true);
  }, [supported, audio, src]);

  const active = !!session.media;
  useEffect(() => {
    if (!unlocked) return;
    if (!active) {
      // No source at all, or Chrome keeps a paused notification around.
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (!audio.getAttribute('src')) audio.src = src;
    if (session.playing) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [unlocked, active, session.playing, audio, src]);

  const { title, artist, album, artwork } = session.media ?? {};
  useEffect(() => {
    if (!supported) return;
    navigator.mediaSession.metadata = title
      ? new MediaMetadata({
          title,
          artist,
          album,
          artwork: artwork ? [{ src: new URL(artwork, location.href).href }] : [],
        })
      : null;
  }, [supported, title, artist, album, artwork]);

  useEffect(() => {
    if (!supported) return;
    navigator.mediaSession.playbackState = !active
      ? 'none'
      : session.playing
        ? 'playing'
        : 'paused';
  }, [supported, active, session.playing]);

  // The TV's position and length on the notification's bar; the browser runs it forward.
  const { duration, position } = session;
  useEffect(() => {
    if (!supported) return;
    try {
      if (active && duration > 0) {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.max(0, Math.min(position, duration)),
          playbackRate: 1,
        });
      } else {
        navigator.mediaSession.setPositionState();
      }
    } catch {
      // Older browsers without position state.
    }
  }, [supported, active, duration, position]);

  useEffect(() => {
    if (!supported) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => latest.current.onPlay()],
      ['pause', () => latest.current.onPause()],
      ['seekbackward', (d) => latest.current.onSeekBy(-(d.seekOffset ?? 10))],
      ['seekforward', (d) => latest.current.onSeekBy(d.seekOffset ?? 30)],
      ['seekto', (d) => d.seekTime !== undefined && latest.current.onSeek(d.seekTime)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // An action this browser doesn't know.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [supported]);
}

// `seconds` of 8 kHz 8-bit mono PCM silence, as a WAV file. Long enough to count as
// media: Chrome gives no notification to clips under 5 s.
function silentWav(seconds: number): Blob {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per frame
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  // 8-bit PCM is unsigned: 128 is the zero line.
  new Uint8Array(buffer, 44).fill(128);
  return new Blob([buffer], { type: 'audio/wav' });
}
