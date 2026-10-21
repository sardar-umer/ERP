const NonEmployeeRecord = require('../../models/hr/NonEmployeeRecord');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const {
  sameUserId,
  isDevNewEmployeeSrDirectorApprover
} = require('../../utils/executiveAccess');

const optionalUserId = (value) => {
  if (value === undefined || value === null || value === '' || value === 'null' || value === 'undefined') {
    return undefined;
  }
  return value;
};

const actorUserId = (user) => String(user?.id || user?._id || '');

const canActAsAssignedOrDevSrDirector = (assignedField, user) => {
  if (!assignedField) return true;
  if (sameUserId(assignedField, actorUserId(user))) return true;
  return isDevNewEmployeeSrDirectorApprover(user);
};

const RESUBMITTABLE_STATUSES = new Set(['Returned', 'Rejected by CEO', 'Draft']);

const RESUBMIT_TARGET_STATUSES = new Set([
  'Pending HOD HR',
  'Pending AVP',
  'Pending Chairman',
  'Pending Sr Director',
  'Forwarded to CEO'
]);

const STAGE_ORDER = [
  'Pending HOD HR',
  'Pending AVP',
  'Pending Chairman',
  'Pending Sr Director',
  'Forwarded to CEO'
];

const EMPTY_STAGE_APPROVAL = {
  by: undefined,
  at: undefined,
  comments: undefined,
  sig: undefined
};

const readStageApprovals = (record) => ({
  hod: {
    by: record.hodApprovedBy,
    at: record.hodApprovedAt,
    comments: record.hodComments,
    sig: record.hodSignature
  },
  avp: {
    by: record.avpApprovedBy,
    at: record.avpApprovedAt,
    comments: record.avpComments,
    sig: record.avpSignature
  },
  chairman: {
    by: record.chairmanApprovedBy,
    at: record.chairmanApprovedAt,
    comments: record.chairmanComments,
    sig: record.chairmanSignature
  },
  sr: {
    by: record.srDirectorApprovedBy,
    at: record.srDirectorApprovedAt,
    comments: record.srDirectorComments,
    sig: record.srDirectorSignature
  },
  ceo: {
    by: record.ceoApprovedBy,
    at: record.ceoApprovedAt,
    comments: record.ceoComments,
    sig: record.ceoSignature
  }
});

const writeStageApprovals = (record, snap) => {
  record.hodApprovedBy = snap.hod.by;
  record.hodApprovedAt = snap.hod.at;
  record.hodComments = snap.hod.comments;
  record.hodSignature = snap.hod.sig;
  record.avpApprovedBy = snap.avp.by;
  record.avpApprovedAt = snap.avp.at;
  record.avpComments = snap.avp.comments;
  record.avpSignature = snap.avp.sig;
  record.chairmanApprovedBy = snap.chairman.by;
  record.chairmanApprovedAt = snap.chairman.at;
  record.chairmanComments = snap.chairman.comments;
  record.chairmanSignature = snap.chairman.sig;
  record.srDirectorApprovedBy = snap.sr.by;
  record.srDirectorApprovedAt = snap.sr.at;
  record.srDirectorComments = snap.sr.comments;
  record.srDirectorSignature = snap.sr.sig;
  record.ceoApprovedBy = snap.ceo.by;
  record.ceoApprovedAt = snap.ceo.at;
  record.ceoComments = snap.ceo.comments;
  record.ceoSignature = snap.ceo.sig;
};

/**
 * On resubmit: keep every earlier authority's approval + signature.
 * Only clear the rejector's stage and any later stages.
 * Example: CEO return → keep HOD / AVP / Chairman / Sr Director; clear CEO only.
 */
const clearApprovalsFromStage = (record, fromStatus) => {
  const idx = STAGE_ORDER.indexOf(fromStatus);
  const start = idx < 0 ? 0 : idx;
  const snap = readStageApprovals(record);

  writeStageApprovals(record, {
    hod: start > 0 ? snap.hod : EMPTY_STAGE_APPROVAL,
    avp: start > 1 ? snap.avp : EMPTY_STAGE_APPROVAL,
    chairman: start > 2 ? snap.chairman : EMPTY_STAGE_APPROVAL,
    sr: start > 3 ? snap.sr : EMPTY_STAGE_APPROVAL,
    ceo: start > 4 ? snap.ceo : EMPTY_STAGE_APPROVAL
  });
};

