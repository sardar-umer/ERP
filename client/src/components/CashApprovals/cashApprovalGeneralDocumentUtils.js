import { normalizeUploadPath, resolveUploadFileHref } from '../../utils/uploadPaths';
import { getImageUrl } from '../../utils/imageService';
import { numberToWords } from '../../utils/numberToWords';
import { brandPrintHtml } from '../../utils/tovusPrintBrand';

export { normalizeUploadPath };

export const isGeneralModuleCashApproval = (ca) =>
  String(ca?.originatingModule || '').toLowerCase() === 'general';

export const formatInvoiceDateDmy = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).replace(/ /g, '-');
};

export const formatInvoiceTime12h = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const formatDateTime = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatDecimalPk = (amount) =>
  new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount || 0));

export const userDisplayName = (user) => {
  if (!user) return '';
  if (typeof user === 'string') return user;
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email || user.employeeId || '';
};

/** Digital Signature column only — stamps render in the separate Approval Stamp section. */
export const getSignatureSource = (row) => {
  if (row?.signatureUser?.digitalSignature) return row.signatureUser.digitalSignature;
  if (row?.authority === 'CEO' && row?.signaturePath) return row.signaturePath;
  return '';
};

/** Public URL for files under /uploads (cash approval line attachments, etc.) */
export const resolveUploadPublicUrl = (relativePath) =>
  resolveUploadFileHref(relativePath) || '';

export const getStatusColor = (status) => {
  if (status === 'Draft') return 'default';
  if (status === 'Pending Approval') return 'warning';
  if (['Pending Audit', 'Forwarded to Audit Director'].includes(status)) return 'info';
  if (['Completed', 'Advance Issued', 'Payment Settled', 'Finance Authority Approved'].includes(status)) {
    return 'success';
  }
  if (['Rejected', 'Cancelled'].includes(status)) return 'error';
  return 'primary';
};

export const advanceEmployeeLabel = (ca) => {
  const emp = ca?.advanceToEmployee;
  const name = ca?.advanceToName || userDisplayName(emp) || userDisplayName(ca?.advanceTo);
  const code = emp?.employeeId ? ` (${emp.employeeId})` : '';
  return `${name}${code}`.trim() || '—';
};

/** Populated companyId → display label for screen/print. */
export const getCashApprovalCompanyLabel = (ca) => {
  const company = ca?.companyId;
  if (!company || typeof company !== 'object') return null;
  const name = String(company.name || '').trim();
  if (!name) return null;
  const code = String(company.companyCode || '').trim();
  return code ? `${name} (${code})` : name;
};

