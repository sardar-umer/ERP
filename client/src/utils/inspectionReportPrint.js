import { openPrintHtml } from './employeeFormPrint';
import { getImageUrl } from './imageService';

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

const date = (v, withTime = false) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return escapeHtml(d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }));
};

const absoluteUrl = (path) => {
  const url = getImageUrl(path);
  if (!url) return '';
  return /^https?:|^data:|^blob:/.test(url) ? url : `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
};

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
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .value { font-weight: 600; margin-top: 2px; }
  h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; }
  td.r, th.r { text-align: right; }
  .note { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px; min-height: 30px; white-space: pre-wrap; }
  .signers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 10px; }
  .signer { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; page-break-inside: avoid; }
  .signer .sig { height: 64px; display: flex; align-items: flex-end; justify-content: center; border-bottom: 1px solid #1f2937; margin: 6px 0 4px; }
  .signer .sig img { max-height: 60px; max-width: 100%; object-fit: contain; }
  .ok { color: #15803d; font-weight: 700; }
  .bad { color: #b91c1c; font-weight: 700; }
  .wait { color: #b45309; font-weight: 700; }
  .obs { margin-top: 4px; font-size: 11px; white-space: pre-wrap; }
  .evidence { page-break-inside: avoid; margin-top: 10px; }
  .evidence .photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .evidence .photos img { width: 120px; height: 90px; object-fit: cover; border: 1px solid #d1d5db; border-radius: 3px; }
  .evidence .video { font-size: 11px; margin-top: 4px; word-break: break-all; }
`;

/** A4 inspection report with every inspector's decision, observations and profile signature. */
export const buildInspectionReportPrintHtml = ({ report, mainProject, subProject, sector, contractLabel }) => {
  const cr = report.checkRequest || {};
  const isSlab = report.claimType === 'Slab';
  const workHtml = isSlab
    ? `<table><thead><tr><th>Slab (stage)</th><th class="r">Share</th><th class="r">Amount</th></tr></thead>
        <tbody><tr><td><strong>${display(report.slab?.name)}</strong></td><td class="r">${escapeHtml(report.slab?.percentage ?? 0)}%</td>
        <td class="r">${money(report.slab?.amount)}</td></tr></tbody></table>`
    : `<table><thead><tr><th style="width:28px">#</th><th>Item</th><th class="r">Claimed</th><th class="r">Inspected</th>
        <th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
        ${(report.items || []).map((i, idx) => `<tr><td>${idx + 1}</td><td>${display(i.title)}</td>
          <td class="r">${escapeHtml(i.claimedQuantity)} ${escapeHtml(i.unit)}</td>
          <td class="r"><strong>${escapeHtml(i.inspectedQuantity)} ${escapeHtml(i.unit)}</strong></td>
          <td class="r">${money(i.unitPrice)}</td><td class="r">${money((Number(i.inspectedQuantity) || 0) * (Number(i.unitPrice) || 0))}</td></tr>`).join('')}
        </tbody></table>`;

  const statusClass = (s) => (s === 'Approved' ? 'ok' : s === 'Rejected' ? 'bad' : 'wait');
  const signersHtml = (report.inspectors || []).map((i) => {
    const sigUrl = i.signature ? absoluteUrl(i.signature) : '';
    return `<div class="signer">
      <div class="value">${display(i.name || [i.user?.firstName, i.user?.lastName].filter(Boolean).join(' '))}</div>
      <div class="muted">${display(i.designation)}</div>
      <div class="sig">${sigUrl ? `<img src="${escapeHtml(sigUrl)}" alt="Signature" />` : '<span class="muted">Not signed</span>'}</div>
      <div class="${statusClass(i.status)}">${escapeHtml(i.status)}</div>
      <div class="muted">${i.actedAt ? date(i.actedAt, true) : ''}</div>
      ${i.observations ? `<div class="obs"><span class="label">Observations</span><br />${escapeHtml(i.observations)}</div>` : ''}
    </div>`;
  }).join('');

  const evidenceHtml = (report.inspectors || [])
    .filter((i) => (i.attachments || []).length)
    .map((i) => {
      const photos = i.attachments.filter((a) => a.kind === 'image');
      const videos = i.attachments.filter((a) => a.kind === 'video');
      return `<div class="evidence">
        <div class="value">${display(i.name)} — ${photos.length} photo(s), ${videos.length} video(s)</div>
        <div class="photos">${photos.map((a) => `<img src="${escapeHtml(absoluteUrl(a.url))}" alt="${escapeHtml(a.originalName)}" />`).join('')}</div>
        ${videos.map((a) => `<div class="video">Video: ${escapeHtml(a.originalName || 'site video')} — ${escapeHtml(absoluteUrl(a.url))}</div>`).join('')}
      </div>`;
    }).join('');

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${display(report.reportNumber)}</title>
    <style>${STYLES}</style></head><body>
    <div class="head">
      <div>
        <h1>Inspection Report</h1>
        <div class="muted">For check request ${display(cr.checkRequestNumber)} — ${display(cr.title)}</div>
        ${contractLabel ? `<div class="contract">${escapeHtml(contractLabel)}</div>` : ''}
      </div>
      <div class="num">${display(report.reportNumber)}
        <div><span class="badge">${display(report.status)}</span></div>
        <div class="muted" style="font-weight:400;margin-top:4px">Inspected: ${date(report.inspectionDate)}</div>
      </div>
    </div>

    <div class="grid">
      <div><div class="label">Main Project</div><div class="value">${display(mainProject)}</div></div>
      <div><div class="label">Sub Project</div><div class="value">${display(subProject)}</div></div>
      <div><div class="label">Sector</div><div class="value">${display(sector)}</div></div>
      <div><div class="label">Subcontractor</div><div class="value">${display(cr.contractor?.name)}</div></div>
      <div><div class="label">Claim basis</div><div class="value">${isSlab ? 'Slab wise (stage payment)' : 'BOQ wise (quantities)'}</div></div>
      <div><div class="label">Location</div><div class="value">${display(report.location)}</div></div>
    </div>

    <h2>Work inspected</h2>
    ${workHtml}
    <div style="text-align:right;margin-top:8px;font-size:13px">Inspected value: <strong>${money(report.inspectedTotal)}</strong></div>

    <h2>Remarks</h2>
    <div class="note">${display(report.remarks)}</div>

    <h2>Inspectors</h2>
    <div class="signers">${signersHtml}</div>

    ${evidenceHtml ? `<h2>Site evidence</h2>${evidenceHtml}` : ''}

    <div class="muted" style="margin-top:14px;font-size:10px">
      Prepared by ${display([report.createdBy?.firstName, report.createdBy?.lastName].filter(Boolean).join(' '))} on ${date(report.createdAt, true)}.
      Signatures are the inspectors' profile signatures, stamped when each decision was recorded.
    </div>
  </body></html>`;
};

export const printInspectionReport = (args) => openPrintHtml(buildInspectionReportPrintHtml(args));
