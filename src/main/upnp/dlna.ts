// DLNA 4th-field parameters, shared by the DIDL `res@protocolInfo` we hand the renderer
// and the `contentFeatures.dlna.org` header we answer its GETs with — they must agree.
//
// FLAGS primary bits (DLNA 7.4.1.3.24): 31 sp (sender-paced), 30 lop-npt, 29 lop-bytes,
// 28 playcontainer, 27 s0-increasing, 26 sN-increasing, 25 rtsp-pause, 24 tm-s (streaming),
// 23 tm-i, 22 tm-b (background), 21 http-stalling, 20 DLNA v1.5. `0170…` = tm-s + tm-b +
// http-stalling + v1.5: a plain, fixed-length, receiver-paced stream. Never set 31/27/26 —
// they describe a live broadcast whose start and end keep moving, and players then
// buffer minimally and refuse backward seeks.
//
// No DLNA.ORG_PN on either: direct play passes through whatever the source is, and the
// transcode would need a PN chosen against the renderer's Sink.

// Native container, byte-range seek (OP=01), not converted (CI=0).
export const DIRECT_PLAY_FEATURES =
  'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';

// Live MPEG-TS transcode: time-based seek only (OP=10, TimeSeekRange.dlna.org), converted (CI=1).
export const TRANSCODED_FEATURES =
  'DLNA.ORG_OP=10;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=01700000000000000000000000000000';
