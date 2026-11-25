import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { NotificationAvatar } from './notificationVisuals';

/** Pop-up card shown bottom-left when a new notification arrives live. */
const NotificationToast = ({ toastObj, notification, onOpen, onClose }) => (
  <Box
    role="alert"
    onClick={onOpen}
    sx={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 1.5,
      width: { xs: 'calc(100vw - 32px)', sm: 360 },
      p: 1.5,
      borderRadius: 2,
      bgcolor: '#242526',
      color: '#fff',
      cursor: 'pointer',
      boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
      opacity: toastObj?.visible === false ? 0 : 1,
      transform: toastObj?.visible === false ? 'translateY(8px)' : 'none',
      transition: 'opacity 180ms ease, transform 180ms ease',
      '&:hover': { bgcolor: '#2f3031' }
    }}
  >
    <NotificationAvatar notification={notification} size={40} />
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: '#b0b3b8', display: 'block', lineHeight: 1.2, mb: 0.25 }}>
        New notification
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }} noWrap>
        {notification?.title}
      </Typography>
      {notification?.message && (
        <Typography
          variant="caption"
          sx={{
            color: '#e4e6eb',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.35
          }}
        >
          {notification.message}
        </Typography>
      )}
    </Box>
    <IconButton
      size="small"
      aria-label="Dismiss"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      sx={{ color: '#b0b3b8', mt: -0.5, mr: -0.5 }}
    >
      <CloseIcon fontSize="small" />
    </IconButton>
  </Box>
);

export default NotificationToast;
