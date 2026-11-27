import api from './api';

const base = '/taj-utilities/invoices';

export const createInvoice = (propertyId, data) => {
  if (propertyId) {
    return api.post(`${base}/property/${propertyId}`, data);
  } else {
    // Create open invoice without property
    return api.post(base, data);
  }
};

/** Taj Utilities — bulk CAM invoice creation (single HTTP request; server creates all). */
export const bulkCreateCamInvoices = (data) =>
  api.post(`${base}/bulk-create-cam-invoices`, data, { timeout: 600000 });

/** Taj Utilities — bulk Water invoice creation (single HTTP request; server creates all). */
export const bulkCreateWaterInvoices = (data) =>
  api.post(`${base}/bulk-create-water-invoices`, data, { timeout: 600000 });

/** Taj Utilities — bulk rental (RENT) invoice creation (single HTTP request; server creates all). */
export const bulkCreateRentInvoices = (data) =>
  api.post(`${base}/bulk-create-rent-invoices`, data, { timeout: 600000 });

export const fetchInvoice = (invoiceId) =>
  api.get(`${base}/${invoiceId}`);

export const fetchInvoicesForProperty = (propertyId) =>
  api.get(`${base}/property/${propertyId}`);

export const fetchAllInvoices = (params = {}) =>
  api.get(base, { params });

/** RENT / GROUND BOOKING / OTHER totals from invoice charge lines (excludes CAM, WATER, ELECTRICITY lines). */
export const fetchChargeRollups = (params = {}) =>
  api.get(`${base}/charge-rollups`, { params });

export const fetchReports = (params = {}) =>
  api.get(`${base}/reports`, { params });

/** Open invoices (no property) — GROUND vs OTHER line split; same month window as Reports. */
export const fetchReportsOpenInvoiceBucket = (params = {}) =>
  api.get(`${base}/reports/open-invoice-bucket`, { params });

/** Receivable roll-forward per month and charge type (Opening + Billed − Received = Closing). */
export const fetchReceivableRollForward = (params = {}) =>
  api.get(`${base}/reports/receivable-rollforward`, { params });

/** Dashboard: top residents by outstanding for charge types (CAM,WATER,...) or total balance when chargeTypes omitted. */
export const fetchDashboardResidentsOutstanding = (params = {}) =>
  api.get(`${base}/dashboard-residents-outstanding`, { params });

export const fetchMonthSummary = (params = {}) =>
  api.get(`${base}/month-summary`, { params });

export const fetchReconciliationRecords = (params = {}) =>
  api.get(`${base}/reconciliation`, { params });

export const saveReconciliation = (formData) =>
  api.post(`${base}/reconciliation/save`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

export const updateInvoice = (invoiceId, data) =>
  api.put(`${base}/${invoiceId}`, data);

export const deleteInvoice = (invoiceId) =>
  api.delete(`${base}/${invoiceId}`);

export const deletePaymentFromInvoice = (invoiceId, paymentId) =>
  api.delete(`${base}/${invoiceId}/payments/${paymentId}`);

export const getElectricityCalculation = (propertyId, currentReading, meterNo, unitsConsumed, previousReading) => {
  const params = {};
  
  // Include manual previous reading if provided
  if (previousReading !== undefined && previousReading !== null && previousReading !== '') {
    params.previousReading = previousReading;
  }
  
  // CRITICAL: If unitsConsumed is provided, ONLY send unitsConsumed (ignore currentReading)
  if (unitsConsumed !== undefined && unitsConsumed !== null && unitsConsumed !== '') {
    params.unitsConsumed = unitsConsumed;
    // Explicitly do NOT send currentReading when unitsConsumed is provided
  } else if (currentReading !== undefined && currentReading !== null && currentReading !== '') {
    // Only send currentReading if unitsConsumed is NOT provided
    params.currentReading = currentReading;
  }
  
  // Always include meterNo if provided
  if (meterNo) {
    params.meterNo = meterNo;
  }
  
  console.log('[getElectricityCalculation] Params:', params);
  
  return api.get(`${base}/property/${propertyId}/electricity-calculation`, { params });
};

export const getRentCalculation = (propertyId) =>
  api.get(`${base}/property/${propertyId}/rent-calculation`);

export const getCAMCalculation = (propertyId) =>
  api.get(`${base}/property/${propertyId}/cam-calculation`);

export const getWaterCalculation = (propertyId) =>
  api.get(`${base}/property/${propertyId}/water-calculation`);

const propertyInvoiceService = {
  createInvoice,
  bulkCreateCamInvoices,
  bulkCreateWaterInvoices,
  bulkCreateRentInvoices,
  fetchInvoice,
  fetchInvoicesForProperty,
  fetchAllInvoices,
  fetchReports,
  fetchReportsOpenInvoiceBucket,
  updateInvoice,
  deleteInvoice,
  deletePaymentFromInvoice,
  getElectricityCalculation,
  getRentCalculation,
  getCAMCalculation,
  getWaterCalculation
};

export default propertyInvoiceService;

