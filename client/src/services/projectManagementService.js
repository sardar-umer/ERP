import api from './api';

const BASE = '/project-management';

// ─── Projects ─────────────────────────────────────────────────────────────────
export const getProjects = (params = {}) =>
  api.get(`${BASE}/projects`, { params });

export const getProjectStats = () =>
  api.get(`${BASE}/projects/statistics`);

export const getProjectById = (id) =>
  api.get(`${BASE}/projects/${id}`);

export const createProject = (data) =>
  api.post(`${BASE}/projects`, data);

export const updateProject = (id, data) =>
  api.put(`${BASE}/projects/${id}`, data);

export const cancelProject = (id) =>
  api.delete(`${BASE}/projects/${id}`);

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

export const batchAssignBOQContractor = (projectId, data) =>
  api.put(`${BASE}/projects/${projectId}/boq/batch-assign-contractor`, data);

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

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const getExpenses = (projectId, params = {}) =>
  api.get(`${BASE}/projects/${projectId}/expenses`, { params });

export const addExpense = (projectId, data) =>
  api.post(`${BASE}/projects/${projectId}/expenses`, data);

export const updateExpense = (projectId, expenseId, data) =>
  api.put(`${BASE}/projects/${projectId}/expenses/${expenseId}`, data);

export const deleteExpense = (projectId, expenseId) =>
  api.delete(`${BASE}/projects/${projectId}/expenses/${expenseId}`);

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

const projectManagementService = {
  getProjects, getProjectStats, getProjectById, createProject, updateProject, cancelProject,
  updateBudgetStatus, setLumpSumBudget, allocateBudgetToSubs,
  addMilestone, updateMilestone, deleteMilestone,
  getBOQ, addBOQItem, bulkAddBOQItems, updateBOQItem, updateBoqDiscount, deleteBOQItem,
  getTasks, createTask, updateTask, deleteTask,
  getExpenses, addExpense, updateExpense, deleteExpense,
  getDPRList, getDPRById, submitDPR, deleteDPR,
  createPOFromBOQ, getProjectPurchaseOrders,
  getProjectInvoices, createProjectInvoice, generateMilestoneInvoice,
  updateProjectInvoice, deleteProjectInvoice
};

export default projectManagementService;
