import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  CircularProgress,
  Menu,
  MenuItem,
  ListItemIcon,
  Tabs,
  Tab,
  Tooltip,
  Divider
} from '@mui/material';
import {
  NotificationsNone as NotificationsIcon,
  CheckCircle,
  DoneAll,
  Archive,
  Delete,
  MoreHoriz,
  Refresh,
  DesktopWindows
} from '@mui/icons-material';
import { useNotifications } from '../../contexts/NotificationContext';
import NotificationService from '../../services/notificationService';
import { NotificationAvatar, shortTimeAgo, groupByDay } from './notificationVisuals';

const PAGE_SIZE = 20;

const NotificationRow = ({ notification, onOpen, onMenu }) => {
  const unread = !notification.isRead;
  return (
    <Box
      onClick={() => onOpen(notification)}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        px: 1.5,
        py: 1.25,
        mx: 0.75,
        borderRadius: 1.5,
        cursor: 'pointer',
        position: 'relative',
        bgcolor: unread ? 'rgba(24,119,242,0.06)' : 'transparent',
        '&:hover': { bgcolor: unread ? 'rgba(24,119,242,0.11)' : 'action.hover' },
        '&:hover .notif-more': { opacity: 1 }
      }}
    >
      <NotificationAvatar notification={notification} size={44} />
      <Box sx={{ flex: 1, minWidth: 0, pr: 3 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: unread ? 700 : 500, lineHeight: 1.35, color: unread ? 'text.primary' : 'text.secondary' }}
        >
          {notification.title}
        </Typography>
        {notification.message && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              fontSize: '0.8rem',
              lineHeight: 1.35,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'pre-line'
            }}
          >
            {notification.message}
          </Typography>
        )}
        <Typography
          variant="caption"
          sx={{ color: unread ? '#1877f2' : 'text.disabled', fontWeight: unread ? 600 : 400 }}
        >
          {shortTimeAgo(notification.createdAt)}
        </Typography>
      </Box>
      {unread && (
        <Box
          sx={{
            position: 'absolute',
            right: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: '#1877f2'
          }}
        />
      )}
      <IconButton
        className="notif-more"
        size="small"
        aria-label="More options"
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e, notification);
        }}
        sx={{
          position: 'absolute',
          right: 30,
          top: 8,
          opacity: { xs: 1, md: 0 },
          bgcolor: 'background.paper',
          boxShadow: 1,
          transition: 'opacity 120ms',
          '&:hover': { bgcolor: 'background.paper' }
        }}
      >
        <MoreHoriz fontSize="small" />
      </IconButton>
    </Box>
  );
};

