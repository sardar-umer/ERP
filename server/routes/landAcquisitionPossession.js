const express = require('express');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const LandMoza = require('../models/tajResidencia/LandMoza');
const LandMozaKhasraEntry = require('../models/tajResidencia/LandMozaKhasraEntry');
const LandPossession = require('../models/tajResidencia/LandPossession');
const { buildMozaAcquisitionStatus } = require('../utils/landAcquisitionStatus');
const {
  parseAreaInput, addAreas, toSarsais, normalizeArea, subtractAreas, formatKMS
} = require('../utils/landAreaUnits');
const { enrichPossessionLines } = require('../utils/syncKhasraFromMozaEntry');

const router = express.Router();

const fetchPossessedTotalsByKhasra = async (moza, excludePossessionId) => {
  const filter = { moza, isActive: true };
  if (excludePossessionId) {
    filter._id = { $ne: excludePossessionId };
  }

  const possessions = await LandPossession.find(filter).select('lines').lean();
  const totals = {};

  possessions.forEach((doc) => {
    (doc.lines || []).forEach((line) => {
      const id = String(line.khasraEntry || '');
      if (!id) return;
      totals[id] = addAreas(totals[id] || { kanal: 0, marla: 0, sarsai: 0 }, normalizeArea(line.possessedArea));
    });
  });

  return totals;
};

/**
 * Cap each line's possessedArea to remaining khasra plot capacity.
 * Prevents "registry acquired" defaults from blocking save when only a remnant remains.
 * Returns list of human-readable cap notes (may be empty).
 */
const capPossessionLinesToPlot = async (moza, lines, excludePossessionId) => {
  const totals = await fetchPossessedTotalsByKhasra(moza, excludePossessionId);
  const ids = [...new Set(lines.map((l) => String(l.khasraEntry || '')).filter(Boolean))];
  const entries = await LandMozaKhasraEntry.find({ _id: { $in: ids } })
    .select('landInKhasra khasraNo')
    .lean();
  const plotById = Object.fromEntries(
    entries.map((e) => [String(e._id), normalizeArea(e.landInKhasra)])
  );
  const running = { ...totals };
  const notes = [];

  for (const line of lines) {
    const id = String(line.khasraEntry || '');
    const plotArea = plotById[id];
    if (!id || !toSarsais(plotArea)) continue;

    const prior = running[id] || { kanal: 0, marla: 0, sarsai: 0 };
    const remaining = subtractAreas(plotArea, prior);
    const requested = normalizeArea(line.possessedArea);
    const khasraLabel = line.khasraNo || entries.find((e) => String(e._id) === id)?.khasraNo || '';

    if (toSarsais(requested) > 0.001 && toSarsais(remaining) <= 0) {
      const err = new Error(
        `Khasra ${khasraLabel} is already fully possessed. Maximum possessed area: 0-0-0`
      );
      err.status = 400;
      throw err;
    }

    if (toSarsais(requested) - toSarsais(remaining) > 0.001) {
      notes.push(
        `Khasra ${khasraLabel}: possessed area capped from ${formatKMS(requested)} to ${formatKMS(remaining)} (plot remaining)`
      );
      line.possessedArea = remaining;
    }

    running[id] = addAreas(prior, line.possessedArea);
  }

  return notes;
};

const assertPossessionKhasraLimits = async (moza, lines, excludePossessionId) => {
  const totals = await fetchPossessedTotalsByKhasra(moza, excludePossessionId);
  const ids = [...new Set(lines.map((l) => String(l.khasraEntry || '')).filter(Boolean))];
  const entries = await LandMozaKhasraEntry.find({ _id: { $in: ids } }).select('landInKhasra khasraNo').lean();
  const plotById = Object.fromEntries(
    entries.map((e) => [String(e._id), normalizeArea(e.landInKhasra)])
  );

  // Running totals so multiple lines for the same khasra in one request are capped correctly
  const running = { ...totals };

  for (const line of lines) {
    const id = String(line.khasraEntry || '');
    const plotArea = plotById[id];
    if (!id || !toSarsais(plotArea)) continue;

    const prior = running[id] || { kanal: 0, marla: 0, sarsai: 0 };
    const owned = addAreas(prior, line.possessedArea);

    // Allow tiny float noise; reject only when clearly over plot
    if (toSarsais(owned) - toSarsais(plotArea) > 0.001) {
      const remArea = subtractAreas(plotArea, prior);
      const err = new Error(
        `Total land possessed for Khasra ${line.khasraNo || ''} cannot exceed khasra plot area. Maximum possessed area: ${remArea.kanal}-${remArea.marla}-${remArea.sarsai}`
      );
      err.status = 400;
      throw err;
    }

    running[id] = owned;
  }
};

