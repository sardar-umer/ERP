import api from './api';

const BASE = '/project-management';

// ─── Projects ─────────────────────────────────────────────────────────────────
export const getProjects = (params = {}) =>
  api.get(`${BASE}/projects`, { params });

export const getProjectStats = () =>
  api.get(`${BASE}/projects/statistics`);

export const getProjectWorkflow = (id) =>
  api.get(`${BASE}/projects/${id}/workflow`);

export const getApprovalsInbox = () =>
  api.get(`${BASE}/approvals`);

export const getProjectById = (id) =>
  api.get(`${BASE}/projects/${id}`);

export const createProject = (data) =>
  api.post(`${BASE}/projects`, data);

export const updateProject = (id, data) =>
  api.put(`${BASE}/projects/${id}`, data);

export const cancelProject = (id) =>
  api.delete(`${BASE}/projects/${id}`);

/** Developer only: what a permanent delete would remove (Sub Projects, BOQ, contracts, …). */
export const getProjectDeleteImpact = (id) =>
  api.get(`${BASE}/projects/${id}/delete-impact`);

/** Developer only: permanently delete a project, all its Sub Projects and their records. */
export const deleteProjectPermanently = (id, confirmText) =>
  api.delete(`${BASE}/projects/${id}/permanent`, { data: { confirmText } });

export const updateBudgetStatus = (id, action, notes = '') =>
  api.put(`${BASE}/projects/${id}/budget-status`, { action, notes });

export const setLumpSumBudget = (id, lumpSumBudget) =>
  api.put(`${BASE}/projects/${id}/lump-sum-budget`, { lumpSumBudget });

export const allocateBudgetToSubs = (id, allocations) =>
  api.put(`${BASE}/projects/${id}/budget-allocations`, { allocations });

export const getProjectRollup = (id) =>
  api.get(`${BASE}/projects/${id}/rollup`);

// ─── Milestones ───────────────────────────────────────────────────────────────
export const addMilestone = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/milestones`, data);

export const updateMilestone = (projectId, milestoneId, data) =>
  api.put(`${BASE}/projects/${projectId}/milestones/${milestoneId}`, data);

export const deleteMilestone = (projectId, milestoneId) =>
  api.delete(`${BASE}/projects/${projectId}/milestones/${milestoneId}`);

// ─── BOQ ──────────────────────────────────────────────────────────────────────
export const getBOQHeaders = (projectId) =>
  api.get(`${BASE}/projects/${projectId}/boq-headers`);

export const createBOQHeader = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/boq-headers`, data);

export const updateBOQHeader = (projectId, boqId, data) =>
  api.put(`${BASE}/projects/${projectId}/boq-headers/${boqId}`, data);

export const deleteBOQHeader = (projectId, boqId) =>
  api.delete(`${BASE}/projects/${projectId}/boq-headers/${boqId}`);

export const allocateBOQItem = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/boq/allocate`, data);

export const getBOQ = (projectId, params = {}) =>
  api.get(`${BASE}/projects/${projectId}/boq`, { params });

export const addBOQItem = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/boq`, data);

export const bulkAddBOQItems = (projectId, items) =>
  api.post(`${BASE}/projects/${projectId}/boq/bulk`, { items });

export const updateBOQItem = (projectId, itemId, data) =>
  api.put(`${BASE}/projects/${projectId}/boq/${itemId}`, data);

export const getSuppliers = (params = {}) =>
  api.get('/suppliers', { params: { limit: 1000, ...params } });

export const updateBoqDiscount = (projectId, boqDiscountAmount) =>
  api.put(`${BASE}/projects/${projectId}/boq/discount`, { boqDiscountAmount });

export const deleteBOQItem = (projectId, itemId) =>
  api.delete(`${BASE}/projects/${projectId}/boq/${itemId}`);

// ─── Tasks ────────────────────────────────────────────────────────────────────
export const getTasks = (projectId) =>
  api.get(`${BASE}/projects/${projectId}/tasks`);

