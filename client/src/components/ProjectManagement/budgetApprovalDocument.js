import dayjs from 'dayjs';
import { getImageUrl } from '../../utils/imageService';
import { numberToWords } from '../../utils/numberToWords';

/**
 * The Main Project budget as one self-contained HTML document (same style as the IPC certificate).
 * Shown in an iframe on the budget page, the approvers' page and in every IPC review file; "Print" prints the same page.
 *
 * Input shape (from the IPC dossier's `budget`, or `budgetDocFromView` for the budget request API):
 * { documentNo, status, amount, purpose, notes, revision, preparedByName, submittedAt, approvedAt,
 *   lines: [{ name, scope, utilized, amount }],   (utilized = spent before the ERP; total = utilized + amount) approvers: [{ role, name, designation, status, remarks, signature, actedAt }],
 *   project: { name, projectNumber, projectType, contractBasis, society, sector, address, startDate, expectedEndDate, clientName } }
 */

const money = (v) => new Intl.NumberFormat('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v || 0));
const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const para = (text) => esc(text).replace(/\n/g, '<br>');

export const BUDGET_STATUS_TEXT = {
  Draft: 'Draft — not submitted',
  Submitted: 'In approval',
  Approved: 'Approved'
};

/** Budget request API view → document shape */
export const budgetDocFromView = (view) => {
  const r = view?.request || {};
  // A revision of an approved budget: show what each line was approved at before
  const before = view?.approved && view?.status !== 'Approved'
    ? new Map((view.approved.lines || []).map((l) => [String(l.subProject), Number(l.amount) || 0]))
    : null;
  // What the project team asked for, before approvers cut or added
  const requested = new Map((r.submittedLines || []).map((l) => [String(l.subProject), Number(l.amount) || 0]));
  const lines = (r.lines || [])
    .filter((l) => Number(l.amount) > 0 || Number(l.utilized) > 0 || l.scope || before?.get(String(l.subProject)) || requested.get(String(l.subProject)))
    .map((l) => ({
      ...l,
      ...(before ? { previous: before.get(String(l.subProject)) || 0 } : {}),
      ...(requested.has(String(l.subProject)) ? { requested: requested.get(String(l.subProject)) } : {})
    }));
  return {
    documentNo: view?.documentNo,
    status: view?.status,
    amount: view?.status === 'Approved' || view?.status === 'Submitted'
      ? view.amount
      : lines.reduce((t, l) => t + (Number(l.amount) || 0), 0),
    purpose: r.purpose,
    notes: r.notes,
    revision: r.revision || 0,
    preparedByName: r.preparedByName,
    submittedAt: r.submittedAt,
    approvedAt: view?.approvedAt,
    lines,
    approvers: r.approvers || [],
    returned: r.returned?.at ? r.returned : null,
    previousTotal: before ? Number(view.approved.amount) || 0 : null,
    previousNo: before ? view.approvedDocumentNo : null,
    project: view?.project || {},
    company: view?.company || null
  };
};

const CSS = `
  *{box-sizing:border-box}
  html,body{margin:0}
  body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#18181b;font-size:12px;line-height:1.5;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums}
  .screen{background:#eceef1;padding:28px 16px}
  .sheet{background:#fff;max-width:820px;margin:0 auto;padding:52px 60px 40px;position:relative}
  .screen .sheet{border:1px solid #dcdfe4}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:18px;border-bottom:2px solid #18181b}
  .org-name{font-size:17px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
  .org-meta{color:#71717a;font-size:11px;margin-top:3px}
  .doc{text-align:right}
  .doc-title{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#52525b}
  .doc-no{font-size:22px;font-weight:300;line-height:1.15;margin-top:4px}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #e4e4e7}
  .meta div{padding:12px 0}
  .lbl{display:block;font-size:9.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#71717a;margin-bottom:3px}
  .val{font-size:12.5px;font-weight:500}
  .facts{display:grid;grid-template-columns:1fr 1fr;gap:12px 40px;padding:18px 0;border-bottom:1px solid #e4e4e7}
  .facts .name{font-size:13.5px;font-weight:600}
  h2{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:26px 0 8px;color:#18181b}
  h2 span{color:#a1a1aa;margin-right:8px}
  p.text{margin:0;color:#27272a;font-size:12.5px}
  table{width:100%;border-collapse:collapse}
  th{font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#71717a;text-align:left;padding:0 8px 6px;border-bottom:1px solid #18181b}
  td{padding:8px;border-bottom:1px solid #e4e4e7;vertical-align:top}
  th:first-child,td:first-child{padding-left:0}th:last-child,td:last-child{padding-right:0}
  .r{text-align:right;white-space:nowrap}.muted{color:#71717a}
  tr.total td{border-top:2px solid #18181b;border-bottom:0;font-weight:700;font-size:14px;padding-top:10px}
  .words{margin-top:14px;padding:10px 14px;border-left:2px solid #18181b;background:#f7f7f8;font-size:11.5px}
  .sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:18px}
  .sig .img{height:54px;display:flex;align-items:flex-end}
  .sig img{max-height:52px;max-width:100%;object-fit:contain}
  .sig .line{border-top:1px solid #18181b;margin-top:6px;padding-top:6px}
  .sig .who{font-weight:600;min-height:18px}
  .sig .when{color:#71717a;font-size:11px;min-height:16px}
  .sig .rem{color:#3f3f46;font-size:11px;margin-top:4px;font-style:italic}
  .chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:.04em}
  .ok{background:#dcfce7;color:#166534}.wait{background:#fef3c7;color:#92400e}.no{background:#fee2e2;color:#991b1b}.idle{background:#f4f4f5;color:#71717a}
  .returned{margin-top:14px;padding:10px 14px;border-left:3px solid #dc2626;background:#fef2f2;font-size:12px}
  .stamp{position:absolute;top:150px;right:60px;transform:rotate(-12deg);border:3px solid;padding:6px 14px;font-weight:800;letter-spacing:.14em;font-size:15px;text-transform:uppercase;opacity:.85}
  .stamp.ok{color:#15803d;border-color:#15803d;background:transparent}.stamp.wait{color:#b45309;border-color:#b45309;background:transparent}.stamp.idle{color:#a1a1aa;border-color:#a1a1aa;background:transparent}
  .foot{display:flex;justify-content:space-between;margin-top:36px;padding-top:10px;border-top:1px solid #e4e4e7;color:#a1a1aa;font-size:10px}
  @media print{.screen{background:#fff;padding:0}.sheet{max-width:none;padding:0;border:0}.stamp{top:110px;right:0}@page{size:A4;margin:16mm 15mm}}
`;

const approverChip = (a, isCurrent) => {
  if (a.status === 'Approved') return '<span class="chip ok">APPROVED</span>';
  if (a.status === 'Rejected') return '<span class="chip no">RETURNED</span>';
  return isCurrent ? '<span class="chip wait">AWAITING</span>' : '<span class="chip idle">PENDING</span>';
};

/** @param {object} b budget document (see top) @param {{ print?: boolean, company?: object }} opts */
export const budgetDocumentHtml = (b, { print = false, company = null } = {}) => {
  const co = company || b.company || {};
  const p = b.project || {};
  const contact = [co.contactInfo?.address, co.contactInfo?.phone, co.contactInfo?.email].filter(Boolean).join('  ·  ');
  const total = (b.lines || []).reduce((t, l) => t + (Number(l.amount) || 0), 0) || b.amount;
  // Ongoing projects: what was already utilized before the ERP, shown next to the remaining budget
  const utilizedTotal = (b.lines || []).reduce((t, l) => t + (Number(l.utilized) || 0), 0);
  const hasUtilized = utilizedTotal > 0;
  const grandTotal = total + utilizedTotal;
  const firstWaiting = b.status === 'Submitted' ? (b.approvers || []).findIndex((a) => a.status === 'Pending') : -1;
  const stamp = b.status === 'Approved' ? '<div class="stamp ok">Approved</div>'
    : b.status === 'Submitted' ? '<div class="stamp wait">In approval</div>' : '<div class="stamp idle">Draft</div>';

  // Revisions show the approved amount before and the change on every line
  const isRevision = b.previousTotal != null;
  const change = (now, was) => {
    const d = (Number(now) || 0) - (Number(was) || 0);
    if (!d) return '<span class="muted">—</span>';
    return `<span style="font-weight:600;color:${d > 0 ? '#b45309' : '#15803d'}">${d > 0 ? '+' : '−'}${money(Math.abs(d))}</span>`;
  };
  // Approvers cut or added: show what was asked for next to the amount now
  const adjusted = (b.lines || []).some((l) => l.requested != null && Math.abs((Number(l.requested) || 0) - (Number(l.amount) || 0)) >= 0.005);
  const requestedTotal = (b.lines || []).reduce((t, l) => t + (Number(l.requested ?? l.amount) || 0), 0);
  const amountHead = hasUtilized
    ? (b.status === 'Approved' ? 'Remaining approved (PKR)' : adjusted ? 'Remaining after changes (PKR)' : isRevision ? 'Revised remaining (PKR)' : 'Remaining budget (PKR)')
    : (b.status === 'Approved' ? 'Approved (PKR)' : adjusted ? 'After changes (PKR)' : isRevision ? 'Revised (PKR)' : 'Budget (PKR)');
  const showShare = !(isRevision || adjusted);
  const lines = (b.lines || []).length
    ? `<table><thead><tr><th style="width:28px">#</th><th>Sub project</th><th>Scope of work covered</th>
        ${hasUtilized ? '<th class="r">Already utilized</th>' : ''}
        ${isRevision ? '<th class="r">Approved before</th>' : ''}
        ${adjusted ? '<th class="r">Requested</th>' : ''}
        ${isRevision ? '<th class="r">Change</th>' : ''}
        <th class="r">${amountHead}</th>${hasUtilized ? '<th class="r">Total budget</th>' : ''}${showShare ? '<th class="r">Share</th>' : ''}</tr></thead><tbody>
      ${b.lines.map((l, i) => `<tr><td class="muted">${i + 1}</td>
        <td style="font-weight:600">${esc(l.name)}${isRevision && !l.previous ? ' <span class="chip wait">NEW</span>' : ''}</td>
        <td>${para(l.scope) || '<span class="muted">—</span>'}</td>
        ${hasUtilized ? `<td class="r muted">${Number(l.utilized) ? money(l.utilized) : '—'}</td>` : ''}
        ${isRevision ? `<td class="r muted">${l.previous ? money(l.previous) : '—'}</td>` : ''}
        ${adjusted ? `<td class="r muted">${money(l.requested ?? l.amount)}</td>` : ''}
        ${isRevision ? `<td class="r">${change(l.amount, l.previous)}</td>` : ''}
        <td class="r"${adjusted && Math.abs((Number(l.requested ?? l.amount) || 0) - (Number(l.amount) || 0)) >= 0.005 ? ' style="font-weight:700"' : ''}>${money(l.amount)}</td>
        ${hasUtilized ? `<td class="r" style="font-weight:600">${money((Number(l.utilized) || 0) + (Number(l.amount) || 0))}</td>` : ''}
        ${showShare ? `<td class="r muted">${grandTotal ? Math.round((((Number(l.utilized) || 0) + (Number(l.amount) || 0)) / grandTotal) * 100) : 0}%</td>` : ''}</tr>`).join('')}
      <tr class="total"><td></td><td colspan="2">${isRevision || adjusted || b.status === 'Approved' ? 'Total' : 'Total budget requested'}</td>
        ${hasUtilized ? `<td class="r">${money(utilizedTotal)}</td>` : ''}
        ${isRevision ? `<td class="r">${money(b.previousTotal)}</td>` : ''}
        ${adjusted ? `<td class="r muted">${money(requestedTotal)}</td>` : ''}
        ${isRevision ? `<td class="r">${change(total, b.previousTotal)}</td>` : ''}
        <td class="r">${money(total)}</td>${hasUtilized ? `<td class="r">${money(grandTotal)}</td>` : ''}${showShare ? '<td></td>' : ''}</tr>
      </tbody></table>`
    : '<p class="text muted">No sub project lines yet.</p>';

  const sigs = (b.approvers || []).map((a, i) => `<div class="sig">
      <div class="img">${a.status === 'Approved' && a.signature ? `<img src="${esc(getImageUrl(a.signature))}" alt="">` : ''}</div>
      <div class="line"><span class="lbl">${esc(a.role)} ${approverChip(a, i === firstWaiting)}</span>
        <div class="who">${esc(a.name)}</div>
        <div class="when">${a.actedAt && a.status !== 'Pending' ? `${a.status === 'Approved' ? 'Approved' : 'Returned'} ${day(a.actedAt)}` : (a.designation ? esc(a.designation) : '')}</div>
        ${(a.changes || []).length ? `<div class="rem" style="font-style:normal;color:#6d28d9"><b>Changed:</b> ${a.changes.map((c) => `${esc(c.name)} ${money(c.from)} → ${money(c.to)}`).join('; ')}</div>` : ''}
        ${a.remarks ? `<div class="rem">“${esc(a.remarks)}”</div>` : ''}</div>
    </div>`).join('');

  const body = `<div class="sheet">
    ${stamp}
    <div class="top">
      <div><div class="org-name">${esc(co.name || '')}</div>${contact ? `<div class="org-meta">${esc(contact)}</div>` : ''}</div>
      <div class="doc"><div class="doc-title">Project Budget Approval</div><div class="doc-no">${esc(b.documentNo || '')}</div></div>
    </div>
    <div class="meta">
      <div><span class="lbl">Project no.</span><span class="val">${esc(p.projectNumber || '—')}</span></div>
      <div><span class="lbl">Revision</span><span class="val">${b.revision || '—'}</span></div>
      <div><span class="lbl">Submitted</span><span class="val">${day(b.submittedAt)}</span></div>
      <div><span class="lbl">Status</span><span class="val">${esc(BUDGET_STATUS_TEXT[b.status] || b.status || '')}${b.status === 'Approved' && b.approvedAt ? `, ${day(b.approvedAt)}` : ''}</span></div>
    </div>
    <div class="facts">
      <div><span class="lbl">Project</span><div class="name">${esc(p.name || '')}</div><div class="muted">${esc([p.society, p.sector, p.address].filter(Boolean).join(', '))}</div></div>
      <div><span class="lbl">Type · contracts</span><div class="name">${esc(p.projectType || '—')}</div><div class="muted">${p.contractBasis ? (p.contractBasis === 'Slab' ? 'Slab-wise contracts' : 'BOQ-wise contracts') : ''}</div></div>
      <div><span class="lbl">Timeline</span><div class="name">${day(p.startDate)} → ${day(p.expectedEndDate)}</div></div>
      <div><span class="lbl">Prepared by</span><div class="name">${esc(b.preparedByName || '—')}</div>${p.clientName ? `<div class="muted">Client: ${esc(p.clientName)}</div>` : ''}</div>
    </div>

    ${isRevision ? `<div class="returned" style="border-left-color:#b45309;background:#fffbeb"><b>Revision of ${esc(b.previousNo || 'the approved budget')}</b> (${money(b.previousTotal)} approved). The approved budget stays in force until this revision is approved.</div>` : ''}
    <h2><span>1</span>Purpose and scope</h2>
    <p class="text">${para(b.purpose) || '<span class="muted">Not written yet.</span>'}</p>

    <h2><span>2</span>Budget by sub project</h2>
    ${lines}
    ${hasUtilized ? `<p class="text" style="margin-top:10px;font-size:12px"><b>Total budget ${money(grandTotal)}</b> = already utilized ${money(utilizedTotal)} (spent before this project came into the ERP) + remaining ${money(total)} (available for new contracts).</p>` : ''}
    <div class="words">Total${hasUtilized ? ' budget' : ''} in words: <b>${esc(numberToWords(Math.round(grandTotal || 0)))}</b></div>
    <p class="text muted" style="margin-top:8px;font-size:11px">Approvers may cut or add amounts; the amounts after the final (CEO) approval are the budget. Each sub project receives its amount as its budget, and its sublet contracts cannot exceed it.</p>

    ${b.notes ? `<h2><span>3</span>Assumptions and remarks</h2><p class="text">${para(b.notes)}</p>` : ''}

    <h2><span>${b.notes ? 4 : 3}</span>Approval</h2>
    <p class="text muted" style="font-size:11px">Approved one after another in the order below; the last signature puts the budget in force.</p>
    ${b.returned ? `<div class="returned"><b>Returned by ${esc(b.returned.name)} (${esc(b.returned.role)}) on ${day(b.returned.at)}:</b> ${esc(b.returned.remarks)}</div>` : ''}
    <div class="sigs">${sigs || '<p class="text muted">No approvers chosen yet.</p>'}</div>

    <div class="foot"><span>Project Budget Approval ${esc(b.documentNo || '')}</span><span>Generated ${dayjs().format('DD MMM YYYY, hh:mm A')}</span></div>
  </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.documentNo || 'Budget')}</title><style>${CSS}</style></head>
    <body class="${print ? '' : 'screen'}">${body}${print ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>' : ''}</body></html>`;
};

/** Opens the budget document in a print window; false when pop-ups are blocked */
export const printBudgetDocument = (b, opts = {}) => {
  const w = window.open('', '_blank', 'width=960,height=1100');
  if (!w) return false;
  w.document.open();
  w.document.write(budgetDocumentHtml(b, { ...opts, print: true }));
  w.document.close();
  return true;
};
