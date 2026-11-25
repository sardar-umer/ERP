import React, { createContext, useContext, useReducer, useCallback, useMemo, useRef } from 'react';
import { useAuth } from './AuthContext';
import NotificationService from '../services/notificationService';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import NotificationToast from '../components/Notifications/NotificationToast';

// Optimized notification state structure
const initialState = {
  notifications: [],
  unreadCount: 0,
  moduleCounts: {
    employees: 0,
    hr: 0,
    finance: 0,
    crm: 0,
    sales: 0,
    procurement: 0
  },
  loading: false,
  lastUpdated: null
};

// Efficient reducer with minimal state updates
const notificationReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    
    case 'SET_NOTIFICATIONS':
      return { 
        ...state, 
        notifications: action.payload.notifications,
        unreadCount: action.payload.unreadCount,
        moduleCounts: action.payload.moduleCounts,
        lastUpdated: Date.now()
      };
    
    case 'UPDATE_MODULE_COUNT':
      return {
        ...state,
        moduleCounts: {
          ...state.moduleCounts,
          [action.payload.module]: action.payload.count
        }
      };
    
    case 'DECREASE_COUNTS': {
      const idSet = new Set((action.payload.notificationIds || []).map(String));
      const removed = state.notifications.filter((n) => idSet.has(String(n._id)));
      const updatedNotifications = state.notifications.filter((n) => !idSet.has(String(n._id)));
      // Items not loaded in the list (beyond the latest 50) still count toward the badge
      const removedCount = Math.max(removed.length, idSet.size);
      const decreasedModuleCounts = { ...state.moduleCounts };
      removed.forEach((n) => {
        const mod = n.metadata?.module || 'other';
        decreasedModuleCounts[mod] = Math.max(0, (decreasedModuleCounts[mod] || 0) - 1);
      });

      return {
        ...state,
        notifications: updatedNotifications,
        unreadCount: Math.max(0, state.unreadCount - removedCount),
        moduleCounts: decreasedModuleCounts
      };
    }

    case 'MARK_ALL_READ':
      return {
        ...state,
        notifications: [],
        unreadCount: 0,
        moduleCounts: Object.fromEntries(Object.keys(state.moduleCounts).map((k) => [k, 0]))
      };

    case 'ADD_NOTIFICATION': {
      const newNotification = action.payload;
      // Same notification can arrive twice (socket + refetch) — don't double count
      if (state.notifications.some((n) => String(n._id) === String(newNotification._id))) {
        return state;
      }
      const mod = newNotification.metadata?.module || 'other';
      return {
        ...state,
        notifications: [newNotification, ...state.notifications].slice(0, 50),
        unreadCount: state.unreadCount + 1,
        moduleCounts: {
          ...state.moduleCounts,
          [mod]: (state.moduleCounts[mod] || 0) + 1
        }
      };
    }

    case 'CLEAR_ALL':
      return { ...initialState };
    
    default:
      return state;
  }
};

const NotificationContext = createContext();

const EVT_CHAT_UNREAD_CHANGED = 'sgc:chat-unread-changed';
const EVT_APP_NOTIFICATIONS_REFRESH = 'sgc:app-notifications-refresh';
const CHAT_SOUND_PREF_PREFIX = 'sgc:chat-sound-enabled:';

const isChatSoundEnabled = (userId) => {
  if (typeof window === 'undefined') return true;
  const key = `${CHAT_SOUND_PREF_PREFIX}${String(userId || '')}`;
  const saved = window.localStorage.getItem(key);
  if (saved == null) return true;
  return saved !== '0' && saved !== 'false';
};

const playIncomingChatSound = () => {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    // Very close tri-tone-style notification (Apple-like timing/envelope).
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.008);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.62);
    master.connect(ctx.destination);

    const playTone = (freq, start, duration, type = 'sine', level = 1) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(0.62 * level, start + 0.006);
      env.gain.exponentialRampToValueAtTime(0.26 * level, start + duration * 0.35);
      env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.01);
      return osc;
    };

    // Tri-tone contour (short-short-long) with a tiny bright layer.
    const t0 = ctx.currentTime;
    playTone(830.61, t0, 0.12, 'sine', 1); // G#5
    playTone(1046.5, t0 + 0.135, 0.12, 'sine', 0.95); // C6
    const last = playTone(1318.51, t0 + 0.27, 0.2, 'sine', 0.9); // E6

    // Subtle upper harmonics to mimic phone timbre.
    playTone(1661.22, t0 + 0.002, 0.1, 'triangle', 0.22);
    playTone(2093.0, t0 + 0.138, 0.1, 'triangle', 0.2);
    playTone(2637.02, t0 + 0.275, 0.14, 'triangle', 0.18);

    last.onended = () => ctx.close().catch(() => {});
  } catch {
    // Browser may block autoplay until user interaction.
  }
};

