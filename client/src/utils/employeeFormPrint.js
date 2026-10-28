import { computeAutoSalaryBreakdown } from './salaryBreakdown';
import { vehicleAllowanceAmount, fuelAllowanceAmount } from './allowanceHelpers';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const ALLOWANCE_LABELS = {
  conveyance: 'Conveyance Allowance',
  food: 'Food Allowance',
  mobile: 'Mobile Allowance',
  vehicle: 'Vehicle Allowance',
  fuel: 'Fuel Allowance',
  medical: 'Medical Allowance',
  houseRent: 'House Allowance',
  special: 'Special Allowance',
  other: 'Other Allowance'
};

const escapeHtml = (value) => {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const displayVal = (value) => {
  if (value == null || value === '') return '—';
  return String(value);
};

const formatDate = (dateString) => {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateLong = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
      : day === 3 || day === 23 ? 'rd' : 'th';
  return `${day}${suffix} ${date.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}`;
};

const formatDateTime = (dateString) => {
  if (!dateString) return '_________________________';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '_________________________';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatPKR = (amount) => {
  const n = Number(amount) || 0;
  return `PKR ${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
};

const resolveById = (list, id, field = 'name') => {
  if (!id) return '—';
  const item = (list || []).find((x) => String(x._id) === String(id));
  if (!item) return '—';
  return item[field] || item.name || item.title || '—';
};

const categoryLabel = (value) => {
  if (value === 'blue_collar') return 'Blue Collar';
  if (value === 'white_collar') return 'White Collar';
  return displayVal(value);
};

const SECTION_STYLES = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 10pt;
    line-height: 1.5;
    color: #1e293b;
    margin: 0;
    padding: 0;
  }
  .header {
    border-bottom: 3px solid #2563eb;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  .company { font-size: 9pt; font-weight: 700; letter-spacing: 0.1em; color: #1d4ed8; text-transform: uppercase; }
  .title { font-size: 16pt; font-weight: 800; color: #0f172a; margin-top: 4px; }
  .meta { font-size: 8.5pt; color: #64748b; margin-top: 6px; }
  .card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 16px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .card-head {
    background: #eff6ff;
    border-bottom: 1px solid #bfdbfe;
    padding: 8px 14px;
    font-size: 9pt;
    font-weight: 700;
    color: #1d4ed8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.fields { width: 100%; border-collapse: collapse; }
  table.fields td {
    padding: 7px 14px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
    font-size: 9pt;
  }
  table.fields tr:last-child td { border-bottom: none; }
  table.fields tr:nth-child(even) td { background: #f8fafc; }
  table.fields td.lbl { width: 36%; font-weight: 600; color: #475569; }
  table.fields td.val { font-weight: 500; color: #0f172a; }
  table.fields td.val.money { color: #1d4ed8; font-weight: 700; }
  .prose {
    padding: 12px 14px;
    white-space: pre-wrap;
    font-size: 9pt;
    line-height: 1.6;
  }
  .footer {
    margin-top: 24px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 8pt;
    color: #64748b;
    text-align: center;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

const fieldRow = (label, value, opts = {}) => {
  const cls = opts.money ? 'val money' : 'val';
  return `<tr><td class="lbl">${escapeHtml(label)}</td><td class="${cls}">${escapeHtml(displayVal(value))}</td></tr>`;
};

const fieldsTable = (rows) => {
  const html = (rows || []).filter(Boolean).join('');
  if (!html.trim()) return '<div class="prose">No data entered.</div>';
  return `<table class="fields"><tbody>${html}</tbody></table>`;
};

const sectionCard = (title, rows) => `
  <div class="card">
    <div class="card-head">${escapeHtml(title)}</div>
    ${fieldsTable(rows)}
  </div>
`;

const wrapSectionDocument = ({ pageTitle, sectionTitle, employeeLabel, employeeId, bodyHtml }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>${SECTION_STYLES}</style>
</head>
<body>
  <div class="header">
    <div class="company">Sardar Group of Companies</div>
    <div class="title">${escapeHtml(sectionTitle)}</div>
    <div class="meta">
      ${employeeLabel ? `Employee: ${escapeHtml(employeeLabel)}` : 'Employee (draft)'}
      ${employeeId ? ` · ID: ${escapeHtml(employeeId)}` : ''}
      · Generated: ${escapeHtml(new Date().toLocaleString('en-GB'))}
    </div>
  </div>
  ${bodyHtml}
  <div class="footer">Sardar Group of Companies · Human Resources · Confidential</div>
</body>
</html>`;

export const buildJoiningReportPrintHtml = (report = {}, employeeLabel = '') => {
  const issueDateFormatted = report.issueDate ? formatDateLong(report.issueDate) : '2nd May, 2021';
  const reportingDateTimeFormatted = report.reportingDateTime
    ? formatDateTime(report.reportingDateTime)
    : '_________________________';
  const employeeSignatureDateFormatted = report.employeeSignatureDate
    ? formatDate(report.employeeSignatureDate)
    : '_________________________';
  const hrSignatureDateFormatted = report.hrSignatureDate
    ? formatDate(report.hrSignatureDate)
    : '_________________________';

  return `<!DOCTYPE html>
<html>
  <head>
    <title>Joining Report${employeeLabel ? ` - ${escapeHtml(employeeLabel)}` : ''}</title>
    <style>
      @page { margin: 22mm 18mm 22mm 32mm; size: A4; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Times New Roman', serif;
        font-size: 12pt;
        line-height: 1.6;
        color: #000;
        background: #fff;
        padding: 24px 20px 24px 48px;
      }
      .header { text-align: center; margin-bottom: 20px; padding: 0 12mm; }
      .company-name { font-size: 18pt; font-weight: bold; margin-bottom: 15px; letter-spacing: 1px; }
      .document-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 15px;
        background-color: #f0f0f0;
        border: 1px solid #000;
        margin-bottom: 15px;
        font-size: 10pt;
      }
      .document-info span { font-weight: bold; }
      .report-title {
        text-align: center;
        font-size: 16pt;
        font-weight: bold;
        margin-bottom: 25px;
        text-decoration: underline;
      }
      .document-body {
        padding-left: 14mm;
        padding-right: 6mm;
      }
      .section { margin-bottom: 25px; }
      .section-title {
        font-weight: bold;
        font-size: 12pt;
        margin-bottom: 10px;
        text-decoration: underline;
      }
      .field-line { margin-bottom: 12px; line-height: 1.8; padding-left: 2mm; }
      .field-value {
        display: inline;
        border-bottom: 1px solid #000;
        min-width: 300px;
        padding: 0 5px;
        margin-left: 5px;
      }
      .signature-row {
        display: flex;
        justify-content: space-between;
        margin-top: 30px;
        margin-bottom: 20px;
        padding-left: 2mm;
        gap: 16px;
      }
      .signature-box { width: 45%; }
      .hr-section {
        border-left: 3px solid #000;
        padding-left: 18px;
        margin-left: 2mm;
        margin-top: 20px;
      }
      .optional-note { display: inline; font-style: italic; color: #666; margin-left: 10px; }
      .footer {
        margin-top: 40px;
        text-align: center;
        font-size: 9pt;
        color: #333;
        padding: 20px 12mm 0;
        border-top: 1px solid #ccc;
      }
      @media print {
        body { padding: 0 10mm 0 26mm; }
        .document-body { padding-left: 10mm; padding-right: 4mm; }
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="company-name">SARDAR GROUP OF COMPANIES</div>
      <div class="document-info">
        <span>Document No. ${escapeHtml(report.documentNumber || 'UD/HR/FRM-005')}</span>
        <span>Rev.#: ${escapeHtml(report.revisionNumber || '00')}</span>
        <span>Issue Date: ${escapeHtml(issueDateFormatted)}</span>
      </div>
      <div class="report-title">JOINING REPORT</div>
    </div>

    <div class="document-body">
    <div class="section">
      <div class="section-title">Employee:</div>
      <div class="field-line"><span>Dear Sir</span></div>
      <div class="field-line" style="margin-top: 15px;">
        <span>With reference to your offer, For the employment as </span>
        <span class="field-value">${escapeHtml(report.employmentPosition || '_________________________')}</span>
        <span> With Sardar Group of Companies</span>
      </div>
      <div class="field-line" style="margin-top: 15px;">
        <span>I </span>
        <span class="field-value" style="min-width: 80px;">${escapeHtml(report.employeeTitle || 'Mr.')}</span>
        <span class="field-value" style="min-width: 300px;">${escapeHtml(report.employeeName || '_________________________')}</span>
      </div>
      <div class="field-line">
        <span class="field-value" style="min-width: 60px;">${escapeHtml(report.parentSpouseRelation || 'S/o')}</span>
        <span class="field-value" style="min-width: 300px;">${escapeHtml(report.parentSpouseName || '_________________________')}</span>
      </div>
      <div class="field-line">
        <span>CNIC # </span>
        <span class="field-value" style="min-width: 350px;">${escapeHtml(report.cnic || '_________________________')}</span>
      </div>
      <div class="field-line">
        <span>Contact No </span>
        <span class="field-value" style="min-width: 350px;">${escapeHtml(report.contactNumber || '_________________________')}</span>
      </div>
      <div class="field-line" style="margin-top: 20px;">
        <span>Reported for duty, at </span>
        <span class="field-value" style="min-width: 300px;">${escapeHtml(report.reportingLocation || '_________________________')}</span>
        <span> (location)</span>
      </div>
      <div class="field-line">
        <span>On </span>
        <span class="field-value" style="min-width: 400px;">${escapeHtml(reportingDateTimeFormatted)}</span>
        <span> (Time & Date)</span>
      </div>
      <div class="signature-row">
        <div class="signature-box">
          <div class="field-line">
            <span>Signature </span>
            <span class="field-value" style="min-width: 250px;">${escapeHtml(report.employeeSignature || '_________________________')}</span>
          </div>
        </div>
        <div class="signature-box">
          <div class="field-line">
            <span>Date </span>
            <span class="field-value" style="min-width: 250px;">${escapeHtml(employeeSignatureDateFormatted)}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Verification (Concerned Department):</div>
      <div style="display: flex; justify-content: space-between; margin-top: 15px;">
        <div style="width: 48%;">
          <div class="field-line">
            <span>Department: </span>
            <span class="field-value" style="min-width: 200px;">${escapeHtml(report.verificationDepartment || '_________________________')}</span>
          </div>
        </div>
        <div style="width: 48%;">
          <div class="field-line">
            <span>HOD Name: </span>
            <span class="field-value" style="min-width: 200px;">${escapeHtml(report.hodName || '_________________________')}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section hr-section">
      <div class="section-title">
        For Official Use Only (Human Resources Department):
        <span class="optional-note">-> optional.</span>
      </div>
      <div class="field-line" style="margin-top: 15px;">
        <span>Joining Remarks: </span>
        <span class="field-value" style="min-width: 400px;">${escapeHtml(report.joiningRemarks || '_________________________')}</span>
      </div>
      <div class="signature-row">
        <div class="signature-box">
          <div class="field-line">
            <span>Signature: </span>
            <span class="field-value" style="min-width: 250px;">${escapeHtml(report.hrSignature || '_________________________')}</span>
          </div>
        </div>
        <div class="signature-box">
          <div class="field-line">
            <span>Date: </span>
            <span class="field-value" style="min-width: 250px;">${escapeHtml(hrSignatureDateFormatted)}</span>
          </div>
        </div>
      </div>
    </div>

    </div>

    <div class="footer">
      This document is exclusive property of SGC. It is confidential and cannot be published, copied or multiplied without authorization.
    </div>
  </body>
</html>`;
};

const buildPersonalHtml = (values, meta) => wrapSectionDocument({
  pageTitle: `Personal Information — ${meta.employeeLabel || 'Employee'}`,
  sectionTitle: 'Personal Information',
  employeeLabel: meta.employeeLabel,
  employeeId: values.employeeId,
  bodyHtml: sectionCard('Basic Information', [
    fieldRow('First Name', values.firstName),
    fieldRow('Last Name', values.lastName),
    fieldRow('Email', values.email),
    fieldRow('Phone', values.phone),
    fieldRow('Date of Birth', formatDate(values.dateOfBirth)),
    fieldRow('Gender', values.gender),
    fieldRow('ID Card', values.idCard),
    fieldRow('Nationality', values.nationality),
    fieldRow('Religion', values.religion),
    fieldRow('Marital Status', values.maritalStatus),
    values.maritalStatus === 'Married' ? fieldRow('Spouse Name', values.spouseName) : '',
    fieldRow('Employment Status', values.employmentStatus)
  ])
});

const buildEmploymentHtml = (values, lookups) => {
  const {
    companies = [], sectors = [], projects = [], departments = [],
    sections = [], designations = [], locations = []
  } = lookups;

  const blocks = [
    sectionCard('Employment Details', [
      fieldRow('Employee ID', values.employeeId),
      fieldRow('Qualification', values.qualification),
      fieldRow('Hire Date', formatDate(values.hireDate)),
      fieldRow('Appointment Date', formatDate(values.appointmentDate)),
      fieldRow('Probation Period', values.probationPeriodMonths != null ? `${values.probationPeriodMonths} months` : ''),
      fieldRow('End of Probation', formatDate(values.endOfProbationDate)),
      fieldRow('Confirmation Date', formatDate(values.confirmationDate)),
      fieldRow('Employee Category', categoryLabel(values.employeeCategory)),
      fieldRow('Active', values.isActive ? 'Yes' : 'No'),
      fieldRow('Employment Status', values.employmentStatus)
    ]),
    sectionCard('Placement & Assignment', [
      fieldRow('Company', resolveById(companies, values.placementCompany)),
      fieldRow('Sector', resolveById(sectors, values.placementSector)),
      fieldRow('Project', resolveById(projects, values.placementProject)),
      fieldRow('Department', resolveById(departments, values.placementDepartment)),
      fieldRow('Section', resolveById(sections, values.placementSection)),
      fieldRow('Designation', resolveById(designations, values.placementDesignation, 'title')),
      fieldRow('Old Designation', resolveById(designations, values.oldDesignation, 'title')),
      fieldRow('Location', resolveById(locations, values.placementLocation))
    ])
  ];

  if (values.jobDescription) {
    blocks.push(`
      <div class="card">
        <div class="card-head">Job Description</div>
        <div class="prose">${escapeHtml(values.jobDescription)}</div>
      </div>
    `);
  }

  (values.academicBackground || []).forEach((record, index) => {
    blocks.push(sectionCard(`Academic Record ${index + 1}`, [
      fieldRow('Degree', record.degree),
      fieldRow('Institution', record.institution),
      fieldRow('Field of Study', record.fieldOfStudy),
      fieldRow('Graduation Year', record.graduationYear),
      fieldRow('GPA', record.gpa),
      fieldRow('Percentage', record.percentage != null ? `${record.percentage}%` : ''),
      fieldRow('Grade', record.grade)
    ]));
  });

  (values.professionalEducation || []).forEach((course, index) => {
    blocks.push(sectionCard(`Professional Course ${index + 1}`, [
      fieldRow('Course Name', course.courseName),
      fieldRow('Institution', course.institution),
      fieldRow('Certification Body', course.certificationBody),
      fieldRow('Certificate Number', course.certificateNumber),
      fieldRow('Completion Date', formatDate(course.completionDate)),
      fieldRow('Expiry Date', formatDate(course.expiryDate)),
      fieldRow('Active', course.isActive !== false ? 'Yes' : 'No')
    ]));
  });

  (values.employmentHistory || []).forEach((record, index) => {
    blocks.push(sectionCard(`Employment History ${index + 1}`, [
      fieldRow('Company', record.companyName),
      fieldRow('Position', record.position),
      fieldRow('Start Date', formatDate(record.startDate)),
      fieldRow('End Date', record.isCurrentJob ? 'Present' : formatDate(record.endDate)),
      fieldRow('Location', record.location),
      record.salary ? fieldRow('Salary', formatPKR(record.salary), { money: true }) : '',
      fieldRow('Supervisor', record.supervisorName),
      fieldRow('Supervisor Contact', record.supervisorContact),
      fieldRow('Responsibilities', record.responsibilities),
      fieldRow('Reason for Leaving', record.reasonForLeaving)
    ]));
  });

  return wrapSectionDocument({
    pageTitle: `Employment Details — ${lookups.employeeLabel || 'Employee'}`,
    sectionTitle: 'Employment Details',
    employeeLabel: lookups.employeeLabel,
    employeeId: values.employeeId,
    bodyHtml: blocks.join('')
  });
};

const buildContactHtml = (values, lookups) => {
  const { countries = [], provinces = [], cities = [] } = lookups;

  return wrapSectionDocument({
    pageTitle: `Contact & Address — ${lookups.employeeLabel || 'Employee'}`,
    sectionTitle: 'Contact & Address',
    employeeLabel: lookups.employeeLabel,
    employeeId: values.employeeId,
    bodyHtml: [
      sectionCard('Address', [
        fieldRow('Street', values.address?.street),
        fieldRow('Country', resolveById(countries, values.address?.country)),
        fieldRow('State / Province', resolveById(provinces, values.address?.state)),
        fieldRow('City', resolveById(cities, values.address?.city))
      ]),
      sectionCard('Emergency Contact', [
        fieldRow('Name', values.emergencyContact?.name),
        fieldRow('Relationship', values.emergencyContact?.relationship),
        fieldRow('Phone', values.emergencyContact?.phone)
      ])
    ].join('')
  });
};

const buildSalaryHtml = (values, lookups) => {
  const { banks = [] } = lookups;
  const breakdown = computeAutoSalaryBreakdown(values.salary?.gross);
  const allowances = values.allowances || {};

  const allowanceRows = Object.entries(ALLOWANCE_LABELS).map(([key, label]) => {
    const entry = allowances[key];
    if (!entry?.isActive) return '';
    return fieldRow(label, formatPKR(entry.amount), { money: true });
  }).filter(Boolean);

  const partialPeriods = (values.partialSalaryPay?.periods || [])
    .map((p) => `${MONTH_NAMES[Number(p.month)] || p.month} ${p.year}`)
    .join(', ') || '—';

  const blocks = [
    sectionCard('Salary', [
      fieldRow('Gross Salary', formatPKR(values.salary?.gross), { money: true }),
      fieldRow('Basic (66.66%)', formatPKR(breakdown.basic), { money: true }),
      fieldRow('House Rent (23.34%)', formatPKR(breakdown.houseRent), { money: true }),
      fieldRow('Medical (10%)', formatPKR(breakdown.medical), { money: true })
    ]),
    sectionCard('Partial Monthly Pay', [
      fieldRow('Enabled', values.partialSalaryPay?.isActive ? 'Yes' : 'No'),
      values.partialSalaryPay?.isActive ? fieldRow('Payable Days / Month', values.partialSalaryPay?.payableDaysPerMonth) : '',
      values.partialSalaryPay?.isActive ? fieldRow('Selected Periods', partialPeriods) : ''
    ]),
    sectionCard('Allowances', allowanceRows.length ? allowanceRows : [fieldRow('Allowances', 'None active')]),
    sectionCard('Deductions & Tax', [
      fieldRow('EOBI Active', values.eobi?.isActive ? 'Yes' : 'No'),
      values.eobi?.isActive ? fieldRow('EOBI Amount', formatPKR(values.eobi?.amount || 370), { money: true }) : '',
      fieldRow('Provident Fund Active', values.providentFund?.isActive ? 'Yes' : 'No'),
      values.providentFund?.isActive ? fieldRow('Provident Fund Amount', formatPKR(values.providentFund?.amount), { money: true }) : '',
      fieldRow('Manual Tax Override', values.manualTax?.isActive ? 'Yes' : 'No'),
      values.manualTax?.isActive ? fieldRow('Fixed Tax Amount', formatPKR(values.manualTax?.fixedAmount), { money: true }) : ''
    ]),
    sectionCard('Bank Information', [
      fieldRow('Bank', resolveById(banks, values.bankName)),
      fieldRow('Account Number', values.bankAccountNumber),
      fieldRow('Foreign Account', values.foreignBankAccount)
    ])
  ];

  const vehicleAmt = vehicleAllowanceAmount(allowances);
  const fuelAmt = fuelAllowanceAmount(allowances);
  if (vehicleAmt > 0 || fuelAmt > 0) {
    const vRows = [];
    if (vehicleAmt > 0) vRows.push(fieldRow('Vehicle Allowance', formatPKR(vehicleAmt), { money: true }));
    if (fuelAmt > 0) vRows.push(fieldRow('Fuel Allowance', formatPKR(fuelAmt), { money: true }));
    blocks.push(sectionCard('Vehicle & Fuel', vRows));
  }

  return wrapSectionDocument({
    pageTitle: `Salary & Benefits — ${lookups.employeeLabel || 'Employee'}`,
    sectionTitle: 'Salary & Benefits',
    employeeLabel: lookups.employeeLabel,
    employeeId: values.employeeId,
    bodyHtml: blocks.join('')
  });
};

export const buildEmployeeFormStepPrintHtml = (stepIndex, values, options = {}) => {
  const employeeLabel = options.employeeLabel
    || `${values.firstName || ''} ${values.lastName || ''}`.trim()
    || values.joiningReport?.employeeName
    || '';

  const lookups = { ...options.lookups, employeeLabel };

  switch (stepIndex) {
    case 0:
      return buildJoiningReportPrintHtml(values.joiningReport || {}, employeeLabel);
    case 1:
      return buildPersonalHtml(values, { employeeLabel });
    case 2:
      return buildEmploymentHtml(values, lookups);
    case 3:
      return buildContactHtml(values, lookups);
    case 4:
      return buildSalaryHtml(values, lookups);
    default:
      return '';
  }
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

export const openPrintHtml = (html) => {
  if (!html) return { ok: false, message: 'Nothing to print.' };

  const existing = document.getElementById('employee-form-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'employee-form-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = 'Employee form print';
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

export const printEmployeeFormStep = (stepIndex, values, options = {}) => {
  const html = buildEmployeeFormStepPrintHtml(stepIndex, values, options);
  return openPrintHtml(html);
};

export default printEmployeeFormStep;
