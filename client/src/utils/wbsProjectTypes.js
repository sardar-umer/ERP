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

export const wbsProjectTypeLabel = (value) =>
  WBS_PROJECT_TYPES.find((t) => t.value === value)?.label || value || '—';

export const WBS_ACTIVITIES_PATH = '/general/project-management/wbs-activities';
export const SLAB_SCHEDULES_PATH = '/general/project-management/slabs';
