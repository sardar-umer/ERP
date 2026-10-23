/**
 * Resolve candidate rows for New-Hiring Approval.
 * Newer records use `employees[]`; older CEO-approved docs store flat fields.
 */
export function getNewHiringEmployees(record) {
  if (!record) return [];
  if (Array.isArray(record.employees) && record.employees.length > 0) {
    return record.employees;
  }

  const hasLegacy =
    record.firstName
    || record.lastName
    || record.name
    || record.cnic
    || record.role
    || record.designation
    || record.expectedWages != null
    || record.currentPackageMonthly != null;

  if (!hasLegacy) return [];

  const name = String(record.name || '').trim()
    || [record.firstName, record.lastName].filter(Boolean).join(' ').trim();

  return [{
    name,
    cnic: record.cnic || '',
    designation: record.designation || record.role || '',
    departmentSubject: record.departmentSubject || record.department || '',
    project: record.project || '',
    location: record.location || '',
    currentPackageMonthly: record.currentPackageMonthly != null && String(record.currentPackageMonthly).trim() !== ''
      ? String(record.currentPackageMonthly)
      : (record.expectedWages != null ? String(record.expectedWages) : ''),
    tentativeDoj: record.tentativeDoj || null,
    remark: record.remark || record.justification || '',
    firstName: record.firstName,
    lastName: record.lastName,
    role: record.role,
    expectedWages: record.expectedWages,
    justification: record.justification
  }];
}

export function formatNewHiringPackage(value) {
  if (value == null || String(value).trim() === '' || String(value) === '0') return '—';
  const n = Number(value);
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(String(value).trim())) {
    return n.toLocaleString('en-PK');
  }
  return String(value);
}

/** Tentative DOJ is free text; format ISO dates nicely, otherwise show as typed. */
export function formatNewHiringDoj(value) {
  if (value == null || String(value).trim() === '') return '—';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }
  return raw;
}

const authorityPersonLabel = (user) => {
  if (!user) return '';
  if (typeof user === 'string') return 'Approved';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Approved';
};

/**
 * Approval authority cards for New-Hiring.
 * Older CEO-approved docs used HOD → AVP → CEO only (no Chairman / Sr Director).
 * Those skipped stages must not show as "Pending".
 */
export function getNewHiringAuthorityCards(record) {
  if (!record) return [];
  const fullyApproved = record.workflowStatus === 'Approved by CEO';

  const stages = [
    {
      key: 'hod',
      label: 'HOD HR',
      user: record.hodApprovedBy,
      at: record.hodApprovedAt,
      sig: record.hodSignature,
      assigned: record.assignedHod
    },
    {
      key: 'avp',
      label: 'AVP (Taj Fahad Farid)',
      user: record.avpApprovedBy,
      at: record.avpApprovedAt,
      sig: record.avpSignature,
      assigned: record.assignedAvp
    },
    {
      key: 'chairman',
      label: 'Chairman Steering Committee',
      user: record.chairmanApprovedBy,
      at: record.chairmanApprovedAt,
      sig: record.chairmanSignature,
      assigned: record.assignedChairman
    },
    {
      key: 'srDirector',
      label: 'Sr Director (Hamza Tanveer)',
      user: record.srDirectorApprovedBy,
      at: record.srDirectorApprovedAt,
      sig: record.srDirectorSignature,
      assigned: record.assignedSrDirector
    },
    {
      key: 'ceo',
      label: 'CEO Secretariat',
      user: record.ceoApprovedBy,
      at: record.ceoApprovedAt,
      sig: record.ceoSignature,
      assigned: true
    }
  ];

  const cards = stages
    .map((stage) => {
      if (stage.user) {
        return {
          ...stage,
          statusLabel: authorityPersonLabel(stage.user),
          statusKind: 'approved'
        };
      }
      // Skipped later-added stages on completed legacy workflow
      if (fullyApproved && !stage.assigned && (stage.key === 'chairman' || stage.key === 'srDirector')) {
        return null;
      }
      if (fullyApproved) {
        return {
          ...stage,
          statusLabel: 'Approved',
          statusKind: 'approved'
        };
      }
      return {
        ...stage,
        statusLabel: 'Pending',
        statusKind: 'pending'
      };
    })
    .filter(Boolean);

  // Hardcoded display-only authority (after CEO) — not part of workflow
  cards.push({
    key: 'president',
    label: 'President SGC',
    statusLabel: 'Sardar Tanveer Ilyas khan',
    statusKind: 'display',
    user: null,
    at: null,
    sig: null,
    assigned: true
  });

  return cards;
}