const normalizeReturnObservations = (observations, userId) => {
  const list = Array.isArray(observations) ? observations : [];
  return list
    .map((obs) => {
      const text = String(obs?.observation || obs?.text || (typeof obs === 'string' ? obs : '') || '').trim();
      if (!text) return null;
      const severity = String(obs?.severity || 'medium').toLowerCase();
      return {
        observation: text,
        severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium',
        addedBy: userId || undefined,
        addedAt: new Date(),
        resolved: false
      };
    })
    .filter(Boolean);
};

const userDisplayName = async (userId) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return '';
  try {
    const u = await mongoose.model('User').findById(userId).select('firstName lastName email').lean();
    if (!u) return '';
    return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || '';
  } catch (e) {
    return '';
  }
};

/** Parse per-observation responses sent by the form (JSON string or array). */
const parseObservationResponses = (raw) => {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch (e) { list = []; }
  }
  return Array.isArray(list) ? list : [];
};

/**
 * Snapshot the current return feedback + initiator's reply into resubmissionHistory.
 * Must run before return fields are cleared.
 */
const appendResubmissionHistory = async (record, { initiatorComment, responses, actorId, targetStatus }) => {
  const responseFor = (obs, idx) => {
    const id = obs?._id ? String(obs._id) : '';
    const hit = responses.find((r) => (id && String(r?.observationId || '') === id))
      || responses.find((r) => Number(r?.index) === idx);
    return String(hit?.response || '').trim();
  };
  const observations = (record.returnObservations || [])
    .filter((o) => String(o?.observation || '').trim())
    .map((o, idx) => ({
      observation: o.observation,
      severity: o.severity || 'medium',
      response: responseFor(o, idx)
    }));

  const returnedById = record.returnedBy?._id || record.returnedBy || null;
  const [returnedByName, resubmittedByName] = await Promise.all([
    userDisplayName(returnedById),
    userDisplayName(actorId)
  ]);

  if (!Array.isArray(record.resubmissionHistory)) record.resubmissionHistory = [];
  record.resubmissionHistory.push({
    returnedFromStatus: record.returnedFromStatus || targetStatus || '',
    returnedBy: returnedById || undefined,
    returnedByName,
    returnedAt: record.returnedAt || record.updatedAt || undefined,
    returnComments: record.returnComments || record.rejectionComments || '',
    observations,
    initiatorComment,
    resubmittedBy: actorId || undefined,
    resubmittedByName,
    resubmittedAt: new Date(),
    resubmittedTo: targetStatus
  });
};

const markReturnedToInitiator = (record, comments, fromStatus, { observations, userId } = {}) => {
  const target = RESUBMIT_TARGET_STATUSES.has(fromStatus) ? fromStatus : 'Pending HOD HR';
  record.workflowStatus = 'Returned';
  record.returnedFromStatus = target;
  record.returnComments = comments || '';
  record.rejectionComments = comments || record.rejectionComments || '';
  record.returnedBy = userId || undefined;
  record.returnedAt = new Date();
  const normalizedObs = normalizeReturnObservations(observations, userId);
  if (normalizedObs.length) {
    record.returnObservations = normalizedObs;
  }
  return record;
};

/**
 * Resolve where resubmit should go.
 * Prefer saved returnedFromStatus; otherwise infer from current status / approvals
 * (covers older returns that never persisted returnedFromStatus).
 */
const resolveResubmitTarget = (record, currentStatus, bodyHint) => {
  if (RESUBMIT_TARGET_STATUSES.has(record.returnedFromStatus)) {
    return record.returnedFromStatus;
  }
  if (RESUBMIT_TARGET_STATUSES.has(bodyHint)) {
    return bodyHint;
  }
  if (currentStatus === 'Rejected by CEO') {
    return 'Forwarded to CEO';
  }
  // Infer from furthest intact approval (CEO/Sr return leaves prior stage approvals)
  if (record.srDirectorApprovedBy) return 'Forwarded to CEO';
  if (record.chairmanApprovedBy) return 'Pending Sr Director';
  if (record.avpApprovedBy) return 'Pending Chairman';
  if (record.hodApprovedBy) return 'Pending AVP';
  return 'Pending HOD HR';
};

/** Full populate used whenever initiator/CEO need to see approval authorities. */
const populateApprovalAuthorities = (query) =>
  query
    .populate('initiator', 'firstName lastName email')
    .populate('assignedHod', 'firstName lastName email')
    .populate('assignedSrDirector', 'firstName lastName email')
    .populate('assignedAvp', 'firstName lastName email')
    .populate('assignedChairman', 'firstName lastName email')
    .populate('hodApprovedBy', 'firstName lastName email')
    .populate('srDirectorApprovedBy', 'firstName lastName email')
    .populate('avpApprovedBy', 'firstName lastName email')
    .populate('chairmanApprovedBy', 'firstName lastName email')
    .populate('ceoApprovedBy', 'firstName lastName email')
    .populate('returnObservations.addedBy', 'firstName lastName email')
    .populate('returnedBy', 'firstName lastName email');

