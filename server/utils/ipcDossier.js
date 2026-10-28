const mongoose = require('mongoose');

/**
 * IPC dossier: the certificate plus every supporting record a reviewer needs (Pre-Audit, Audit Director,
 * CEO Office, CEO, Finance) — parties, sublet contract and its progress, the verified check request,
 * inspection reports with site evidence, earlier IPCs to the same subcontractor, project documents,
 * subcontractor balances (retention / advance) and the Finance hand-off. Read-only.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const NON_WORK = ['Advance', 'Retention Release'];

const projectSummary = (p) => (p ? {
  _id: p._id,
  name: p.name,
  projectNumber: p.projectNumber,
  projectType: p.projectType,
  sector: p.sector,
  society: p.society,
  street: p.street,
  side: p.side,
  address: p.address,
  status: p.status,
  startDate: p.startDate,
  expectedEndDate: p.expectedEndDate,
  contractValue: p.contractValue,
  overallProgress: p.overallProgress,
  clientName: p.clientName,
  documents: (p.documents || []).map((d) => ({
    _id: d._id, name: d.originalName || d.filename, url: d.url, category: d.category || 'General',
    uploadedAt: d.uploadedAt, uploadedBy: d.uploadedBy ? [d.uploadedBy.firstName, d.uploadedBy.lastName].filter(Boolean).join(' ') : ''
  }))
} : null);

/**
 * @param {object} ipc populated, lean ProjectInvoice (as GET /ipcs/:id returns it)
 * @param {{ subcontractorBalances: Function, resolveProjectCompanyId: Function }} helpers
 */
