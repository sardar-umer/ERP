/**
 * One-time backfill for Main Projects created before "Project Type + BOQ-wise / Slab-wise" was chosen on the Main Project.
 *
 * For every Main Project without a contract basis:
 *   - contract basis = the kind of its sublet contracts when they are all one kind (all Slab → Slab, all BOQ → BOQ);
 *     left empty when it has none or a mix (set it by editing the Main Project)
 *   - project type   = its Sub Projects' type when they all share one, if the Main Project's differs
 *   - the basis is then copied to its Sub Projects (their own project type is not touched)
 *
 * Dry run by default; pass --apply to write.
 * Uses the same MongoDB selection rules as the API (server/config/database.js).
 *
 * Examples:
 *   node server/scripts/backfill-project-contract-basis.js
 *   node server/scripts/backfill-project-contract-basis.js --apply
 *   SGC_ENV_FILE=.env.production node server/scripts/backfill-project-contract-basis.js --apply
 */

const path = require('path');
const fsSync = require('fs');

const repoRoot = path.join(__dirname, '..', '..');
[path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')].forEach((file, i) => {
  if (fsSync.existsSync(file)) require('dotenv').config({ path: file, override: i > 0 });
});
if (process.env.SGC_ENV_FILE) {
  const extra = path.isAbsolute(process.env.SGC_ENV_FILE) ? process.env.SGC_ENV_FILE : path.join(process.cwd(), process.env.SGC_ENV_FILE);
  if (fsSync.existsSync(extra)) require('dotenv').config({ path: extra, override: true });
  else console.warn(`SGC_ENV_FILE set but file not found: ${extra}`);
}

const mongoose = require('mongoose');
const { getMongoUri, getMongooseClientOptions } = require('../config/database');
const ConstructionProject = require('../models/projectManagement/ConstructionProject');
const SubletContract = require('../models/projectManagement/SubletContract');

const APPLY = process.argv.includes('--apply');
const MAIN_PROJECT_TYPES = ['INFRASTRUCTURE DEVELOPMENT', 'COMMERCIAL', 'VILLAS'];
const LEGACY_TYPE = { Villa: 'VILLAS', Apartment: 'COMMERCIAL', 'Commercial Building': 'COMMERCIAL', Infrastructure: 'INFRASTRUCTURE DEVELOPMENT' };
const normalType = (t) => (MAIN_PROJECT_TYPES.includes(t) ? t : LEGACY_TYPE[t] || null);

async function main() {
  const { uri, isLocal } = getMongoUri();
  if (!uri) {
    console.error('No MongoDB URI resolved (set MONGODB_URI_LOCAL or MONGODB_URI).');
    process.exit(1);
  }
  await mongoose.connect(uri, getMongooseClientOptions(uri, isLocal));
  console.log(`\nbackfill-project-contract-basis — ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to write)'}\n`);

  const mains = await ConstructionProject.find({ parentProject: null, status: { $ne: 'Cancelled' } })
    .select('name projectNumber projectType contractBasis').lean();
  let changed = 0;

  for (const m of mains) {
    const subs = await ConstructionProject.find({ parentProject: m._id }).select('name projectType contractBasis').lean();
    const subIds = subs.map((s) => s._id);
    const kinds = [...new Set((await SubletContract.find({ project: { $in: subIds }, status: { $ne: 'Cancelled' } })
      .select('contractType').lean()).map((c) => (c.contractType === 'Slab' ? 'Slab' : 'BOQ')))];
    const subTypes = [...new Set(subs.map((s) => normalType(s.projectType)).filter(Boolean))];

    const set = {};
    if (!m.contractBasis && kinds.length === 1) set.contractBasis = kinds[0];
    if (subTypes.length === 1 && m.projectType !== subTypes[0]) set.projectType = subTypes[0];
    const basis = set.contractBasis || m.contractBasis || null;
    const subsToUpdate = basis ? subs.filter((s) => s.contractBasis !== basis) : [];

    const note = [];
    if (!m.contractBasis && !kinds.length) note.push('no contracts yet — choose BOQ-wise / Slab-wise by editing it');
    if (kinds.length > 1) note.push('has BOQ-wise AND Slab-wise contracts — left unset, decide by editing it');
    if (subTypes.length > 1) note.push(`sub projects have different types (${subTypes.join(', ')}) — main type left as is`);

    if (!Object.keys(set).length && !subsToUpdate.length) {
      console.log(`• ${m.name}: nothing to change${note.length ? ` (${note.join('; ')})` : ''}`);
      continue;
    }
    changed += 1;
    console.log(`• ${m.name}: ${Object.entries(set).map(([k, v]) => `${k} → ${v}`).join(', ') || 'main unchanged'}`
      + `${subsToUpdate.length ? `; ${subsToUpdate.length} sub project(s) → ${basis}` : ''}${note.length ? ` (${note.join('; ')})` : ''}`);
    if (APPLY) {
      if (Object.keys(set).length) await ConstructionProject.updateOne({ _id: m._id }, { $set: set });
      if (subsToUpdate.length) await ConstructionProject.updateMany({ _id: { $in: subsToUpdate.map((s) => s._id) } }, { $set: { contractBasis: basis } });
    }
  }

  console.log(`\n${changed} main project(s) ${APPLY ? 'updated' : 'would be updated'}.\n`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
