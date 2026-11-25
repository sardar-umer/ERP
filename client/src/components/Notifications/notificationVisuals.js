import React from 'react';
import {
  AccountBalance,
  AssignmentTurnedIn,
  Chat,
  EventNote,
  Groups,
  Info,
  Inventory2,
  Payments,
  PersonAdd,
  Schedule,
  Storefront,
  Warning,
  FactCheck,
  Campaign
} from '@mui/icons-material';

/** Icon + colour for a notification, picked from its type, then category, then module. */
export const getNotificationVisual = (n = {}) => {
  const type = n.type || '';
  const category = n.category || '';
  const module = n.metadata?.module || '';

  if (type === 'chat_message') return { Icon: Chat, color: '#1877f2' };
  if (type === 'candidate_hired' || category === 'hiring') return { Icon: PersonAdd, color: '#2e7d32' };
  if (type === 'error' || type === 'warning' || n.priority === 'urgent') return { Icon: Warning, color: '#d32f2f' };
  if (category === 'approval') return { Icon: AssignmentTurnedIn, color: '#7b1fa2' };
  if (category === 'payroll' || type === 'payroll_generated') return { Icon: Payments, color: '#00897b' };
  if (category === 'leave' || type === 'leave_request') return { Icon: EventNote, color: '#0288d1' };
  if (category === 'attendance' || type === 'attendance_update') return { Icon: Schedule, color: '#0288d1' };
  if (category === 'finance' || module === 'finance' || type === 'loan_approved') return { Icon: AccountBalance, color: '#ef6c00' };
  if (module === 'procurement') return { Icon: Inventory2, color: '#5d4037' };
  if (module === 'audit') return { Icon: FactCheck, color: '#6a1b9a' };
  if (module === 'crm' || module === 'sales') return { Icon: Storefront, color: '#c2185b' };
  if (module === 'hr' || module === 'employees' || category === 'employee') return { Icon: Groups, color: '#3949ab' };
  if (type === 'system' || category === 'system') return { Icon: Campaign, color: '#546e7a' };
  return { Icon: Info, color: '#607d8b' };
};

export const NotificationAvatar = ({ notification, size = 40 }) => {
  const { Icon, color } = getNotificationVisual(notification);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: `${color}1f`,
        color
      }}
    >
      <Icon style={{ fontSize: Math.round(size * 0.5) }} />
    </span>
  );
};

/** Short Facebook-style time: "Just now", "5m", "3h", "2d", then "12 Nov" / "12 Nov 2025". */
export const shortTimeAgo = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  });
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Split a newest-first list into Today / Yesterday / Earlier (empty groups dropped). */
export const groupByDay = (items = []) => {
  const today = startOfDay(new Date());
  const yesterday = today - 86400000;
  const groups = { Today: [], Yesterday: [], Earlier: [] };
  items.forEach((n) => {
    const t = n.createdAt ? startOfDay(new Date(n.createdAt)) : 0;
    if (t >= today) groups.Today.push(n);
    else if (t >= yesterday) groups.Yesterday.push(n);
    else groups.Earlier.push(n);
  });
  return Object.entries(groups).filter(([, list]) => list.length);
};
