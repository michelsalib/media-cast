import {
  CheckRounded,
  ContrastOutlined,
  DarkModeOutlined,
  LightModeOutlined,
} from '@mui/icons-material';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import { useState } from 'react';
import type { ThemeSource } from '../../../shared/types';

const OPTIONS: { value: ThemeSource; label: string; Icon: typeof LightModeOutlined }[] = [
  { value: 'system', label: 'Use system setting', Icon: ContrastOutlined },
  { value: 'light', label: 'Light', Icon: LightModeOutlined },
  { value: 'dark', label: 'Dark', Icon: DarkModeOutlined },
];

type Props = {
  value: ThemeSource;
  onChange: (value: ThemeSource) => void;
};

export default function ThemeButton({ value, onChange }: Props): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const Current = OPTIONS.find((o) => o.value === value)?.Icon ?? ContrastOutlined;

  return (
    <>
      <Tooltip title="Theme">
        <IconButton
          aria-label="Theme"
          aria-haspopup="menu"
          onClick={(e) => setAnchor(e.currentTarget)}
          size="small"
          sx={{
            appRegion: 'no-drag',
            color: 'text.secondary',
            // The title bar is only 32px tall.
            padding: '4px',
          }}
        >
          <Current fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {OPTIONS.map(({ value: option, label, Icon }) => (
          <MenuItem
            key={option}
            selected={option === value}
            onClick={() => {
              onChange(option);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{label}</ListItemText>
            {option === value && <CheckRounded fontSize="small" sx={{ ml: 2 }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
