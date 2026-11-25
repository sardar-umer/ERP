import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, Slide, Snackbar, Typography } from '@mui/material';
import {
  WifiOff as WifiOffIcon,
  Wifi as WifiIcon,
  Close as CloseIcon
} from '@mui/icons-material';

/**
 * Facebook-style connection notice (bottom-left).
 * - Offline: stays on screen until the connection comes back.
 * - Back online: green "restored" note that hides itself after a few seconds.
 */
const RESTORED_HIDE_MS = 4000;

const SlideUp = (props) => <Slide {...props} direction="up" />;

const NetworkStatusBanner = () => {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  const [open, setOpen] = useState(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false
  );
  const wentOffline = useRef(!online);

  useEffect(() => {
    const goOffline = () => {
      wentOffline.current = true;
      setOnline(false);
      setOpen(true);
    };
    const goOnline = () => {
      setOnline(true);
      // Only announce "restored" if the user actually saw the offline notice
      setOpen(wentOffline.current);
      wentOffline.current = false;
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  const handleClose = (_e, reason) => {
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  const Icon = online ? WifiIcon : WifiOffIcon;

  return (
    <Snackbar
      open={open}
      onClose={handleClose}
      autoHideDuration={online ? RESTORED_HIDE_MS : null}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      TransitionComponent={SlideUp}
      sx={{ zIndex: (t) => t.zIndex.snackbar + 10 }}
    >
      <Box
        role="status"
        aria-live="polite"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          minWidth: { xs: 'auto', sm: 340 },
          maxWidth: 440,
          px: 2,
          py: 1.25,
          borderRadius: 2,
          bgcolor: '#242526',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(0,0,0,0.28)'
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: online ? 'rgba(76,175,80,0.18)' : 'rgba(255,255,255,0.12)',
            color: online ? '#66bb6a' : '#e4e6eb'
          }}
        >
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {online ? 'Your internet connection was restored.' : 'You are currently offline.'}
          </Typography>
          {!online && (
            <Typography variant="caption" sx={{ color: '#b0b3b8', display: 'block', lineHeight: 1.3 }}>
              Changes you save now won&apos;t go through. Check your connection.
            </Typography>
          )}
        </Box>
        {online ? (
          <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: '#b0b3b8' }} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        ) : (
          <Button
            size="small"
            onClick={() => window.location.reload()}
            sx={{ color: '#4599ff', fontWeight: 700, textTransform: 'none', flexShrink: 0 }}
          >
            Refresh
          </Button>
        )}
      </Box>
    </Snackbar>
  );
};

export default NetworkStatusBanner;
