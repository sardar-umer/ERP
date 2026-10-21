import api from './api';

const base = '/president-meetings';

/** Format stored HH:mm (24h) as h:mm AM/PM */
export const formatMeetingTime = (time) => {
  if (!time) return '';
  const raw = String(time).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
  if (!match) return raw;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const meridiem = match[3];

  if (meridiem) {
    return `${hours % 12 || 12}:${minutes} ${meridiem.toUpperCase()}`;
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${period}`;
};

export const formatMeetingTimeRange = (startTime, endTime, empty = '—') => {
  const parts = [formatMeetingTime(startTime), formatMeetingTime(endTime)].filter(Boolean);
  return parts.length ? parts.join(' – ') : empty;
};

export const fetchMeetings = (params = {}) => api.get(base, { params });

export const fetchMeetingById = (id) => api.get(`${base}/${id}`);

export const createMeeting = (data) => api.post(base, data);

export const updateMeeting = (id, data) => api.put(`${base}/${id}`, data);

export const acceptMeetingRequest = (id) => api.put(`${base}/${id}/accept`);

export const rejectMeetingRequest = (id) => api.put(`${base}/${id}/reject`);

export const deleteMeeting = (id) => api.delete(`${base}/${id}`);

const presidentMeetingService = {
  fetchMeetings,
  fetchMeetingById,
  createMeeting,
  updateMeeting,
  acceptMeetingRequest,
  rejectMeetingRequest,
  deleteMeeting,
  formatMeetingTime,
  formatMeetingTimeRange
};

export default presidentMeetingService;