const generatePossessionRef = async (mozaId) => {
  const docs = await LandPossession.find({
    moza: mozaId,
    isActive: true,
    possessionRef: { $ne: '' }
  }).select('possessionRef').lean();

  let max = 0;
  docs.forEach((doc) => {
    const match = String(doc.possessionRef || '').match(/(\d+)\s*$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });

  return `POS-${String(max + 1).padStart(4, '0')}`;
};

const khasraEntryId = (val) => {
  if (!val) return undefined;
  if (typeof val === 'object' && val._id) return String(val._id);
  if (typeof val === 'string' && val.trim() && val !== '[object Object]') return val.trim();
  return undefined;
};

/** Only real Mongo ObjectIds — reject synthetic registry ids like "exchange-in-<id>-0". */
const toObjectIdString = (val) => {
  const id = khasraEntryId(val);
  if (!id) return undefined;
  if (id.startsWith('exchange-in-') || id.startsWith('exchange-out-') || id.startsWith('in-line-')) {
    return undefined;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return undefined;
  // Guard against mongoose treating arbitrary 12-byte strings as valid
  if (String(new mongoose.Types.ObjectId(id)) !== id) return undefined;
  return id;
};

const parseLine = (line) => ({
  registryKhasraEntry: toObjectIdString(line.registryKhasraEntry),
  registryKhewatNo: String(line.registryKhewatNo || '').trim(),
  registryKhasraNo: String(line.registryKhasraNo || '').trim(),
  registeredArea: parseAreaInput(line.registeredArea),
  khasraEntry: toObjectIdString(line.khasraEntry),
  registry: toObjectIdString(line.registry),
  khewatNo: String(line.khewatNo || '').trim(),
  khasraNo: String(line.khasraNo || '').trim(),
  khasraArea: parseAreaInput(line.khasraArea),
  possessedArea: parseAreaInput(line.possessedArea),
  totalLandPossessed: parseAreaInput(line.totalLandPossessed),
  transferPercent: Math.min(100, Math.max(0, Number(line.transferPercent) || 0)),
  remarks: String(line.remarks || '').trim()
});

const cleanRegistryLabel = (value) => {
  const s = String(value || '').trim();
  if (!s || s === '—' || s === '-' || s === 'null' || s === 'undefined') return '';
  return s;
};

/** Resolve a real LandRegistry id when client sent synthetic exchange-in id or only numbers. */
const resolveRegistryLink = async ({ registry, registryNo, inteqalNo, moza }) => {
  let registryId = toObjectIdString(registry);
  let snapRegistryNo = cleanRegistryLabel(registryNo);
  let snapInteqalNo = cleanRegistryLabel(inteqalNo);

  const LandRegistry = require('../models/tajResidencia/LandRegistry');

  if (registryId) {
    if (!snapRegistryNo || !snapInteqalNo) {
      const doc = await LandRegistry.findById(registryId).select('registryNo inteqalNo').lean();
      if (doc) {
        if (!snapRegistryNo) snapRegistryNo = cleanRegistryLabel(doc.registryNo);
        if (!snapInteqalNo) snapInteqalNo = cleanRegistryLabel(doc.inteqalNo);
      }
    }
    return { registryId, registryNo: snapRegistryNo, inteqalNo: snapInteqalNo };
  }

  if (moza && (snapRegistryNo || snapInteqalNo)) {
    const filter = { moza, isActive: true };
    if (snapRegistryNo) filter.registryNo = snapRegistryNo;
    if (snapInteqalNo) filter.inteqalNo = snapInteqalNo;
    const match = await LandRegistry.findOne(filter).select('_id registryNo inteqalNo').lean();
    if (match) {
      return {
        registryId: String(match._id),
        registryNo: snapRegistryNo || cleanRegistryLabel(match.registryNo),
        inteqalNo: snapInteqalNo || cleanRegistryLabel(match.inteqalNo)
      };
    }
  }

  return { registryId: undefined, registryNo: snapRegistryNo, inteqalNo: snapInteqalNo };
};

const buildPossessionPayload = async (body) => {
  const lines = Array.isArray(body.lines) ? body.lines.map(parseLine) : [];
  const invalidLine = lines.find((l) => !l.khewatNo || !l.khasraNo);
  if (invalidLine) {
    const err = new Error('Each line must have a khasra number and khewat number.');
    err.status = 400;
    throw err;
  }

  const totalArea = parseAreaInput(body.totalArea);
  const linesTotal = addAreas(...lines.map((l) => l.possessedArea));

  let khewatNo = String(body.khewatNo || '').trim();
  if (!khewatNo) {
    khewatNo = [...new Set(lines.map((l) => l.khewatNo).filter(Boolean))].join(', ');
  }

  if (!khewatNo) {
    const err = new Error('At least one Khewat is required on a line');
    err.status = 400;
    throw err;
  }

  const linked = await resolveRegistryLink({
    registry: body.registry,
    registryNo: body.registryNo,
    inteqalNo: body.inteqalNo,
    moza: body.moza
  });

  // Propagate header registry onto lines when missing
  const linesWithRegistry = lines.map((line) => ({
    ...line,
    registry: line.registry || linked.registryId || undefined
  }));

  return {
    possessionDate: body.possessionDate ? new Date(body.possessionDate) : null,
    moza: body.moza,
    khewatNo,
    totalArea,
    possessionRef: String(body.possessionRef || '').trim(),
    registry: linked.registryId,
    registryNo: linked.registryNo,
    inteqalNo: linked.inteqalNo,
    lines: linesWithRegistry,
    linesTotal
  };
};

const mapPossession = (doc) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  const populatedReg = obj.registry && typeof obj.registry === 'object' ? obj.registry : null;
  return {
    ...obj,
    registryNo: obj.registryNo || populatedReg?.registryNo || '',
    inteqalNo: obj.inteqalNo || populatedReg?.inteqalNo || '',
    totalArea: normalizeArea(obj.totalArea),
    lines: (obj.lines || []).map((line) => ({
      ...line,
      registeredArea: normalizeArea(line.registeredArea),
      khasraArea: normalizeArea(line.khasraArea),
      possessedArea: normalizeArea(line.possessedArea),
      totalLandPossessed: normalizeArea(line.totalLandPossessed),
      transferPercent: line.transferPercent != null ? line.transferPercent : 0,
      khasraEntry: line.khasraEntry ? { ...line.khasraEntry, landInKhasra: normalizeArea(line.khasraEntry.landInKhasra) } : undefined
    }))
  };
};

// GET /api/taj-residencia/land-acquisition/possession-status
router.get('/possession-status', authMiddleware, asyncHandler(async (req, res) => {
  const { moza, khewatNo, search } = req.query;
  if (!moza) {
    return res.status(400).json({ success: false, message: 'Moza is required' });
  }

  const mozaDoc = await LandMoza.findOne({ _id: moza, isActive: true });
  if (!mozaDoc) {
    return res.status(404).json({ success: false, message: 'Moza not found' });
  }

  const rows = await buildMozaAcquisitionStatus(moza, { khewatNo, search });

  res.json({
    success: true,
    data: {
      moza: { _id: mozaDoc._id, name: mozaDoc.name },
      rows
    }
  });
}));

// GET /api/taj-residencia/land-acquisition/possessions
router.get('/possessions', authMiddleware, asyncHandler(async (req, res) => {
  const { moza, search = '', page = 1, limit = 50 } = req.query;
  const filter = { isActive: true };

  if (moza) {
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(moza)) {
      filter.moza = new mongoose.Types.ObjectId(moza);
    }
  }
  if (search && search.trim()) {
    const cleanSearch = search.trim();
    const escaped = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');

    const LandRegistry = require('../models/tajResidencia/LandRegistry');
    const matchingRegistries = await LandRegistry.find({
      $or: [{ registryNo: re }, { inteqalNo: re }],
      isActive: true
    }).select('_id').lean();
    const registryIds = matchingRegistries.map((r) => r._id);

    filter.$or = [
      { possessionRef: re },
      { khewatNo: re },
      { registryNo: re },
      { inteqalNo: re },
      { 'lines.khewatNo': re },
      { 'lines.khasraNo': re },
      { 'lines.registryKhewatNo': re },
      { 'lines.registryKhasraNo': re },
      ...(registryIds.length ? [{ registry: { $in: registryIds } }] : [])
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const SARSAIS_PER_KANAL = 180;
  const SARSAI_PER_MARLA = 9;

  const [rows, total, grandTotalAgg] = await Promise.all([
    LandPossession.find(filter)
      .populate('moza', 'name slug')
      .populate('registry', 'registryNo inteqalNo registryDate totalArea')
      .populate('lines.registry', 'registryNo inteqalNo registryDate')
      .sort({ possessionDate: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limitNum),
    LandPossession.countDocuments(filter),
    LandPossession.aggregate([
      { $match: filter },
      { $unwind: "$lines" },
      {
        $group: {
          _id: null,
          totalSarsais: {
            $sum: {
              $add: [
                { $multiply: [{ $ifNull: ['$lines.possessedArea.kanal', 0] }, SARSAIS_PER_KANAL] },
                { $multiply: [{ $ifNull: ['$lines.possessedArea.marla', 0] }, SARSAI_PER_MARLA] },
                { $ifNull: ['$lines.possessedArea.sarsai', 0] }
              ]
            }
          }
        }
      }
    ])
  ]);

  const totalSarsais = grandTotalAgg[0]?.totalSarsais || 0;
  const grandKanal = Math.floor(totalSarsais / SARSAIS_PER_KANAL);
  const rem1 = totalSarsais % SARSAIS_PER_KANAL;
  const grandMarla = Math.floor(rem1 / SARSAI_PER_MARLA);
  const grandSarsai = rem1 % SARSAI_PER_MARLA;

  res.json({
    success: true,
    data: {
      possessions: rows.map(mapPossession),
      pagination: { page: pageNum, limit: limitNum, total },
      grandTotal: { kanal: grandKanal, marla: grandMarla, sarsai: grandSarsai }
    }
  });
}));

// GET /api/taj-residencia/land-acquisition/possessions/possessed-totals?moza=&excludePossessionId=
router.get('/possessions/possessed-totals', authMiddleware, asyncHandler(async (req, res) => {
  const { moza, excludePossessionId } = req.query;
  if (!moza) {
    return res.status(400).json({ success: false, message: 'moza is required' });
  }

  const totals = await fetchPossessedTotalsByKhasra(moza, excludePossessionId);
  res.json({ success: true, data: totals });
}));

// GET /api/taj-residencia/land-acquisition/possessions/next-ref?moza=
router.get('/possessions/next-ref', authMiddleware, asyncHandler(async (req, res) => {
  const { moza } = req.query;
  if (!moza) {
    return res.status(400).json({ success: false, message: 'moza is required' });
  }

  const mozaDoc = await LandMoza.findOne({ _id: moza, isActive: true });
  if (!mozaDoc) {
    return res.status(404).json({ success: false, message: 'Moza not found' });
  }

  const possessionRef = await generatePossessionRef(moza);
  res.json({ success: true, data: { possessionRef } });
}));

// GET /api/taj-residencia/land-acquisition/possessions/:id
router.get('/possessions/:id', authMiddleware, asyncHandler(async (req, res) => {
  const doc = await LandPossession.findOne({ _id: req.params.id, isActive: true })
    .populate('moza', 'name slug')
    .populate('registry', 'registryNo inteqalNo registryDate')
    .populate('lines.registry', 'registryNo inteqalNo registryDate')
    .populate('lines.khasraEntry', 'landInKhasra');

  if (!doc) {
    return res.status(404).json({ success: false, message: 'Possession record not found' });
  }

  res.json({ success: true, data: mapPossession(doc) });
}));

// POST /api/taj-residencia/land-acquisition/possessions
router.post('/possessions', authMiddleware, asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = await buildPossessionPayload(req.body);
    payload.lines = await enrichPossessionLines(payload.lines, payload.moza);
    payload.khewatNo = [...new Set(payload.lines.map((l) => l.khewatNo).filter(Boolean))].join(', ');
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  if (!payload.possessionDate || Number.isNaN(payload.possessionDate.getTime())) {
    return res.status(400).json({ success: false, message: 'Possession date is required' });
  }
  if (!payload.moza || !payload.lines.length) {
    return res.status(400).json({ success: false, message: 'Moza and at least one line are required' });
  }

  const moza = await LandMoza.findOne({ _id: payload.moza, isActive: true });
  if (!moza) {
    return res.status(404).json({ success: false, message: 'Moza not found' });
  }

  const possessionRef = payload.possessionRef || await generatePossessionRef(payload.moza);

  const duplicate = await LandPossession.findOne({
    moza: payload.moza,
    possessionRef,
    isActive: true
  });
  if (duplicate) {
    return res.status(409).json({
      success: false,
      message: `Possession ref "${possessionRef}" already exists for this mouza`
    });
  }

  let capNotes = [];
  try {
    capNotes = await capPossessionLinesToPlot(payload.moza, payload.lines);
    payload.linesTotal = addAreas(...payload.lines.map((l) => l.possessedArea));
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  const finalTotal = toSarsais(payload.totalArea) ? payload.totalArea : payload.linesTotal;
  if (toSarsais(payload.totalArea) && toSarsais(payload.linesTotal) > toSarsais(payload.totalArea)) {
    return res.status(400).json({
      success: false,
      message: 'Total possessed area cannot exceed Total Registry Area'
    });
  }

  try {
    await assertPossessionKhasraLimits(payload.moza, payload.lines);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  const doc = await LandPossession.create({
    possessionDate: payload.possessionDate,
    moza: payload.moza,
    khewatNo: payload.khewatNo,
    totalArea: finalTotal,
    possessionRef,
    registry: payload.registry,
    registryNo: payload.registryNo || '',
    inteqalNo: payload.inteqalNo || '',
    lines: payload.lines,
    createdBy: req.user?._id
  });

  await doc.populate([
    { path: 'moza', select: 'name slug' },
    { path: 'registry', select: 'registryNo inteqalNo registryDate totalArea' },
    { path: 'lines.registry', select: 'registryNo inteqalNo registryDate' },
    { path: 'lines.khasraEntry', select: 'landInKhasra' }
  ]);

  res.status(201).json({
    success: true,
    message: capNotes.length
      ? `Possession record created. ${capNotes.join(' ')}`
      : 'Possession record created',
    data: mapPossession(doc),
    warnings: capNotes
  });
}));

// PUT /api/taj-residencia/land-acquisition/possessions/:id
router.put('/possessions/:id', authMiddleware, asyncHandler(async (req, res) => {
  const doc = await LandPossession.findOne({ _id: req.params.id, isActive: true });
  if (!doc) {
    return res.status(404).json({ success: false, message: 'Possession record not found' });
  }

  let payload;
  try {
    payload = await buildPossessionPayload(req.body);
    payload.lines = await enrichPossessionLines(payload.lines, payload.moza || doc.moza);
    payload.khewatNo = [...new Set(payload.lines.map((l) => l.khewatNo).filter(Boolean))].join(', ');
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  if (!payload.possessionDate || Number.isNaN(payload.possessionDate.getTime())) {
    return res.status(400).json({ success: false, message: 'Possession date is required' });
  }
  if (!payload.khewatNo || !payload.lines.length) {
    return res.status(400).json({ success: false, message: 'At least one khasra line with khewat is required' });
  }

  if (payload.possessionRef) {
    const duplicate = await LandPossession.findOne({
      _id: { $ne: doc._id },
      moza: doc.moza,
      possessionRef: payload.possessionRef,
      isActive: true
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `Possession ref "${payload.possessionRef}" already exists for this mouza`
      });
    }
  }

  let capNotes = [];
  try {
    capNotes = await capPossessionLinesToPlot(doc.moza, payload.lines, doc._id);
    payload.linesTotal = addAreas(...payload.lines.map((l) => l.possessedArea));
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  const finalTotal = toSarsais(payload.totalArea) ? payload.totalArea : payload.linesTotal;
  if (toSarsais(payload.totalArea) && toSarsais(payload.linesTotal) > toSarsais(payload.totalArea)) {
    return res.status(400).json({
      success: false,
      message: 'Total possessed area cannot exceed Total Registry Area'
    });
  }

  try {
    await assertPossessionKhasraLimits(doc.moza, payload.lines, doc._id);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  doc.possessionDate = payload.possessionDate;
  doc.khewatNo = payload.khewatNo;
  doc.totalArea = finalTotal;
  doc.possessionRef = payload.possessionRef;
  doc.registry = payload.registry;
  doc.registryNo = payload.registryNo || '';
  doc.inteqalNo = payload.inteqalNo || '';
  doc.lines = payload.lines;
  await doc.save();

  await doc.populate([
    { path: 'moza', select: 'name slug' },
    { path: 'registry', select: 'registryNo inteqalNo registryDate totalArea' },
    { path: 'lines.registry', select: 'registryNo inteqalNo registryDate' },
    { path: 'lines.khasraEntry', select: 'landInKhasra' }
  ]);

  res.json({
    success: true,
    message: capNotes.length
      ? `Possession record updated. ${capNotes.join(' ')}`
      : 'Possession record updated',
    data: mapPossession(doc),
    warnings: capNotes
  });
}));

// DELETE /api/taj-residencia/land-acquisition/possessions/:id
router.delete('/possessions/:id', authMiddleware, asyncHandler(async (req, res) => {
  const doc = await LandPossession.findOne({ _id: req.params.id, isActive: true });
  if (!doc) {
    return res.status(404).json({ success: false, message: 'Possession record not found' });
  }

  doc.isActive = false;
  await doc.save();

  res.json({ success: true, message: 'Possession record deleted' });
}));

module.exports = router;
