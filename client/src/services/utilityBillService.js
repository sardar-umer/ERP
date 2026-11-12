import api from './api';

const utilityBillService = {
  // Get all utility bills with optional filters
  getUtilityBills: async (params = {}) => {
    const response = await api.get('/utility-bills', { params });
    return response.data;
  },

  // Get single utility bill
  getUtilityBill: async (id) => {
    const response = await api.get(`/utility-bills/${id}`);
    return response.data;
  },

  // Create new utility bill
  createUtilityBill: async (billData) => {
    const response = await api.post('/utility-bills', billData);
    return response.data;
  },

  // Update utility bill
  updateUtilityBill: async (id, billData) => {
    const response = await api.put(`/utility-bills/${id}`, billData);
    return response.data;
  },

  getApproverCandidates: async (params = {}) => {
    const response = await api.get('/utility-bills/approver-candidates', { params });
    return response.data;
  },

  getFormMasterData: async () => {
    const response = await api.get('/utility-bills/form-master-data');
    return response.data;
  },

  submitUtilityBill: async (id, body = {}) => {
    const response = await api.post(`/utility-bills/${id}/submit`, body);
    return response.data;
  },

  approveUtilityBill: async (id, body = {}) => {
    const response = await api.post(`/utility-bills/${id}/approve`, body);
    return response.data;
  },

  rejectUtilityBill: async (id, rejectionReason) => {
    const response = await api.post(`/utility-bills/${id}/reject`, { rejectionReason });
    return response.data;
  },

  /** After audit return: optional observation replies + back to Pre-Audit queue */
  /** After a Finance return: rebuild the Finance bill from this corrected utility bill and send it back to Finance */
  resubmitUtilityBillToFinance: async (id, body = {}) => {
    const response = await api.post(`/utility-bills/${id}/resubmit-to-finance`, body);
    return response.data;
  },
  resendUtilityBillToAudit: async (id, body = {}) => {
    const response = await api.post(`/utility-bills/${id}/resend-to-audit`, body);
    return response.data;
  },

  postUtilityBillToFinance: async (id) => {
    const response = await api.post(`/utility-bills/${id}/post-to-finance`);
    return response.data;
  },

  // Record payment
  recordPayment: async (id, paymentData) => {
    const response = await api.put(`/utility-bills/${id}/payment`, paymentData);
    return response.data;
  },

  // Delete utility bill
  deleteUtilityBill: async (id) => {
    const response = await api.delete(`/utility-bills/${id}`);
    return response.data;
  },

  // Get utility bills by type
  getByType: async (utilityType, params = {}) => {
    const response = await api.get(`/utility-bills/by-type/${utilityType}`, { params });
    return response.data;
  },

  // Get utility bills summary by type
  getSummary: async (params = {}) => {
    const response = await api.get('/utility-bills/summary', { params });
    return response.data;
  },

  // Get overdue bills
  getOverdueBills: async () => {
    const response = await api.get('/utility-bills/overdue');
    return response.data;
  },

  // Get pending bills
  getPendingBills: async () => {
    const response = await api.get('/utility-bills/pending');
    return response.data;
  }
};

export default utilityBillService;
