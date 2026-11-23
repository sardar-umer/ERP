import { PAYROLL_AUTHORITY_SLOTS, userOptionLabel } from '../services/payrollApprovalAuthorityService';

export const PAYROLL_AUTHORITY_STATUS_VALUES = [
  'Approved by Deputy Manager Payroll HR',
  'Approved by GM HR',
  'Approved by AVP'
];

export const isPayrollFinalApprovedStatus = (status) => {
  const s = String(status || '').trim();
  // GM HR is the final approver since 2026-11-23; 'Approved by AVP' kept for older months.
  return s === 'Approved' || s === 'Approved by GM HR' || s === 'Approved by AVP';
};

export const getPayrollStatusColor = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'draft') return 'default';
  if (s === 'approved by deputy manager payroll hr') return 'info';
  if (s === 'approved by gm hr' || s === 'approved by avp' || s === 'approved') return 'success';
  if (s === 'paid') return 'success';
  if (s === 'cancelled') return 'error';
  return 'warning';
};

export const getPayrollStatusLabel = (status) => {
  const s = String(status || '').trim();
  if (!s) return '—';
  return s;
};

export const buildPayrollApprovalAuthorityRows = (monthlyApproval) => {
  const authorities = monthlyApproval?.financeApprovalAuthorities || {};
  const approvals = monthlyApproval?.financeAuthorityApprovals || [];
  const approvedByKey = new Map();
  approvals
    .filter((row) => String(row?.decision || 'approved') !== 'rejected')
    .forEach((row) => {
      const key = String(row?.authorityKey || '').trim();
      if (key) approvedByKey.set(key, row);
    });

  return PAYROLL_AUTHORITY_SLOTS.map((slot) => {
    const assigned = authorities[slot.key];
    const record = approvedByKey.get(slot.key);
    const approver = record?.approver || assigned;
    const approved = Boolean(record?.approvedAt);
    return {
      key: slot.key,
      authority: slot.label,
      name: userOptionLabel(approver),
      signatureUser: approved ? approver : null,
      dateTime: record?.approvedAt || null,
      approved
    };
  });
};