export const buildGeneralCashApprovalApprovalRows = (ca) => {
  if (!ca) return [];
  const chain = ca.departmentApprovalChain || [];
  const history = Array.isArray(ca.workflowHistory) ? [...ca.workflowHistory].reverse() : [];
  const normalize = (v) => String(v || '').trim().toLowerCase();

  const isDepartmentSentToAuditQueue = (entry) => {
    const from = normalize(entry?.fromStatus);
    const to = normalize(entry?.toStatus);
    if (from !== 'pending approval' || to !== 'pending audit') return false;
    const comments = normalize(entry?.comments);
    return (
      comments.includes('manager / hod') ||
      comments.includes('sent to pre-audit after') ||
      comments.includes('approval authority approved')
    );
  };

  // Moving a CA *into* Pending Audit is done by the requester / department (first send or a resubmission after
  // an audit rejection). Only Pre-Audit's own action (Pending Audit → Pending Audit, module Pre-Audit) is a signature.
  const isSentIntoAuditQueue = (entry) => {
    const to = normalize(entry?.toStatus);
    if (!to.startsWith('pending audit')) return false;
    const from = normalize(entry?.fromStatus);
    const module = normalize(entry?.module);
    return from !== 'pending audit' && !module.includes('audit');
  };

  const matchingAuditHistory = (keywords, { excludeModules = [] } = {}) =>
    history.filter((entry) => {
      if (isDepartmentSentToAuditQueue(entry)) return false;
      if (isSentIntoAuditQueue(entry)) return false;
      const module = normalize(entry?.module);
      if (excludeModules.some((m) => module === normalize(m))) return false;
      const to = normalize(entry?.toStatus);
      return keywords.some((keyword) => to === keyword || to.startsWith(keyword));
    });

  const findPreferredAuditEntry = (keywords, options = {}) => {
    const entries = matchingAuditHistory(keywords, options);
    return entries.find((e) => e?.changedBy?.digitalSignature) || entries[0] || null;
  };

  const findAuthorityApproval = (key) =>
    (Array.isArray(ca.authorityApprovals) ? ca.authorityApprovals : [])
      .find((entry) => String(entry?.authorityKey || '').trim() === key) || null;

  const preAuditFromHistory = findPreferredAuditEntry([
    'initial audit approval',
    'pending audit'
  ]);
  const preAuditActor =
    (typeof ca.preAuditInitialApprovedBy === 'object' ? ca.preAuditInitialApprovedBy : null) ||
    preAuditFromHistory?.changedBy ||
    null;
  const preAuditAt = ca.preAuditInitialApprovedAt || preAuditFromHistory?.changedAt;

  const auditDirectorApproval = findAuthorityApproval('auditDirectorApproval');
  const directorFromHistory = findPreferredAuditEntry(
    [
      'approved (from forwarded to audit director)',
      'approved (from send to audit)',
      'send to ceo office'
    ],
    { excludeModules: ['ceo', 'ceo secretariat', 'finance'] }
  );
  const directorActor =
    (typeof ca.auditApprovedBy === 'object' ? ca.auditApprovedBy : null) ||
    (typeof auditDirectorApproval?.approver === 'object' ? auditDirectorApproval.approver : null) ||
    directorFromHistory?.changedBy ||
    null;
  const directorAt =
    ca.auditApprovedAt ||
    auditDirectorApproval?.approvedAt ||
    directorFromHistory?.changedAt ||
    null;

  const ceoSecretariatActor = ca.ceoForwardedBy || null;
  const ceoActor = ca.ceoApprovedBy || null;
  const ceoTypedSignature =
    ca.ceoDigitalSignature &&
    !String(ca.ceoDigitalSignature).startsWith('/') &&
    !String(ca.ceoDigitalSignature).startsWith('http')
      ? String(ca.ceoDigitalSignature).trim()
      : '';
  const ceoImageSignature =
    (ca.ceoDigitalSignature && String(ca.ceoDigitalSignature).startsWith('/')
      ? ca.ceoDigitalSignature
      : '') || ceoActor?.digitalSignature || '';

  return [
    {
      authority: 'Sig of Requester',
      name: userDisplayName(ca.createdBy),
      signatureUser: ca.createdBy,
      dateTime: formatDateTime(ca.createdAt)
    },
    {
      authority: 'Manager Approver',
      name: userDisplayName(chain[0]?.approver),
      signatureUser: chain[0]?.status === 'approved' ? chain[0]?.approver : null,
      dateTime: chain[0]?.status === 'approved' ? formatDateTime(chain[0]?.actedAt) : '—'
    },
    {
      authority: 'Head Of Department Approver',
      name: userDisplayName(chain[1]?.approver),
      signatureUser: chain[1]?.status === 'approved' ? chain[1]?.approver : null,
      dateTime: chain[1]?.status === 'approved' ? formatDateTime(chain[1]?.actedAt) : '—'
    },
    {
      authority: 'Pre-Audit Authority',
      name: preAuditActor ? userDisplayName(preAuditActor) : '—',
      signatureUser: preAuditActor || null,
      dateTime: preAuditActor ? formatDateTime(preAuditAt) : '—'
    },
    {
      authority: 'Audit Director',
      name: directorActor ? userDisplayName(directorActor) : '—',
      signatureUser: directorActor || null,
      signaturePath:
        directorFromHistory?.stampUsed && directorFromHistory?.stampImage
          ? directorFromHistory.stampImage
          : directorActor?.digitalSignature || '',
      dateTime: directorActor ? formatDateTime(directorAt) : '—'
    },
    {
      authority: 'PS to CEO',
      name: ceoSecretariatActor ? userDisplayName(ceoSecretariatActor) : '—',
      signatureUser: ceoSecretariatActor || null,
      dateTime: ceoSecretariatActor && ca.ceoForwardedAt ? formatDateTime(ca.ceoForwardedAt) : '—'
    },
    {
      authority: 'CEO',
      name: ceoActor ? userDisplayName(ceoActor) : '—',
      signatureUser: ceoActor || null,
      signaturePath: ceoImageSignature,
      typedSignature: ceoTypedSignature,
      dateTime: ceoActor && ca.ceoApprovedAt ? formatDateTime(ca.ceoApprovedAt) : '—'
    }
  ];
};