const buildIpcDossier = async (ipc, { subcontractorBalances, resolveProjectCompanyId }) => {
  const ConstructionProject = mongoose.model('ConstructionProject');
  const ProjectInvoice = mongoose.model('ProjectInvoice');
  const CheckRequest = mongoose.model('CheckRequest');
  const SubletContract = mongoose.model('SubletContract');
  const InspectionReport = mongoose.model('InspectionReport');
  const Supplier = mongoose.model('Supplier');
  const PlacementCompany = mongoose.model('PlacementCompany');

  const projectId = ipc.project?._id || ipc.project;
  const contractorId = ipc.contractor?._id || ipc.contractor;
  const checkRequestId = ipc.checkRequest?._id || ipc.checkRequest;

  const [subProject, checkRequest, contractor] = await Promise.all([
    ConstructionProject.findById(projectId).populate('documents.uploadedBy', 'firstName lastName').lean(),
    checkRequestId
      ? CheckRequest.findById(checkRequestId)
        .populate('activity', 'name code').populate('submittedBy verifiedByUser', 'firstName lastName')
        .lean()
      : null,
    contractorId ? Supplier.findById(contractorId).select('name contactPerson phone email address ntnCnic payeeName vendorCategory').lean() : null
  ]);

  // Main Project = top of the chain
  let mainProject = subProject;
  for (let depth = 0; mainProject?.parentProject && depth < 10; depth += 1) {
    mainProject = await ConstructionProject.findById(mainProject.parentProject).populate('documents.uploadedBy', 'firstName lastName').lean();
  }
  const companyId = await resolveProjectCompanyId(subProject);
  const company = companyId ? await PlacementCompany.findById(companyId).select('name code contactInfo website').lean() : null;

  const contractId = ipc.subletContract?._id || ipc.subletContract || checkRequest?.subletContract || null;
  const [contract, inspections] = await Promise.all([
    contractId ? SubletContract.findById(contractId).populate('createdBy', 'firstName lastName').lean() : null,
    checkRequestId
      ? InspectionReport.find({ checkRequest: checkRequestId }).sort({ inspectionDate: 1 })
        .populate('createdBy', 'firstName lastName').lean()
      : []
  ]);

  // Earlier IPCs to this subcontractor on this sub-project (any kind), oldest first
  const history = projectId && contractorId
    ? await ProjectInvoice.find({
      project: projectId, contractor: contractorId, invoiceType: 'Subcontractor_IPC', _id: { $ne: ipc._id }
    }).select('invoiceNumber ipcNumber ipcKind issueDate grossAmount retentionAmount advanceRecoveryAmount whtAmount netPayableAmount approvalStatus status paidAmount subletContract checkRequest financeBillNumber')
      .sort({ issueDate: 1, ipcNumber: 1 }).lean()
    : [];

  // Contract progress: work certified on this contract before / including this IPC
  const live = (r) => r.status !== 'Cancelled' && !['Rejected', 'Draft'].includes(r.approvalStatus || 'Draft');
  const sameContract = (r) => contractId && String(r.subletContract || '') === String(contractId);
  const workBefore = history.filter((r) => !NON_WORK.includes(r.ipcKind) && live(r) && (contractId ? sameContract(r) : true));
  const certifiedApproved = r2(workBefore.filter((r) => r.approvalStatus === 'Approved').reduce((t, r) => t + (r.grossAmount || 0), 0));
  const certifiedInApproval = r2(workBefore.filter((r) => r.approvalStatus !== 'Approved').reduce((t, r) => t + (r.grossAmount || 0), 0));
  const thisGross = NON_WORK.includes(ipc.ipcKind) ? 0 : r2(ipc.grossAmount);
  const contractValue = r2(contract?.totalAmount || 0);
  const certifiedToDate = r2(certifiedApproved + certifiedInApproval + thisGross);

  const balances = projectId && contractorId ? await subcontractorBalances(projectId, contractorId, ipc._id) : null;

  const ap = ipc.financeApBillId
    ? await mongoose.model('AccountsPayable').findById(ipc.financeApBillId)
      .select('billNumber totalAmount amountPaid advanceApplied status payments.amount payments.paymentDate payments.paymentMethod payments.reference').lean()
    : null;

  return {
    ipc,
    company,
    contractor,
    mainProject: projectSummary(mainProject && String(mainProject._id) !== String(subProject?._id) ? mainProject : null),
    subProject: projectSummary(subProject),
    contract: contract ? {
      _id: contract._id,
      contractNumber: contract.contractNumber,
      title: contract.title,
      contractType: contract.contractType,
      status: contract.status,
      startDate: contract.startDate,
      endDate: contract.endDate,
      totalAmount: contractValue,
      notes: contract.notes,
      createdBy: contract.createdBy ? [contract.createdBy.firstName, contract.createdBy.lastName].filter(Boolean).join(' ') : '',
      items: (contract.items || []).map((i) => ({ title: i.title || i.description, unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount })),
      slabs: (contract.slabs || []).map((s) => ({ name: s.name, percentage: s.percentage, amount: s.amount, activities: (s.activities || []).map((a) => a.name).filter(Boolean) }))
    } : null,
    contractProgress: contract ? {
      contractValue,
      certifiedApproved,
      certifiedInApproval,
      thisIpc: thisGross,
      certifiedToDate,
      remaining: r2(Math.max(0, contractValue - certifiedToDate)),
      percent: contractValue > 0 ? Math.round((certifiedToDate / contractValue) * 1000) / 10 : null,
      overrun: contractValue > 0 && certifiedToDate > contractValue + 0.01
    } : null,
    checkRequest: checkRequest ? {
      _id: checkRequest._id,
      checkRequestNumber: checkRequest.checkRequestNumber,
      title: checkRequest.title,
      claimType: checkRequest.claimType,
      activity: checkRequest.activity?.name || '',
      status: checkRequest.status,
      slab: checkRequest.slab,
      claimedTotal: checkRequest.claimedTotal,
      verifiedTotal: checkRequest.verifiedTotal,
      submittedAt: checkRequest.submittedAt,
      submittedBy: checkRequest.submittedBy ? [checkRequest.submittedBy.firstName, checkRequest.submittedBy.lastName].filter(Boolean).join(' ') : '',
      verifiedAt: checkRequest.verifiedAt,
      verifiedBy: checkRequest.verifiedBy || (checkRequest.verifiedByUser ? [checkRequest.verifiedByUser.firstName, checkRequest.verifiedByUser.lastName].filter(Boolean).join(' ') : ''),
      verificationNotes: checkRequest.verificationNotes,
      verificationPhotoUrl: checkRequest.verificationPhotoUrl,
      notes: checkRequest.notes,
      items: (checkRequest.items || []).map((i) => ({
        title: i.title || i.description, unit: i.unit,
        claimedQuantity: i.claimedQuantity, verifiedQuantity: i.verifiedQuantity, unitPrice: i.unitPrice,
        claimedAmount: i.claimedAmount, verifiedAmount: i.verifiedAmount, notes: i.notes
      }))
    } : null,
    inspections: inspections.map((r) => ({
      _id: r._id,
      reportNumber: r.reportNumber,
      inspectionDate: r.inspectionDate,
      location: r.location,
      remarks: r.remarks,
      status: r.status,
      claimType: r.claimType,
      inspectedTotal: r.inspectedTotal,
      slab: r.slab,
      items: r.items || [],
      inspectors: (r.inspectors || []).map((i) => ({
        name: i.name, designation: i.designation, status: i.status, observations: i.observations,
        signature: i.signature, actedAt: i.actedAt, attachments: i.attachments || []
      }))
    })),
    previousIpcs: history.map((h) => ({ ...h, sameContract: Boolean(sameContract(h)) })),
    balances,
    finance: ap ? {
      billNumber: ap.billNumber, totalAmount: ap.totalAmount, status: ap.status,
      paid: r2((ap.amountPaid || 0) + (ap.advanceApplied || 0)), payments: ap.payments || []
    } : (ipc.financeBillNumber ? { billNumber: ipc.financeBillNumber } : null),
    generatedAt: new Date()
  };
};

module.exports = { buildIpcDossier };
