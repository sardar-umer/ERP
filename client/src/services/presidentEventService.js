import api from './api';
import { formatMeetingTime, formatMeetingTimeRange } from './presidentMeetingService';

const base = '/president-events';

export const formatEventTime = formatMeetingTime;
export const formatEventTimeRange = formatMeetingTimeRange;

export const getEventVenueDisplay = (event) => {
  if (!event) return '—';
  return event.venue?.trim() || '—';
};

export const fetchEvents = (params = {}) => api.get(base, { params });

export const fetchEventById = (id) => api.get(`${base}/${id}`);

export const createEvent = (data) => api.post(base, data);

export const updateEvent = (id, data) => api.put(`${base}/${id}`, data);

export const deleteEvent = (id) => api.delete(`${base}/${id}`);

const presidentEventService = {
  fetchEvents,
  fetchEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  formatEventTime,
  formatEventTimeRange,
  getEventVenueDisplay
};

export default presidentEventService;
