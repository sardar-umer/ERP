import { brandPrintHtml } from './tovusPrintBrand';

const escapeHtml = (value) => {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const formatDate = (dateString) => {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatPKR = (amount) => {
  const n = Number(amount) || 0;
  return `PKR ${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
};

const safeText = (value) => {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (value.name) return String(value.name);
    if (value.title) return String(value.title);
    if (value.code) return String(value.code);
  }
  return '—';
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const tenureLabel = (hireDate) => {
  if (!hireDate) return '—';
  const start = new Date(hireDate);
  if (Number.isNaN(start.getTime())) return '—';
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (months < 0) { years -= 1; months += 12; }
  if (years > 0 && months > 0) return `${years} yr ${months} mo`;
  if (years > 0) return `${years} yr`;
  return `${months} mo`;
};

const PRINT_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');


  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif;
    font-size: 9pt;
    line-height: 1.55;
    color: #334155;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(59, 130, 246, 0.15);
  }

  .hero {
    background: linear-gradient(135deg, #bfdbfe 0%, #ddd6fe 45%, #fecdd3 100%);
    padding: 28px 28px 24px;
    position: relative;
    page-break-inside: avoid;
  }
  .hero::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6, #f472b6);
  }
  .hero-top {
    display: table;
    width: 100%;
    margin-bottom: 20px;
  }
  .hero-top .left, .hero-top .right {
    display: table-cell;
    vertical-align: top;
  }
  .hero-top .right { text-align: right; width: 200px; }
  .company {
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #1e40af;
    margin-bottom: 4px;
  }
  .doc-type {
    font-size: 12pt;
    font-weight: 800;
    color: #6d28d9;
    letter-spacing: 0.02em;
  }
  .doc-date {
    font-size: 7.5pt;
    font-weight: 600;
    color: #7c3aed;
    margin-top: 4px;
  }

  .profile-row {
    display: table;
    width: 100%;
  }
  .profile-row .photo-col,
  .profile-row .info-col {
    display: table-cell;
    vertical-align: middle;
  }
  .photo-col { width: 96px; padding-right: 20px; }
  .avatar-ring {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    padding: 4px;
    background: linear-gradient(135deg, #3b82f6, #a855f7, #f43f5e);
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);
  }
  .avatar-inner {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .avatar-inner img { width: 100%; height: 100%; object-fit: cover; }
  .avatar-inner .initials {
    font-size: 22pt;
    font-weight: 800;
    color: #2563eb;
  }
  .emp-name {
    font-size: 21pt;
    font-weight: 800;
    color: #1e3a8a;
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin-bottom: 4px;
  }
  .emp-role {
    font-size: 10pt;
    font-weight: 600;
    color: #4338ca;
    margin-bottom: 12px;
  }
  .chips { margin-top: 4px; }
  .chip {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 7.5pt;
    font-weight: 600;
    margin-right: 6px;
    margin-bottom: 4px;
  }
  .chip-blue { background: #fff; color: #1d4ed8; border: 1.5px solid #93c5fd; box-shadow: 0 2px 6px rgba(59,130,246,0.15); }
  .chip-green { background: #fff; color: #047857; border: 1.5px solid #6ee7b7; box-shadow: 0 2px 6px rgba(16,185,129,0.15); }
  .chip-rose { background: #fff; color: #be123c; border: 1.5px solid #fda4af; box-shadow: 0 2px 6px rgba(244,63,94,0.15); }
  .chip-lavender { background: #fff; color: #6d28d9; border: 1.5px solid #c4b5fd; box-shadow: 0 2px 6px rgba(139,92,246,0.15); }

  /* Stat pills */
  .stats {
    display: table;
    width: 100%;
    margin-top: 18px;
    border-collapse: separate;
    border-spacing: 8px 0;
  }
  .stats .stat {
    display: table-cell;
    background: #fff;
    border: 2px solid #fff;
    border-radius: 12px;
    padding: 10px 12px;
    text-align: center;
    width: 20%;
    box-shadow: 0 3px 12px rgba(0,0,0,0.08);
  }
  .stats .stat:nth-child(1) { border-color: #93c5fd; }
  .stats .stat:nth-child(2) { border-color: #c4b5fd; }
  .stats .stat:nth-child(3) { border-color: #fcd34d; }
  .stats .stat:nth-child(4) { border-color: #f9a8d4; }
  .stats .stat:nth-child(5) { border-color: #6ee7b7; }
  .stat-label {
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 9.5pt;
    font-weight: 800;
    color: #1d4ed8;
  }
  .stat-value.accent { color: #db2777; }

  /* Body */
  .body { padding: 20px 24px 24px; }

  /* Cards */
  .card {
    margin-bottom: 16px;
    border-radius: 14px;
    border: 1.5px solid #e2e8f0;
    overflow: hidden;
    background: #fff;
    page-break-inside: avoid;
    box-shadow: 0 2px 10px rgba(59, 130, 246, 0.08);
  }
  .card-head {
    padding: 11px 16px;
    border-bottom: 2px solid transparent;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .head-blue { background: linear-gradient(90deg, #dbeafe, #eff6ff); border-bottom-color: #3b82f6; }
  .head-lavender { background: linear-gradient(90deg, #ede9fe, #f5f3ff); border-bottom-color: #8b5cf6; }
  .head-rose { background: linear-gradient(90deg, #ffe4e6, #fff1f2); border-bottom-color: #f43f5e; }
  .head-mint { background: linear-gradient(90deg, #d1fae5, #ecfdf5); border-bottom-color: #10b981; }
  .head-sky { background: linear-gradient(90deg, #e0f2fe, #f0f9ff); border-bottom-color: #0ea5e9; }
  .head-peach { background: linear-gradient(90deg, #ffedd5, #fff7ed); border-bottom-color: #f97316; }
  .card-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 2px #fff;
  }
  .dot-blue { background: #3b82f6; }
  .dot-lavender { background: #8b5cf6; }
  .dot-rose { background: #f43f5e; }
  .dot-mint { background: #10b981; }
  .dot-sky { background: #0ea5e9; }
  .dot-peach { background: #f97316; }
  .head-blue .card-title { color: #1d4ed8; }
  .head-lavender .card-title { color: #6d28d9; }
  .head-rose .card-title { color: #be123c; }
  .head-mint .card-title { color: #047857; }
  .head-sky .card-title { color: #0369a1; }
  .head-peach .card-title { color: #c2410c; }
  .card-title {
    font-size: 9pt;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .card-body { padding: 0; }

  /* Field rows */
  table.fields {
    width: 100%;
    border-collapse: collapse;
  }
  table.fields td {
    padding: 7px 16px;
    border-bottom: 1px solid #f4f6fa;
    vertical-align: top;
    font-size: 8.5pt;
  }
  table.fields tr:last-child td { border-bottom: none; }
  table.fields tr:nth-child(even) td { background: #f0f9ff; }
  table.fields td.lbl {
    width: 38%;
    font-size: 7.5pt;
    font-weight: 700;
    color: #0369a1;
    letter-spacing: 0.02em;
  }
  table.fields td.val {
    color: #1e293b;
    font-weight: 600;
  }
  table.fields td.val.money { color: #2563eb; font-weight: 800; }

  /* Two columns */
  .row-2 {
    display: table;
    width: 100%;
    border-collapse: separate;
    border-spacing: 14px 0;
    margin-bottom: 16px;
  }
  .row-2 .col {
    display: table-cell;
    width: 50%;
    vertical-align: top;
  }
  .row-2 .card { margin-bottom: 0; }

  /* Highlight metrics inside card */
  .metric-strip {
    display: table;
    width: 100%;
    border-collapse: separate;
    border-spacing: 8px 0;
    padding: 12px 14px;
    background: linear-gradient(90deg, #eff6ff, #faf5ff);
    border-bottom: 1px solid #bfdbfe;
  }
  .metric-strip .m-cell {
    display: table-cell;
    text-align: center;
    background: #fff;
    border: 2px solid #bfdbfe;
    border-radius: 10px;
    padding: 10px 6px;
    box-shadow: 0 2px 8px rgba(59,130,246,0.1);
  }
  .metric-strip .m-cell.highlight {
    background: linear-gradient(135deg, #dbeafe, #ede9fe);
    border-color: #8b5cf6;
  }
  .m-cell .m-lbl {
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    margin-bottom: 3px;
  }
  .m-cell .m-val {
    font-size: 9.5pt;
    font-weight: 800;
    color: #1d4ed8;
  }
  .m-cell.highlight .m-val { color: #6d28d9; }

  /* Sub blocks */
  .sub-head {
    font-size: 7.5pt;
    font-weight: 700;
    color: #a88fd4;
    padding: 8px 16px 4px;
    letter-spacing: 0.04em;
  }

  /* Data tables */
  table.data {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
  }
  table.data th {
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
    color: #fff;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px;
    text-align: left;
    border: none;
  }
  table.data td {
    padding: 7px 12px;
    border-bottom: 1px solid #e0f2fe;
    color: #334155;
    vertical-align: top;
    font-weight: 500;
  }
  table.data tr:nth-child(even) td { background: #f0f9ff; }
  table.data tr:last-child td { border-bottom: none; }
  table.data td.num { text-align: right; font-weight: 800; color: #2563eb; white-space: nowrap; }
  .tag {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 7pt;
    font-weight: 700;
    background: #dbeafe;
    color: #1d4ed8;
  }

  .prose {
    padding: 14px 16px;
    font-size: 8.5pt;
    line-height: 1.7;
    color: #334155;
    white-space: pre-wrap;
    background: #f8fafc;
  }
  .empty {
    padding: 16px;
    text-align: center;
    font-size: 8pt;
    color: #b0bec8;
    font-style: italic;
  }

  .footer {
    padding: 14px 24px;
    background: linear-gradient(90deg, #dbeafe, #ede9fe, #fce7f3);
    border-top: 3px solid transparent;
    border-image: linear-gradient(90deg, #3b82f6, #8b5cf6, #f472b6) 1;
    font-size: 7.5pt;
    font-weight: 600;
    color: #4338ca;
    text-align: center;
    letter-spacing: 0.04em;
  }

  @media print {
    body { background: #fff; }
    .page { box-shadow: none; border-radius: 0; }
    .card { page-break-inside: avoid; }
  }
`;

const displayVal = (value) => {
  if (value == null || value === '') return '—';
  return value;
};

const fieldRow = (label, value, opts = {}) => {
  const cls = opts.money ? 'val money' : 'val';
  return `<tr><td class="lbl">${escapeHtml(label)}</td><td class="${cls}">${escapeHtml(displayVal(value))}</td></tr>`;
};

const fieldsTable = (rows) => {
  const html = Array.isArray(rows) ? rows.filter(Boolean).join('') : (rows || '');
  if (!html.trim()) return '';
  return `<table class="fields"><tbody>${html}</tbody></table>`;
};

const card = (title, content, dotClass = 'dot-blue') => {
  if (!content?.trim()) return '';
  const headClass = dotClass.replace('dot-', 'head-');
  return `
    <div class="card">
      <div class="card-head ${headClass}">
        <span class="card-dot ${dotClass}"></span>
        <span class="card-title">${escapeHtml(title)}</span>
      </div>
      <div class="card-body">${content}</div>
    </div>
  `;
};

const twoCol = (left, right) => {
  if (!left?.trim() && !right?.trim()) return '';
  if (!right?.trim()) return left;
  if (!left?.trim()) return right;
  return `<div class="row-2"><div class="col">${left}</div><div class="col">${right}</div></div>`;
};

const metricStrip = (items) => {
  const visible = items.filter((i) => i.label);
  const cells = visible.map((item) => `
    <div class="m-cell${item.highlight ? ' highlight' : ''}" style="width:${Math.floor(100 / visible.length)}%">
      <div class="m-lbl">${escapeHtml(item.label)}</div>
      <div class="m-val">${escapeHtml(item.value)}</div>
    </div>
  `).join('');
  return `<div class="metric-strip">${cells}</div>`;
};

const field = (label, value, opts = {}) => ({ label, value, money: opts.money });

const buildArrearsTable = (rows = []) => {
  if (!rows.length) return '<div class="empty">No arrears records.</div>';
  const trs = rows.map((a) => `
    <tr>
      <td>${escapeHtml(`${a.monthName || ''} ${a.year || ''}`.trim())}</td>
      <td>${escapeHtml(a.type || 'Other')}</td>
      <td class="num">${escapeHtml(formatPKR(a.amount))}</td>
      <td><span class="tag">${escapeHtml(a.status || '—')}</span></td>
      <td>${escapeHtml(a.description || '—')}</td>
      <td>${escapeHtml(formatDate(a.createdDate))}</td>
    </tr>
  `).join('');
  return `<table class="data"><thead><tr>
    <th>Period</th><th>Type</th><th>Amount</th><th>Status</th><th>Description</th><th>Created</th>
  </tr></thead><tbody>${trs}</tbody></table>`;
};

const buildLoansTable = (loans = []) => {
  if (!loans.length) return '<div class="empty">No loans on record.</div>';
  const trs = loans.map((l) => `
    <tr>
      <td>${escapeHtml(l.loanType || '—')}</td>
      <td><span class="tag">${escapeHtml(l.status || '—')}</span></td>
      <td class="num">${escapeHtml(formatPKR(l.loanAmount))}</td>
      <td class="num">${escapeHtml(formatPKR(l.monthlyInstallment))}</td>
      <td class="num">${escapeHtml(formatPKR(l.outstandingBalance))}</td>
      <td>${escapeHtml(l.loanTerm ?? '—')}</td>
      <td>${escapeHtml(l.purpose || '—')}</td>
    </tr>
  `).join('');
  return `<table class="data"><thead><tr>
    <th>Type</th><th>Status</th><th>Amount</th><th>Installment</th><th>Outstanding</th><th>Term</th><th>Purpose</th>
  </tr></thead><tbody>${trs}</tbody></table>`;
};

export const buildEmployeeDetailPrintHtml = ({
  employee,
  leaveSummary,
  kpiSummary,
  loans = [],
  profileImageUrl
}) => {
  if (!employee) return '';

  const name = `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
  const generatedAt = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const dept = safeText(employee.placementDepartment?.name || employee.department?.name);
  const designation = safeText(employee.placementDesignation);
  const categoryLabel = employee.employeeCategory === 'blue_collar'
    ? 'Blue Collar'
    : employee.employeeCategory === 'white_collar'
      ? 'White Collar'
      : safeText(employee.employeeCategory);

  const personalCard = card('Personal Information', fieldsTable([
    fieldRow('Email', employee.email),
    fieldRow('Phone', employee.phone),
    fieldRow('Date of Birth', formatDate(employee.dateOfBirth)),
    fieldRow('Gender', employee.gender),
    fieldRow('CNIC / ID Card', employee.idCard),
    fieldRow('Nationality', employee.nationality),
    fieldRow('Religion', employee.religion),
    fieldRow('Marital Status', employee.maritalStatus),
    employee.maritalStatus === 'Married' ? fieldRow('Spouse Name', employee.spouseName) : ''
  ]), 'dot-blue');

  const employmentCard = card('Employment Information', fieldsTable([
    fieldRow('Department', dept),
    fieldRow('Designation', designation),
    fieldRow('Category', categoryLabel),
    fieldRow('Qualification', employee.qualification),
    fieldRow('Bank', safeText(employee.bankName)),
    fieldRow('Account No.', employee.bankAccountNumber || employee.accountNumber),
    fieldRow('Foreign Account', employee.foreignBankAccount),
    fieldRow('Hire Date', formatDate(employee.hireDate)),
    fieldRow('Appointment Date', formatDate(employee.appointmentDate)),
    fieldRow('Probation', employee.probationPeriodMonths != null ? `${employee.probationPeriodMonths} months` : ''),
    fieldRow('End of Probation', formatDate(employee.endOfProbationDate)),
    fieldRow('Confirmation', formatDate(employee.confirmationDate)),
    fieldRow('Status', employee.employmentStatus)
  ]), 'dot-lavender');

  const placementRows = [
    employee.placementCompany && fieldRow('Company', safeText(employee.placementCompany)),
    employee.placementSector && fieldRow('Sector', safeText(employee.placementSector)),
    employee.placementProject && fieldRow('Project', safeText(employee.placementProject)),
    employee.placementDepartment && fieldRow('Department', safeText(employee.placementDepartment)),
    employee.placementSection && fieldRow('Section', safeText(employee.placementSection)),
    employee.placementDesignation && fieldRow('Designation', safeText(employee.placementDesignation)),
    employee.oldDesignation && fieldRow('Prev. Designation', safeText(employee.oldDesignation)),
    employee.placementLocation && fieldRow('Location', safeText(employee.placementLocation))
  ].filter(Boolean);

  const leaveBody = leaveSummary?.balance ? metricStrip((() => {
    const b = leaveSummary.balance;
    return [
      { label: 'Annual Leave', value: `${b.annual?.used ?? 0} / ${(b.annual?.allocated || 0) + (b.annual?.carriedForward || 0)}`, highlight: true },
      { label: 'Sick Leave', value: `${b.sick?.used ?? 0} / 10` },
      { label: 'Casual Leave', value: `${b.casual?.used ?? 0} / 10` },
      { label: 'Approved', value: `${leaveSummary.statistics?.approved ?? 0} / ${leaveSummary.statistics?.totalRequests ?? 0}` }
    ];
  })()) : '';

  const kpiBody = kpiSummary ? metricStrip([
    { label: 'Period', value: kpiSummary.month ? `${MONTH_NAMES[kpiSummary.month] || kpiSummary.month} ${kpiSummary.year}` : '—' },
    { label: 'KPI Score', value: String(kpiSummary.totalKPIScore ?? '—'), highlight: true },
    { label: 'Weight', value: kpiSummary.totalWeight != null ? `${kpiSummary.totalWeight}%` : '—' }
  ]) : '';

  const academicCards = (employee.academicBackground || []).map((r, i) => card(
    `Academic · ${r.degree || `Record ${i + 1}`}`,
    fieldsTable([
      fieldRow('Institution', r.institution),
      fieldRow('Field of Study', r.fieldOfStudy),
      fieldRow('Graduation Year', r.graduationYear),
      fieldRow('GPA / Grade', r.gpa || r.grade),
      fieldRow('Percentage', r.percentage != null ? `${r.percentage}%` : '')
    ]),
    'dot-sky'
  )).join('');

  const professionalCards = (employee.professionalEducation || []).map((c, i) => card(
    `Course · ${c.courseName || `Record ${i + 1}`}`,
    fieldsTable([
      fieldRow('Institution', c.institution),
      fieldRow('Certification Body', c.certificationBody),
      fieldRow('Certificate No.', c.certificateNumber),
      fieldRow('Completed', formatDate(c.completionDate)),
      fieldRow('Expires', formatDate(c.expiryDate))
    ]),
    'dot-mint'
  )).join('');

  const historyCards = (employee.employmentHistory || []).map((r, i) => card(
    `${r.companyName || `Employment ${i + 1}`}${r.isCurrentJob ? ' · Current' : ''}`,
    fieldsTable([
      fieldRow('Position', r.position),
      fieldRow('Duration', `${formatDate(r.startDate)} — ${r.isCurrentJob ? 'Present' : formatDate(r.endDate)}`),
      fieldRow('Location', r.location),
      fieldRow('Salary', r.salary ? formatPKR(r.salary) : '', { money: !!r.salary }),
      fieldRow('Responsibilities', r.responsibilities),
      fieldRow('Reason for Leaving', r.reasonForLeaving)
    ]),
    'dot-rose'
  )).join('');

  const initials = escapeHtml((employee.firstName?.[0] || '') + (employee.lastName?.[0] || ''));
  const avatarHtml = profileImageUrl
    ? `<img src="${escapeHtml(profileImageUrl)}" alt="" />`
    : `<span class="initials">${initials}</span>`;

  const body = [
    twoCol(personalCard, employmentCard),
    placementRows.length ? card('Placement & Assignment', fieldsTable(placementRows), 'dot-mint') : '',
    employee.jobDescription ? card('Job Description', `<div class="prose">${escapeHtml(employee.jobDescription)}</div>`, 'dot-lavender') : '',
    leaveBody ? card('Leave Balance', leaveBody, 'dot-mint') : '',
    kpiBody ? card('KPI Summary', kpiBody, 'dot-lavender') : '',
    card('Arrears', metricStrip([
      { label: 'Outstanding', value: formatPKR(employee.totalArrears), highlight: true },
      { label: 'Current Month', value: formatPKR(employee.currentMonthArrears) },
      { label: 'Total Paid', value: formatPKR(employee.arrearsPaid) },
      { label: 'Months / Overdue', value: `${employee.monthsWithArrears ?? 0} / ${employee.arrearsOverdue ?? 0}` }
    ]) + buildArrearsTable(employee.arrearsMonths), 'dot-peach'),
    card('Loans & Advances', buildLoansTable(loans), 'dot-rose'),
    twoCol(
      card('Address', fieldsTable([
        fieldRow('Street', employee.address?.street),
        fieldRow('City', safeText(employee.address?.city)),
        fieldRow('State / Province', safeText(employee.address?.state)),
        fieldRow('Country', safeText(employee.address?.country))
      ]), 'dot-sky'),
      card('Emergency Contact', fieldsTable([
        fieldRow('Name', employee.emergencyContact?.name),
        fieldRow('Relationship', employee.emergencyContact?.relationship),
        fieldRow('Phone', employee.emergencyContact?.phone)
      ]), 'dot-rose')
    ),
    academicCards,
    professionalCards,
    historyCards
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Employee Record — ${escapeHtml(name)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div class="hero-top">
        <div class="left">
          <div class="company">Sardar Group of Companies</div>
        </div>
        <div class="right">
          <div class="doc-date">${escapeHtml(generatedAt)}</div>
        </div>
      </div>
      <div class="profile-row">
        <div class="photo-col">
          <div class="avatar-ring">
            <div class="avatar-inner">${avatarHtml}</div>
          </div>
        </div>
        <div class="info-col">
          <div class="emp-name">${escapeHtml(name)}</div>
          <div class="emp-role">${escapeHtml(designation)}${dept !== '—' ? ` · ${escapeHtml(dept)}` : ''}</div>
          <div class="chips">
            <span class="chip chip-blue">ID ${escapeHtml(employee.employeeId)}</span>
            <span class="chip ${employee.isActive ? 'chip-green' : 'chip-rose'}">${employee.isActive ? 'Active' : 'Inactive'}</span>
            ${categoryLabel && categoryLabel !== '—' ? `<span class="chip chip-lavender">${escapeHtml(categoryLabel)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Tenure</div>
          <div class="stat-value">${escapeHtml(tenureLabel(employee.hireDate))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Hire Date</div>
          <div class="stat-value">${escapeHtml(formatDate(employee.hireDate))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">CNIC</div>
          <div class="stat-value">${escapeHtml(employee.idCard || '—')}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Phone</div>
          <div class="stat-value">${escapeHtml(employee.phone || '—')}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Status</div>
          <div class="stat-value">${escapeHtml(employee.employmentStatus || '—')}</div>
        </div>
      </div>
    </div>

    <div class="body">${body}</div>

    <div class="footer">
      Sardar Group of Companies · Human Resources · ${escapeHtml(name)} · ${escapeHtml(employee.employeeId)}
    </div>
  </div>
</body>
</html>`;
};

const waitForImages = (doc) => {
  const images = Array.from(doc.images || []);
  if (!images.length) return Promise.resolve();
  return Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  }));
};

export const openEmployeeDetailPrint = (options) => {
  const raw = buildEmployeeDetailPrintHtml(options);
  if (!raw) return;
  // Tovus ERP branding; the full employee record runs over several pages at normal size
  const html = brandPrintHtml(raw, {
    title: 'Employee Profile',
    docRef: options?.employee?.employeeId ? `Emp ID ${options.employee.employeeId}` : undefined,
    fit: false
  });

  const existing = document.getElementById('employee-detail-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'employee-detail-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = 'Employee print';
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win?.document;
  if (!doc || !win) {
    iframe.remove();
    return { ok: false, message: 'Unable to prepare print preview.' };
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 500);
  };

  const triggerPrint = async () => {
    try {
      await waitForImages(doc);
      try { if (typeof win.tovusFit === 'function') win.tovusFit(); } catch { /* ignore */ }
      win.focus();
      win.print();
      win.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 60000);
    } catch {
      iframe.remove();
      return { ok: false, message: 'Unable to open print dialog.' };
    }
  };

  if (iframe.contentDocument?.readyState === 'complete') {
    setTimeout(triggerPrint, 100);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 100);
  }

  return { ok: true };
};

export default openEmployeeDetailPrint;