/** Softer two-note chime for bell notifications (chat keeps its own tri-tone). */
const playNotificationChime = () => {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.14, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
      return osc;
    };
    const t0 = ctx.currentTime;
    tone(880, t0, 0.18);
    const last = tone(1318.5, t0 + 0.12, 0.32);
    last.onended = () => ctx.close().catch(() => {});
  } catch {
    // Browser may block audio until the user has interacted with the page.
  }
};

const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;
const readDesktopPermission = () => (desktopSupported() ? window.Notification.permission : 'unsupported');

const TITLE_COUNT_RE = /^\(\d+\+?\)\s+/;

export const NotificationProvider = ({ children }) => {
  const [state, dispatch] = useReducer(notificationReducer, initialState);
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [desktopPermission, setDesktopPermission] = React.useState(readDesktopPermission);

  // Memoized selectors for performance
  const selectors = useMemo(() => ({
    getUnreadCount: () => state.unreadCount,
    getModuleCount: (module) => state.moduleCounts[module] || 0,
    getNotifications: () => state.notifications,
    isLoading: () => state.loading,
    getLastUpdated: () => state.lastUpdated
  }), [state]);

  // Optimized fetch function with caching
  const fetchNotifications = useCallback(async (force = false) => {
    if (!isAuthenticated) return;
    
    // Cache for 30 seconds to avoid unnecessary API calls
    const now = Date.now();
    if (!force && state.lastUpdated && (now - state.lastUpdated) < 30000) {
      return;
    }

    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      const [notificationsRes, countsRes] = await Promise.all([
        NotificationService.getNotifications({ status: 'unread', limit: 50 }),
        NotificationService.getModuleCounts()
      ]);

      dispatch({
        type: 'SET_NOTIFICATIONS',
        payload: {
          notifications: notificationsRes.data || [],
          unreadCount: notificationsRes.pagination?.unreadCount || 0,
          moduleCounts: countsRes.data || {}
        }
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [isAuthenticated, state.lastUpdated]);

  // Stable handle so long-lived effects (socket, timer) don't restart after every fetch
  const fetchRef = useRef(fetchNotifications);
  fetchRef.current = fetchNotifications;

  // Fast notification marking with optimistic updates
  const markAsRead = useCallback(async (notificationIds, modules = []) => {
    if (!notificationIds.length) return;

    // Optimistic update
    dispatch({
      type: 'DECREASE_COUNTS',
      payload: { notificationIds, modules }
    });

    try {
      await NotificationService.markAsRead(notificationIds);
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      // Revert optimistic update on error
      fetchNotifications(true);
    }
  }, [fetchNotifications]);

  // Fast module-specific marking
  const markModuleAsRead = useCallback(async (module) => {
    const moduleNotifications = state.notifications.filter(
      n => n.metadata?.module === module
    );
    
    if (moduleNotifications.length > 0) {
      const notificationIds = moduleNotifications.map(n => n._id);
      await markAsRead(notificationIds, [module]);
    }
  }, [state.notifications, markAsRead]);

  const markAllAsRead = useCallback(async () => {
    dispatch({ type: 'MARK_ALL_READ' });
    try {
      await NotificationService.markAllAsRead();
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      fetchNotifications(true);
    }
  }, [fetchNotifications]);

  const archiveNotification = useCallback(async (notificationId, { wasUnread = true } = {}) => {
    if (!notificationId) return;
    if (wasUnread) {
      dispatch({ type: 'DECREASE_COUNTS', payload: { notificationIds: [notificationId] } });
    }
    try {
      await NotificationService.markAsArchived(notificationId);
    } catch (error) {
      console.error('Error archiving notification:', error);
      fetchNotifications(true);
    }
  }, [fetchNotifications]);

  const deleteNotification = useCallback(async (notificationId, { wasUnread = true } = {}) => {
    if (!notificationId) return;
    if (wasUnread) {
      dispatch({ type: 'DECREASE_COUNTS', payload: { notificationIds: [notificationId] } });
    }
    try {
      await NotificationService.deleteNotification(notificationId);
    } catch (error) {
      console.error('Error deleting notification:', error);
      fetchNotifications(true);
    }
  }, [fetchNotifications]);

  const requestDesktopPermission = useCallback(async () => {
    if (!desktopSupported()) return 'unsupported';
    try {
      const result = await window.Notification.requestPermission();
      setDesktopPermission(result);
      return result;
    } catch {
      return readDesktopPermission();
    }
  }, []);

  const openNotification = useCallback((notification) => {
    if (!notification?._id) return;
    if (!notification.isRead) {
      markAsRead([notification._id], [notification?.metadata?.module].filter(Boolean));
    }
    if (notification.actionUrl) navigate(notification.actionUrl);
  }, [markAsRead, navigate]);

  /** Toast + chime while the tab is open; desktop pop-up when it's in the background. */
  const announceNotification = useCallback((notification) => {
    // Chat has its own sound / unread badge — don't announce it twice
    if (!notification || notification.type === 'chat_message') return;
    const myUserId = String(user?.id || user?._id || '');
    if (isChatSoundEnabled(myUserId)) playNotificationChime();

    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (hidden && readDesktopPermission() === 'granted') {
      try {
        const desk = new window.Notification(notification.title || 'Tovus ERP', {
          body: String(notification.message || '').slice(0, 180),
          tag: String(notification._id),
          icon: '/favicon.ico'
        });
        desk.onclick = () => {
          window.focus();
          openNotification(notification);
          desk.close();
        };
      } catch {
        /* some browsers only allow desktop notifications from a service worker */
      }
      return;
    }

    toast.custom(
      (t) => (
        <NotificationToast
          toastObj={t}
          notification={notification}
          onOpen={() => {
            toast.dismiss(t.id);
            openNotification(notification);
          }}
          onClose={() => toast.dismiss(t.id)}
        />
      ),
      { id: `notif-${notification._id}`, duration: 6000, position: 'bottom-left' }
    );
  }, [user?.id, user?._id, openNotification]);

  const announceRef = useRef(announceNotification);
  announceRef.current = announceNotification;

  // Unread count in the browser tab title, e.g. "(3) Tovus ERP System"
  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const count = isAuthenticated ? state.unreadCount : 0;
    const apply = () => {
      const base = document.title.replace(TITLE_COUNT_RE, '');
      const next = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    // Pages may change the title later — keep the count on it
    const titleEl = document.querySelector('title');
    if (!titleEl || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(apply);
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [state.unreadCount, isAuthenticated]);

  // Add new notification (for real-time updates)
  const addNotification = useCallback((notification) => {
    dispatch({ type: 'ADD_NOTIFICATION', payload: notification });
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, []);

  // Auto-refresh every 5 minutes when authenticated (reduced from 30 seconds)
  React.useEffect(() => {
    if (!isAuthenticated) {
      clearAll();
      return;
    }

    fetchRef.current();
    const interval = setInterval(() => fetchRef.current(), 300000); // 5 minutes

    return () => clearInterval(interval);
  }, [isAuthenticated, clearAll]);

  // Chat page marks conversation + push notifications read — refresh bell counts
  React.useEffect(() => {
    if (!isAuthenticated) return undefined;
    const onRefresh = () => {
      fetchNotifications(true);
    };
    window.addEventListener('sgc:app-notifications-refresh', onRefresh);
    return () => window.removeEventListener('sgc:app-notifications-refresh', onRefresh);
  }, [isAuthenticated, fetchNotifications]);

  // Real-time socket updates for new notifications
  React.useEffect(() => {
    if (!isAuthenticated) return undefined;

    const token = localStorage.getItem('token');
    if (!token) return undefined;

    const baseURL = process.env.NODE_ENV === 'production'
      ? window.location.origin
      : (process.env.REACT_APP_API_URL || 'http://localhost:5001/api').replace(/\/api\/?$/, '');

    const socket = io(baseURL, {
      path: '/socket-notifications',
      transports: ['websocket', 'polling'],
      auth: { token }
    });

    const myUserId = String(user?.id || user?._id || '');

    const onNotificationNew = (notification) => {
      if (notification && notification._id) {
        addNotification(notification);
        announceRef.current(notification);
      } else {
        fetchRef.current(true);
      }
    };

    const onChatMessage = (payload) => {
      const senderId = String(payload?.message?.sender || '');
      if (!senderId || senderId === myUserId) return;
      window.dispatchEvent(new Event(EVT_CHAT_UNREAD_CHANGED));
      window.dispatchEvent(new Event(EVT_APP_NOTIFICATIONS_REFRESH));
      if (isChatSoundEnabled(myUserId)) {
        playIncomingChatSound();
      }
    };

    const onChatConversationUpdated = () => {
      window.dispatchEvent(new Event(EVT_CHAT_UNREAD_CHANGED));
    };

    // After a dropped connection (internet off, server restart, laptop sleep), pull anything missed
    let hasConnectedOnce = false;
    const onConnect = () => {
      if (hasConnectedOnce) fetchRef.current(true);
      hasConnectedOnce = true;
    };
    const onBackOnline = () => fetchRef.current(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchRef.current();
    };
    socket.on('connect', onConnect);
    window.addEventListener('online', onBackOnline);
    document.addEventListener('visibilitychange', onVisible);

    socket.on('notification:new', onNotificationNew);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:conversation:updated', onChatConversationUpdated);

    return () => {
      socket.off('connect', onConnect);
      window.removeEventListener('online', onBackOnline);
      document.removeEventListener('visibilitychange', onVisible);
      socket.off('notification:new', onNotificationNew);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:conversation:updated', onChatConversationUpdated);
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, user?._id, addNotification]);

  // Context value memoized to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    ...selectors,
    fetchNotifications,
    markAsRead,
    markModuleAsRead,
    markAllAsRead,
    archiveNotification,
    deleteNotification,
    openNotification,
    desktopPermission,
    requestDesktopPermission,
    addNotification,
    clearAll
  }), [selectors, fetchNotifications, markAsRead, markModuleAsRead, markAllAsRead, archiveNotification, deleteNotification, openNotification, desktopPermission, requestDesktopPermission, addNotification, clearAll]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