export const buildGeneralCashApprovalStampRows = (ca) => {
  if (!ca) return [];
  const history = Array.isArray(ca.workflowHistory) ? [...ca.workflowHistory].reverse() : [];
  const normalize = (v) => String(v || '').trim().toLowerCase();
  const isDepartmentSentToAuditQueue = (entry) => {
    const from = normalize(entry?.fromStatus);
    const to = normalize(entry?.toStatus);
    if (from !== 'pending approval' || to !== 'pending audit') return false;
    const comments = normalize(entry?.comments);
    return comments.includes('manager / hod') || comments.includes('sent to pre-audit after');
  };
  const findStamp = (accepted) =>
    history.find(
      (e) =>
        !isDepartmentSentToAuditQueue(e) &&
        e?.stampUsed &&
        e?.stampImage &&
        accepted.some((k) => {
          const to = normalize(e?.toStatus);
          return to === k || to.startsWith(k);
        })
    );
  const preAuditStamp = findStamp([
    'forwarded to audit director',
    'initial audit approval',
    'pending audit'
  ]);
  const directorStamp = history.find(
    (e) =>
      !isDepartmentSentToAuditQueue(e) &&
      e?.stampUsed &&
      e?.stampImage &&
      !['ceo', 'ceo secretariat', 'finance'].includes(normalize(e?.module)) &&
      ['approved (from forwarded to audit director)', 'approved (from send to audit)', 'send to ceo office'].some((k) => {
        const to = normalize(e?.toStatus);
        return to === k || to.startsWith(k);
      })
  );
  return [
    {
      authority: 'Pre-Audit Authority Stamp',
      stampImage: preAuditStamp?.stampImage,
      dateTime: formatDateTime(preAuditStamp?.changedAt)
    },
    {
      authority: 'Audit Director Stamp',
      stampImage: directorStamp?.stampImage,
      dateTime: formatDateTime(directorStamp?.changedAt)
    }
  ].filter((r) => r.stampImage);
};

const PRINT_STATUS_TONE = (status) => {
  if (['Completed', 'Advance Issued', 'Payment Settled', 'Finance Authority Approved'].includes(status)) return 'ok';
  if (['Rejected', 'Cancelled'].includes(status)) return 'bad';
  if (status === 'Draft') return 'muted';
  return 'info';
};

/** Absolute URL for an uploaded image, so the print window (about:blank) can load it. */
const absoluteImageUrl = (path) => {
  const src = getImageUrl(path);
  if (!src) return '';
  try {
    return new URL(src, window.location.origin).href;
  } catch {
    return src;
  }
};

/**
 * Printable A4 cash approval: company header, details, line items, totals with amount in words,
 * and the approval signatures as a sign-off grid. Scaled down when needed to fit one page.
 */
