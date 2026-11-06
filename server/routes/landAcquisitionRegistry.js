const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const LandMoza = require('../models/tajResidencia/LandMoza');
const LandRegistry = require('../models/tajResidencia/LandRegistry');
const LandParty = require('../models/tajResidencia/LandParty');
const {
  parseAreaInput, addAreas, toSarsais, normalizeArea, subtractAreas
} = require('../utils/landAreaUnits');
const { enrichRegistryLines } = require('../utils/syncKhasraFromMozaEntry');

const router = express.Router();

const registryUploadDir = path.join(__dirname, '../uploads/land-acquisition-registry');
const registryUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(registryUploadDir)) {
      fs.mkdirSync(registryUploadDir, { recursive: true });
    }
    cb(null, registryUploadDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `registry-${unique}${path.extname(file.originalname)}`);
  }
});

const registryUpload = multer({
  storage: registryUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Attachments must be a PDF or image file'), false);
    }
  }
});

const handleRegistryUpload = (req, res, next) => {
  registryUpload.fields([
    { name: 'attachments', maxCount: 10 },
    { name: 'registryDocAttachments', maxCount: 10 },
    { name: 'inteqalDocAttachments', maxCount: 10 }
  ])(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Each attachment must be 10 MB or less' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, message: 'Maximum 10 attachments per document type' });
    }
    return res.status(400).json({ success: false, message: err.message || 'File upload error' });
  });
};

const parseRegistryRequestBody = (req) => {
  if (!req.body?.data) return req.body;
  try {
    return typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
  } catch {
    const err = new Error('Invalid registry data');
    err.status = 400;
    throw err;
  }
};

const mapUploadedAttachments = (files = []) => files.map((file) => ({
  filename: file.filename,
  originalName: file.originalname,
  path: `/uploads/land-acquisition-registry/${file.filename}`,
  mimetype: file.mimetype,
  size: file.size,
  uploadedAt: new Date()
}));

