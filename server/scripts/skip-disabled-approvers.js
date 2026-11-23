/**
 * Move documents stuck with disabled approvers to their next step (utils/disabledApprovers).
 *
 *   node server/scripts/skip-disabled-approvers.js                     dry run: list what would move
 *   node server/scripts/skip-disabled-approvers.js --apply --backup=FILE   write (old values saved to FILE first)
 *   --disable=<userId>:<Name>[,<userId>:<Name>]   add approvers to SystemSettings.disabledApprovers first
 *   --enable=<userId>[,<userId>] --apply          take approvers off the list (documents already moved stay moved)
 *
 * Uses MONGODB_URI (and MONGODB_DB, default sgc_erp). Covers purchase orders and cash approvals (authority
 * slots / chain), indents and utility bills (chains), and the AVP step of manual salary, final settlement and loan.
 * The server must already run the code that knows the 'skipped' step state. New documents are skipped
 * automatically by the model save hooks; this script is for documents already waiting.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => (flag(name) || '').split('=').slice(1).join('=');
const APPLY = Boolean(flag('apply'));

require('../models/User');
const SystemSettings = require('../models/general/SystemSettings');
const PurchaseOrder = require('../models/procurement/PurchaseOrder');
const Indent = require('../models/general/Indent');
const UtilityBill = require('../models/hr/UtilityBill');
const CashApproval = require('../models/procurement/CashApproval');
const ManualSalary = require('../models/hr/ManualSalary');
const FinalSettlement = require('../models/hr/FinalSettlement');
const Loan = require('../models/hr/Loan');
const {
  getDisabledApprovers, skipOnPurchaseOrder, skipOnIndent, skipOnUtilityBill, skipOnCashApproval, skipOnHrAvp
} = require('../utils/disabledApprovers');

const FIELDS = {
  PurchaseOrder: ['status', 'authorityApprovals', 'workflowHistory'],
  Indent: ['status', 'approvalChain', 'workflowHistory', 'approvedDate', 'storeRoutingStatus'],
  UtilityBill: ['approvalStatus', 'approvalChain', 'workflowHistory', 'approvedAt', 'auditStatus'],
  CashApproval: ['status', 'authorityApprovals', 'departmentApprovalChain', 'departmentApprovalStatus', 'departmentApprovedAt', 'workflowHistory'],
  ManualSalary: ['workflowStatus', 'avpComments', 'workflowHistory'],
  FinalSettlement: ['workflowStatus', 'avpComments'],
  Loan: ['workflowStatus', 'avpComments']
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB || 'sgc_erp',
    directConnection: true,
    serverSelectionTimeoutMS: 10000
  });

  const toEnable = value('enable');
  if (toEnable) {
    const ids = toEnable.split(',').map((id) => new mongoose.Types.ObjectId(id.trim()));
    if (APPLY) await SystemSettings.updateOne({ key: 'default' }, { $pull: { disabledApprovers: { user: { $in: ids } } } });
    console.log(`${APPLY ? 'Enabled' : 'Would enable'}: ${toEnable}`);
    process.exit(0);
  }

  const toDisable = value('disable');
  if (toDisable) {
    const settings = await SystemSettings.findOne({ key: 'default' }).select('disabledApprovers').lean();
    const existing = new Set((settings?.disabledApprovers || []).map((e) => String(e.user)));
    const add = toDisable.split(',').map((p) => {
      const [id, ...rest] = p.split(':');
      return { user: new mongoose.Types.ObjectId(id.trim()), name: rest.join(':').trim(), reason: 'Disabled on request', disabledAt: new Date() };
    }).filter((e) => !existing.has(String(e.user)));
    if (add.length) {
      if (APPLY) await SystemSettings.updateOne({ key: 'default' }, { $push: { disabledApprovers: { $each: add } } });
      console.log(`${APPLY ? 'Disabled' : 'Would disable'}: ${add.map((a) => a.name).join(', ')}`);
    }
  }

  let disabled = await getDisabledApprovers();
  if (!APPLY && toDisable) {
    // Dry run: use the requested list without saving it
    disabled = toDisable.split(',').map((p) => {
      const [id, ...rest] = p.split(':');
      const name = rest.join(':').trim();
      return { id: id.trim(), name, tokens: [name.toLowerCase().replace(/\s+/g, ' ')] };
    }).concat(disabled.filter((d) => !toDisable.includes(d.id)));
  }
  if (!disabled.length) {
    console.log('No disabled approvers configured — nothing to do.');
    process.exit(0);
  }
  console.log('Disabled approvers:', disabled.map((d) => d.name).join(', '));

  const jobs = [
    { model: PurchaseOrder, label: 'PurchaseOrder', number: 'orderNumber', query: { status: 'Pending Approval' }, skip: skipOnPurchaseOrder },
    { model: Indent, label: 'Indent', number: 'indentNumber', query: { status: { $in: ['Submitted', 'Under Review'] }, 'approvalChain.status': 'pending' }, skip: skipOnIndent },
    { model: UtilityBill, label: 'UtilityBill', number: 'billId', query: { approvalStatus: 'Submitted', 'approvalChain.status': 'pending' }, skip: skipOnUtilityBill },
    { model: CashApproval, label: 'CashApproval', number: 'caNumber', query: { status: 'Pending Approval' }, skip: skipOnCashApproval },
    { model: ManualSalary, label: 'ManualSalary', number: 'name', query: { workflowStatus: 'Pending AVP' }, skip: (d, x) => skipOnHrAvp(d, x, 'ManualSalary') },
    { model: FinalSettlement, label: 'FinalSettlement', number: '_id', query: { workflowStatus: 'Pending AVP' }, skip: (d, x) => skipOnHrAvp(d, x, 'FinalSettlement') },
    { model: Loan, label: 'Loan', number: 'loanNumber', query: { workflowStatus: 'Pending AVP' }, skip: (d, x) => skipOnHrAvp(d, x, 'Loan') }
  ];

  const backup = [];
  const changes = [];
  for (const job of jobs) {
    const docs = await job.model.find(job.query);
    for (const doc of docs) {
      const before = doc.toObject();
      const r = await job.skip(doc, disabled);
      if (!r.skipped.length) continue;
      const after = doc.toObject();
      const set = {};
      FIELDS[job.label].forEach((f) => { if (after[f] !== undefined) set[f] = after[f]; });
      set.updatedAt = new Date();
      const old = {};
      FIELDS[job.label].concat('updatedAt').forEach((f) => { old[f] = before[f] === undefined ? null : before[f]; });
      backup.push({ model: job.label, _id: String(doc._id), number: doc[job.number], old });
      changes.push({ job, doc, set, r, statusBefore: before.workflowStatus || before.status || before.approvalStatus, statusAfter: after.workflowStatus || after.status || after.approvalStatus });
    }
  }

  changes.forEach(({ job, doc, r, statusBefore, statusAfter }) => {
    console.log(`${job.label} ${doc[job.number]} | skipped: ${r.skipped.join('; ')} | ${statusBefore} -> ${statusAfter}`);
  });
  console.log(`\n${changes.length} document(s) ${APPLY ? 'to update' : 'would move'}.`);

  if (APPLY && changes.length) {
    const backupFile = value('backup');
    if (!backupFile) throw new Error('--backup=FILE is required with --apply');
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.writeFileSync(backupFile, JSON.stringify({ takenAt: new Date(), disabled: disabled.map((d) => d.name), documents: backup }, null, 2));
    console.log('Backup written:', backupFile);
    for (const { job, doc, set } of changes) {
      // $set only the workflow fields, so unrelated old data is not re-validated
      await job.model.collection.updateOne({ _id: doc._id }, { $set: set });
    }
    console.log('Updated.');
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
