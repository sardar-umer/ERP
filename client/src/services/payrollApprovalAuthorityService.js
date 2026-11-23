import api from './api';
import { userOptionLabel } from './financeApprovalAuthorityService';

export const PAYROLL_AUTHORITY_SLOTS = [
  { key: 'accountsOfficerUser', label: 'Deputy Manager Payroll HR' },
  { key: 'financeControllerUser', label: 'GM HR' }
];
// AVP removed from the payroll chain (2026-11-23): GM HR is the final approver.

export async function fetchPayrollAuthorityCandidates(search = '') {
  try {
    const res = await api.get('/payroll/hr-authority-candidates', {
      params: {
        limit: 500,
        allUsers: true,
        search: search || undefined,
        _ts: Date.now()
      },
      headers: { 'Cache-Control': 'no-cache' }
    });
    return Array.isArray(res.data?.data) ? res.data.data : [];
  } catch {
    return [];
  }
}

export function buildPayrollApprovalAuthoritiesPayload(gmHrUser, preparerUserId) {
  const gmHrId = gmHrUser?._id || gmHrUser;
  if (!gmHrId || !preparerUserId) return null;
  return {
    accountsOfficerUser: String(preparerUserId),
    financeControllerUser: String(gmHrId)
  };
}

export function validatePayrollAuthoritySelection(gmHrUser, preparerUserId) {
  if (!gmHrUser) return 'Select GM HR before saving.';
  const gmHrId = String(gmHrUser?._id || gmHrUser || '');
  if (gmHrId && preparerUserId && gmHrId === String(preparerUserId)) {
    return 'GM HR must be a different user from you (Deputy Manager Payroll HR).';
  }
  return null;
}

export function getNextPendingPayrollAuthorityKey(approvalDoc) {
  const assigned = approvalDoc?.financeApprovalAuthorities || {};
  const approvedKeys = new Set(
    (approvalDoc?.financeAuthorityApprovals || [])
      .filter((a) => String(a?.decision || 'approved') !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  );
  for (const slot of PAYROLL_AUTHORITY_SLOTS) {
    const userRef = assigned[slot.key];
    const userId = String(userRef?._id || userRef || '');
    if (userId && !approvedKeys.has(slot.key)) return slot.key;
  }
  return null;
}

export { userOptionLabel };
