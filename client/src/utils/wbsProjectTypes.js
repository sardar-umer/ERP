/** Project types that own a WBS activity master (matches ConstructionProject.projectType). */
export const WBS_PROJECT_TYPES = [
  { value: 'INFRASTRUCTURE DEVELOPMENT', label: 'Infrastructure' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'VILLAS', label: 'Villas' }
];

const LEGACY_PROJECT_TYPE_MAP = {
  Villa: 'VILLAS',
  Apartment: 'COMMERCIAL',
  'Commercial Building': 'COMMERCIAL',
  Infrastructure: 'INFRASTRUCTURE DEVELOPMENT'
};

/** Map a project's (possibly legacy) projectType onto a master type, or null. */
export const normalizeWbsProjectType = (value) => {
  if (!value) return null;
  if (WBS_PROJECT_TYPES.some((t) => t.value === value)) return value;
  return LEGACY_PROJECT_TYPE_MAP[value] || null;
};

/**
 * What the units built inside a Sub Project are called for its type: villas, floors / units of a
 * commercial building, or sections (road stretches, streets) of infrastructure work.
 */
const UNIT_NAMES = {
  VILLAS: ['Villa', 'Villas'],
  COMMERCIAL: ['Floor / Unit', 'Floors / Units'],
  'INFRASTRUCTURE DEVELOPMENT': ['Section', 'Sections']
};
export const unitWord = (projectType, plural = false) => {
  const names = UNIT_NAMES[normalizeWbsProjectType(projectType)] || ['Unit', 'Units'];
  return plural ? names[1] : names[0];
};

export const wbsProjectTypeLabel = (value) =>
  WBS_PROJECT_TYPES.find((t) => t.value === value)?.label || value || '—';

export const WBS_ACTIVITIES_PATH = '/general/project-management/wbs-activities';
export const SLAB_SCHEDULES_PATH = '/general/project-management/slabs';
