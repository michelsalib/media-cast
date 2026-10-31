import { useEffect, useRef, useState } from 'react';

type Session = {
  // What the TV has loaded; null takes the notification away.
  media: { title: string; artist: string; album?: string; artwork: string } | null;
  playing: boolean;
  duration: number;
  // Where the TV was at its last status, and when that status came.
  position: number;
  statusAt: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  // From where the TV is now.
  onSeekBy: (delta: number) => void;
};

// How long after a play/pause from the phone the clip is left as it is, for the TV to
// answer: a status already on its way still says what the TV did before.
const ANSWER_MS = 3000;

// The phone's media notification (lock screen, notification shade, Control Centre) for
// what plays on the TV, through the Media Session API. A page only gets one while it is
// playing audio itself, so a silent clip loops along with the TV: playing while the TV
// plays, paused while it's paused. Browsers only let audio start after a tap, so the
// notification shows from the first tap on the page. Playing audio, the page takes the
// phone's audio focus: other audio pauses, and audio started elsewhere pauses the TV.
export function useMediaSession(session: Session): void {
  const supported = 'mediaSession' in navigator;
  const latest = useRef(session);
  latest.current = session;
  const [audio] = useState(() => {
    const el = new Audio();
    el.loop = true;
    return el;
  });
  const src = useRef('');
  const [unlocked, setUnlocked] = useState(false);
  // What this hook last did to the clip, so its own play/pause events aren't taken for the
  // phone's.
  const expected = useRef<'play' | 'pause'>(undefined);
  // When the phone last played or paused (see ANSWER_MS).
  const forwardedAt = useRef(0);

  useEffect(() => {
    if (!supported) return;
    src.current = URL.createObjectURL(silentWav(10));
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      URL.revokeObjectURL(src.current);
    };
  }, [supported, audio]);

  // The clip to playing or paused, as the TV is.
  function drive(play: boolean): void {
    if (play === !audio.paused) return;
    expected.current = play ? 'play' : 'pause';
    if (!play) {
      audio.pause();
      return;
    }
    if (!audio.getAttribute('src')) audio.src = src.current;
    audio.play().catch(() => {
      // Refused (no tap yet, audio focus): the next status tries again.
      if (expected.current === 'play') expected.current = undefined;
    });
  }

  // A play/pause from the phone, to the TV.
  function forward(play: boolean): void {
    const s = latest.current;
    if (!s.media || s.playing === play) return;
    forwardedAt.current = Date.now();
    if (play) s.onPlay();
    else s.onPause();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: drive only uses refs
  useEffect(() => {
    if (!supported) return;
    const unlock = (): void => {
      expected.current = 'play';
      audio.src = src.current;
      audio
        .play()
        .then(() => {
          // Started once from a tap, it can start again later without one.
          const { media, playing } = latest.current;
          if (!media || !playing) drive(false);
          setUnlocked(true);
          document.removeEventListener('click', unlock, true);
        })
        .catch(() => {});
    };
    document.addEventListener('click', unlock, true);
    return () => document.removeEventListener('click', unlock, true);
  }, [supported, audio]);

  // The clip follows the TV, at every status: also back in line after a play/pause that
  // didn't reach the TV, or a clip that wouldn't start.
  const active = !!session.media;
  // biome-ignore lint/correctness/useExhaustiveDependencies: statusAt is the trigger; drive only uses refs
  useEffect(() => {
    if (!unlocked) return;
    if (!active) {
      // No source at all, or Chrome keeps a paused notification around.
      drive(false);
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (Date.now() - forwardedAt.current < ANSWER_MS) return;
    drive(session.playing);
  }, [unlocked, active, session.playing, session.statusAt, audio]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: forward and drive only use refs
  useEffect(() => {
    if (!supported) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      // The clip flips at once, and with it the notification's button.
      [
        'play',
        () => {
          forward(true);
          drive(true);
        },
      ],
      [
        'pause',
        () => {
          forward(false);
          drive(false);
        },
      ],
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
  }, [supported, audio]);

  // Some systems play or pause the clip themselves, without the handlers above (the
  // notification's button on some phones, a call, other audio starting): the TV follows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: forward only uses refs
  useEffect(() => {
    if (!supported) return;
    const onEvent = (kind: 'play' | 'pause') => (): void => {
      const own = expected.current === kind;
      expected.current = undefined;
      if (!own) forward(kind === 'play');
    };
    const onPlay = onEvent('play');
    const onPause = onEvent('pause');
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [supported, audio]);
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
