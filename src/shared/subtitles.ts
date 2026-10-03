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
