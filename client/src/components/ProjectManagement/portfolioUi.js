/** Shared look for the Portfolio Dashboard and its project dialog. */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';

// One colour per Main Project, used on its card, chart series and dialog hero
export const PROJECT_COLORS = ['#14b8a6', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#a855f7', '#22c55e', '#ef4444', '#eab308', '#06b6d4'];

export const HEALTH_STYLE = {
  'On Track': { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
  'Needs Attention': { bg: '#fef9c3', fg: '#a16207', dot: '#eab308' },
  'Behind Schedule': { bg: '#ffedd5', fg: '#c2410c', dot: '#f97316' },
  'Over Budget': { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444' }
};

/** Animates a number from 0 to `value` (ease-out) */
export const useCountUp = (value, duration = 1200) => {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setN(begin + (value - begin) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return n;
};

const draw = keyframes`from { stroke-dashoffset: var(--len); }`;

/** Circular progress with the % in the middle; draws itself in on mount */
export const ProgressRing = ({ value = 0, size = 72, stroke = 7, color = '#14b8a6', track = '#e2e8f0', textColor = '#0f172a', label }) => {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const shown = Math.round(useCountUp(value));
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <Box
          component="circle"
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - Math.min(100, value) / 100)}
          style={{ '--len': len }}
          sx={{ animation: `${draw} 1.2s cubic-bezier(.2,.8,.2,1)`, filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <Box>
          <Typography sx={{ fontWeight: 900, fontSize: size * 0.24, lineHeight: 1, color: textColor }}>{shown}%</Typography>
          {label && <Typography sx={{ fontSize: Math.max(9, size * 0.1), fontWeight: 700, color: textColor, opacity: 0.6, mt: 0.25 }}>{label}</Typography>}
        </Box>
      </Box>
    </Box>
  );
};