const deleteAttachmentFile = (attachment) => {
  if (!attachment?.path) return;
  const filename = path.basename(attachment.path);
  const filePath = path.join(registryUploadDir, filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
};

const parseRemovedAttachmentIds = (body, key = 'removedAttachmentIds') => {
  const raw = body[key];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
};

const applyAttachmentChanges = (registry, body, filesMap = {}, keyName = 'attachments', removedKey = 'removedAttachmentIds') => {
  const removedIds = new Set(parseRemovedAttachmentIds(body, removedKey));
  const kept = (registry[keyName] || []).filter((att) => {
    if (removedIds.has(String(att._id))) {
      deleteAttachmentFile(att);
      return false;
    }
    return true;
  });
  const newFiles = filesMap[keyName] || [];
  registry[keyName] = [...kept, ...mapUploadedAttachments(newFiles)];
};

const fetchRegisteredTotalsByKhasra = async (moza, excludeRegistryId) => {
  const filter = { moza, isActive: true };
  if (excludeRegistryId) {
    filter._id = { $ne: excludeRegistryId };
  }

  const [registries, exchanges] = await Promise.all([
    LandRegistry.find(filter).select('lines').lean(),
    LandExchange.find({ isActive: true }).select('outLandLines inLandLines moza').lean()
  ]);

  const totals = {};

  registries.forEach((doc) => {
    (doc.lines || []).forEach((line) => {
      const id = String(line.khasraEntry || '');
      if (!id) return;
      totals[id] = addAreas(totals[id] || { kanal: 0, marla: 0, sarsai: 0 }, normalizeArea(line.acquiredArea));
    });
  });

  exchanges.forEach((exc) => {
    (exc.outLandLines || []).forEach((l) => {
      const id = String(l.khasraEntry || '');
      if (!id || !totals[id]) return;
      totals[id] = subtractAreas(totals[id], normalizeArea(l.surrenderedArea));
    });
    (exc.inLandLines || []).forEach((l) => {
      const id = String(l.khasraEntry || '');
      if (!id) return;
      totals[id] = addAreas(totals[id] || { kanal: 0, marla: 0, sarsai: 0 }, normalizeArea(l.acquiredArea));
    });
  });

  return totals;
};

const assertKhasraOwnershipLimits = async (moza, lines, excludeRegistryId) => {
  // Disabled assertion to allow area in registry to exceed khasra area
  return;
};

const parseLine = (line) => ({
  khasraEntry: line.khasraEntry || undefined,
  khewatNo: String(line.khewatNo || '').trim(),
  khasraNo: String(line.khasraNo || '').trim(),
  khasraArea: parseAreaInput(line.khasraArea),
  landOfKhasra: parseAreaInput(line.landOfKhasra),
  acquiredArea: parseAreaInput(line.acquiredArea),
  landWithMalkiyat: parseAreaInput(line.landWithMalkiyat),
  transferPercent: Math.max(0, Number(line.transferPercent) || 0),
  remarks: String(line.remarks || '').trim()
});

const buildRegistryPayload = (body) => {
  const lines = Array.isArray(body.lines) ? body.lines.map(parseLine) : [];
  const invalidLine = lines.find((l) => !l.khewatNo || !l.khasraNo);
  if (invalidLine) {
    const err = new Error('Each line must have Khewat No. and Khasra No.');
    err.status = 400;
    throw err;
  }

  const totalArea = parseAreaInput(body.totalArea);
  const linesTotal = addAreas(...lines.map((l) => l.acquiredArea));

  let khewatNos = Array.isArray(body.khewatNos)
    ? body.khewatNos.map((k) => String(k).trim()).filter(Boolean)
    : String(body.khewatNo || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  if (!khewatNos.length) {
    khewatNos = [...new Set(lines.map((l) => l.khewatNo).filter(Boolean))];
  }

  if (!khewatNos.length) {
    const err = new Error('At least one Khewat is required on a line');
    err.status = 400;
    throw err;
  }

  if (!toSarsais(totalArea)) {
    const err = new Error('Total area is required');
    err.status = 400;
    throw err;
  }

  const finalTotal = toSarsais(totalArea) ? totalArea : linesTotal;
  if (toSarsais(totalArea) && toSarsais(linesTotal) !== toSarsais(totalArea)) {
    const err = new Error('Sum of area in registry lines must exactly match the total area');
    err.status = 400;
    throw err;
  }

  const lineOverTotal = lines.find((l) => toSarsais(l.acquiredArea) > toSarsais(totalArea));
  if (lineOverTotal) {
    const err = new Error('Area in registry on a line cannot exceed total area');
    err.status = 400;
    throw err;
  }

  return {
    dealNo: body.dealNo ? Number(body.dealNo) : undefined,
    registryDate: body.registryDate ? new Date(body.registryDate) : null,
    moza: body.moza,
    khewatNo: khewatNos.join(', '),
    khewatNos,
    totalArea: finalTotal,
    registryNo: (body.registryNo === 'null' || body.registryNo === 'undefined') ? '' : String(body.registryNo || '').trim(),
    inteqalNo: (body.inteqalNo === 'null' || body.inteqalNo === 'undefined') ? '' : String(body.inteqalNo || '').trim(),
    seller: body.seller || undefined,
    purchaser: body.purchaser || undefined,
    dealer: body.dealer || undefined,
    lines,
    linesTotal
  };
};

/**
 * Validate party refs by type. Seller/buyer must match type.
 * Dealer: if ID points at a non-dealer party (common with "Unknown Seller" bad data), clear it
 * instead of blocking the whole save.
 */
const resolveRegistryParties = async (payload) => {
  const next = { ...payload };

  if (next.seller) {
    const seller = await LandParty.findOne({ _id: next.seller, partyType: 'seller', isActive: true });
    if (!seller) {
      const err = new Error('Seller not found');
      err.status = 404;
      throw err;
    }
  }

  if (next.purchaser) {
    const purchaser = await LandParty.findOne({ _id: next.purchaser, partyType: 'buyer', isActive: true });
    if (!purchaser) {
      const err = new Error('Purchaser not found');
      err.status = 404;
      throw err;
    }
  }

  if (next.dealer) {
    const dealer = await LandParty.findOne({ _id: next.dealer, partyType: 'dealer', isActive: true });
    if (!dealer) {
      const anyParty = await LandParty.findById(next.dealer).select('_id partyType isActive').lean();
      if (anyParty && anyParty.partyType !== 'dealer') {
        next.dealer = undefined;
      } else {
        const err = new Error('Dealer not found');
        err.status = 404;
        throw err;
      }
    }
  }

  return next;
};

const mapRegistry = (doc) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  const khewatNos = (obj.khewatNos?.length
    ? obj.khewatNos
    : String(obj.khewatNo || '').split(',').map((s) => s.trim()).filter(Boolean));

  const lines = (obj.lines || []).map((line) => ({
    ...line,
    khasraArea: normalizeArea(line.khasraArea),
    landOfKhasra: normalizeArea(line.landOfKhasra),
    acquiredArea: normalizeArea(line.acquiredArea),
    landWithMalkiyat: normalizeArea(line.landWithMalkiyat)
  }));

  return {
    ...obj,
    khewatNos,
    khewatNo: khewatNos.join(', ') || obj.khewatNo,
    lines,
    registryDocAttachments: obj.registryDocAttachments || [],
    inteqalDocAttachments: obj.inteqalDocAttachments || []
  };
};

const LandTransfer = require('../models/tajResidencia/LandTransfer');
const LandExchange = require('../models/tajResidencia/LandExchange');

async function attachTransferDocsToRegistries(mappedRegistries = []) {
  if (!mappedRegistries.length) return mappedRegistries;

  // Fetch ALL active transfers to resolve dealNo by registryNo / intiqalNo
  const transfers = await LandTransfer.find({
    isActive: true
  }).lean();

  if (!transfers.length) return mappedRegistries;

  // Build lookup maps for matching
  const transferByDealNo = new Map();
  const transferByRegNo = new Map();
  const transferByIntNo = new Map();

  for (const t of transfers) {
    if (t.dealNo !== undefined && t.dealNo !== null) {
      transferByDealNo.set(Number(t.dealNo), t);
    }
    if (t.registryNo && String(t.registryNo).trim()) {
      transferByRegNo.set(String(t.registryNo).trim().toLowerCase(), t);
    }
    if (t.intiqalNo && String(t.intiqalNo).trim()) {
      transferByIntNo.set(String(t.intiqalNo).trim().toLowerCase(), t);
    }
  }

  return mappedRegistries.map((reg) => {
    const regDealNo = reg.dealNo !== undefined && reg.dealNo !== null && reg.dealNo !== '' ? Number(reg.dealNo) : null;
    const regNo = String(reg.registryNo || '').trim().toLowerCase();
    const intNo = String(reg.inteqalNo || '').trim().toLowerCase();

    // Priority order: 1) Direct dealNo, 2) Registry No match, 3) Inteqal No match
    let matched = null;
    if (regNo && transferByRegNo.has(regNo)) {
      matched = transferByRegNo.get(regNo);
    } else if (intNo && transferByIntNo.has(intNo)) {
      matched = transferByIntNo.get(intNo);
    } else if (regDealNo !== null && transferByDealNo.has(regDealNo)) {
      matched = transferByDealNo.get(regDealNo);
    }

    if (!matched) return reg;

    const registryDocs = [...(reg.registryDocAttachments || [])];
    const inteqalDocs = [...(reg.inteqalDocAttachments || [])];

    if (matched.registryAttachment && !registryDocs.some(d => d.path === matched.registryAttachment)) {
      registryDocs.unshift({
        _id: `transfer-reg-${matched._id}`,
        originalName: 'Registry Doc (Land Transfer)',
        filename: path.basename(matched.registryAttachment),
        path: matched.registryAttachment,
        uploadedAt: matched.updatedAt || matched.createdAt
      });
    }

    if (matched.inteqalAttachment && !inteqalDocs.some(d => d.path === matched.inteqalAttachment)) {
      inteqalDocs.unshift({
        _id: `transfer-int-${matched._id}`,
        originalName: 'Inteqal Doc (Land Transfer)',
        filename: path.basename(matched.inteqalAttachment),
        path: matched.inteqalAttachment,
        uploadedAt: matched.updatedAt || matched.createdAt
      });
    }

    return {
      ...reg,
      // If reg has no dealNo set explicitly, inherit matched transfer's dealNo
      dealNo: reg.dealNo || matched.dealNo,
      registryDocAttachments: registryDocs,
      inteqalDocAttachments: inteqalDocs
    };
  });
}

async function attachExchangeDataToRegistries(mappedRegistries = []) {
  if (!mappedRegistries.length) return mappedRegistries;

  const exchanges = await LandExchange.find({ isActive: true })
    .populate('party', 'name cnic phone')
    .lean();

  if (!exchanges.length) {
    return mappedRegistries.map((reg) => ({
      ...reg,
      exchangedOutArea: { kanal: 0, marla: 0, sarsai: 0 },
      netRemainingArea: reg.totalArea,
      exchanges: [],
      lines: (reg.lines || []).map((l) => ({
        ...l,
        exchangedOutArea: { kanal: 0, marla: 0, sarsai: 0 },
        netRemainingArea: l.acquiredArea || { kanal: 0, marla: 0, sarsai: 0 }
      }))
    }));
  }

  return mappedRegistries.map((reg) => {
    const regIdStr = String(reg._id);
    const regNoLower = String(reg.registryNo || '').trim().toLowerCase();
    const intNoLower = String(reg.inteqalNo || '').trim().toLowerCase();
    const regMozaId = String(reg.moza?._id || reg.moza || '');

    const matchedExchanges = [];
    const outAreasList = [];

    // Map each line of registry to compute per-khasra surrendered area
    const updatedLines = (reg.lines || []).map((line) => {
      const lineKhasra = String(line.khasraNo || '').trim();
      const lineOutAreas = [];

      exchanges.forEach((exc) => {
        (exc.outLandLines || []).forEach((outL) => {
          const outRegId = outL.registry
            ? String(outL.registry?._id || outL.registry)
            : (outL.exchangeInId ? String(outL.exchangeInId) : null);
          const outRegNo = String(outL.registryNo || '').trim().toLowerCase();
          const outIntNo = String(outL.inteqalNo || '').trim().toLowerCase();
          const outMozaId = String(outL.moza?._id || outL.moza || exc.moza?._id || exc.moza || '');

          const isIdMatch = outRegId && outRegId === regIdStr;
          const isMozaMatch = !outMozaId || !regMozaId || outMozaId === regMozaId;
          const isStringMatch = isMozaMatch && (
            (regNoLower && outRegNo && outRegNo === regNoLower) ||
            (intNoLower && outIntNo && outIntNo === intNoLower)
          );

          const isRegMatch = isIdMatch || isStringMatch;

          if (isRegMatch) {
            const outKhasra = String(outL.khasraNo || '').trim();
            if (!lineKhasra || !outKhasra || outKhasra === lineKhasra) {
              const surrendered = normalizeArea(outL.surrenderedArea);
              if (toSarsais(surrendered) > 0) {
                lineOutAreas.push(surrendered);
              }
            }
          }
        });
      });

      const lineExchangedOut = addAreas(...lineOutAreas);
      const lineAcquired = normalizeArea(line.acquiredArea);
      const lineNet = subtractAreas(lineAcquired, lineExchangedOut);

      return {
        ...line,
        exchangedOutArea: lineExchangedOut,
        netRemainingArea: lineNet
      };
    });

    // Compute total registry exchanged out
    exchanges.forEach((exc) => {
      (exc.outLandLines || []).forEach((outL) => {
        const outRegId = outL.registry
          ? String(outL.registry?._id || outL.registry)
          : (outL.exchangeInId ? String(outL.exchangeInId) : null);
        const outRegNo = String(outL.registryNo || '').trim().toLowerCase();
        const outIntNo = String(outL.inteqalNo || '').trim().toLowerCase();
        const outMozaId = String(outL.moza?._id || outL.moza || exc.moza?._id || exc.moza || '');

        const isIdMatch = outRegId && outRegId === regIdStr;
        const isMozaMatch = !outMozaId || !regMozaId || outMozaId === regMozaId;
        const isStringMatch = isMozaMatch && (
          (regNoLower && outRegNo && outRegNo === regNoLower) ||
          (intNoLower && outIntNo && outIntNo === intNoLower)
        );

        const isRegMatch = isIdMatch || isStringMatch;

        if (isRegMatch) {
          const surrendered = normalizeArea(outL.surrenderedArea);
          if (toSarsais(surrendered) > 0) {
            outAreasList.push(surrendered);
            matchedExchanges.push({
              _id: exc._id,
              type: 'OUT',
              exchangeRef: exc.exchangeRef,
              exchangeDate: exc.exchangeDate,
              partyName: exc.party?.name || '—',
              khasraNo: outL.khasraNo,
              surrenderedArea: surrendered,
              remarks: outL.remarks || exc.remarks
            });
          }
        }
      });
    });

    const exchangedOutArea = addAreas(...outAreasList);
    const regTotal = normalizeArea(reg.totalArea);
    const netRemainingArea = subtractAreas(regTotal, exchangedOutArea);

    return {
      ...reg,
      exchangedOutArea,
      netRemainingArea,
      exchanges: matchedExchanges,
      lines: updatedLines
    };
  });
}

// GET /api/taj-residencia/land-acquisition/registries
router.get('/registries', authMiddleware, asyncHandler(async (req, res) => {
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
    filter.$or = [
      { registryNo: re },
      { inteqalNo: re },
      { khewatNo: re },
      { 'lines.khewatNo': re },
      { 'lines.khasraNo': re }
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);
  const skip = (pageNum - 1) * limitNum;

  const SARSAIS_PER_KANAL = 180;
  const SARSAI_PER_MARLA = 9;

  const [rows, total, grandTotalAgg] = await Promise.all([
    LandRegistry.find(filter)
      .populate('moza', 'name slug')
      .populate('seller', 'name cnic phoneNumber')
      .populate('purchaser', 'name cnic phoneNumber')
      .populate('dealer', 'name cnic phoneNumber')
      .sort({ registryDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    LandRegistry.countDocuments(filter),
    LandRegistry.aggregate([
      { $match: filter },
      { $unwind: "$lines" },
      {
        $group: {
          _id: null,
          totalSarsais: {
            $sum: {
              $add: [
                { $multiply: [{ $ifNull: ['$lines.acquiredArea.kanal', 0] }, SARSAIS_PER_KANAL] },
                { $multiply: [{ $ifNull: ['$lines.acquiredArea.marla', 0] }, SARSAI_PER_MARLA] },
                { $ifNull: ['$lines.acquiredArea.sarsai', 0] }
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

  // Compute exchange aggregates for active filter
  const excFilter = { isActive: true };
  if (filter.moza) {
    excFilter.$or = [
      { moza: filter.moza },
      { 'inLandLines.moza': filter.moza },
      { 'outLandLines.moza': filter.moza }
    ];
  }
  const activeExchanges = await LandExchange.find(excFilter)
    .populate('party', 'name cnic phoneNumber')
    .populate('moza', 'name slug')
    .populate('inLandLines.moza', 'name slug')
    .lean();

  let excOutSarsais = 0;
  let excInSarsais = 0;
  activeExchanges.forEach((exc) => {
    (exc.outLandLines || []).forEach((l) => {
      excOutSarsais += toSarsais(normalizeArea(l.surrenderedArea));
    });
    (exc.inLandLines || []).forEach((l) => {
      excInSarsais += toSarsais(normalizeArea(l.acquiredArea));
    });
  });

  const netEffectiveSarsais = Math.max(0, totalSarsais - excOutSarsais + excInSarsais);

  const mappedWithTransfers = await attachTransferDocsToRegistries(rows.map(mapRegistry));
  const mapped = await attachExchangeDataToRegistries(mappedWithTransfers);

  // Synthesize In Land exchange records into legal acquisition entries
  const exchangeInRows = [];
  activeExchanges.forEach((exc) => {
    const groupedLines = {};

    (exc.inLandLines || []).forEach((inL, idx) => {
      const inMozaId = String(inL.moza?._id || inL.moza || exc.moza?._id || exc.moza || '');
      if (filter.moza && inMozaId !== String(filter.moza)) {
        return;
      }

      const inArea = normalizeArea(inL.acquiredArea);
      if (toSarsais(inArea) === 0) return;

      const regNo = inL.registryNo || `(Exch: ${exc.exchangeRef})`;
      const inteqalNo = inL.inteqalNo || '—';
      const khewatNo = inL.khewatNo || '—';
      const khasraNo = inL.khasraNo || '—';

      if (search && search.trim()) {
        const clean = search.trim().toLowerCase();
        const matches = String(exc.exchangeRef || '').toLowerCase().includes(clean) ||
          String(regNo).toLowerCase().includes(clean) ||
          String(inteqalNo).toLowerCase().includes(clean) ||
          String(khewatNo).toLowerCase().includes(clean) ||
          String(khasraNo).toLowerCase().includes(clean) ||
          String(exc.party?.name || '').toLowerCase().includes(clean);
        if (!matches) return;
      }

      const excInId = `exchange-in-${exc._id}-${idx}`;
      const matchingOutAreas = [];
      activeExchanges.forEach((e) => {
        (e.outLandLines || []).forEach((ol) => {
          const isIdMatch = ol.exchangeInId === excInId;
          const isSourceMatch = ol.sourceExchange &&
            String(ol.sourceExchange?._id || ol.sourceExchange) === String(exc._id) &&
            String(ol.khasraNo).trim() === khasraNo;
          if (isIdMatch || isSourceMatch) {
            matchingOutAreas.push(normalizeArea(ol.surrenderedArea));
          }
        });
      });
      const exchangedOutArea = addAreas(...matchingOutAreas);
      const netRemainingArea = subtractAreas(inArea, exchangedOutArea);

      const groupKey = `${regNo}|${inteqalNo}`;
      if (!groupedLines[groupKey]) {
        groupedLines[groupKey] = {
          _id: `exchange-in-${exc._id}-${regNo.replace(/[^a-zA-Z0-9]/g, '')}`,
          isExchangeIn: true,
          exchangeId: exc._id,
          exchangeRef: exc.exchangeRef,
          dealNo: exc.dealNo,
          registryDate: exc.exchangeDate,
          moza: inL.moza || exc.moza,
          khewatNos: new Set(),
          registryNo: regNo,
          inteqalNo,
          seller: exc.party,
          purchaser: { name: 'Taj Residencia (Exchange In)' },
          dealer: null,
          totalArea: { kanal: 0, marla: 0, sarsai: 0 },
          exchangedOutArea: { kanal: 0, marla: 0, sarsai: 0 },
          netRemainingArea: { kanal: 0, marla: 0, sarsai: 0 },
          lines: [],
          registryDocAttachments: (exc.attachments || []).map((att) => ({
            ...att,
            originalName: att.originalName || `Exchange Doc (${exc.exchangeRef})`
          })),
          inteqalDocAttachments: []
        };
      }

      const grp = groupedLines[groupKey];
      grp.khewatNos.add(khewatNo);
      grp.totalArea = addAreas(grp.totalArea, inArea);
      grp.exchangedOutArea = addAreas(grp.exchangedOutArea, exchangedOutArea);
      grp.netRemainingArea = addAreas(grp.netRemainingArea, netRemainingArea);
      
      grp.lines.push({
        _id: inL._id || `in-line-${idx}`,
        khewatNo,
        khasraNo,
        khasraArea: inL.khasraArea || inArea,
        acquiredArea: inArea,
        landWithMalkiyat: inArea,
        transferPercent: 100,
        exchangedOutArea,
        netRemainingArea,
        remarks: inL.remarks || `Acquired via Land Exchange ${exc.exchangeRef}`
      });
    });

    Object.values(groupedLines).forEach(grp => {
      grp.khewatNo = Array.from(grp.khewatNos).join(', ');
      delete grp.khewatNos;
      exchangeInRows.push(grp);
    });
  });

  const combinedRegistries = [...mapped, ...exchangeInRows].sort((a, b) => {
    const da = a.registryDate ? new Date(a.registryDate).getTime() : 0;
    const db = b.registryDate ? new Date(b.registryDate).getTime() : 0;
    return db - da;
  });

  res.json({
    success: true,
    data: {
      registries: combinedRegistries,
      pagination: { page: pageNum, limit: limitNum, total: total + exchangeInRows.length },
      grandTotal: { kanal: grandKanal, marla: grandMarla, sarsai: grandSarsai },
      exchangeTotals: {
        exchangedOut: {
          kanal: Math.floor(excOutSarsais / SARSAIS_PER_KANAL),
          marla: Math.floor((excOutSarsais % SARSAIS_PER_KANAL) / SARSAI_PER_MARLA),
          sarsai: (excOutSarsais % SARSAIS_PER_KANAL) % SARSAI_PER_MARLA
        },
        exchangedIn: {
          kanal: Math.floor(excInSarsais / SARSAIS_PER_KANAL),
          marla: Math.floor((excInSarsais % SARSAIS_PER_KANAL) / SARSAI_PER_MARLA),
          sarsai: (excInSarsais % SARSAIS_PER_KANAL) % SARSAI_PER_MARLA
        },
        netEffective: {
          kanal: Math.floor(netEffectiveSarsais / SARSAIS_PER_KANAL),
          marla: Math.floor((netEffectiveSarsais % SARSAIS_PER_KANAL) / SARSAI_PER_MARLA),
          sarsai: (netEffectiveSarsais % SARSAIS_PER_KANAL) % SARSAI_PER_MARLA
        }
      }
    }
  });
}));

// GET /api/taj-residencia/land-acquisition/registries/registered-totals?moza=&excludeRegistryId=
router.get('/registries/registered-totals', authMiddleware, asyncHandler(async (req, res) => {
  const { moza, excludeRegistryId } = req.query;
  if (!moza) {
    return res.status(400).json({ success: false, message: 'moza is required' });
  }

  const filter = { moza, isActive: true };
  if (excludeRegistryId) {
    filter._id = { $ne: excludeRegistryId };
  }

  const totals = await fetchRegisteredTotalsByKhasra(moza, excludeRegistryId);
  res.json({ success: true, data: totals });
}));

// GET /api/taj-residencia/land-acquisition/registries/pending-possession
// Registries that exist but are not fully possessed
router.get('/registries/pending-possession', authMiddleware, asyncHandler(async (req, res) => {
  const LandPossession = require('../models/tajResidencia/LandPossession');
  const { moza, search = '', page = 1, limit = 25 } = req.query;

  const filter = { isActive: true };
  if (moza) filter.moza = moza;

  if (search && String(search).trim()) {
    const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    filter.$or = [
      { registryNo: re },
      { inteqalNo: re },
      { khewatNo: re },
      { 'lines.khasraNo': re },
      { 'lines.khewatNo': re }
    ];
  }

  const registries = await LandRegistry.find(filter)
    .populate('moza', 'name slug')
    .populate('seller', 'name cnic phoneNumber')
    .populate('purchaser', 'name cnic phoneNumber')
    .populate('dealer', 'name cnic phoneNumber')
    .sort({ registryDate: -1, createdAt: -1 })
    .lean();

  const mapped = await attachExchangeDataToRegistries(registries.map(mapRegistry));

  const mozaIds = [...new Set(mapped.map((r) => String(r.moza?._id || r.moza)).filter(Boolean))];
  const possessions = mozaIds.length
    ? await LandPossession.find({ moza: { $in: mozaIds }, isActive: true }).lean()
    : [];

  const registryByNo = new Map();
  mapped.forEach((r) => {
    const key = `${String(r.moza?._id || r.moza)}::${String(r.registryNo || '').trim().toLowerCase()}`;
    if (r.registryNo) registryByNo.set(key, String(r._id));
  });

  const possessedByRegistryId = new Map();
  possessions.forEach((pos) => {
    const mozaId = String(pos.moza?._id || pos.moza || '');
    const headerRegId = pos.registry ? String(pos.registry._id || pos.registry) : null;
    const headerRegNoKey = pos.registryNo
      ? `${mozaId}::${String(pos.registryNo).trim().toLowerCase()}`
      : null;

    (pos.lines || []).forEach((line) => {
      const area = normalizeArea(line.possessedArea);
      if (!toSarsais(area)) return;

      let regId = line.registry ? String(line.registry._id || line.registry) : null;
      if (!regId) regId = headerRegId;
      if (!regId && headerRegNoKey && registryByNo.has(headerRegNoKey)) {
        regId = registryByNo.get(headerRegNoKey);
      }
      if (!regId) return;

      const prev = possessedByRegistryId.get(regId) || { kanal: 0, marla: 0, sarsai: 0 };
      possessedByRegistryId.set(regId, addAreas(prev, area));
    });

    // Header-only possession (no lines) — attribute full totalArea if linked
    if (!(pos.lines || []).length) {
      const area = normalizeArea(pos.totalArea);
      if (!toSarsais(area)) return;
      let regId = headerRegId;
      if (!regId && headerRegNoKey && registryByNo.has(headerRegNoKey)) {
        regId = registryByNo.get(headerRegNoKey);
      }
      if (!regId) return;
      const prev = possessedByRegistryId.get(regId) || { kanal: 0, marla: 0, sarsai: 0 };
      possessedByRegistryId.set(regId, addAreas(prev, area));
    }
  });

  let grandRegistered = { kanal: 0, marla: 0, sarsai: 0 };
  let grandPossessed = { kanal: 0, marla: 0, sarsai: 0 };
  let grandPending = { kanal: 0, marla: 0, sarsai: 0 };

  const pendingRows = mapped
    .map((reg) => {
      const registeredArea = normalizeArea(reg.netRemainingArea || reg.totalArea);
      const possessedArea = normalizeArea(possessedByRegistryId.get(String(reg._id)) || {
        kanal: 0,
        marla: 0,
        sarsai: 0
      });
      // Cap possessed at registered so pending never goes negative from over-attribution
      const cappedPossessed = toSarsais(possessedArea) > toSarsais(registeredArea)
        ? registeredArea
        : possessedArea;
      const pendingPossession = subtractAreas(registeredArea, cappedPossessed);
      return {
        _id: reg._id,
        registryDate: reg.registryDate,
        dealNo: reg.dealNo || '',
        moza: reg.moza,
        khewatNo: reg.khewatNo || '',
        registryNo: reg.registryNo || '',
        inteqalNo: reg.inteqalNo || '',
        seller: reg.seller || null,
        purchaser: reg.purchaser || null,
        dealer: reg.dealer || null,
        khasras: [...new Set((reg.lines || []).map((l) => l.khasraNo).filter(Boolean))].join(', '),
        linesCount: (reg.lines || []).length,
        registeredArea,
        possessedArea: cappedPossessed,
        pendingPossession,
        isFullyPending: toSarsais(cappedPossessed) === 0
      };
    })
    .filter((row) => toSarsais(row.registeredArea) > 0 && toSarsais(row.pendingPossession) > 0);

  pendingRows.forEach((row) => {
    grandRegistered = addAreas(grandRegistered, row.registeredArea);
    grandPossessed = addAreas(grandPossessed, row.possessedArea);
    grandPending = addAreas(grandPending, row.pendingPossession);
  });

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100000);
  const skip = (pageNum - 1) * limitNum;
  const paged = pendingRows.slice(skip, skip + limitNum);

  res.json({
    success: true,
    data: {
      registries: paged,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: pendingRows.length
      },
      grandTotal: {
        registered: grandRegistered,
        possessed: grandPossessed,
        pendingPossession: grandPending,
        count: pendingRows.length
      }
    }
  });
}));

// GET /api/taj-residencia/land-acquisition/registries/:id
router.get('/registries/:id', authMiddleware, asyncHandler(async (req, res) => {
  const registry = await LandRegistry.findOne({ _id: req.params.id, isActive: true })
    .populate('moza', 'name slug')
    .populate('seller', 'name cnic phoneNumber partyDate')
    .populate('purchaser', 'name cnic phoneNumber partyDate')
    .populate('dealer', 'name cnic phoneNumber partyDate');

  if (!registry) {
    return res.status(404).json({ success: false, message: 'Registry not found' });
  }

  const mappedWithTransfers = await attachTransferDocsToRegistries([mapRegistry(registry)]);
  const mapped = await attachExchangeDataToRegistries(mappedWithTransfers);
  res.json({ success: true, data: mapped[0] });
}));

// POST /api/taj-residencia/land-acquisition/registries
router.post('/registries', authMiddleware, handleRegistryUpload, asyncHandler(async (req, res) => {
  let body;
  try {
    body = parseRegistryRequestBody(req);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  let payload;
  try {
    payload = buildRegistryPayload(body);
    payload.lines = await enrichRegistryLines(payload.lines);
    const khewatNos = [...new Set(payload.lines.map((l) => l.khewatNo).filter(Boolean))];
    payload.khewatNos = khewatNos;
    payload.khewatNo = khewatNos.join(', ');
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  if (!payload.registryDate || Number.isNaN(payload.registryDate.getTime())) {
    return res.status(400).json({ success: false, message: 'Registry date is required' });
  }
  if (!payload.moza) {
    return res.status(400).json({ success: false, message: 'Moza is required' });
  }
  if (!payload.khewatNos?.length) {
    return res.status(400).json({ success: false, message: 'At least one Khewat is required' });
  }
  if (!payload.lines.length) {
    return res.status(400).json({ success: false, message: 'At least one khasra line is required' });
  }

  const moza = await LandMoza.findOne({ _id: payload.moza, isActive: true });
  if (!moza) {
    return res.status(404).json({ success: false, message: 'Moza not found' });
  }

  try {
    payload = await resolveRegistryParties(payload);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  if (payload.registryNo) {
    const duplicate = await LandRegistry.findOne({
      moza: payload.moza,
      registryNo: payload.registryNo,
      isActive: true
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `Registry No. ${payload.registryNo} already exists for this mouza`
      });
    }
  }

  if (payload.inteqalNo) {
    const duplicate = await LandRegistry.findOne({
      moza: payload.moza,
      inteqalNo: payload.inteqalNo,
      isActive: true
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `Inteqal No. ${payload.inteqalNo} already exists for this mouza`
      });
    }
  }

  try {
    await assertKhasraOwnershipLimits(payload.moza, payload.lines);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  const filesMap = req.files || {};
  const registry = await LandRegistry.create({
    dealNo: payload.dealNo,
    registryDate: payload.registryDate,
    moza: payload.moza,
    khewatNo: payload.khewatNo,
    khewatNos: payload.khewatNos,
    totalArea: payload.totalArea,
    registryNo: payload.registryNo,
    inteqalNo: payload.inteqalNo,
    seller: payload.seller || null,
    purchaser: payload.purchaser || null,
    dealer: payload.dealer || null,
    lines: payload.lines,
    attachments: mapUploadedAttachments(filesMap.attachments || []),
    registryDocAttachments: mapUploadedAttachments(filesMap.registryDocAttachments || []),
    inteqalDocAttachments: mapUploadedAttachments(filesMap.inteqalDocAttachments || []),
    createdBy: req.user?._id
  });

  await registry.populate('moza', 'name slug');
  await registry.populate('seller', 'name cnic phoneNumber partyDate');
  await registry.populate('purchaser', 'name cnic phoneNumber partyDate');
  await registry.populate('dealer', 'name cnic phoneNumber partyDate');

  res.status(201).json({
    success: true,
    message: 'Registry created',
    data: mapRegistry(registry)
  });
}));

// PUT /api/taj-residencia/land-acquisition/registries/:id
router.put('/registries/:id', authMiddleware, handleRegistryUpload, asyncHandler(async (req, res) => {
  const registry = await LandRegistry.findOne({ _id: req.params.id, isActive: true });
  if (!registry) {
    return res.status(404).json({ success: false, message: 'Registry not found' });
  }

  let body;
  try {
    body = parseRegistryRequestBody(req);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  let payload;
  try {
    payload = buildRegistryPayload(body);
    payload.lines = await enrichRegistryLines(payload.lines);
    const khewatNos = [...new Set(payload.lines.map((l) => l.khewatNo).filter(Boolean))];
    payload.khewatNos = khewatNos;
    payload.khewatNo = khewatNos.join(', ');
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  try {
    payload = await resolveRegistryParties(payload);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  if (!payload.registryDate || Number.isNaN(payload.registryDate.getTime())) {
    return res.status(400).json({ success: false, message: 'Registry date is required' });
  }
  if (!payload.khewatNos?.length || !payload.lines.length) {
    return res.status(400).json({ success: false, message: 'At least one Khewat and one line are required' });
  }

  if (payload.registryNo) {
    const duplicate = await LandRegistry.findOne({
      _id: { $ne: registry._id },
      moza: registry.moza,
      registryNo: payload.registryNo,
      isActive: true
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `Registry No. ${payload.registryNo} already exists for this mouza`
      });
    }
  }

  if (payload.inteqalNo) {
    const duplicate = await LandRegistry.findOne({
      _id: { $ne: registry._id },
      moza: registry.moza,
      inteqalNo: payload.inteqalNo,
      isActive: true
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `Inteqal No. ${payload.inteqalNo} already exists for this mouza`
      });
    }
  }

  try {
    await assertKhasraOwnershipLimits(registry.moza, payload.lines, registry._id);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  if (payload.dealNo !== undefined) registry.dealNo = payload.dealNo;
  registry.registryDate = payload.registryDate;
  registry.khewatNo = payload.khewatNo;
  registry.khewatNos = payload.khewatNos;
  registry.totalArea = payload.totalArea;
  registry.registryNo = payload.registryNo;
  registry.inteqalNo = payload.inteqalNo;
  registry.seller = payload.seller || null;
  registry.purchaser = payload.purchaser || null;
  registry.dealer = payload.dealer || null;
  registry.lines = payload.lines;

  const filesMap = req.files || {};
  applyAttachmentChanges(registry, body, filesMap, 'attachments', 'removedAttachmentIds');
  applyAttachmentChanges(registry, body, filesMap, 'registryDocAttachments', 'removedRegistryDocAttachmentIds');
  applyAttachmentChanges(registry, body, filesMap, 'inteqalDocAttachments', 'removedInteqalDocAttachmentIds');

  await registry.save();
  await registry.populate('moza', 'name slug');
  await registry.populate('seller', 'name cnic phoneNumber partyDate');
  await registry.populate('purchaser', 'name cnic phoneNumber partyDate');
  await registry.populate('dealer', 'name cnic phoneNumber partyDate');

  res.json({
    success: true,
    message: 'Registry updated',
    data: mapRegistry(registry)
  });
}));

// DELETE /api/taj-residencia/land-acquisition/registries/:id
router.delete('/registries/:id', authMiddleware, asyncHandler(async (req, res) => {
  const registry = await LandRegistry.findOne({ _id: req.params.id, isActive: true });
  if (!registry) {
    return res.status(404).json({ success: false, message: 'Registry not found' });
  }

  registry.isActive = false;
  await registry.save();

  res.json({ success: true, message: 'Registry deleted' });
}));

// GET /api/taj-residencia/land-acquisition/khasra-summary
router.get('/khasra-summary', authMiddleware, asyncHandler(async (req, res) => {
  const { moza, search = '', page = 1, limit = 25 } = req.query;
  const LandMozaKhasraEntry = require('../models/tajResidencia/LandMozaKhasraEntry');
  const LandPossession = require('../models/tajResidencia/LandPossession');

  const khasraFilter = {};
  if (moza) {
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(moza)) {
      khasraFilter.moza = new mongoose.Types.ObjectId(moza);
    }
  }

  // If search query is provided
  if (search && search.trim()) {
    const cleanSearch = search.trim();
    const escaped = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');

    const matchingRegistries = await LandRegistry.find({
      isActive: true,
      ...(moza && { moza }),
      $or: [
        { registryNo: re },
        { inteqalNo: re },
        { 'lines.khasraNo': re },
        { 'lines.khewatNo': re }
      ]
    }).select('lines.khasraEntry').lean();

    const searchKhasraEntryIds = [];
    matchingRegistries.forEach((r) => {
      (r.lines || []).forEach((l) => {
        if (l.khasraEntry) searchKhasraEntryIds.push(l.khasraEntry);
      });
    });

    khasraFilter.$or = [
      { khasraNo: re },
      { khewatNo: re },
      ...(searchKhasraEntryIds.length ? [{ _id: { $in: searchKhasraEntryIds } }] : [])
    ];
  }

  const allKhasras = await LandMozaKhasraEntry.find(khasraFilter)
    .populate('moza', 'name slug')
    .sort({ moza: 1, srNo: 1, khasraNo: 1 })
    .lean();

  if (!allKhasras.length) {
    return res.json({
      success: true,
      data: {
        khasras: [],
        pagination: { page: Number(page) || 1, limit: Number(limit) || 25, total: 0 },
        grandTotal: {
          baseline: { kanal: 0, marla: 0, sarsai: 0 },
          registered: { kanal: 0, marla: 0, sarsai: 0 },
          remainingToRegister: { kanal: 0, marla: 0, sarsai: 0 },
          possessed: { kanal: 0, marla: 0, sarsai: 0 },
          remainingToPossess: { kanal: 0, marla: 0, sarsai: 0 }
        }
      }
    });
  }

  const mozaIds = [...new Set(allKhasras.map((k) => String(k.moza?._id || k.moza)))];

  const [registries, possessions, exchanges] = await Promise.all([
    LandRegistry.find({ moza: { $in: mozaIds }, isActive: true })
      .populate('seller', 'name cnic phoneNumber partyDate')
      .populate('purchaser', 'name cnic phoneNumber partyDate')
      .populate('dealer', 'name cnic phoneNumber partyDate')
      .lean(),
    LandPossession.find({ moza: { $in: mozaIds }, isActive: true })
      .populate('registry', 'registryNo inteqalNo dealNo')
      .populate('lines.registry', 'registryNo inteqalNo dealNo')
      .lean(),
    LandExchange.find({ isActive: true })
      .populate('party', 'name cnic phoneNumber')
      .lean()
  ]);

  const registryMetaById = new Map();
  registries.forEach((reg) => {
    registryMetaById.set(String(reg._id), {
      registryNo: reg.registryNo,
      inteqalNo: reg.inteqalNo,
      dealNo: reg.dealNo,
      registryDate: reg.registryDate
    });
  });

  const registriesByKhasra = new Map();
  registries.forEach((reg) => {
    (reg.lines || []).forEach((line) => {
      const kId = String(line.khasraEntry || '');
      const kKey = `${String(reg.moza)}_${String(line.khewatNo || '').trim()}_${String(line.khasraNo || '').trim()}`;
      const item = {
        _id: reg._id,
        registryNo: reg.registryNo,
        inteqalNo: reg.inteqalNo,
        dealNo: reg.dealNo,
        registryDate: reg.registryDate,
        seller: reg.seller,
        purchaser: reg.purchaser,
        dealer: reg.dealer,
        acquiredArea: normalizeArea(line.acquiredArea),
        registryDocAttachments: reg.registryDocAttachments || [],
        inteqalDocAttachments: reg.inteqalDocAttachments || [],
        attachments: reg.attachments || [],
        transferPercent: line.transferPercent,
        remarks: line.remarks
      };

      if (kId) {
        if (!registriesByKhasra.has(kId)) registriesByKhasra.set(kId, []);
        registriesByKhasra.get(kId).push(item);
      }
      if (!registriesByKhasra.has(kKey)) registriesByKhasra.set(kKey, []);
      registriesByKhasra.get(kKey).push(item);
    });
  });

  const exchangesInByKhasra = new Map();
  const exchangesOutByKhasra = new Map();

  exchanges.forEach((exc) => {
    // In Land (Acquired in exchange into khasra)
    (exc.inLandLines || []).forEach((inL, idx) => {
      const inArea = normalizeArea(inL.acquiredArea);
      if (toSarsais(inArea) === 0) return;
      const kId = inL.khasraEntry ? String(inL.khasraEntry) : '';
      const mozaIdStr = String(inL.moza?._id || inL.moza || exc.moza?._id || exc.moza || '');
      const kKey = `${mozaIdStr}_${String(inL.khewatNo || '').trim()}_${String(inL.khasraNo || '').trim()}`;

      const inItem = {
        _id: `exc-in-${exc._id}-${idx}`,
        exchangeId: exc._id,
        exchangeRef: exc.exchangeRef,
        registryNo: inL.registryNo || `(Exch: ${exc.exchangeRef})`,
        inteqalNo: inL.inteqalNo || '—',
        dealNo: exc.dealNo,
        exchangeDate: exc.exchangeDate,
        seller: exc.party,
        acquiredArea: inArea,
        attachments: exc.attachments || [],
        remarks: inL.remarks || `In Land from Exchange ${exc.exchangeRef}`
      };

      if (kId) {
        if (!exchangesInByKhasra.has(kId)) exchangesInByKhasra.set(kId, []);
        exchangesInByKhasra.get(kId).push(inItem);
      }
      if (!exchangesInByKhasra.has(kKey)) exchangesInByKhasra.set(kKey, []);
      exchangesInByKhasra.get(kKey).push(inItem);
    });

    // Out Land (Surrendered in exchange from khasra)
    (exc.outLandLines || []).forEach((outL, idx) => {
      const outArea = normalizeArea(outL.surrenderedArea);
      if (toSarsais(outArea) === 0) return;
      const kId = outL.khasraEntry ? String(outL.khasraEntry) : '';
      const mozaIdStr = String(outL.moza?._id || outL.moza || exc.moza?._id || exc.moza || '');
      const kKey = `${mozaIdStr}_${String(outL.khewatNo || '').trim()}_${String(outL.khasraNo || '').trim()}`;

      const outItem = {
        _id: `exc-out-${exc._id}-${idx}`,
        exchangeId: exc._id,
        exchangeRef: exc.exchangeRef,
        registryNo: outL.registryNo || '—',
        inteqalNo: outL.inteqalNo || '—',
        dealNo: exc.dealNo,
        exchangeDate: exc.exchangeDate,
        party: exc.party,
        surrenderedArea: outArea,
        remarks: outL.remarks || `Surrendered in Exchange ${exc.exchangeRef}`
      };

      if (kId) {
        if (!exchangesOutByKhasra.has(kId)) exchangesOutByKhasra.set(kId, []);
        exchangesOutByKhasra.get(kId).push(outItem);
      }
      if (!exchangesOutByKhasra.has(kKey)) exchangesOutByKhasra.set(kKey, []);
      exchangesOutByKhasra.get(kKey).push(outItem);
    });
  });

  // Possessions are attributed to the REGISTRY khasra (the land the registry is for).
  // When the land was physically handed over in a different khasra, the line is a
  // "linked possession": it reduces the registry khasra's pending possession and is
  // listed on the possessed khasra only for information ("handed over here").
  const possessionsByKhasra = new Map();
  const handedOverByKhasra = new Map();
  const pushTo = (map, key, item) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  };
  possessions.forEach((pos) => {
    (pos.lines || []).forEach((line) => {
      const mozaKey = String(pos.moza);
      const possKhewat = String(line.khewatNo || '').trim();
      const possKhasra = String(line.khasraNo || '').trim();
      const regKhewat = String(line.registryKhewatNo || line.khewatNo || '').trim();
      const regKhasra = String(line.registryKhasraNo || line.khasraNo || '').trim();
      const possId = String(line.khasraEntry || '');
      const regId = String(line.registryKhasraEntry || line.khasraEntry || '');
      const possKey = `${mozaKey}_${possKhewat}_${possKhasra}`;
      const regKey = `${mozaKey}_${regKhewat}_${regKhasra}`;
      const isLinked = regId && possId
        ? regId !== possId
        : regKey !== possKey;
      const linkedRegistry = line.registry || pos.registry || null;
      const linkedRegistryId = linkedRegistry
        ? String(linkedRegistry._id || linkedRegistry)
        : '';
      const meta = linkedRegistryId ? registryMetaById.get(linkedRegistryId) : null;
      const item = {
        _id: pos._id,
        lineId: String(line._id || ''),
        possessionRef: pos.possessionRef,
        possessionDate: pos.possessionDate,
        possessedArea: normalizeArea(line.possessedArea),
        isLinked,
        registryKhewatNo: regKhewat,
        registryKhasraNo: regKhasra,
        possessedKhewatNo: possKhewat,
        possessedKhasraNo: possKhasra,
        transferPercent: line.transferPercent,
        remarks: line.remarks,
        registryId: linkedRegistryId || null,
        registryNo:
          pos.registryNo ||
          (linkedRegistry && typeof linkedRegistry === 'object' && linkedRegistry.registryNo) ||
          meta?.registryNo ||
          '',
        inteqalNo:
          pos.inteqalNo ||
          (linkedRegistry && typeof linkedRegistry === 'object' && linkedRegistry.inteqalNo) ||
          meta?.inteqalNo ||
          '',
        dealNo:
          (linkedRegistry && typeof linkedRegistry === 'object' && linkedRegistry.dealNo) ||
          meta?.dealNo ||
          ''
      };

      pushTo(possessionsByKhasra, regId, item);
      pushTo(possessionsByKhasra, regKey, item);
      if (isLinked) {
        pushTo(handedOverByKhasra, possId, item);
        pushTo(handedOverByKhasra, possKey, item);
      }
    });
  });

  const uniqueByLine = (list) =>
    Array.from(new Map(list.map((p) => [p.lineId || `${p._id}${JSON.stringify(p.possessedArea)}`, p])).values());

  let grandBaseline = { kanal: 0, marla: 0, sarsai: 0 };
  let grandRegistered = { kanal: 0, marla: 0, sarsai: 0 };
  let grandRemainingToRegister = { kanal: 0, marla: 0, sarsai: 0 };
  let grandPossessed = { kanal: 0, marla: 0, sarsai: 0 };
  let grandDirectPossessed = { kanal: 0, marla: 0, sarsai: 0 };
  let grandLinkedPossessed = { kanal: 0, marla: 0, sarsai: 0 };
  let grandRemainingToPossess = { kanal: 0, marla: 0, sarsai: 0 };
  let grandOverPossessed = { kanal: 0, marla: 0, sarsai: 0 };
  let overPossessedCount = 0;
  let grandOverRegistered = { kanal: 0, marla: 0, sarsai: 0 };
  let overRegisteredCount = 0;

  const enrichedKhasras = allKhasras.map((entry) => {
    const id = String(entry._id);
    const mozaIdStr = String(entry.moza?._id || entry.moza);
    const fallbackKey = `${mozaIdStr}_${String(entry.khewatNo || '').trim()}_${String(entry.khasraNo || '').trim()}`;

    const regList = registriesByKhasra.get(id) || registriesByKhasra.get(fallbackKey) || [];
    const uniqueRegistries = Array.from(new Map(regList.map(r => [String(r._id) + JSON.stringify(r.acquiredArea), r])).values());

    const excInList = exchangesInByKhasra.get(id) || exchangesInByKhasra.get(fallbackKey) || [];
    const uniqueExcIn = Array.from(new Map(excInList.map(e => [String(e._id) + JSON.stringify(e.acquiredArea), e])).values());

    const excOutList = exchangesOutByKhasra.get(id) || exchangesOutByKhasra.get(fallbackKey) || [];
    const uniqueExcOut = Array.from(new Map(excOutList.map(e => [String(e._id) + JSON.stringify(e.surrenderedArea), e])).values());

    const posList = possessionsByKhasra.get(id) || possessionsByKhasra.get(fallbackKey) || [];
    const uniquePossessions = uniqueByLine(posList);
    const directPossessions = uniquePossessions.filter((p) => !p.isLinked);
    const linkedPossessions = uniquePossessions.filter((p) => p.isLinked);
    const handedOverList = handedOverByKhasra.get(id) || handedOverByKhasra.get(fallbackKey) || [];
    const handedOverPossessions = uniqueByLine(handedOverList);

    const baseline = normalizeArea(entry.landInKhasra);
    const directPurchased = addAreas(...uniqueRegistries.map(r => r.acquiredArea));
    const exchangedOut = addAreas(...uniqueExcOut.map(e => e.surrenderedArea));
    const exchangedIn = addAreas(...uniqueExcIn.map(e => e.acquiredArea));

    // Net Acquired in this Khasra = (Direct Purchased - Exchanged Out) + Exchanged In
    const afterOut = subtractAreas(directPurchased, exchangedOut);
    const registered = addAreas(afterOut, exchangedIn);

    const directPossessed = addAreas(...directPossessions.map(p => p.possessedArea));
    const linkedPossessed = addAreas(...linkedPossessions.map(p => p.possessedArea));
    const possessed = addAreas(directPossessed, linkedPossessed);
    const remainingToRegister = subtractAreas(baseline, registered);
    const remainingToPossess = subtractAreas(registered, possessed);
    const overPossessed = subtractAreas(possessed, registered);
    const overRegistered = subtractAreas(registered, baseline);
    if (toSarsais(overRegistered) > 0) {
      grandOverRegistered = addAreas(grandOverRegistered, overRegistered);
      overRegisteredCount += 1;
    }

    grandBaseline = addAreas(grandBaseline, baseline);
    grandRegistered = addAreas(grandRegistered, registered);
    grandRemainingToRegister = addAreas(grandRemainingToRegister, remainingToRegister);
    grandPossessed = addAreas(grandPossessed, possessed);
    grandDirectPossessed = addAreas(grandDirectPossessed, directPossessed);
    grandLinkedPossessed = addAreas(grandLinkedPossessed, linkedPossessed);
    grandRemainingToPossess = addAreas(grandRemainingToPossess, remainingToPossess);
    if (toSarsais(overPossessed) > 0) {
      grandOverPossessed = addAreas(grandOverPossessed, overPossessed);
      overPossessedCount += 1;
    }

    // Combine direct registries + In Land acquisitions for the khasra detail modal
    const combinedRegistries = [
      ...uniqueRegistries,
      ...uniqueExcIn.map((e) => ({
        _id: e._id,
        isExchangeIn: true,
        registryNo: e.registryNo,
        inteqalNo: e.inteqalNo,
        dealNo: e.dealNo,
        registryDate: e.exchangeDate,
        seller: e.seller,
        purchaser: { name: 'Taj Residencia (Exchange In)' },
        dealer: null,
        acquiredArea: e.acquiredArea,
        registryDocAttachments: e.attachments || [],
        inteqalDocAttachments: [],
        transferPercent: 100,
        remarks: e.remarks
      }))
    ].sort((a, b) => {
      const da = a.registryDate ? new Date(a.registryDate).getTime() : 0;
      const db = b.registryDate ? new Date(b.registryDate).getTime() : 0;
      return da - db;
    });

    // Attribute possession to registries (explicit link first, then FIFO for unlinked)
    const possessedByRegistryId = new Map();
    let unlinkedPossessed = { kanal: 0, marla: 0, sarsai: 0 };
    uniquePossessions.forEach((p) => {
      const area = normalizeArea(p.possessedArea);
      if (p.registryId && combinedRegistries.some((r) => String(r._id) === String(p.registryId))) {
        const prev = possessedByRegistryId.get(String(p.registryId)) || { kanal: 0, marla: 0, sarsai: 0 };
        possessedByRegistryId.set(String(p.registryId), addAreas(prev, area));
      } else {
        unlinkedPossessed = addAreas(unlinkedPossessed, area);
      }
    });

    const pendingByRegistry = [];
    combinedRegistries.forEach((reg) => {
      const id = String(reg._id);
      const acquired = normalizeArea(reg.acquiredArea);
      let attributed = possessedByRegistryId.get(id) || { kanal: 0, marla: 0, sarsai: 0 };
      const stillNeeded = subtractAreas(acquired, attributed);
      if (toSarsais(unlinkedPossessed) > 0 && toSarsais(stillNeeded) > 0) {
        const take = toSarsais(unlinkedPossessed) <= toSarsais(stillNeeded)
          ? unlinkedPossessed
          : stillNeeded;
        attributed = addAreas(attributed, take);
        unlinkedPossessed = subtractAreas(unlinkedPossessed, take);
        possessedByRegistryId.set(id, attributed);
      }
      const pendingPossession = subtractAreas(acquired, attributed);
      const regOverPossessed = subtractAreas(attributed, acquired);
      const possessionRefs = uniquePossessions
        .filter((p) => p.registryId && String(p.registryId) === id)
        .map((p) => ({
          possessionRef: p.possessionRef,
          possessedArea: p.possessedArea,
          isLinked: p.isLinked,
          possessedKhewatNo: p.possessedKhewatNo,
          possessedKhasraNo: p.possessedKhasraNo
        }));
      pendingByRegistry.push({
        overPossessed: regOverPossessed,
        possessionRefs,
        _id: reg._id,
        isExchangeIn: Boolean(reg.isExchangeIn),
        registryNo: reg.registryNo || '—',
        inteqalNo: reg.inteqalNo || '—',
        dealNo: reg.dealNo || '',
        registryDate: reg.registryDate || null,
        sellerName: reg.seller?.name || '—',
        acquiredArea: acquired,
        possessedArea: attributed,
        pendingPossession
      });
    });

    // Attach per-registry pending onto linked registry rows for the detail table
    const registriesWithPending = combinedRegistries.map((reg) => {
      const row = pendingByRegistry.find((p) => String(p._id) === String(reg._id));
      return {
        ...reg,
        possessedArea: row?.possessedArea || { kanal: 0, marla: 0, sarsai: 0 },
        pendingPossession: row?.pendingPossession || { kanal: 0, marla: 0, sarsai: 0 },
        overPossessed: row?.overPossessed || { kanal: 0, marla: 0, sarsai: 0 },
        possessionRefs: row?.possessionRefs || []
      };
    });

    return {
      _id: entry._id,
      srNo: entry.srNo,
      moza: entry.moza,
      khewatNo: entry.khewatNo,
      khasraNo: entry.khasraNo,
      landInKhasra: baseline,
      totalAcquired: registered,
      remainingToRegister,
      overRegistered,
      // totalPossessed = possession taken in this khasra against its own registry
      // linkedPossessed = possession taken in another khasra against this khasra's registry
      totalPossessed: directPossessed,
      linkedPossessed,
      possessedAll: possessed,
      remainingToPossess,
      overPossessed,
      registries: registriesWithPending,
      pendingByRegistry: pendingByRegistry.filter((r) => toSarsais(r.pendingPossession) > 0),
      exchangesOut: uniqueExcOut,
      exchangesIn: uniqueExcIn,
      possessions: directPossessions,
      linkedPossessions,
      handedOverPossessions,
      registriesCount: combinedRegistries.length,
      possessionsCount: uniquePossessions.length,
      remarks: entry.remarks
    };
  });

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 500);
  const skip = (pageNum - 1) * limitNum;
  const pagedKhasras = enrichedKhasras.slice(skip, skip + limitNum);

  res.json({
    success: true,
    data: {
      khasras: pagedKhasras,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: enrichedKhasras.length
      },
      grandTotal: {
        baseline: grandBaseline,
        registered: grandRegistered,
        remainingToRegister: grandRemainingToRegister,
        possessed: grandPossessed,
        directPossessed: grandDirectPossessed,
        linkedPossessed: grandLinkedPossessed,
        remainingToPossess: grandRemainingToPossess,
        overPossessed: grandOverPossessed,
        overPossessedCount,
        overRegistered: grandOverRegistered,
        overRegisteredCount
      }
    }
  });
}));

module.exports = router;
