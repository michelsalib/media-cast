// Image-based subtitle codecs (Blu-ray PGS, DVD VobSub, DVB, DivX XSUB). They can't be
// converted to text, so the only way to show them is burning into a transcoded stream.
const BITMAP_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvb_subtitle',
  'xsub',
]);

export function isBitmapSubtitleCodec(codecName: string | undefined): boolean {
  return codecName !== undefined && BITMAP_SUBTITLE_CODECS.has(codecName);
}

// Subtitle sizes offered in the window and on the phone, as a scale of the default.
export const SUBTITLE_SCALES: readonly { value: number; label: string }[] = [
  { value: 0.75, label: 'Small' },
  { value: 1, label: 'Normal' },
  { value: 1.3, label: 'Large' },
  { value: 1.6, label: 'Very large' },
];
