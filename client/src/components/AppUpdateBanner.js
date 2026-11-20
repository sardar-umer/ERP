import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { isChunkLoadError } from '../utils/lazyWithReload';

/**
 * "New version available" banner.
 *
 * The ERP is a single-page app: a tab left open keeps running the code it loaded, even after a deploy.
 * Every few minutes (and whenever the tab regains focus) we read /asset-manifest.json from the server and
 * compare its main.js with the one this tab is running. If they differ, a deploy happened: show a banner
 * so the user can refresh when ready (no auto-reload, so half-filled forms are not lost).
 */
const CHECK_EVERY_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;

const runningMainJs = () => {
  const el = document.querySelector('script[src*="/static/js/main."]');
  if (!el) return '';
  try {
    return new URL(el.getAttribute('src'), window.location.origin).pathname;
  } catch {
    return el.getAttribute('src') || '';
  }
};

const AppUpdateBanner = () => {
  const [available, setAvailable] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const lastCheck = useRef(0);
  const current = useRef(runningMainJs());

  const check = useCallback(async () => {
    if (!current.current) return; // dev server / unknown bundle
    const now = Date.now();
    if (now - lastCheck.current < MIN_GAP_MS) return;
    lastCheck.current = now;
    try {
      const res = await fetch(`/asset-manifest.json?t=${now}`, { cache: 'no-store' });
      if (!res.ok) return;
      const manifest = await res.json();
      const latest = manifest?.files?.['main.js'];
      if (latest && latest !== current.current) setAvailable(true);
    } catch {
      // offline or server restarting — try again next time
    }
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    // A lazy page or library failed to load because the deploy removed the old file
    const onRejection = (e) => { if (isChunkLoadError(e?.reason)) setAvailable(true); };
    const onError = (e) => { if (isChunkLoadError(e?.error || e?.message)) setAvailable(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, [check]);

  // "Later" hides the banner for a while, then it comes back
  useEffect(() => {
    if (!snoozedUntil) return undefined;
    const t = setTimeout(() => setSnoozedUntil(0), Math.max(0, snoozedUntil - Date.now()));
    return () => clearTimeout(t);
  }, [snoozedUntil]);

  if (!available || snoozedUntil > Date.now()) return null;

  return (
    <Alert
      severity="info"
      variant="filled"
      icon={<RefreshIcon />}
      sx={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        width: 'calc(100% - 32px)',
        maxWidth: 560,
        alignItems: 'center',
        boxShadow: 6,
        '@media print': { display: 'none' }
      }}
      action={(
        <Stack direction="row" spacing={1}>
          <Button color="inherit" size="small" onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}>
            Later
          </Button>
          <Button
            color="inherit"
            size="small"
            variant="outlined"
            onClick={() => window.location.reload()}
            sx={{ fontWeight: 700 }}
          >
            Refresh
          </Button>
        </Stack>
      )}
    >
      A new version of Tovus is available. Save your work, then refresh to get the latest changes.
    </Alert>
  );
};

export default AppUpdateBanner;
