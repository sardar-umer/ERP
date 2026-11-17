/**
 * E2E helper: GRN vendor bills need a Procurement approval authority before they reach Pre-Audit.
 *
 *   const approver = await pickGrnBillApprover(api);          // pass approver._id as approvalAuthorityId
 *   await approveGrnBillAsAuthority(BASE, approver, bill._id); // each approver signs in turn → 'Pending Audit'
 *
 * The approver must be someone other than the user creating the bill, so the approval is done with
 * the approver's own login. Its password comes from E2E_APPROVER_PASSWORD (default 123456, the
 * password these tests already use for other seeded users).
 */
const axios = require('axios');

async function pickGrnBillApprover(api) {
  const res = await api.get('/procurement/vendor-bills/approval-authorities');
  const list = res.data?.data || [];
  if (!res.data?.success || !list.length) {
    throw new Error('No Procurement department user (other than the test user) is available as approval authority — add one active user with department "Procurement"');
  }
  return list[0];
}

async function approverClient(BASE, approver) {
  const login = await axios.post(
    `${BASE}/auth/login`,
    { email: approver.email, password: process.env.E2E_APPROVER_PASSWORD || '123456' },
    { validateStatus: () => true }
  );
  const token = login.data?.data?.token;
  if (!token) {
    throw new Error(`Could not log in as approval authority ${approver.email} — set E2E_APPROVER_PASSWORD to that user's password`);
  }
  return axios.create({
    baseURL: BASE,
    timeout: 120000,
    validateStatus: () => true,
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function approveGrnBillAsAuthority(BASE, approver, billId) {
  // The chain is the chosen Manager Procurement, then the fixed Sr Manager Procurement: each signs in turn
  let current = approver;
  for (let step = 0; step < 4; step += 1) {
    const client = await approverClient(BASE, current);
    const res = await client.post(`/finance/accounts-payable/${billId}/department-approve`, {
      comments: 'E2E: approval authority approved'
    });
    if (!res.data?.success) {
      throw new Error(`Approval authority ${current.email} could not approve bill ${billId}: ${res.data?.message || res.status}`);
    }
    if (res.data?.data?.status === 'Pending Audit') return res.data.data;
    const next = (res.data?.data?.approvalChain || []).find((s) => s.status === 'pending');
    if (!next?.approver?.email) {
      throw new Error(`Bill ${billId} is not with Pre-Audit after approval and has no next approver`);
    }
    current = next.approver;
  }
  throw new Error(`Bill ${billId} did not reach Pre-Audit after its approvals`);
}

module.exports = { pickGrnBillApprover, approveGrnBillAsAuthority };
