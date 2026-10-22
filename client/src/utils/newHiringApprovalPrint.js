import { getImageUrl } from './imageService';
import { openPrintHtml } from './employeeFormPrint';
import { getNewHiringAuthorityCards, getNewHiringEmployees } from './newHiringEmployees';

const escapeHtml = (value) => {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const display = (value) => {
  if (value == null || String(value).trim() === '') return '—';
  return escapeHtml(String(value));
};

const formatPerson = (user) => {
  if (!user) return 'Pending';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return escapeHtml(name || user.email || 'Approved');
};

const formatDateTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return escapeHtml(
    d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  );
};

const formatDoj = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return escapeHtml(
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  );
};

const formatPackage = (pkg) => {
  if (pkg == null || String(pkg).trim() === '' || String(pkg) === '0') return '—';
  const n = Number(pkg);
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(String(pkg).trim())) {
    return escapeHtml(`${n.toLocaleString('en-PK')} PKR`);
  }
  return escapeHtml(String(pkg));
};

/** Embed original signature as data URL so print iframe loads it reliably (no black rewrite). */
const toEmbeddedSignatureSrc = async (path) => {
  const src = getImageUrl(path);
  if (!src) return null;
  if (String(src).startsWith('data:')) return src;
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return typeof dataUrl === 'string' ? dataUrl : src;
  } catch {
    return src;
  }
};

const signatureBlock = (src, alt) => {
  if (!src || !String(src).trim()) {
    return '<div class="sig-line"><span class="muted">No Signature</span></div>';
  }
  return `<div class="sig-line"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" /></div>`;
};

export const buildNewHiringApprovalPrintHtml = async (record) => {
  if (!record) return '';

  const employees = getNewHiringEmployees(record);
  const rows = employees
    .map((emp, index) => {
      const name = emp.name || [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim() || '—';
      const designation = emp.designation || emp.role || '—';
      const pkg = emp.currentPackageMonthly ?? emp.expectedWages;
      return `<tr>
        <td class="center">${index + 1}</td>
        <td>${display(name)}</td>
        <td>${display(emp.cnic)}</td>
        <td>${display(designation)}</td>
        <td>${display(emp.departmentSubject)}</td>
        <td>${display(emp.project)}</td>
        <td>${display(emp.location)}</td>
        <td class="right">${formatPackage(pkg)}</td>
        <td>${formatDoj(emp.tentativeDoj)}</td>
        <td>${display(emp.remark || emp.justification)}</td>
      </tr>`;
    })
    .join('');

  const authorities = getNewHiringAuthorityCards(record);
  const embeddedSources = await Promise.all(
    authorities.map((a) => (a.sig ? toEmbeddedSignatureSrc(a.sig) : Promise.resolve(null)))
  );

  const authorityCards = authorities
    .map(
      (a, idx) => `<div class="auth-card">
        <div class="auth-label">${escapeHtml(a.label)}</div>
        <div class="auth-name">${escapeHtml(a.statusLabel || formatPerson(a.user))}</div>
        ${a.at ? `<div class="muted">${formatDateTime(a.at)}</div>` : ''}
        ${signatureBlock(embeddedSources[idx], `${a.label} Signature`)}
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>New-Hiring Approval - ${escapeHtml(record.recordNumber || '')}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; font-size: 12px; }
    .company { font-size: 16px; font-weight: 700; text-align: center; margin: 0 0 6px; letter-spacing: 0.02em; text-transform: uppercase; }
    h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
    .sub { text-align: center; color: #555; margin-bottom: 20px; font-size: 12px; }
    h2 { font-size: 13px; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; text-align: left; }
    th { background: #f0f0f0; font-weight: 700; }
    td.right { text-align: right; }
    td.center { text-align: center; }
    .auth-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 8px; }
    .auth-card { border: 1px solid #ccc; border-radius: 4px; padding: 10px 12px; min-height: 110px; page-break-inside: avoid; }
    .auth-label { font-size: 11px; color: #666; font-weight: 700; margin-bottom: 4px; }
    .auth-name { font-weight: 700; margin-bottom: 2px; }
    .muted { color: #777; font-size: 11px; }
    .sig-line { margin-top: 8px; border-top: 1px solid #ddd; padding-top: 6px; min-height: 40px; }
    .sig-line img {
      max-height: 72px;
      max-width: 190px;
      object-fit: contain;
      display: block;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media print {
      body { margin: 12mm; }
      .auth-grid { grid-template-columns: repeat(3, 1fr); }
      .sig-line img {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="company">Sardar Group Of Companies</div>
  <h1>New-Hiring Approval Details</h1>
  <div class="sub">Record ${display(record.recordNumber)}${record.status ? ` · Status: ${display(record.status)}` : ''}</div>

  <h2>Candidates recommended for hiring (${employees.length})</h2>
  <table>
    <thead>
      <tr>
        <th style="width:40px;text-align:center">Sr No</th>
        <th>Name</th>
        <th>CNIC/Passport No.</th>
        <th>Designation</th>
        <th>Department/Subject</th>
        <th>Project</th>
        <th>Location</th>
        <th>Current Package Monthly</th>
        <th>Tentative DOJ</th>
        <th>Remark</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="10" style="text-align:center">No candidates</td></tr>'}
    </tbody>
  </table>

  <h2>Approval Authorities</h2>
  <div class="auth-grid">
    ${authorityCards}
  </div>
</body>
</html>`;
};

export const printNewHiringApproval = async (record) => {
  try {
    const html = await buildNewHiringApprovalPrintHtml(record);
    return openPrintHtml(html);
  } catch (err) {
    return { ok: false, message: err?.message || 'Unable to prepare print.' };
  }
};
