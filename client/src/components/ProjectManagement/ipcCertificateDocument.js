import dayjs from 'dayjs';
import { getImageUrl } from '../../utils/imageService';
import { numberToWords } from '../../utils/numberToWords';
import { ipcStageText } from './IpcApprovalTrail';

/**
 * The payment certificate as one self-contained HTML document. The review dialog shows it in an iframe and
 * "Print certificate" prints the same page, so screen and paper always match.
 */

export const money = (v) => new Intl.NumberFormat('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v || 0));
export const pkr = (v) => `PKR ${money(v)}`;
export const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
export const person = (u) => (u && typeof u === 'object' ? [u.firstName, u.lastName].filter(Boolean).join(' ') : (u || ''));
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const certificateTitle = (ipc) => {
  if (ipc?.invoiceType === 'Client_Invoice') return 'Client Invoice';
  if (ipc?.ipcKind === 'Advance') return 'Advance Payment Certificate';
  if (ipc?.ipcKind === 'Retention Release') return 'Retention Release Certificate';
  return 'Interim Payment Certificate';
};

/** Deduction lines (only those that apply) */
export const moneyLines = (ipc) => [
  ['Gross value certified', ipc.grossAmount, false],
  [`Retention @ ${ipc.retentionPercentage || 0}%`, ipc.retentionAmount, true],
  ['Advance recovery', ipc.advanceRecoveryAmount, true],
  [`Withholding tax @ ${ipc.whtPercentage || 0}% (at payment)`, ipc.whtAmount, true]
].filter(([, v, neg]) => !neg || Number(v) > 0);

export const signatories = (ipc) => [
  { role: 'Prepared by', user: ipc.createdBy, at: ipc.submittedAt || ipc.createdAt },
  { role: 'Pre-Audit', user: ipc.preAuditInitialApprovedBy, at: ipc.preAuditInitialApprovedAt },
  { role: 'Audit Director', user: ipc.auditApprovedBy, at: ipc.auditApprovedAt },
  { role: 'Chief Executive Officer', user: ipc.ceoApprovedBy, at: ipc.ceoApprovedAt }
];

/** Supporting documents that travel with the certificate */
export const enclosures = (d) => [
  d.contract && `Sublet Contract ${d.contract.contractNumber}, ${d.contract.title} (${d.contract.contractType}-wise, ${pkr(d.contract.totalAmount)})`,
  d.checkRequest && `Check Request ${d.checkRequest.checkRequestNumber}, verified ${day(d.checkRequest.verifiedAt)}${d.checkRequest.verifiedBy ? ` by ${d.checkRequest.verifiedBy}` : ''}`,
  ...d.inspections.map((r) => {
    const files = r.inspectors.reduce((t, i) => t + i.attachments.length, 0);
    return `Inspection Report ${r.reportNumber}, ${r.status.toLowerCase()} ${day(r.inspectionDate)}${files ? `, with ${files} site photographs / videos` : ''}`;
  }),
  d.previousIpcs.length && `Statement of ${d.previousIpcs.length} earlier certificate(s) to this subcontractor`,
  ...[...(d.mainProject?.documents || []), ...(d.subProject?.documents || [])].map((doc) => `${doc.name} (${doc.category})`)
].filter(Boolean);

const CSS = `
  *{box-sizing:border-box}
  html,body{margin:0}
  body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#18181b;font-size:12px;line-height:1.5;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums}
  .screen{background:#eceef1;padding:28px 16px}
  .sheet{background:#fff;max-width:820px;margin:0 auto;padding:52px 60px 40px}
  .screen .sheet{border:1px solid #dcdfe4}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:18px;border-bottom:2px solid #18181b}
  .org-name{font-size:17px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
  .org-meta{color:#71717a;font-size:11px;margin-top:3px}
  .doc{text-align:right}
  .doc-title{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#52525b}
  .doc-no{font-size:26px;font-weight:300;line-height:1.1;margin-top:4px}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #e4e4e7}
  .meta div{padding:12px 0 12px;}
  .lbl{display:block;font-size:9.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#71717a;margin-bottom:3px}
  .val{font-size:12.5px;font-weight:500}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;padding:18px 0;border-bottom:1px solid #e4e4e7}
  .parties .blk{margin-bottom:12px}.parties .blk:last-child{margin-bottom:0}
  .parties .name{font-size:13.5px;font-weight:600}
  .parties .sub{color:#52525b}
  h2{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:26px 0 8px;color:#18181b}
  h2 span{color:#a1a1aa;margin-right:8px}
  table{width:100%;border-collapse:collapse}
  th{font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#71717a;text-align:left;
    padding:0 8px 6px;border-bottom:1px solid #18181b}
  td{padding:7px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top}
  th:first-child,td:first-child{padding-left:0}th:last-child,td:last-child{padding-right:0}
  .r{text-align:right;white-space:nowrap}.muted{color:#71717a}
  .note{padding:10px 0;border-bottom:1px solid #e4e4e7}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:0 40px}
  .rows .row{display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px solid #e4e4e7}
  .rows .row.strong{font-weight:600}
  .rows .row.neg span:last-child::before{content:"("}.rows .row.neg span:last-child::after{content:")"}
  .rows .total{display:flex;justify-content:space-between;align-items:baseline;padding:10px 0 0;margin-top:2px;border-top:2px solid #18181b}
  .rows .total span:first-child{font-weight:600}
  .rows .total span:last-child{font-size:18px;font-weight:700}
  .words{margin-top:14px;padding:10px 14px;border-left:2px solid #18181b;background:#f7f7f8;font-size:11.5px}
  .words b{font-weight:600}
  .stmt{color:#3f3f46;margin:0}
  .sigs{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:40px}
  .sig .img{height:54px;display:flex;align-items:flex-end;justify-content:flex-start}
  .sig img{max-height:52px;max-width:100%;object-fit:contain}
  .sig .line{border-top:1px solid #18181b;margin-top:6px;padding-top:6px}
  .sig .who{font-weight:600;min-height:18px}
  .sig .when{color:#71717a;font-size:11px;min-height:16px}
  ol{margin:0;padding-left:18px}ol li{padding:3px 0}
  .foot{display:flex;justify-content:space-between;margin-top:36px;padding-top:10px;border-top:1px solid #e4e4e7;color:#a1a1aa;font-size:10px}
  @media print{.screen{background:#fff;padding:0}.sheet{max-width:none;padding:0;border:0}@page{size:A4;margin:16mm 15mm}}
`;

/**
 * @param {object} d dossier from GET /ipcs/:id/dossier
 * @param {{ print?: boolean }} opts print adds the auto-print script and drops the grey screen backdrop
 */
export const ipcCertificateHtml = (d, { print = false } = {}) => {
  const { ipc } = d;
  const isClient = ipc.invoiceType === 'Client_Invoice';
  const net = ipc.netPayableAmount || ipc.invoiceAmount;
  const p = d.contractProgress;
  const co = d.company || {};
  const contact = [co.contactInfo?.address, co.contactInfo?.phone, co.contactInfo?.email].filter(Boolean).join('  ·  ');
  const street = String(d.subProject?.street || '').trim();
  const location = [street && (/^\d/.test(street) ? `Street ${street}` : street), d.subProject?.sector, d.subProject?.society].filter(Boolean).join(', ');

  const work = (ipc.items || []).length
    ? `<table><thead><tr><th style="width:28px">#</th><th>Description of work</th><th>Unit</th><th class="r">Previous</th><th class="r">This period</th><th class="r">To date</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
      ${ipc.items.map((i, idx) => `<tr><td class="muted">${idx + 1}</td><td>${esc(i.title || i.description)}</td><td>${esc(i.unit)}</td>
        <td class="r">${money(i.previousQuantity)}</td><td class="r">${money(i.currentQuantity)}</td><td class="r">${money(i.cumulativeQuantity)}</td>
        <td class="r">${money(i.unitPrice)}</td><td class="r">${money(i.currentAmount)}</td></tr>`).join('')}
      <tr><td></td><td colspan="6" style="font-weight:600">Total this period</td><td class="r" style="font-weight:600">${money(ipc.grossAmount)}</td></tr>
      </tbody></table>`
    : `<div class="note">${esc(ipc.ipcKind === 'Advance'
      ? `Mobilisation advance against ${d.contract?.contractNumber || 'the sublet contract'}, recoverable at ${ipc.advanceRecoveryPercent || 0}% of each later work certificate.`
      : ipc.ipcKind === 'Retention Release'
        ? 'Release of retention held on earlier approved work certificates.'
        : `Payment stage “${ipc.checkRequest?.slab?.name || ''}”, ${ipc.checkRequest?.slab?.percentage || 0}% of the contract value, certified in full on the verified check request.`)}</div>`;

  const position = p ? [
    ['Contract value', p.contractValue],
    ['Certified previously', p.certifiedApproved + p.certifiedInApproval],
    ['This certificate', p.thisIpc],
    [`Certified to date${p.percent != null ? ` (${p.percent}%)` : ''}`, p.certifiedToDate, 'strong'],
    ['Balance of contract', p.remaining]
  ] : [];

  const statement = isClient
    ? 'Certified that the work billed above has been executed and verified, and that the amount stated is receivable from the client.'
    : 'Certified that the work stated above has been measured and verified in accordance with the sublet contract, and that the net amount shown is due to the subcontractor after the deductions listed.';

  const sigs = signatories(ipc).map((s) => `<div class="sig">
      <div class="img">${s.user?.digitalSignature ? `<img src="${esc(getImageUrl(s.user.digitalSignature))}" alt="">` : ''}</div>
      <div class="line"><span class="lbl">${esc(s.role)}</span><div class="who">${esc(person(s.user))}</div><div class="when">${s.user && s.at ? day(s.at) : ''}</div></div>
    </div>`).join('');

  const body = `<div class="sheet">
    <div class="top">
      <div><div class="org-name">${esc(co.name || '')}</div>${contact ? `<div class="org-meta">${esc(contact)}</div>` : ''}</div>
      <div class="doc"><div class="doc-title">${esc(certificateTitle(ipc))}</div><div class="doc-no">${isClient ? esc(ipc.invoiceNumber) : `No. ${String(ipc.ipcNumber || 1).padStart(2, '0')}`}</div></div>
    </div>
    <div class="meta">
      <div><span class="lbl">Reference</span><span class="val">${esc(ipc.invoiceNumber)}</span></div>
      <div><span class="lbl">Date of issue</span><span class="val">${day(ipc.issueDate)}</span></div>
      <div><span class="lbl">Contract</span><span class="val">${esc(d.contract?.contractNumber || '—')}</span></div>
      <div><span class="lbl">Status</span><span class="val">${esc(ipcStageText(ipc))}</span></div>
    </div>
    <div class="parties">
      <div>
        <div class="blk"><span class="lbl">Employer</span><div class="name">${esc(co.name || '—')}</div></div>
        <div class="blk"><span class="lbl">Project</span><div class="name">${esc(d.mainProject?.name || d.subProject?.name || '')}</div>
          <div class="sub">${esc([d.mainProject ? d.subProject?.name : '', location].filter(Boolean).join(', '))}</div></div>
      </div>
      <div>
        <div class="blk"><span class="lbl">${isClient ? 'Client' : 'Subcontractor'}</span><div class="name">${esc((isClient ? ipc.clientName : d.contractor?.name) || '—')}</div>
          <div class="sub">${esc([d.contractor?.ntnCnic && `NTN / CNIC ${d.contractor.ntnCnic}`, d.contractor?.phone].filter(Boolean).join('  ·  '))}</div></div>
        <div class="blk"><span class="lbl">Basis of certificate</span><div class="name">${esc(d.checkRequest ? `Check Request ${d.checkRequest.checkRequestNumber}` : (d.contract ? `Contract ${d.contract.contractNumber}` : '—'))}</div>
          <div class="sub">${esc(d.checkRequest ? `Verified ${day(d.checkRequest.verifiedAt)}${d.checkRequest.verifiedBy ? ` by ${d.checkRequest.verifiedBy}` : ''}` : '')}</div></div>
      </div>
    </div>

    <h2><span>1</span>Valuation of work</h2>
    ${work}

    <div class="cols">
      <div>
        <h2><span>2</span>Contract position</h2>
        <div class="rows">${position.length ? position.map(([l, v, cls]) => `<div class="row ${cls || ''}"><span>${esc(l)}</span><span>${money(v)}</span></div>`).join('') : '<div class="row muted"><span>No sublet contract linked</span><span></span></div>'}</div>
      </div>
      <div>
        <h2><span>3</span>Amount ${isClient ? 'receivable' : 'certified'} (PKR)</h2>
        <div class="rows">
          ${moneyLines(ipc).map(([l, v, neg]) => `<div class="row ${neg ? 'neg' : ''}"><span>${esc(neg ? `Less: ${l}` : l)}</span><span>${money(v)}</span></div>`).join('')}
          <div class="total"><span>${isClient ? 'Amount receivable' : 'Net amount payable'}</span><span>${money(net)}</span></div>
        </div>
      </div>
    </div>
    <div class="words">Amount in words: <b>${esc(numberToWords(Math.round(net || 0)))}</b></div>
    ${ipc.description ? `<p class="muted" style="margin:10px 0 0">Remarks: ${esc(ipc.description)}</p>` : ''}

    <h2><span>4</span>Certification</h2>
    <p class="stmt">${statement}</p>
    <div class="sigs">${sigs}</div>

    <h2><span>5</span>Enclosures</h2>
    <ol>${enclosures(d).map((e) => `<li>${esc(e)}</li>`).join('') || '<li>None</li>'}</ol>

    <div class="foot"><span>${esc(certificateTitle(ipc))} ${esc(ipc.invoiceNumber)}</span><span>Generated ${dayjs().format('DD MMM YYYY, hh:mm A')}</span></div>
  </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ipc.invoiceNumber)}</title><style>${CSS}</style></head>
    <body class="${print ? '' : 'screen'}">${body}${print ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>' : ''}</body></html>`;
};

/** Opens the certificate in a print window; false when pop-ups are blocked */
export const printIpcCertificate = (d) => {
  const w = window.open('', '_blank', 'width=960,height=1100');
  if (!w) return false;
  w.document.open();
  w.document.write(ipcCertificateHtml(d, { print: true }));
  w.document.close();
  return true;
};