export const createTask = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/tasks`, data);

export const updateTask = (projectId, taskId, data) =>
  api.put(`${BASE}/projects/${projectId}/tasks/${taskId}`, data);

export const deleteTask = (projectId, taskId) =>
  api.delete(`${BASE}/projects/${projectId}/tasks/${taskId}`);

// ─── Daily Progress Reports ───────────────────────────────────────────────────
export const getDPRList = (projectId, params = {}) =>
  api.get(`${BASE}/projects/${projectId}/dpr`, { params });

export const getDPRById = (projectId, dprId) =>
  api.get(`${BASE}/projects/${projectId}/dpr/${dprId}`);

export const submitDPR = (projectId, formData) =>
  api.post(`${BASE}/projects/${projectId}/dpr`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

export const deleteDPR = (projectId, dprId) =>
  api.delete(`${BASE}/projects/${projectId}/dpr/${dprId}`);

// ─── Procurement (BOQ → Purchase Order) ───────────────────────────────────────
export const createPOFromBOQ = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/boq/create-po`, data);

export const getProjectPurchaseOrders = (projectId) =>
  api.get(`${BASE}/projects/${projectId}/purchase-orders`);

// ─── WBS Activity Master (per Project Type) ───────────────────────────────────
export const getWbsActivities = (params = {}) =>
  api.get(`${BASE}/wbs-activities`, { params });

export const createWbsActivity = (data) =>
  api.post(`${BASE}/wbs-activities`, data);

export const updateWbsActivity = (activityId, data) =>
  api.put(`${BASE}/wbs-activities/${activityId}`, data);

export const deleteWbsActivity = (activityId) =>
  api.delete(`${BASE}/wbs-activities/${activityId}`);

// ─── Slab Schedules (percentage-wise payment stages per Project Type) ────────
export const getSlabSchedules = (params = {}) =>
  api.get(`${BASE}/slab-schedules`, { params });

export const createSlabSchedule = (data) =>
  api.post(`${BASE}/slab-schedules`, data);

export const updateSlabSchedule = (scheduleId, data) =>
  api.put(`${BASE}/slab-schedules/${scheduleId}`, data);

export const deleteSlabSchedule = (scheduleId) =>
  api.delete(`${BASE}/slab-schedules/${scheduleId}`);

// ─── Sublet Contracts (BOQ lines → subcontractors) ────────────────────────────
export const getSubletContracts = (projectId, params = {}) =>
  api.get(`${BASE}/projects/${projectId}/sublet-contracts`, { params });

export const getSubletContractById = (projectId, scId) =>
  api.get(`${BASE}/projects/${projectId}/sublet-contracts/${scId}`);

export const createSubletContract = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/sublet-contracts`, data);

export const updateSubletContract = (projectId, scId, data) =>
  api.put(`${BASE}/projects/${projectId}/sublet-contracts/${scId}`, data);

export const activateSubletContract = (projectId, scId) =>
  api.post(`${BASE}/projects/${projectId}/sublet-contracts/${scId}/activate`);

export const completeSubletContract = (projectId, scId) =>
  api.post(`${BASE}/projects/${projectId}/sublet-contracts/${scId}/complete`);

export const cancelSubletContract = (projectId, scId) =>
  api.delete(`${BASE}/projects/${projectId}/sublet-contracts/${scId}`);

// ─── Check Requests (gate before IPC / payment) ───────────────────────────────
export const getCheckRequests = (projectId, params = {}) =>
  api.get(`${BASE}/projects/${projectId}/check-requests`, { params });

export const getCheckRequestById = (projectId, crId) =>
  api.get(`${BASE}/projects/${projectId}/check-requests/${crId}`);

export const createCheckRequest = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/check-requests`, data);

export const updateCheckRequest = (projectId, crId, data) =>
  api.put(`${BASE}/projects/${projectId}/check-requests/${crId}`, data);

export const submitCheckRequest = (projectId, crId) =>
  api.post(`${BASE}/projects/${projectId}/check-requests/${crId}/submit`);

// ─── Inspection Reports (verify a Submitted Check Request) ───────────────────
export const getInspectionReports = (projectId, params = {}) =>
  api.get(`${BASE}/projects/${projectId}/inspection-reports`, { params });

export const createInspectionReport = (projectId, crId, data) =>
  api.post(`${BASE}/projects/${projectId}/check-requests/${crId}/inspection-reports`, data);

/** formData: decision, observations, images[] (≥3), videos[] (≥1). Videos can be large, so no short timeout. */
export const decideInspectionReport = (projectId, irId, formData, onUploadProgress) =>
  api.post(`${BASE}/projects/${projectId}/inspection-reports/${irId}/decision`, formData, {
    timeout: 0,
    onUploadProgress
  });

