import { BoltRounded, SyncRounded } from '@mui/icons-material';
import { Box, Stack, Tooltip } from '@mui/material';
import type { CompatReport } from '../../../shared/compat';

const chipSx = {
  height: 32,
  px: 1.5,
  alignItems: 'center',
  borderRadius: '8px',
  bgcolor: 'tonal.secondaryContainer',
  color: 'tonal.onSecondaryContainer',
  fontSize: 13,
  fontWeight: 500,
  minWidth: 0,
} as const;

// Whether the video ready plays as it is on the screen picked, or is converted (and why),
// in the window and on the phone remote.
export function CompatChip({
  report,
  deviceName,
}: {
  report: CompatReport;
  deviceName: string;
}): React.JSX.Element {
  const transcoding = report.needsTranscoding;

  return (
    <Tooltip
      placement="bottom-start"
      enterDelay={200}
      title={
        <Box sx={{ minWidth: 220, lineHeight: 1.5 }}>
          <Box sx={{ fontWeight: 600, fontSize: 13, mb: 0.75 }}>
            {transcoding ? 'Transcoding required' : 'Direct play'}
          </Box>
          <Stack spacing={0.25} sx={{ fontSize: 12 }}>
            <Box>Container: {report.container || 'unknown'}</Box>
            <Box>Video: {report.videoCodec ?? 'unknown'}</Box>
            <Box>Audio: {report.audioCodec ?? 'unknown'}</Box>
          </Stack>
          {report.issues.length > 0 && (
            <Box sx={{ mt: 1, pt: 0.75, borderTop: '1px solid', borderColor: 'currentColor' }}>
              <Box sx={{ fontSize: 11, opacity: 0.8, mb: 0.25 }}>Why re-encode</Box>
              <Stack component="ul" sx={{ pl: 2, m: 0, fontSize: 12 }} spacing={0.25}>
                {report.issues.map((issue) => (
                  <li key={issue.kind}>{issue.detail}</li>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      }
    >
      <Stack direction="row" spacing={0.75} sx={{ ...chipSx, cursor: 'help' }}>
        {transcoding ? (
          <SyncRounded sx={{ fontSize: 16 }} />
        ) : (
          <BoltRounded sx={{ fontSize: 16 }} />
        )}
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {transcoding ? `Converted for ${deviceName}` : `Plays directly on ${deviceName}`}
        </Box>
      </Stack>
    </Tooltip>
  );
}

// The video playing goes through ffmpeg (Player, and the phone remote).
export function ConvertingChip(): React.JSX.Element {
  return (
    <Tooltip title="ffmpeg is re-encoding this file on the fly for the TV">
      <Stack direction="row" spacing={0.75} sx={chipSx}>
        <SyncRounded sx={{ fontSize: 16 }} />
        <span>Converting</span>
      </Stack>
    </Tooltip>
  );
}