/** Older approved docs stored flat candidate fields; expose them as employees[] for all clients. */
const withEmployeesShape = (record) => {
  if (!record) return record;
  const obj = typeof record.toObject === 'function' ? record.toObject() : { ...record };
  if (Array.isArray(obj.employees) && obj.employees.length > 0) return obj;
  const hasLegacy = obj.firstName || obj.lastName || obj.name || obj.cnic || obj.role || obj.designation
    || obj.expectedWages != null || obj.currentPackageMonthly != null;
  if (!hasLegacy) return obj;
  obj.employees = [NonEmployeeRecord.normalizeEmployeeLine(obj)];
  return obj;
};

exports.createRecord = async (req, res) => {
  try {
    const { employees, assignedHod, assignedSrDirector, assignedAvp, assignedChairman } = req.body;
    
    // Support legacy client sending a stringified employees array in FormData
    let parsedEmployees = employees;
    if (typeof employees === 'string') {
      try {
        parsedEmployees = JSON.parse(employees);
      } catch (e) {
        parsedEmployees = [];
      }
    }

    const autoSignature = req.body.requesterSignature || (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.email);

    const normalizedEmployees = (Array.isArray(parsedEmployees) ? parsedEmployees : [])
      .map((e) => NonEmployeeRecord.normalizeEmployeeLine(e));

    if (normalizedEmployees.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Add at least one candidate row.'
      });
    }

    const record = new NonEmployeeRecord({
      employees: normalizedEmployees,
      requesterSignature: autoSignature,
      assignedHod: optionalUserId(assignedHod),
      assignedSrDirector: optionalUserId(assignedSrDirector),
      assignedAvp: optionalUserId(assignedAvp),
      assignedChairman: optionalUserId(assignedChairman),
      workflowStatus: 'Pending HOD HR',
      initiator: req.user.id,
    });

    if (req.files && req.files.length > 0) {
      record.attachments = req.files.map(f => ({
        filename: f.filename,
        originalName: f.originalname,
        url: f.path,
      }));
    }

    await record.save();

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    console.error('Error creating NonEmployeeRecord:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.updateRecord = async (req, res) => {
  try {
    let record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    const isDeveloper = req.user.email === 'developer@tovus.net';
    const actorId = actorUserId(req.user);
    const initiatorId = String(record.initiator?._id || record.initiator || '');
    const isInitiator = Boolean(actorId && initiatorId && actorId === initiatorId);
    const status = record.workflowStatus;

    if (!isDeveloper && status === 'Approved by CEO') {
      return res.status(400).json({ success: false, error: 'Cannot update an approved record' });
    }

    // After return/reject, only initiator (or developer) may edit and resubmit
    if (!isDeveloper && RESUBMITTABLE_STATUSES.has(status) && !isInitiator) {
      return res.status(403).json({ success: false, error: 'Only the initiator can edit and resubmit this record' });
    }

    // Mid-workflow: only initiator/developer can edit while still at first pending stage
    if (
      !isDeveloper
      && !RESUBMITTABLE_STATUSES.has(status)
      && status !== 'Pending HOD HR'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Record is in approval. Wait for return/reject before editing.'
      });
    }

    if (!isDeveloper && status === 'Pending HOD HR' && !isInitiator) {
      return res.status(403).json({ success: false, error: 'Only the initiator can edit this record' });
    }

    const { employees, assignedHod, assignedSrDirector, assignedAvp, assignedChairman } = req.body;
    
    let parsedEmployees = employees;
    if (typeof employees === 'string') {
      try {
        parsedEmployees = JSON.parse(employees);
      } catch (e) {
        parsedEmployees = record.employees;
      }
    }

    if (parsedEmployees) {
      const normalizedEmployees = (Array.isArray(parsedEmployees) ? parsedEmployees : [])
        .map((e) => NonEmployeeRecord.normalizeEmployeeLine(e));
      if (normalizedEmployees.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Add at least one candidate row.'
        });
      }
      record.employees = normalizedEmployees;
    }
    if (assignedHod !== undefined) record.assignedHod = optionalUserId(assignedHod) || null;
    if (assignedSrDirector !== undefined) record.assignedSrDirector = optionalUserId(assignedSrDirector) || null;
    if (assignedAvp !== undefined) record.assignedAvp = optionalUserId(assignedAvp) || null;
    if (assignedChairman !== undefined) record.assignedChairman = optionalUserId(assignedChairman) || null;

    // Resubmit: send back to the authority who rejected/returned (not a fresh HOD cycle)
    if (status === 'Returned' || status === 'Rejected by CEO' || status === 'Draft') {
      const bodyHint = req.body.resubmitToStatus || req.body.returnedFromStatus;
      const targetStatus = resolveResubmitTarget(record, status, bodyHint);

      // After a return/reject the initiator must reply to the observations before resubmitting
      if (status === 'Returned' || status === 'Rejected by CEO') {
        const initiatorComment = String(req.body.resubmitComment || '').trim();
        if (!initiatorComment) {
          return res.status(400).json({
            success: false,
            error: 'Please add your comment on the observations before resubmitting.'
          });
        }
        await appendResubmissionHistory(record, {
          initiatorComment,
          responses: parseObservationResponses(req.body.observationResponses),
          actorId,
          targetStatus
        });
      }

      clearApprovalsFromStage(record, targetStatus);
      record.workflowStatus = targetStatus;
      record.set('returnedFromStatus', undefined);
      // Clear return feedback after successful resubmit
      record.returnComments = '';
      record.rejectionComments = '';
      record.returnObservations = [];
      record.set('returnedBy', undefined);
      record.set('returnedAt', undefined);
      if (req.body.requesterSignature) {
        record.requesterSignature = req.body.requesterSignature;
      }
    }

    await record.save();
    const populated = await populateApprovalAuthorities(NonEmployeeRecord.findById(record._id));
    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error('Error updating NonEmployeeRecord:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.deleteRecord = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    if (
      record.workflowStatus !== 'Pending HOD HR'
      && record.workflowStatus !== 'Draft'
      && record.workflowStatus !== 'Returned'
      && record.workflowStatus !== 'Rejected by CEO'
    ) {
       return res.status(400).json({ success: false, error: 'Only pending, returned, or rejected records can be deleted' });
    }

    await record.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    console.error('Error deleting NonEmployeeRecord:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.getRecords = async (req, res) => {
  try {
    const records = await populateApprovalAuthorities(NonEmployeeRecord.find()).sort('-createdAt');
    res.status(200).json({
      success: true,
      count: records.length,
      data: records.map(withEmployeesShape)
    });
  } catch (error) {
    console.error('Error fetching NonEmployeeRecords:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.getRecordById = async (req, res) => {
  try {
    const record = await populateApprovalAuthorities(NonEmployeeRecord.findById(req.params.id));
      
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.status(200).json({ success: true, data: withEmployeesShape(record) });
  } catch (error) {
    console.error('Error fetching NonEmployeeRecord:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.approveByHOD = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending HOD HR') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (record.assignedHod) {
      const assignedId = record.assignedHod._id ? record.assignedHod._id.toString() : record.assignedHod.toString();
      if (assignedId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'You are not the assigned HOD for this record' });
      }
    }

    record.workflowStatus = 'Pending AVP';
    record.hodApprovedBy = req.user.id;
    record.hodApprovedAt = Date.now();
    record.hodComments = req.body.comments || '';
    record.hodSignature = req.body.signature || (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.email);

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in HOD approval:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.rejectByHOD = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending HOD HR') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (record.assignedHod) {
      const assignedId = record.assignedHod._id ? record.assignedHod._id.toString() : record.assignedHod.toString();
      if (assignedId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'You are not the assigned HOD for this record' });
      }
    }

    markReturnedToInitiator(record, req.body.comments || '', 'Pending HOD HR', {
      observations: req.body.observations,
      userId: req.user.id
    });
    record.hodComments = req.body.comments || '';

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in HOD rejection:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.approveBySrDirector = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending Sr Director') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (!canActAsAssignedOrDevSrDirector(record.assignedSrDirector, req.user)) {
      return res.status(403).json({ success: false, error: 'You are not the assigned Sr Director for this record' });
    }

    record.workflowStatus = 'Forwarded to CEO';
    record.srDirectorApprovedBy = req.user.id;
    record.srDirectorApprovedAt = Date.now();
    record.srDirectorComments = req.body.comments || '';
    record.srDirectorSignature = req.body.signature
      || (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.email);

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in Sr Director approval:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.rejectBySrDirector = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending Sr Director') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (!canActAsAssignedOrDevSrDirector(record.assignedSrDirector, req.user)) {
      return res.status(403).json({ success: false, error: 'You are not the assigned Sr Director for this record' });
    }

    markReturnedToInitiator(record, req.body.comments || '', 'Pending Sr Director', {
      observations: req.body.observations,
      userId: req.user.id
    });
    record.srDirectorComments = req.body.comments || '';

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in Sr Director rejection:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.approveByAVP = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending AVP') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (record.assignedAvp) {
      const assignedId = record.assignedAvp._id ? record.assignedAvp._id.toString() : record.assignedAvp.toString();
      if (assignedId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'You are not the assigned AVP for this record' });
      }
    }

    record.workflowStatus = 'Pending Chairman';
    record.avpApprovedBy = req.user.id;
    record.avpApprovedAt = Date.now();
    record.avpComments = req.body.comments || '';
    record.avpSignature = req.body.signature || (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.email);

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in AVP approval:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.rejectByAVP = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending AVP') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (record.assignedAvp) {
      const assignedId = record.assignedAvp._id ? record.assignedAvp._id.toString() : record.assignedAvp.toString();
      if (assignedId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'You are not the assigned AVP for this record' });
      }
    }

    markReturnedToInitiator(record, req.body.comments || '', 'Pending AVP', {
      observations: req.body.observations,
      userId: req.user.id
    });
    record.avpComments = req.body.comments || '';

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in AVP rejection:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.approveByChairman = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending Chairman') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (record.assignedChairman) {
      const assignedId = record.assignedChairman._id ? record.assignedChairman._id.toString() : record.assignedChairman.toString();
      if (assignedId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'You are not the assigned Chairman for this record' });
      }
    }

    record.workflowStatus = 'Pending Sr Director';
    record.chairmanApprovedBy = req.user.id;
    record.chairmanApprovedAt = Date.now();
    record.chairmanComments = req.body.comments || '';
    record.chairmanSignature = req.body.signature || (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.email);

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in Chairman approval:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.rejectByChairman = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    if (record.workflowStatus !== 'Pending Chairman') {
      return res.status(400).json({ success: false, error: `Invalid status: ${record.workflowStatus}` });
    }

    if (record.assignedChairman) {
      const assignedId = record.assignedChairman._id ? record.assignedChairman._id.toString() : record.assignedChairman.toString();
      if (assignedId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'You are not the assigned Chairman for this record' });
      }
    }

    markReturnedToInitiator(record, req.body.comments || '', 'Pending Chairman', {
      observations: req.body.observations,
      userId: req.user.id
    });
    record.chairmanComments = req.body.comments || '';

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in Chairman rejection:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// CEO Endpoints
exports.getForCEO = async (req, res) => {
  try {
    const records = await populateApprovalAuthorities(
      NonEmployeeRecord.find({ workflowStatus: 'Forwarded to CEO' })
    ).sort('-createdAt');
    res.status(200).json({
      success: true,
      count: records.length,
      data: records.map(withEmployeesShape)
    });
  } catch (error) {
    console.error('Error fetching CEO NonEmployeeRecords:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.approveByCEO = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    record.workflowStatus = 'Approved by CEO';
    record.ceoApprovedBy = req.user.id;
    record.ceoApprovedAt = Date.now();
    record.ceoComments = req.body.comments || '';
    record.ceoSignature = req.body.signature || (req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.email);

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in CEO approval:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.rejectByCEO = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    // Reject sends back to initiator; resubmit returns to CEO queue
    record.workflowStatus = 'Rejected by CEO';
    record.returnedFromStatus = 'Forwarded to CEO';
    record.rejectionComments = req.body.comments || '';
    record.returnComments = req.body.comments || '';
    record.ceoComments = req.body.comments || '';
    record.returnedBy = req.user.id || undefined;
    record.returnedAt = new Date();
    const ceoRejectObs = normalizeReturnObservations(req.body.observations, req.user.id);
    if (ceoRejectObs.length) {
      record.returnObservations = ceoRejectObs;
    }

    await record.save();
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error('Error in CEO rejection:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

exports.returnByCEO = async (req, res) => {
  try {
    const record = await NonEmployeeRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    // Do not clear HOD/AVP/Chairman/Sr Director — only mark return for initiator resubmit to CEO
    markReturnedToInitiator(record, req.body.comments || req.body.returnComments || '', 'Forwarded to CEO', {
      observations: req.body.observations,
      userId: req.user.id
    });

    await record.save();
    const populated = await populateApprovalAuthorities(NonEmployeeRecord.findById(record._id));
    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error('Error in CEO return:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};