export const buildGeneralCashApprovalPrintHtml = (ca) => {
  if (!ca) return '';
  const linesTotal = (ca.items || []).reduce((s, li) => s + (Number(li.amount) || 0), 0);
  const netTotal = Number(ca.totalAmount) || linesTotal;
  const approvalRows = buildGeneralCashApprovalApprovalRows(ca);
  const stampRows = buildGeneralCashApprovalStampRows(ca);
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const dash = (v) => (v === null || v === undefined || String(v).trim() === '' ? '—' : v);
  const company = getCashApprovalCompanyLabel(ca) || '';
  const glAccount = [
    ca.advanceGlAccount?.accountNumber || ca.advanceGlAccountNumber,
    ca.advanceGlAccount?.name
  ].filter(Boolean).join(' — ');

  const rows = (ca.items || [])
    .map((line, i) => {
      const amt = Number(line.amount) || 0;
      const qty = Number(line.quantity) || 1;
      const rate = Number(line.unitPrice) || amt;
      const item = line.itemName || line.description || '—';
      const desc = line.specification || line.description || '';
      return `<tr>
          <td class="c muted">${i + 1}</td>
          <td><div class="item">${esc(item)}</div>${desc && desc !== item ? `<div class="sub">${esc(desc)}</div>` : ''}</td>
          <td>${esc(dash(line.location))}</td>
          <td class="c">${esc(line.unit || 'pcs')}</td>
          <td class="r num">${formatDecimalPk(qty)}</td>
          <td class="r num">${formatDecimalPk(rate)}</td>
          <td class="r num strong">${formatDecimalPk(amt)}</td>
        </tr>`;
    })
    .join('');

  const signatures = approvalRows
    .map((row) => {
      const source = getSignatureSource(row);
      const signed = Boolean(row.typedSignature || source || (row.dateTime && row.dateTime !== '—'));
      const mark = row.typedSignature
        ? `<div class="typed">${esc(row.typedSignature)}</div>`
        : source
          ? `<img src="${esc(absoluteImageUrl(source))}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'signed-mark',textContent:'Approved'}))" />`
          : signed ? '<div class="signed-mark">Approved</div>' : '';
      return `<div class="sig ${signed ? '' : 'pending'}">
          <div class="sig-area">${mark}</div>
          <div class="sig-line"></div>
          <div class="sig-name">${esc(dash(row.name))}</div>
          <div class="sig-role">${esc(row.authority)}</div>
          <div class="sig-date">${signed ? esc(dash(row.dateTime)) : 'Pending'}</div>
        </div>`;
    })
    .join('');

  const stamps = stampRows.length
    ? `<div class="stamps">${stampRows.map((r) => `<div class="stamp">
          <img src="${esc(absoluteImageUrl(r.stampImage))}" alt="" />
          <div class="sig-role">${esc(r.authority)}</div>
          <div class="sig-date">${esc(dash(r.dateTime))}</div>
        </div>`).join('')}</div>`
    : '';

  const printedAt = formatDateTime(new Date());
  const tone = PRINT_STATUS_TONE(ca.status);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(ca.caNumber)} — Cash Approval</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1f2933; font-size: 11.5px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
  .doc { width: 186mm; margin: 0 auto; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: #7b8794; }
  .strong { font-weight: 700; }
  .c { text-align: center; } .r { text-align: right; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #1e3a5f; }
  .org { font-size: 17px; font-weight: 700; color: #1e3a5f; letter-spacing: .2px; }
  .dept { font-size: 11.5px; color: #52606d; margin-top: 2px; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 21px; letter-spacing: 3px; text-transform: uppercase; color: #1e3a5f; font-weight: 700; }
  .ref { font-size: 13px; font-weight: 600; margin-top: 3px; }
  .pill { display: inline-block; margin-top: 6px; padding: 2px 10px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: .3px; border: 1px solid; }
  .pill.ok { color: #1e6b3a; border-color: #9fd3b1; background: #eaf7ef; }
  .pill.bad { color: #a12b2b; border-color: #efb1b1; background: #fdeeee; }
  .pill.info { color: #1e4f8a; border-color: #a9c6ea; background: #eef4fc; }
  .pill.muted { color: #52606d; border-color: #cbd2d9; background: #f5f7fa; }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 14px; border: 1px solid #d9e2ec; border-radius: 6px; overflow: hidden; }
  .cell { padding: 8px 12px; border-right: 1px solid #d9e2ec; border-bottom: 1px solid #d9e2ec; }
  .cell:nth-child(3n) { border-right: 0; }
  .cell:nth-last-child(-n+3) { border-bottom: 0; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: .8px; color: #7b8794; font-weight: 600; }
  .value { font-size: 12px; font-weight: 600; margin-top: 2px; word-break: break-word; }

  .narration { margin-top: 12px; padding: 9px 12px; background: #f5f8fc; border-left: 3px solid #1e3a5f; border-radius: 0 6px 6px 0; }
  .narration .value { font-weight: 500; white-space: pre-wrap; }

  table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.items th { background: #1e3a5f; color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: .6px; font-weight: 600; padding: 7px 8px; text-align: left; }
  table.items th.r { text-align: right; } table.items th.c { text-align: center; }
  table.items td { padding: 7px 8px; border-bottom: 1px solid #e4e7eb; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #f9fafb; }
  table.items thead { display: table-header-group; }
  table.items tr { break-inside: avoid; page-break-inside: avoid; }
  .dense table.items td { padding: 4px 8px; }
  .dense .sub { font-size: 10px; }
  .keep { break-inside: avoid; page-break-inside: avoid; }
  .item { font-weight: 600; }
  .sub { color: #52606d; font-size: 10.5px; margin-top: 1px; white-space: pre-wrap; }

  .totals-wrap { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-top: 12px; }
  .words { flex: 1; padding: 9px 12px; border: 1px dashed #bcccdc; border-radius: 6px; }
  .words .value { font-weight: 600; font-style: italic; }
  .totals { width: 245px; }
  .trow { display: flex; justify-content: space-between; padding: 4px 2px; }
  .trow.grand { margin-top: 4px; padding: 8px 10px; background: #1e3a5f; color: #fff; border-radius: 6px; font-size: 13.5px; font-weight: 700; }

  .notes { margin-top: 12px; padding: 9px 12px; border: 1px solid #e4e7eb; border-radius: 6px; }
  .notes .value { font-weight: 500; white-space: pre-wrap; }

  .section { margin-top: 18px; font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #1e3a5f; font-weight: 700;
    display: flex; align-items: center; gap: 8px; }
  .section:after { content: ""; flex: 1; border-top: 1px solid #d9e2ec; }
  .sigs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 16px; margin-top: 10px; }
  .sig { text-align: center; }
  .sig-area { height: 62px; display: flex; align-items: flex-end; justify-content: center; }
  .sig-area img { max-height: 60px; max-width: 100%; object-fit: contain; }
  .typed { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 20px; color: #1e3a5f; }
  .signed-mark { font-size: 9.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #1e6b3a; border: 1px solid #9fd3b1; border-radius: 4px; padding: 2px 8px; margin-bottom: 6px; }
  .sig-line { border-top: 1px solid #52606d; margin: 3px 6px 4px; }
  .sig-name { font-weight: 600; font-size: 11px; }
  .sig-role { font-size: 9.5px; color: #52606d; text-transform: uppercase; letter-spacing: .5px; margin-top: 1px; }
  .sig-date { font-size: 9.5px; color: #7b8794; margin-top: 1px; }
  .sig.pending .sig-name, .sig.pending .sig-date { color: #9aa5b1; }
  .stamps { display: flex; gap: 16px; margin-top: 12px; }
  .stamp { flex: 1; text-align: center; border: 1px solid #e4e7eb; border-radius: 6px; padding: 8px; }
  .stamp img { max-height: 80px; max-width: 100%; object-fit: contain; }

  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d9e2ec; display: flex; justify-content: space-between; font-size: 9.5px; color: #7b8794; }
</style></head><body>
<div class="doc${(ca.items || []).length > 12 ? ' dense' : ''}" id="doc">
  <div class="head">
    <div>
      <div class="org">${esc(company || 'Cash Approval')}</div>
      <div class="dept">${esc(ca.requestingDepartment || 'General')}</div>
    </div>
    <div class="title">
      <div class="ref">${esc(ca.caNumber)}</div>
      <span class="pill ${tone}">${esc(ca.status || '')}</span>
    </div>
  </div>

  <div class="grid">
    <div class="cell"><div class="label">Date</div><div class="value">${esc(formatInvoiceDateDmy(ca.approvalDate || ca.createdAt))} · ${esc(formatInvoiceTime12h(ca.createdAt))}</div></div>
    <div class="cell"><div class="label">Department</div><div class="value">${esc(dash(ca.requestingDepartment))}</div></div>
    <div class="cell"><div class="label">Priority</div><div class="value">${esc(dash(ca.priority))}</div></div>
    <div class="cell"><div class="label">Advance to</div><div class="value">${esc(advanceEmployeeLabel(ca))}</div></div>
    <div class="cell"><div class="label">Finance company</div><div class="value">${esc(dash(company))}</div></div>
    <div class="cell"><div class="label">GL account</div><div class="value">${esc(dash(glAccount))}</div></div>
  </div>

  <div class="narration"><div class="label">Narration</div><div class="value">${esc(dash(ca.purpose))}</div></div>

  <table class="items">
    <thead><tr>
      <th class="c" style="width:5%">#</th><th style="width:37%">Item / description</th><th style="width:14%">Location</th>
      <th class="c" style="width:7%">Unit</th><th class="r" style="width:9%">Qty</th><th class="r" style="width:13%">Rate</th><th class="r" style="width:15%">Amount (PKR)</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="c muted">No line items</td></tr>'}</tbody>
  </table>

  <div class="keep">
  <div class="totals-wrap">
    <div class="words"><div class="label">Amount in words</div><div class="value">${esc(numberToWords(netTotal))}</div></div>
    <div class="totals">
      <div class="trow"><span class="muted">Sub total</span><span class="num">${formatDecimalPk(linesTotal)}</span></div>
      ${Number(ca.discountAmount) > 0 ? `<div class="trow"><span class="muted">Discount</span><span class="num">-${formatDecimalPk(ca.discountAmount)}</span></div>` : ''}
      <div class="trow grand"><span>Net total</span><span class="num">PKR ${formatDecimalPk(netTotal)}</span></div>
    </div>
  </div>

  ${ca.notes ? `<div class="notes"><div class="label">Notes</div><div class="value">${esc(ca.notes)}</div></div>` : ''}
  </div>

  <div class="keep">
  <div class="section">Approvals</div>
  <div class="sigs">${signatures}</div>
  ${stamps}
  </div>

</div>
</body></html>`;
};

/**
 * Opens the A4 print page, waits for signature images, shrinks it to one page if it is taller (down to 70%),
 * then prints.
 */
export const printGeneralCashApproval = (ca, onError) => {
  const html = buildGeneralCashApprovalPrintHtml(ca);
  const w = window.open('', '_blank');
  if (!w) {
    onError?.('Allow pop-ups to print');
    return;
  }
  // Tovus ERP branding: header, pinned footer, A4 portrait, shared one-page auto-fit (never cuts)
  w.document.write(brandPrintHtml(html, { title: 'Cash Approval', docRef: ca.caNumber }));
  w.document.close();

  const fitAndPrint = () => {
    // re-fit now that signature images have their real size (shared Tovus fit)
    try { if (typeof w.tovusFit === 'function') w.tovusFit(); } catch { /* ignore */ }
    w.focus();
    w.print();
    w.close();
  };

  const images = [...w.document.images];
  const pending = images.filter((img) => !img.complete);
  if (!pending.length) {
    setTimeout(fitAndPrint, 150);
    return;
  }
  let left = pending.length;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    setTimeout(fitAndPrint, 100);
  };
  pending.forEach((img) => {
    const tick = () => { left -= 1; if (left <= 0) finish(); };
    img.addEventListener('load', tick, { once: true });
    img.addEventListener('error', tick, { once: true });
  });
  // Never wait forever on a slow image
  setTimeout(finish, 3000);
};

export const documentPaperSx = {
  maxWidth: 1050,
  mx: 'auto',
  p: { xs: 2.25, md: 5 },
  bgcolor: 'background.paper',
  color: '#151515',
  borderRadius: 1.5,
  border: '1px solid',
  borderColor: 'grey.200',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)'
};

export const lineTableSx = {
  border: '1px solid',
  borderColor: 'grey.500',
  '& th': {
    bgcolor: 'grey.100',
    border: '1px solid',
    borderColor: 'grey.500',
    fontSize: 11,
    fontWeight: 800,
    textAlign: 'center',
    lineHeight: 1.2,
    py: 1,
    px: 0.5
  },
  '& td': {
    border: '1px solid',
    borderColor: 'grey.400',
    fontSize: 12,
    py: 1,
    px: 0.75,
    verticalAlign: 'top'
  }
};

export const approvalTableSx = {
  mt: 7,
  border: '1px solid',
  borderColor: 'grey.300',
  '& th': {
    bgcolor: 'grey.100',
    fontWeight: 800,
    fontSize: 14,
    borderBottom: '1px solid',
    borderColor: 'grey.300'
  },
  '& td': {
    fontSize: 14,
    borderBottom: '1px solid',
    borderColor: 'grey.200',
    py: 1.4
  },
  '& tr:last-child td': {
    borderBottom: 0
  }
};
