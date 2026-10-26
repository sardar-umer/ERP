import { openPrintHtml } from './employeeFormPrint';

const escapeHtml = (value) => {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const display = (value) => (value == null || String(value).trim() === '' ? '—' : escapeHtml(value));

const money = (v) =>
  escapeHtml(new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v) || 0));

const date = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : escapeHtml(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
};

const qty = (v, unit) => `${escapeHtml((Number(v) || 0).toLocaleString('en-PK'))} ${escapeHtml(unit || '')}`.trim();

const STYLES = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f2937; padding-bottom: 10px; }
  .head h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #6b7280; }
  .num { font-size: 15px; font-weight: 700; text-align: right; }
  .badge { display: inline-block; border: 1px solid #6b7280; border-radius: 12px; padding: 2px 10px; font-size: 11px; font-weight: 700; margin-top: 4px; }
  .contract { display: inline-block; border: 1.5px solid #1f2937; border-radius: 14px; padding: 3px 12px; font-weight: 700; margin: 10px 0 2px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin: 12px 0; }
  .grid .label { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .grid .value { font-weight: 600; margin-top: 2px; }
  h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; }
  td.r, th.r { text-align: right; }
  .totals { margin-top: 10px; display: flex; justify-content: flex-end; gap: 28px; font-size: 13px; }
  .totals strong { font-size: 14px; }
  .chips span { display: inline-block; border: 1px solid #d1d5db; border-radius: 10px; padding: 2px 8px; margin: 2px 4px 2px 0; font-size: 11px; }
  .note { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px; min-height: 36px; white-space: pre-wrap; }
  .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 48px; }
  .sig { border-top: 1px solid #1f2937; padding-top: 4px; text-align: center; font-size: 11px; }
  .draft { color: #b45309; font-weight: 700; }
`;

/**
 * Printable Check Request (A4). `doc` is a plain summary built by the screen, so drafts that
 * are not saved yet print the same way as saved requests.
 */
export const buildCheckRequestPrintHtml = (doc) => {
  const isSlab = doc.claimType === 'Slab';
  const linesHtml = isSlab
    ? `
      <h2>Slab (stage) claimed</h2>
      <table>
        <thead><tr><th>Stage</th><th class="r">Share of contract</th><th class="r">Amount</th></tr></thead>
        <tbody><tr>
          <td><strong>${display(doc.slab?.name)}</strong></td>
          <td class="r">${escapeHtml(doc.slab?.percentage ?? 0)}%</td>
          <td class="r">${money(doc.slab?.amount)}</td>
        </tr></tbody>
      </table>
      <div style="margin-top:8px"><span class="muted">Work covered by this stage:</span>
        <div class="chips">${(doc.slab?.activities || []).map((a) => `<span>${escapeHtml(a.name)}</span>`).join('') || '<span>—</span>'}</div>
      </div>`
    : `
      <h2>BOQ lines claimed</h2>
      <table>
        <thead><tr>
          <th style="width:28px">#</th><th>Item</th><th class="r">Claimed</th><th class="r">Verified</th>
          <th class="r">Rate</th><th class="r">Amount</th>
        </tr></thead>
        <tbody>
          ${(doc.lines || []).map((l, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${display(l.label)}</td>
              <td class="r">${qty(l.claimed, l.unit)}</td>
              <td class="r">${l.verified == null ? '—' : qty(l.verified, l.unit)}</td>
              <td class="r">${money(l.rate)}</td>
              <td class="r">${money((Number(l.claimed) || 0) * (Number(l.rate) || 0))}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">No lines</td></tr>'}
        </tbody>
      </table>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${display(doc.number || 'Check Request')}</title>
    <style>${STYLES}</style></head><body>
    <div class="head">
      <div>
        <h1>Check Request</h1>
        <div class="muted">${display(doc.title)}</div>
        ${doc.contractLabel ? `<div class="contract">${escapeHtml(doc.contractLabel)}</div>` : ''}
      </div>
      <div class="num">
        ${doc.number ? escapeHtml(doc.number) : '<span class="draft">DRAFT — not saved</span>'}
        <div><span class="badge">${display(doc.status || 'Draft')}</span></div>
        <div class="muted" style="font-weight:400;margin-top:4px">Date: ${date(doc.date || new Date())}</div>
      </div>
    </div>

    <div class="grid">
      <div><div class="label">Main Project</div><div class="value">${display(doc.mainProject)}</div></div>
      <div><div class="label">Sub Project</div><div class="value">${display(doc.subProject)}</div></div>
      <div><div class="label">Sector</div><div class="value">${display(doc.sector)}</div></div>
      <div><div class="label">Subcontractor</div><div class="value">${display(doc.contractorName)}</div></div>
      <div><div class="label">Claim basis</div><div class="value">${isSlab ? 'Slab wise (stage payment)' : 'BOQ wise (quantities)'}</div></div>
      <div><div class="label">WBS Activity</div><div class="value">${display(doc.activityLabel)}</div></div>
    </div>

    ${linesHtml}

    <div class="totals">
      <div>Claimed: <strong>${money(doc.claimedTotal)}</strong></div>
      <div>Verified: <strong>${doc.verifiedTotal ? money(doc.verifiedTotal) : '—'}</strong></div>
    </div>

    ${doc.verifiedBy ? `<h2>Verification</h2><div>Verified by <strong>${escapeHtml(doc.verifiedBy)}</strong> on ${date(doc.verifiedAt)}${doc.verificationNotes ? ` — ${escapeHtml(doc.verificationNotes)}` : ''}</div>` : ''}
    ${doc.rejectionReason ? `<h2>Rejected</h2><div>${escapeHtml(doc.rejectionReason)}</div>` : ''}

    <h2>Notes</h2>
    <div class="note">${display(doc.notes)}</div>

    <div class="sigs">
      <div class="sig">Prepared by</div>
      <div class="sig">Site Engineer / Auditor</div>
      <div class="sig">Project Manager</div>
    </div>
  </body></html>`;
};

export const printCheckRequest = (doc) => openPrintHtml(buildCheckRequestPrintHtml(doc));