export const cancelInspectionReport = (projectId, irId) =>
  api.post(`${BASE}/projects/${projectId}/inspection-reports/${irId}/cancel`);

export const getUsersForAssignment = () =>
  api.get('/auth/users', { params: { limit: 1000, status: 'active', dropdown: true } });

export const rejectCheckRequest = (projectId, crId, data) =>
  api.post(`${BASE}/projects/${projectId}/check-requests/${crId}/reject`, data);

export const cancelCheckRequest = (projectId, crId) =>
  api.delete(`${BASE}/projects/${projectId}/check-requests/${crId}`);

// ─── Project Invoices (Milestone Billing) ────────────────────────────────────
export const getProjectInvoices = (projectId) =>
  api.get(`${BASE}/projects/${projectId}/invoices`);

export const createProjectInvoice = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/invoices`, data);

export const generateMilestoneInvoice = (projectId, milestoneId, data = {}) =>
  api.post(`${BASE}/projects/${projectId}/milestones/${milestoneId}/generate-invoice`, data);

export const updateProjectInvoice = (projectId, invoiceId, data) =>
  api.put(`${BASE}/projects/${projectId}/invoices/${invoiceId}`, data);

export const deleteProjectInvoice = (projectId, invoiceId) =>
  api.delete(`${BASE}/projects/${projectId}/invoices/${invoiceId}`);

export const recordInvoicePayment = (projectId, invoiceId, data) =>
  api.post(`${BASE}/projects/${projectId}/invoices/${invoiceId}/payments`, data);

export const cancelProjectInvoice = (projectId, invoiceId, reason) =>
  api.post(`${BASE}/projects/${projectId}/invoices/${invoiceId}/cancel`, { reason });

// ─── IPC approval chain (Pre-Audit → Audit Director → CEO Secretariat → CEO → Finance) ───
export const getIpc = (ipcId) => api.get(`${BASE}/ipcs/${ipcId}`);
export const submitIpc = (ipcId, comments) => api.post(`${BASE}/ipcs/${ipcId}/submit`, { comments });
export const resubmitIpc = (ipcId, comments) => api.post(`${BASE}/ipcs/${ipcId}/resubmit`, { comments });
export const reviseIpc = (projectId, invoiceId, data) =>
  api.post(`${BASE}/projects/${projectId}/invoices/${invoiceId}/revise`, data);
export const retryIpcFinancePosting = (ipcId) => api.post(`${BASE}/ipcs/${ipcId}/post-to-finance`);
export const getSubcontractorBalances = (projectId, params = {}) =>
  api.get(`${BASE}/projects/${projectId}/subcontractor-balances`, { params });
export const createAdvanceIpc = (projectId, data) => api.post(`${BASE}/projects/${projectId}/advances`, data);
export const createRetentionRelease = (projectId, data) => api.post(`${BASE}/projects/${projectId}/retention-releases`, data);

const projectManagementService = {
  getProjects, getProjectStats, getProjectById, createProject, updateProject, cancelProject,
  getProjectDeleteImpact, deleteProjectPermanently,
  updateBudgetStatus, setLumpSumBudget, allocateBudgetToSubs,
  addMilestone, updateMilestone, deleteMilestone,
  getBOQ, addBOQItem, bulkAddBOQItems, updateBOQItem, updateBoqDiscount, deleteBOQItem,
  getTasks, createTask, updateTask, deleteTask,
  getWbsActivities, createWbsActivity, updateWbsActivity, deleteWbsActivity,
  getSlabSchedules, createSlabSchedule, updateSlabSchedule, deleteSlabSchedule,
  getSubletContracts, getSubletContractById, createSubletContract, updateSubletContract,
  activateSubletContract, completeSubletContract, cancelSubletContract,
  getCheckRequests, getCheckRequestById, createCheckRequest, updateCheckRequest,
  submitCheckRequest, rejectCheckRequest, cancelCheckRequest,
  getInspectionReports, createInspectionReport, decideInspectionReport, cancelInspectionReport,
  getDPRList, getDPRById, submitDPR, deleteDPR,
  createPOFromBOQ, getProjectPurchaseOrders,
  getProjectInvoices, createProjectInvoice, generateMilestoneInvoice,
  updateProjectInvoice, deleteProjectInvoice
};

export default projectManagementService;
