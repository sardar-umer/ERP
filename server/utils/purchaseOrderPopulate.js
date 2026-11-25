/**
 * Populate specs for showing a Purchase Order with its approval authorities (names + digital signatures).
 * Used by the PO detail page, and by vendor bills that show their PO as a supporting document
 * (Pre-Audit and Finance), so the PO's "Approval Authorities" table renders the same everywhere.
 */

/** Indent fields + comparative-statement approvers (the PO authority signatures come from these). */
const purchaseOrderIndentPopulate = {
  path: 'indent',
  select:
    'indentNumber title erpRef requestedDate requiredDate department costCenter requestedBy items notes companyId comparativeStatementApprovals comparativeApproval comparativeApprovals splitPOAssignments approvalChain justification signatures attachments storeRoutingStatus movedToProcurementReason movedToProcurementAt movedToProcurementBy',
  populate: [
    { path: 'department', select: 'name code' },
    { path: 'costCenter', select: 'code name path' },
    { path: 'companyId', select: 'name code symbol' },
    { path: 'requestedBy', select: 'firstName lastName email digitalSignature' },
    { path: 'movedToProcurementBy', select: 'firstName lastName email' },
    { path: 'approvalChain.approver', select: 'firstName lastName email digitalSignature' },
    { path: 'comparativeApproval.approvers.approver', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeApproval.submittedBy', select: 'firstName lastName email' },
    { path: 'comparativeApproval.rejectedBy', select: 'firstName lastName email' },
    { path: 'comparativeApprovals.approvers.approver', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.preparedByUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.verifiedByUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.authorisedRepUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.financeRepUser', select: 'firstName lastName email employeeId digitalSignature' },
    { path: 'comparativeStatementApprovals.managerProcurementUser', select: 'firstName lastName email employeeId digitalSignature' }
  ]
};

/** Same populates but keeps every indent field (for screens that already read the whole indent). */
const { select: _indentSelect, ...purchaseOrderIndentPopulateAllFields } = purchaseOrderIndentPopulate;

const PO_USER_FIELDS = 'firstName lastName email employeeId digitalSignature';

/** Everyone the PO "Approval Authorities" table needs, with their signatures. */
const purchaseOrderAuthorityPopulates = [
  { path: 'authorityApprovals.approver', select: PO_USER_FIELDS },
  { path: 'preAuditInitialApprovedBy', select: PO_USER_FIELDS },
  { path: 'auditApprovedBy', select: PO_USER_FIELDS },
  { path: 'auditReturnedBy', select: PO_USER_FIELDS },
  { path: 'auditRejectedBy', select: PO_USER_FIELDS },
  { path: 'workflowHistory.changedBy', select: `${PO_USER_FIELDS} approvalStamp` }
];

module.exports = {
  purchaseOrderIndentPopulate,
  purchaseOrderIndentPopulateAllFields,
  purchaseOrderAuthorityPopulates
};