const Notifications = ({ onNotificationAction, onClose }) => {
  const {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    archiveNotification,
    deleteNotification,
    openNotification,
    fetchNotifications,
    desktopPermission,
    requestDesktopPermission,
    isLoading
  } = useNotifications();

  const [tab, setTab] = useState('unread');
  const [anchorEl, setAnchorEl] = useState(null);
  const [selected, setSelected] = useState(null);

  // "All" tab keeps its own paged list (read + unread history)
  const [allItems, setAllItems] = useState([]);
  const [allPage, setAllPage] = useState(0);
  const [allHasMore, setAllHasMore] = useState(true);
  const [allLoading, setAllLoading] = useState(false);

  const unreadItems = getNotifications();
  const unreadCount = getUnreadCount();
  const loading = isLoading();

  const loadAllPage = useCallback(async (page) => {
    setAllLoading(true);
    try {
      const res = await NotificationService.getNotifications({ status: 'all', page, limit: PAGE_SIZE });
      const rows = Array.isArray(res?.data) ? res.data : [];
      setAllItems((prev) => {
        if (page === 1) return rows;
        const seen = new Set(prev.map((n) => String(n._id)));
        return [...prev, ...rows.filter((n) => !seen.has(String(n._id)))];
      });
      setAllPage(page);
      setAllHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      console.error('Error loading notifications:', err);
    } finally {
      setAllLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'all' && allPage === 0) loadAllPage(1);
  }, [tab, allPage, loadAllPage]);

  // New live notifications should also show at the top of "All"
  useEffect(() => {
    if (allPage === 0) return;
    setAllItems((prev) => {
      const seen = new Set(prev.map((n) => String(n._id)));
      const fresh = unreadItems.filter((n) => !seen.has(String(n._id)));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
  }, [unreadItems, allPage]);

  const items = tab === 'unread' ? unreadItems : allItems;
  const groups = useMemo(() => groupByDay(items), [items]);

  const afterAction = () => {
    if (onNotificationAction) onNotificationAction();
  };

  const patchAll = (id, patch) => {
    setAllItems((prev) => (patch === null
      ? prev.filter((n) => String(n._id) !== String(id))
      : prev.map((n) => (String(n._id) === String(id) ? { ...n, ...patch } : n))));
  };

  const handleOpen = (notification) => {
    patchAll(notification._id, { isRead: true });
    if (onClose) onClose();
    openNotification(notification);
    afterAction();
  };

  const handleMarkRead = async (n) => {
    if (n.isRead) return;
    patchAll(n._id, { isRead: true });
    await markAsRead([n._id], [n?.metadata?.module].filter(Boolean));
    afterAction();
  };

  const handleArchive = async (n) => {
    patchAll(n._id, null);
    await archiveNotification(n._id, { wasUnread: !n.isRead });
    afterAction();
  };

  const handleDelete = async (n) => {
    patchAll(n._id, null);
    await deleteNotification(n._id, { wasUnread: !n.isRead });
    afterAction();
  };

  const handleMarkAll = async () => {
    setAllItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await markAllAsRead();
    afterAction();
  };

  const handleRefresh = () => {
    fetchNotifications(true);
    if (tab === 'all') loadAllPage(1);
  };

  const closeMenu = () => {
    setAnchorEl(null);
    setSelected(null);
  };

  const showDesktopPrompt = desktopPermission === 'default';
  const busy = tab === 'unread' ? loading && unreadItems.length === 0 : allLoading && allItems.length === 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1.75, pb: 0.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          Notifications
        </Typography>
        <Tooltip title="Mark all as read">
          <span>
            <IconButton size="small" onClick={handleMarkAll} disabled={unreadCount === 0} aria-label="Mark all as read">
              <DoneAll fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={handleRefresh} aria-label="Refresh">
            <Refresh fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v)}
        sx={{
          px: 1.5,
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, mr: 0.5, textTransform: 'none', fontWeight: 600, borderRadius: 4 },
          '& .Mui-selected': { bgcolor: 'rgba(24,119,242,0.1)', color: '#1877f2 !important' },
          '& .MuiTabs-indicator': { display: 'none' }
        }}
      >
        <Tab value="unread" label={unreadCount > 0 ? `Unread (${unreadCount > 99 ? '99+' : unreadCount})` : 'Unread'} />
        <Tab value="all" label="All" />
      </Tabs>

      {showDesktopPrompt && (
        <Box
          sx={{
            mx: 1.5,
            mt: 1,
            px: 1.5,
            py: 1,
            borderRadius: 1.5,
            bgcolor: 'action.hover',
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
        >
          <DesktopWindows fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="caption" sx={{ flex: 1, lineHeight: 1.35 }}>
            Get desktop alerts when the ERP tab is in the background.
          </Typography>
          <Button size="small" onClick={requestDesktopPermission} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Turn on
          </Button>
        </Box>
      )}

      {/* List */}
      <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 0, py: 1 }}>
        {busy && (
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!busy && items.length === 0 && (
          <Box textAlign="center" px={3} py={5}>
            <NotificationsIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {tab === 'unread' ? "You're all caught up" : 'No notifications yet'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {tab === 'unread' ? 'New notifications will appear here.' : 'Approvals, reminders and updates will show here.'}
            </Typography>
          </Box>
        )}

        {groups.map(([label, list], gi) => (
          <Box key={label}>
            {gi > 0 && <Divider sx={{ my: 0.75, mx: 2 }} />}
            <Typography variant="subtitle2" sx={{ px: 2, pt: 0.5, pb: 0.5, fontWeight: 700 }}>
              {label}
            </Typography>
            {list.map((n) => (
              <NotificationRow
                key={n._id}
                notification={n}
                onOpen={handleOpen}
                onMenu={(e, notif) => {
                  setAnchorEl(e.currentTarget);
                  setSelected(notif);
                }}
              />
            ))}
          </Box>
        ))}

        {tab === 'all' && allItems.length > 0 && allHasMore && (
          <Box sx={{ px: 2, pt: 1 }}>
            <Button
              fullWidth
              variant="outlined"
              size="small"
              disabled={allLoading}
              onClick={() => loadAllPage(allPage + 1)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {allLoading ? 'Loading…' : 'See previous notifications'}
            </Button>
          </Box>
        )}
      </Box>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        {selected && !selected.isRead && (
          <MenuItem onClick={() => { handleMarkRead(selected); closeMenu(); }}>
            <ListItemIcon><CheckCircle fontSize="small" /></ListItemIcon>
            Mark as read
          </MenuItem>
        )}
        <MenuItem onClick={() => { if (selected) handleArchive(selected); closeMenu(); }}>
          <ListItemIcon><Archive fontSize="small" /></ListItemIcon>
          Archive (hide)
        </MenuItem>
        <MenuItem onClick={() => { if (selected) handleDelete(selected); closeMenu(); }} sx={{ color: 'error.main' }}>
          <ListItemIcon><Delete fontSize="small" color="error" /></ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default Notifications;
