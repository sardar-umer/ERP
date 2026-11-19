/**
 * Finance queue for HR lump-sum loan payments.
 * Mounted at /api/finance/loan-receipts (authMiddleware applied in index.js).
 */
const express = require('express');
const { authorize } = require('../middleware/auth');
const flow = require('../utils/loanLumpSumFinance');

const router = express.Router();
const financeOnly = authorize('super_admin', 'admin', 'finance_manager');

const handle = (label, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error(`Loan receipts — ${label}:`, error);
    return res.status(500).json({ success: false, message: error.message || `Error ${label}` });
  }
};

// GET /api/finance/loan-receipts?status=Pending Finance|Posted|Returned|Rejected|all
router.get('/', financeOnly, handle('listing', async (req, res) => {
  const { financeScope } = require('../utils/financeRouteScope');
  const { companyId } = await financeScope(req).catch(() => ({ companyId: null }));
  const data = await flow.listRequests({ status: req.query.status || 'Pending Finance', companyId });
  res.json({ success: true, data });
}));

// GET /api/finance/loan-receipts/:id — request + fresh preview against the loan as it is now
router.get('/:id', financeOnly, handle('loading', async (req, res) => {
  const data = await flow.getRequestForFinance(req.params.id);
  res.json({ success: true, data });
}));

// POST /api/finance/loan-receipts/:id/post { bankAccountId, date?, paymentMethod?, reference?, costCenter?, narration?, comments? }
router.post('/:id/post', financeOnly, handle('posting', async (req, res) => {
  const { request, voucherNumber } = await flow.postRequest(req.params.id, req.body || {}, req.user);
  res.json({
    success: true,
    message: `${request.requestNumber} posted as ${voucherNumber}. Loan schedule updated.`,
    data: { requestNumber: request.requestNumber, voucherNumber, status: request.status }
  });
}));

// POST /api/finance/loan-receipts/:id/return { comments }
router.post('/:id/return', financeOnly, handle('returning', async (req, res) => {
  const request = await flow.decideRequest(req.params.id, 'Returned', req.body?.comments, req.user);
  res.json({ success: true, message: `${request.requestNumber} returned to HR.`, data: request });
}));

// PUT /api/finance/loan-receipts/:id/finance-reject { comments } — "Return" from Finance → Approvals (back to HR)
router.put('/:id/finance-reject', financeOnly, handle('returning', async (req, res) => {
  const request = await flow.decideRequest(req.params.id, 'Returned', req.body?.comments, req.user);
  res.json({ success: true, message: `${request.requestNumber} returned to HR.`, data: request });
}));

// POST /api/finance/loan-receipts/:id/reject { comments }
router.post('/:id/reject', financeOnly, handle('rejecting', async (req, res) => {
  const request = await flow.decideRequest(req.params.id, 'Rejected', req.body?.comments, req.user);
  res.json({ success: true, message: `${request.requestNumber} rejected.`, data: request });
}));

module.exports = router;
