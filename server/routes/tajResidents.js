const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const TajResident = require('../models/tajResidencia/TajResident');
const TajTransaction = require('../models/tajResidencia/TajTransaction');
const TajProperty = require('../models/tajResidencia/TajProperty');
const PropertyInvoice = require('../models/tajResidencia/PropertyInvoice');
const { authMiddleware } = require('../middleware/auth');
const asyncHandler = require('../middleware/errorHandler').asyncHandler;
const {
  getCached,
  setCached,
  clearCached,
  CACHE_KEYS
} = require('../utils/tajUtilitiesOptimizer');

const GRACE_PERIOD_DAYS = 6;

const getInvoicePayableForCarryForward = (invoice) => {
  if (!invoice) return 0;
  const totalPaid = Number(invoice.totalPaid || 0);
  const basePayable = Math.max(0, Number(invoice.grandTotal || 0) - totalPaid);
  if (basePayable <= 0) return 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dueStart = invoice.dueDate ? new Date(invoice.dueDate) : null;
  if (dueStart) dueStart.setHours(0, 0, 0, 0);
  const dueWithGrace = dueStart ? new Date(dueStart) : null;
  if (dueWithGrace) dueWithGrace.setDate(dueWithGrace.getDate() + GRACE_PERIOD_DAYS);
  const isOverdue = dueWithGrace && todayStart > dueWithGrace;
  const isUnpaid = invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'partial_paid' || basePayable > 0;

  if (!isOverdue || !isUnpaid) return Math.round(basePayable * 100) / 100;

  const chargesForMonth = (invoice.charges || []).reduce((sum, c) => sum + (Number(c.amount) || 0), 0) || Number(invoice.subtotal || 0);
  const lateSurcharge = Math.max(Math.round(chargesForMonth * 0.1), 0);
  return Math.round((basePayable + lateSurcharge) * 100) / 100;
};

const recalculateFutureCamInvoices = async (propertyId, anchorDate) => {
  if (!propertyId || !anchorDate) return;

  const allCamInvoices = await PropertyInvoice.find({
    property: propertyId,
    chargeTypes: { $in: ['CAM'] },
    status: { $ne: 'Cancelled' }
  })
    .sort({ invoiceDate: 1, createdAt: 1 })
    .select('invoiceDate createdAt paymentStatus charges subtotal totalArrears grandTotal totalPaid dueDate')
    .lean();

  if (!allCamInvoices.length) return;

  const anchorMs = new Date(anchorDate).getTime();
  for (let i = 1; i < allCamInvoices.length; i++) {
    const previous = allCamInvoices[i - 1];
    const current = allCamInvoices[i];
    const currentMs = new Date(current.invoiceDate || current.createdAt || 0).getTime();
    if (!(currentMs > anchorMs)) continue;
    if (!['unpaid', 'partial_paid'].includes(current.paymentStatus)) continue;

    const carryForward = getInvoicePayableForCarryForward(previous);
    const updatedCharges = (current.charges || []).map((ch) => {
      if (String(ch.type || '').toUpperCase() !== 'CAM') return ch;
      const amount = Number(ch.amount) || 0;
      return { ...ch, arrears: carryForward, total: Math.round((amount + carryForward) * 100) / 100 };
    });

    const subtotal = Math.round(updatedCharges.reduce((sum, ch) => sum + (Number(ch.amount) || 0), 0) * 100) / 100;
    const totalArrears = Math.round(updatedCharges.reduce((sum, ch) => sum + (Number(ch.arrears) || 0), 0) * 100) / 100;
    const grandTotal = Math.round((subtotal + totalArrears) * 100) / 100;

    const currentDoc = await PropertyInvoice.findById(current._id);
    if (!currentDoc) continue;
    currentDoc.charges = updatedCharges;
    currentDoc.subtotal = subtotal;
    currentDoc.totalArrears = totalArrears;
    currentDoc.grandTotal = grandTotal;
    await currentDoc.save();

    allCamInvoices[i] = {
      ...current,
      charges: updatedCharges,
      subtotal,
      totalArrears,
      grandTotal,
      totalPaid: currentDoc.totalPaid,
      paymentStatus: currentDoc.paymentStatus,
      dueDate: currentDoc.dueDate
    };
  }
};

// Generic version of recalculateFutureCamInvoices that works for any charge type
// (ELECTRICITY, RENT, etc.). Recalculates arrears on unpaid/partial invoices that
// come after the paid one so their grandTotal stays accurate.
const recalculateFutureInvoicesByChargeType = async (propertyId, chargeType, anchorDate) => {
  if (!propertyId || !chargeType || !anchorDate) return;
  const upperType = String(chargeType).toUpperCase();

  const allInvoices = await PropertyInvoice.find({
    property: propertyId,
    chargeTypes: { $in: [chargeType] },
    status: { $ne: 'Cancelled' }
  })
    .sort({ invoiceDate: 1, createdAt: 1 })
    .select('invoiceDate createdAt paymentStatus charges subtotal totalArrears grandTotal totalPaid dueDate')
    .lean();

  if (!allInvoices.length) return;

  const anchorMs = new Date(anchorDate).getTime();
  for (let i = 1; i < allInvoices.length; i++) {
    const previous = allInvoices[i - 1];
    const current = allInvoices[i];
    const currentMs = new Date(current.invoiceDate || current.createdAt || 0).getTime();
    if (!(currentMs > anchorMs)) continue;
    if (!['unpaid', 'partial_paid'].includes(current.paymentStatus)) continue;

    const carryForward = getInvoicePayableForCarryForward(previous);
    const updatedCharges = (current.charges || []).map((ch) => {
      if (String(ch.type || '').toUpperCase() !== upperType) return ch;
      const amount = Number(ch.amount) || 0;
      return { ...ch, arrears: carryForward, total: Math.round((amount + carryForward) * 100) / 100 };
    });

    const subtotal = Math.round(updatedCharges.reduce((sum, ch) => sum + (Number(ch.amount) || 0), 0) * 100) / 100;
    const totalArrears = Math.round(updatedCharges.reduce((sum, ch) => sum + (Number(ch.arrears) || 0), 0) * 100) / 100;
    const grandTotal = Math.round((subtotal + totalArrears) * 100) / 100;

    const currentDoc = await PropertyInvoice.findById(current._id);
    if (!currentDoc) continue;
    currentDoc.charges = updatedCharges;
    currentDoc.subtotal = subtotal;
    currentDoc.totalArrears = totalArrears;
    currentDoc.grandTotal = grandTotal;
    await currentDoc.save();

    allInvoices[i] = {
      ...current,
      charges: updatedCharges,
      subtotal,
      totalArrears,
      grandTotal,
      totalPaid: currentDoc.totalPaid,
      paymentStatus: currentDoc.paymentStatus,
      dueDate: currentDoc.dueDate
    };
  }
};

// Get all residents
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  // Extract pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;
  
  // OPTIMIZATION: Check cache first (only if no filters/search and default pagination)
  const hasFilters =
    req.query.search ||
    req.query.accountType ||
    req.query.bank ||
    req.query.isActive !== undefined ||
    req.query.sortBy ||
    req.query.order;
  const isDefaultPagination = page === 1 && limit === 50;
  const cacheKey = (hasFilters || !isDefaultPagination) ? null : CACHE_KEYS.RESIDENTS_LIST;
  
  if (cacheKey) {
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('📋 Returning cached residents list');
      return res.json(cached);
    }
  }
  
  const { search, accountType, bank, isActive, sortBy, order } = req.query;
  const query = {};

  // Exclude suspense account residents (those without name or residentId)
  // These should only appear in the Suspense Account page, not in the main residents list
  query.$and = [
    {
      $or: [
        { name: { $exists: true, $ne: null, $ne: '' } },
        { residentId: { $exists: true, $ne: null, $ne: '' } }
      ]
    }
  ];

  if (search) {
    const searchConditions = [
      { name: new RegExp(search, 'i') },
      { cnic: new RegExp(search, 'i') },
      { contactNumber: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') },
      { residentId: new RegExp(search, 'i') }
    ];
    query.$and.push({ $or: searchConditions });
  }

  if (accountType) query.accountType = accountType;
  if (bank) {
    const bankRegex = new RegExp(`^${String(bank).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const residentIdsForBank = await TajTransaction.distinct('resident', {
      transactionType: 'deposit',
      bank: bankRegex
    });
    query._id = { $in: residentIdsForBank };
  }
  if (isActive !== undefined) query.isActive = isActive === 'true';

  // Get total count for pagination
  const total = await TajResident.countDocuments(query);

  const sortDir = String(order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  let sortSpec = { name: 1 };
  if (sortBy === 'balance') sortSpec = { balance: sortDir };
  else if (sortBy === 'residentId') sortSpec = { residentId: sortDir };
  else if (sortBy === 'createdAt') sortSpec = { createdAt: sortDir };

  // OPTIMIZATION: Select only needed fields and use lean with pagination
  let residents = await TajResident.find(query)
    .select('_id residentId name cnic contactNumber email accountType isActive properties balance createdBy updatedBy createdAt updatedAt')
    .populate('properties', 'propertyName plotNumber sector block fullAddress ownerName meters')
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName')
    .sort(sortSpec)
    .skip(skip)
    .limit(limit)
    .lean();

  // Lightweight: Populate missing residentIds for existing records
  const residentsWithoutId = residents.filter(r => !r.residentId);
  if (residentsWithoutId.length > 0) {
    const allResidents = await TajResident.find({}, { residentId: 1 }).lean();
    let highestId = 0;
    allResidents.forEach(res => {
      if (res.residentId) {
        const numericId = parseInt(res.residentId.replace(/^0+/, ''));
        if (!isNaN(numericId) && numericId > highestId) {
          highestId = numericId;
        }
      }
    });
    
    // Update missing IDs synchronously for current response
    for (const resident of residentsWithoutId) {
      try {
        highestId++;
        const residentId = highestId.toString().padStart(5, '0');
        await TajResident.findByIdAndUpdate(resident._id, { residentId }, { new: false });
        resident.residentId = residentId;
      } catch (error) {
        console.error(`Error updating resident ID for ${resident._id}:`, error);
      }
    }
  }

  // Calculate property count and total remaining deposits for each resident
  const residentIds = residents.map(r => r._id);
  
  // Get all deposits for these residents (exclude reversal transactions)
  const allDeposits = await TajTransaction.find({
    resident: { $in: residentIds },
    transactionType: 'deposit',
    $or: [
      { referenceNumberExternal: { $not: /^REV-/ } },
      { referenceNumberExternal: { $exists: false } },
      { referenceNumberExternal: null }
    ]
  }).select('resident amount _id').lean();
  
  // Get all deposit usages from bill_payment transactions
  const depositIds = allDeposits.map(d => d._id);
  const depositUsageMap = {};
  
  if (depositIds.length > 0) {
    const usedInPayments = await TajTransaction.find({
      'depositUsages.depositId': { $in: depositIds },
      transactionType: 'bill_payment'
    }).select('depositUsages').lean();
    
    usedInPayments.forEach(payment => {
      if (payment.depositUsages && Array.isArray(payment.depositUsages)) {
        payment.depositUsages.forEach(usage => {
          const depositId = usage.depositId?.toString();
          if (depositId) {
            depositUsageMap[depositId] = (depositUsageMap[depositId] || 0) + (usage.amount || 0);
          }
        });
      }
    });
  }
  
  // Calculate remaining deposits per resident
  const remainingDepositsByResident = {};
  allDeposits.forEach(deposit => {
    const residentId = deposit.resident.toString();
    const depositId = deposit._id.toString();
    const totalUsed = depositUsageMap[depositId] || 0;
    const remaining = Math.max(0, (deposit.amount || 0) - totalUsed);
    
    if (!remainingDepositsByResident[residentId]) {
      remainingDepositsByResident[residentId] = 0;
    }
    remainingDepositsByResident[residentId] += remaining;
  });
  
  // Calculate property count and add remaining deposits balance
  const residentsWithCount = residents.map(resident => {
    resident.propertyCount = resident.properties ? resident.properties.length : 0;
    // Add total remaining deposits as the balance
    resident.totalRemainingDeposits = remainingDepositsByResident[resident._id.toString()] || 0;
    return resident;
  });

  const totalPages = Math.ceil(total / limit);
  const response = { 
    success: true, 
    data: residentsWithCount,
    pagination: {
      page,
      limit,
      total,
      totalPages
    }
  };
  
  // OPTIMIZATION: Cache response if no filters and default pagination
  if (cacheKey) {
    setCached(cacheKey, response);
  }
  
  res.json(response);
}));

// Get unassigned properties (MUST come before /:id route)
router.get('/unassigned-properties', authMiddleware, asyncHandler(async (req, res) => {
  // OPTIMIZATION: Check cache first (only if no filters/search)
  const hasFilters = req.query.search || req.query.includeAssigned === 'true';
  const cacheKey = hasFilters ? null : CACHE_KEYS.UNASSIGNED_PROPERTIES;
  
  if (cacheKey) {
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('📋 Returning cached unassigned properties');
      return res.json(cached);
    }
  }
  
  const { search, includeAssigned } = req.query;
  const query = {};

  // If includeAssigned is not true, only show unassigned properties
  if (includeAssigned !== 'true') {
    query.$or = [
      { resident: null },
      { resident: { $exists: false } }
    ];
  }

  if (search) {
    const searchRegex = new RegExp(search.trim(), 'i');
    const searchConditions = [
      { propertyName: searchRegex },
      { plotNumber: searchRegex },
      { sector: searchRegex },
      { block: searchRegex },
      { ownerName: searchRegex },
      { fullAddress: searchRegex },
      { rdaNumber: searchRegex },
      { street: searchRegex },
      { project: searchRegex }
    ];

    // If search is a number, also search by srNo
    if (!isNaN(search.trim()) && search.trim() !== '') {
      const srNoValue = parseInt(search.trim());
      if (!isNaN(srNoValue)) {
        searchConditions.push({ srNo: srNoValue });
      }
    }

    if (includeAssigned === 'true') {
      // If including assigned, just add search conditions
      query.$or = searchConditions;
    } else {
      // If only unassigned, combine with existing query
      query.$and = [
        {
          $or: searchConditions
        }
      ];
    }
  }

  // OPTIMIZATION: Use lean for better performance
  const properties = await TajProperty.find(query)
    .select('propertyName plotNumber sector block fullAddress ownerName contactNumber rdaNumber street project srNo resident meters')
    .populate('resident', 'name')
    .sort({ propertyName: 1 })
    .limit(200)
    .lean();

  const response = { success: true, data: properties };
  
  // OPTIMIZATION: Cache response if no filters
  if (cacheKey) {
    setCached(cacheKey, response);
  }
  
  res.json(response);
}));

// Get resident ledger (invoices, deposits, payments, transactions) - supports residentId or MongoDB _id
router.get('/ledger', authMiddleware, asyncHandler(async (req, res) => {
  const { residentId: residentIdParam, propertyId: propertyIdParam } = req.query;
  if (!residentIdParam || String(residentIdParam).trim() === '') {
    return res.status(400).json({ success: false, message: 'Resident ID is required' });
  }

  const id = String(residentIdParam).trim();
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);

  let resident = null;
  if (isObjectId) {
    resident = await TajResident.findById(id)
      .populate('properties', 'propertyName plotNumber sector block fullAddress ownerName srNo')
      .lean();
  }
  if (!resident) {
    resident = await TajResident.findOne({ residentId: id })
      .populate('properties', 'propertyName plotNumber sector block fullAddress ownerName srNo')
      .lean();
  }
  if (!resident) {
    return res.status(404).json({ success: false, message: 'Resident not found' });
  }

  const residentMongoId = resident._id;

  // Get all properties for this resident (both from resident.properties and TajProperty.resident)
  const propertyIdsFromResident = (resident.properties || []).map(p => (typeof p === 'object' ? p._id : p));
  const propertiesByResident = await TajProperty.find({ resident: residentMongoId })
    .select('propertyName plotNumber sector block fullAddress ownerName srNo')
    .lean();
  const propertyIdsFromProps = propertiesByResident.map(p => p._id);
  const allPropertyIds = [...new Set([...propertyIdsFromResident.map(String), ...propertyIdsFromProps.map(String)])];

  const allProperties = allPropertyIds.length > 0
    ? await TajProperty.find({ _id: { $in: allPropertyIds } })
      .select('propertyName plotNumber sector block fullAddress ownerName srNo')
      .sort({ srNo: 1, plotNumber: 1 })
      .lean()
    : [];

  let invoicePropertyIds = allPropertyIds;
  const filterPropertyId = propertyIdParam ? String(propertyIdParam).trim() : '';
  if (filterPropertyId) {
    if (!allPropertyIds.includes(filterPropertyId)) {
      return res.status(400).json({
        success: false,
        message: 'Selected property does not belong to this resident'
      });
    }
    invoicePropertyIds = [filterPropertyId];
  }

  // Fetch invoices for these properties
  const invoices = invoicePropertyIds.length > 0
    ? await PropertyInvoice.find({
        property: { $in: invoicePropertyIds },
        status: { $ne: 'Cancelled' }
      })
        .select('invoiceNumber invoiceDate periodFrom periodTo dueDate chargeTypes charges subtotal totalArrears grandTotal totalPaid balance paymentStatus status')
        .populate('property', 'propertyName plotNumber sector')
        .sort({ periodTo: -1, invoiceDate: -1 })
        .limit(200)
        .lean()
    : [];

  // Fetch all transactions (deposits, payments, bill_payment, withdraw, transfer)
  const transactions = await TajTransaction.find({ resident: residentMongoId })
    .populate('depositUsages.depositId', 'amount referenceNumberExternal createdAt')
    .populate('targetResident', 'name residentId')
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  // Calculate remaining amounts for deposits
  const allDeposits = await TajTransaction.find({
    resident: residentMongoId,
    transactionType: 'deposit',
    $or: [
      { referenceNumberExternal: { $not: /^REV-/ } },
      { referenceNumberExternal: { $exists: false } },
      { referenceNumberExternal: null }
    ]
  }).select('_id amount').lean();

  const depositIds = allDeposits.map(d => d._id);
  const depositUsageMap = {};
  if (depositIds.length > 0) {
    const payments = await TajTransaction.find({
      resident: residentMongoId,
      transactionType: 'bill_payment',
      'depositUsages.depositId': { $in: depositIds }
    }).select('depositUsages').lean();
    payments.forEach(p => {
      (p.depositUsages || []).forEach(u => {
        const did = u.depositId?.toString?.() || u.depositId;
        if (did) depositUsageMap[did] = (depositUsageMap[did] || 0) + (u.amount || 0);
      });
    });
  }

  const transactionsWithRemaining = transactions.map(t => {
    const txn = { ...t };
    if (t.transactionType === 'deposit') {
      const totalUsed = depositUsageMap[t._id.toString()] || 0;
      txn.remainingAmount = Math.max(0, (t.amount || 0) - totalUsed);
      txn.totalUsed = totalUsed;
    }
    return txn;
  });

  const selectedProperty = filterPropertyId
    ? allProperties.find((p) => String(p._id) === filterPropertyId) || null
    : null;

  res.json({
    success: true,
    data: {
      resident: {
        _id: resident._id,
        residentId: resident.residentId,
        name: resident.name,
        accountType: resident.accountType,
        cnic: resident.cnic,
        contactNumber: resident.contactNumber,
        email: resident.email,
        address: resident.address,
        balance: resident.balance ?? 0,
        properties: allProperties
      },
      selectedPropertyId: filterPropertyId || null,
      selectedProperty,
      invoices,
      transactions: transactionsWithRemaining
    }
  });
}));

// Get resident by ID
router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const resident = await TajResident.findById(req.params.id)
    .populate('properties', 'propertyName plotNumber sector block fullAddress ownerName meters')
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName');

  if (!resident) {
    return res.status(404).json({ success: false, message: 'Resident not found' });
  }

  const residentObj = resident.toObject();
  residentObj.propertyCount = resident.properties ? resident.properties.length : 0;

  res.json({ success: true, data: residentObj });
}));

// Create resident
router.post(
  '/',
  authMiddleware,
  [
    body('name').optional().trim(), // Allow empty name for suspense account
    body('accountType').optional().isIn(['Resident', 'Property Dealer', 'Other']),
    body('balance').optional().isFloat({ min: 0 })
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const initialBalance = parseFloat(req.body.balance) || 0;
    
    // Set balance to 0 initially, will be updated if deposit is created
    const residentData = {
      ...req.body,
      balance: 0, // Start with 0, will be updated by deposit transaction
      createdBy: req.user.id
    };
    
    // Normalize email to lowercase
    if (residentData.email) {
      residentData.email = residentData.email.toLowerCase().trim();
    }

    const resident = new TajResident(residentData);
    await resident.save();

    // If initial balance is provided, create a deposit transaction
    if (initialBalance > 0) {
      const balanceBefore = 0;
      const balanceAfter = initialBalance;

      // Update resident balance
      resident.balance = balanceAfter;
      await resident.save();

      // Create deposit transaction (same as deposit endpoint)
      const transaction = new TajTransaction({
        resident: resident._id,
        transactionType: 'deposit',
        amount: initialBalance,
        balanceBefore,
        balanceAfter,
        description: req.body.notes || 'Initial Balance Deposit',
        paymentMethod: 'Cash', // Default payment method for initial balance
        createdBy: req.user.id
      });
      await transaction.save();
    }

    clearCached(CACHE_KEYS.RESIDENTS_LIST); // Invalidate cache on creation
    clearCached(CACHE_KEYS.UNASSIGNED_PROPERTIES); // Also invalidate unassigned properties cache

    await resident.populate('properties', 'propertyName plotNumber sector block fullAddress ownerName');
    await resident.populate('createdBy', 'firstName lastName');

    const residentObj = resident.toObject();
    residentObj.propertyCount = resident.properties ? resident.properties.length : 0;

    res.status(201).json({ success: true, data: residentObj });
  })
);

// Update resident
router.put('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const resident = await TajResident.findById(req.params.id);

  if (!resident) {
    return res.status(404).json({ success: false, message: 'Resident not found' });
  }

  // Normalize email to lowercase if provided
  if (req.body.email) {
    req.body.email = req.body.email.toLowerCase().trim();
  }

  Object.assign(resident, req.body);
  resident.updatedBy = req.user.id;
  await resident.save();

  await resident.populate('properties', 'propertyName plotNumber sector block fullAddress ownerName');
  await resident.populate('updatedBy', 'firstName lastName');

  const residentObj = resident.toObject();
  residentObj.propertyCount = resident.properties ? resident.properties.length : 0;

  clearCached(CACHE_KEYS.RESIDENTS_LIST); // Invalidate cache on update
  clearCached(CACHE_KEYS.UNASSIGNED_PROPERTIES); // Also invalidate unassigned properties cache
  res.json({ success: true, data: residentObj });
}));

// Delete resident (soft delete)
router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const resident = await TajResident.findById(req.params.id);

  if (!resident) {
    return res.status(404).json({ success: false, message: 'Resident not found' });
  }

  resident.isActive = false;
  resident.updatedBy = req.user.id;
  await resident.save();

  clearCached(CACHE_KEYS.RESIDENTS_LIST); // Invalidate cache on deletion
  clearCached(CACHE_KEYS.UNASSIGNED_PROPERTIES); // Also invalidate unassigned properties cache
  res.json({ success: true, message: 'Resident deactivated successfully' });
}));

// Get transactions for a resident
router.get('/:id/transactions', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, transactionType, startDate, endDate } = req.query;
  const query = { resident: req.params.id };

  if (transactionType) query.transactionType = transactionType;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const transactions = await TajTransaction.find(query)
    .populate('depositUsages.depositId')
    .populate('resident', 'name accountType')
    .populate('targetResident', 'name accountType')
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await TajTransaction.countDocuments(query);

  // Calculate remaining amounts for deposit transactions
  // IMPORTANT: Get ALL deposit transactions for this resident (not just paginated ones)
  // to ensure remainingAmount is calculated correctly for all deposits
  const allDepositTransactions = await TajTransaction.find({
    resident: req.params.id,
    transactionType: 'deposit',
    $or: [
      { referenceNumberExternal: { $not: /^REV-/ } },
      { referenceNumberExternal: { $exists: false } },
      { referenceNumberExternal: null }
    ]
  }).select('_id amount');
  
  const allDepositIds = allDepositTransactions.map(d => d._id);
  
  // Calculate total used from each deposit by checking ALL bill_payment transactions
  const depositUsageMap = {};
  if (allDepositIds.length > 0) {
    const allPayments = await TajTransaction.find({
      resident: req.params.id,
      transactionType: 'bill_payment',
      'depositUsages.depositId': { $in: allDepositIds }
    }).select('depositUsages');
    
    allPayments.forEach(payment => {
      if (payment.depositUsages && Array.isArray(payment.depositUsages)) {
        payment.depositUsages.forEach(usage => {
          // Handle both ObjectId and populated object cases
          let depositId = null;
          if (usage.depositId) {
            // If it's an ObjectId or has _id, convert to string
            depositId = usage.depositId._id ? usage.depositId._id.toString() : usage.depositId.toString();
          }
          if (depositId) {
            if (!depositUsageMap[depositId]) {
              depositUsageMap[depositId] = 0;
            }
            depositUsageMap[depositId] += usage.amount || 0;
          }
        });
      }
    });
  }

  // Populate property information for bill_payment transactions
  const transactionsWithProperty = await Promise.all(transactions.map(async (txn) => {
    const txnObj = txn.toObject();
    
    // Add remaining amount to deposit transactions
    if (txn.transactionType === 'deposit') {
      const depositId = txn._id.toString();
      const totalUsed = depositUsageMap[depositId] || 0;
      txnObj.remainingAmount = Math.max(0, (txn.amount || 0) - totalUsed);
      txnObj.totalUsed = totalUsed;
    }
    
    // Populate property information for bill_payment transactions
    if (txn.transactionType === 'bill_payment' && txn.referenceId) {
      try {
        const invoice = await PropertyInvoice.findById(txn.referenceId)
          .populate('property', 'propertyName propertyType srNo');
        if (invoice && invoice.property) {
          txnObj.property = {
            _id: invoice.property._id,
            propertyName: invoice.property.propertyName,
            propertyType: invoice.property.propertyType,
            srNo: invoice.property.srNo
          };
        }
      } catch (error) {
        // If invoice not found or error, property will remain undefined
        console.error('Error populating property for transaction:', error);
      }
    }
    
    // Populate bank information for bill_payment transactions
    // If bank is not directly set, try to get it from deposit transactions
    if (txn.transactionType === 'bill_payment' && !txnObj.bank) {
      if (txn.depositUsages && Array.isArray(txn.depositUsages) && txn.depositUsages.length > 0) {
        // Get bank from the first deposit (deposits are already populated)
        const firstDeposit = txn.depositUsages[0]?.depositId;
        if (firstDeposit && firstDeposit.bank) {
          txnObj.bank = firstDeposit.bank;
        }
      }
    }
    
    return txnObj;
  }));

  res.json({
    success: true,
    data: {
      transactions: transactionsWithProperty,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Deposit money
router.post(
  '/:id/deposit',
  authMiddleware,
  [
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('description').optional().trim(),
    body('paymentMethod').optional().isIn(['Cash', 'Bank Transfer', 'Cheque', 'Online', 'Other']),
    body('referenceNumberExternal').notEmpty().withMessage('Transaction Number is required').trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const resident = await TajResident.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const { amount, description, paymentMethod, bank, referenceNumberExternal, depositDate, chargeType } = req.body;
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }
    
    // Validate bank is provided for bank-related payment methods
    if ((paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque' || paymentMethod === 'Online') && !bank) {
      return res.status(400).json({ success: false, message: 'Bank selection is required for this payment method' });
    }
    
    // Transaction Number must be unique across all deposits
    const trimmedRef = (referenceNumberExternal || '').trim();
    const existing = await TajTransaction.findOne({
      transactionType: 'deposit',
      referenceNumberExternal: trimmedRef
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Transaction Number already exists. Please use a unique transaction number.' });
    }
    
    const balanceBefore = resident.balance || 0;
    const balanceAfter = balanceBefore + amountNum;

    // Update resident balance
    resident.balance = balanceAfter;
    resident.updatedBy = req.user.id;
    await resident.save();

    // Create transaction record
    const transactionData = {
      resident: resident._id,
      transactionType: 'deposit',
      amount: amountNum,
      balanceBefore,
      balanceAfter,
      description: description || 'Deposit',
      paymentMethod,
      bank: bank || null,
      referenceNumberExternal,
      chargeType: chargeType ? String(chargeType).trim().toUpperCase() : null,
      createdBy: req.user.id
    };
    
    // Set createdAt if depositDate is provided
    if (depositDate) {
      transactionData.createdAt = new Date(depositDate);
    }
    
    const transaction = new TajTransaction(transactionData);
    await transaction.save();

    await transaction.populate('resident', 'name accountType');
    await transaction.populate('createdBy', 'firstName lastName');

    res.status(201).json({
      success: true,
      message: 'Deposit successful',
      data: {
        transaction,
        newBalance: balanceAfter
      }
    });
  })
);

// Update deposit transaction
router.put(
  '/:id/transactions/:transactionId',
  authMiddleware,
  [
    body('amount').optional().isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('description').optional().trim(),
    body('paymentMethod').optional().isIn(['Cash', 'Bank Transfer', 'Cheque', 'Online', 'Other']),
    body('referenceNumberExternal').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const resident = await TajResident.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const transaction = await TajTransaction.findById(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Only allow editing deposit transactions
    if (transaction.transactionType !== 'deposit') {
      return res.status(400).json({ success: false, message: 'Only deposit transactions can be edited' });
    }

    // Check if transaction belongs to this resident
    if (transaction.resident.toString() !== req.params.id) {
      return res.status(403).json({ success: false, message: 'Transaction does not belong to this resident' });
    }

    const { amount, description, paymentMethod, bank, referenceNumberExternal, depositDate, chargeType } = req.body;
    const oldAmount = transaction.amount;
    const amountChanged = amount !== undefined && parseFloat(amount) !== oldAmount;

    // If amount is being changed, check if deposit has been used
    if (amountChanged) {
      const newAmount = parseFloat(amount) || 0;
      if (newAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
      }

      // Check if this deposit has been used in any payments
      const usedInPayments = await TajTransaction.find({
        'depositUsages.depositId': transaction._id
      });

      if (usedInPayments.length > 0) {
        // Calculate total amount used from this deposit
        const totalUsed = usedInPayments.reduce((sum, payment) => {
          const depositUsage = payment.depositUsages.find(du => du.depositId.toString() === transaction._id.toString());
          return sum + (depositUsage ? depositUsage.amount : 0);
        }, 0);

        // If reducing amount, ensure new amount is at least equal to total used
        if (newAmount < totalUsed) {
          return res.status(400).json({
            success: false,
            message: `Cannot reduce deposit amount below total used amount (${totalUsed.toFixed(2)}). Deposit has been used in ${usedInPayments.length} payment(s).`
          });
        }
      }

      // Recalculate resident balance
      const balanceDifference = newAmount - oldAmount;
      resident.balance = (resident.balance || 0) + balanceDifference;
      resident.updatedBy = req.user.id;
      await resident.save();

      // Update transaction amount and balance
      transaction.amount = newAmount;
      transaction.balanceAfter = resident.balance;
    }

    // Update other fields
    if (description !== undefined) transaction.description = description;
    if (paymentMethod !== undefined) transaction.paymentMethod = paymentMethod;
    if (bank !== undefined) transaction.bank = bank;
    if (referenceNumberExternal !== undefined) transaction.referenceNumberExternal = referenceNumberExternal;
    if (chargeType !== undefined) {
      transaction.chargeType = chargeType ? String(chargeType).trim().toUpperCase() : null;
    }
    
    // Validate bank is provided for bank-related payment methods
    if ((transaction.paymentMethod === 'Bank Transfer' || transaction.paymentMethod === 'Cheque' || transaction.paymentMethod === 'Online') && !transaction.bank) {
      return res.status(400).json({ success: false, message: 'Bank selection is required for this payment method' });
    }

    await transaction.save();

    // Update deposit date if provided (must use direct MongoDB collection update to bypass Mongoose timestamps)
    let finalTransaction = transaction;
    if (depositDate !== undefined && depositDate !== null && depositDate !== '') {
      // Parse the date - handle both ISO string and date string formats
      // If it's a date string like "2024-01-15", create a Date object at midnight local time
      let newDate;
      if (typeof depositDate === 'string' && depositDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Format: YYYY-MM-DD - parse as local midnight to preserve the selected date
        const [year, month, day] = depositDate.split('-').map(Number);
        newDate = new Date(year, month - 1, day, 0, 0, 0, 0);
      } else {
        newDate = depositDate instanceof Date ? depositDate : new Date(depositDate);
      }
      
      // Validate the date
      if (isNaN(newDate.getTime())) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid deposit date format' 
        });
      }
      
      // Use direct MongoDB collection update to bypass Mongoose timestamp management
      // This directly updates the database field without Mongoose interference
      const mongoose = require('mongoose');
      const updateResult = await TajTransaction.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(transaction._id) },
        { $set: { createdAt: newDate } }
      );
      
      if (updateResult.modifiedCount === 0) {
        console.warn('⚠️ Deposit date update: No document was modified. Transaction ID:', transaction._id);
      }
      
      // Fetch the updated transaction to get the new createdAt
      // Use findById to get fresh data from database
      finalTransaction = await TajTransaction.findById(transaction._id);
    }

    await finalTransaction.populate('resident', 'name accountType');
    await finalTransaction.populate('createdBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Deposit updated successfully',
      data: {
        transaction: finalTransaction,
        newBalance: resident.balance
      }
    });
  })
);

// Transfer deposit from suspense account to a known resident
router.post(
  '/deposits/:transactionId/transfer',
  authMiddleware,
  [
    body('targetResidentId').notEmpty().withMessage('Target resident ID is required'),
    body('targetResidentName').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { targetResidentId, targetResidentName } = req.body;
    const transactionId = req.params.transactionId;

    // Find the deposit transaction
    const deposit = await TajTransaction.findById(transactionId)
      .populate('resident', 'name residentId balance');
    
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }

    if (deposit.transactionType !== 'deposit') {
      return res.status(400).json({ success: false, message: 'Transaction is not a deposit' });
    }

    // Find target resident
    let targetResident;
    if (targetResidentId.match(/^[0-9a-fA-F]{24}$/)) {
      // It's an ObjectId
      targetResident = await TajResident.findById(targetResidentId);
    } else {
      // It's a resident ID or name - search for it
      targetResident = await TajResident.findOne({
        $or: [
          { residentId: targetResidentId },
          { name: { $regex: new RegExp(`^${targetResidentId}$`, 'i') } }
        ]
      });
    }

    if (!targetResident) {
      return res.status(404).json({ success: false, message: 'Target resident not found' });
    }

    // Check if source resident is unknown (suspense account)
    const sourceResident = deposit.resident;
    const isUnknownResident = !sourceResident.name || sourceResident.name.trim() === '' || 
                              !sourceResident.residentId || sourceResident.residentId.trim() === '';
    
    if (!isUnknownResident) {
      return res.status(400).json({ 
        success: false, 
        message: 'This deposit is not from a suspense account. Only suspense account deposits can be transferred.' 
      });
    }

    // Check if target resident is known (has name and residentId)
    if (!targetResident.name || targetResident.name.trim() === '' || 
        !targetResident.residentId || targetResident.residentId.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Target resident must be a known resident (with name and resident ID)' 
      });
    }

    // Update balances
    const depositAmount = deposit.amount || 0;
    
    // Remove from source (unknown) resident balance
    const sourceBalanceBefore = sourceResident.balance || 0;
    const sourceBalanceAfter = Math.max(0, sourceBalanceBefore - depositAmount);
    sourceResident.balance = sourceBalanceAfter;
    sourceResident.updatedBy = req.user.id;
    await sourceResident.save();

    // Add to target (known) resident balance
    const targetBalanceBefore = targetResident.balance || 0;
    const targetBalanceAfter = targetBalanceBefore + depositAmount;
    targetResident.balance = targetBalanceAfter;
    targetResident.updatedBy = req.user.id;
    await targetResident.save();

    // Update deposit transaction to point to target resident
    deposit.resident = targetResident._id;
    deposit.balanceBefore = targetBalanceBefore;
    deposit.balanceAfter = targetBalanceAfter;
    deposit.description = deposit.description 
      ? `${deposit.description} (Transferred from suspense account)`
      : `Transferred from suspense account to ${targetResident.name}`;
    deposit.updatedBy = req.user.id;
    await deposit.save();

    await deposit.populate('resident', 'name residentId accountType');
    await deposit.populate('createdBy', 'firstName lastName');
    await deposit.populate('updatedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Deposit transferred successfully',
      data: {
        transaction: deposit,
        sourceBalance: sourceBalanceAfter,
        targetBalance: targetBalanceAfter
      }
    });
  })
);

// Delete deposit transaction
router.delete(
  '/:id/transactions/:transactionId',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const resident = await TajResident.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const transaction = await TajTransaction.findById(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Only allow deleting deposit transactions
    if (transaction.transactionType !== 'deposit') {
      return res.status(400).json({ success: false, message: 'Only deposit transactions can be deleted' });
    }

    // Check if transaction belongs to this resident
    if (transaction.resident.toString() !== req.params.id) {
      return res.status(403).json({ success: false, message: 'Transaction does not belong to this resident' });
    }

    // Check if this deposit has been used in any payments
    const usedInPayments = await TajTransaction.find({
      'depositUsages.depositId': transaction._id
    }).populate('resident', 'name balance');

    let deletedPaymentsCount = 0;
    const PropertyInvoice = require('../models/tajResidencia/PropertyInvoice');

    // If deposit has been used in payments, delete those payments and reverse their effects
    // Use findByIdAndUpdate to avoid triggering TajResident pre-save (which could overwrite residentId
    // when resident was populated with limited fields like 'name balance')
    if (usedInPayments.length > 0) {
      for (const payment of usedInPayments) {
        const paymentResidentId = payment.resident?._id || payment.resident;
        if (paymentResidentId) {
          const paymentAmount = payment.amount || 0;
          const paymentResident = await TajResident.findById(paymentResidentId).select('balance').lean();
          if (paymentResident) {
            const currentBalance = paymentResident.balance || 0;
            const newBalance = currentBalance + paymentAmount;
            await TajResident.findByIdAndUpdate(paymentResidentId, {
              balance: newBalance,
              updatedBy: req.user.id
            });
          }
        }

        // If payment is linked to an invoice, remove it from invoice and recalculate
        if (payment.referenceId && require('mongoose').Types.ObjectId.isValid(payment.referenceId)) {
          try {
            const invoice = await PropertyInvoice.findById(payment.referenceId);
            if (invoice && invoice.payments && invoice.payments.length > 0) {
              // Find and remove the payment entry that matches this transaction
              // Match by amount and payment date (within same day), or by description/notes
              const paymentDate = payment.createdAt || new Date();
              const paymentAmount = payment.amount || 0;
              
              // Try to find matching payment - check multiple criteria
              let paymentToRemove = invoice.payments.find(p => {
                const pDate = p.paymentDate || p.recordedAt;
                const sameDate = pDate && paymentDate && 
                  new Date(pDate).toDateString() === new Date(paymentDate).toDateString();
                const sameAmount = Math.abs((p.amount || p.totalAmount || 0) - paymentAmount) < 0.01;
                
                // Also check if description mentions the transaction ID
                const notesMatch = p.notes && payment._id && 
                  p.notes.toString().includes(payment._id.toString());
                
                return (sameDate && sameAmount) || notesMatch;
              });

              // If no exact match, try to find by amount only (within tolerance)
              if (!paymentToRemove) {
                paymentToRemove = invoice.payments.find(p => {
                  const pAmount = p.amount || p.totalAmount || 0;
                  return Math.abs(pAmount - paymentAmount) < 0.01;
                });
              }

              if (paymentToRemove) {
                invoice.payments.pull(paymentToRemove._id);
                
                // Recalculate totals
                const totalPaid = invoice.payments.reduce((sum, p) => sum + (p.totalAmount || p.amount || 0), 0);
                invoice.totalPaid = totalPaid;
                invoice.balance = invoice.grandTotal - totalPaid;

                // Update payment status
                if (invoice.balance <= 0 && totalPaid > 0) {
                  invoice.paymentStatus = 'paid';
                } else if (totalPaid > 0) {
                  invoice.paymentStatus = 'partial_paid';
                } else {
                  invoice.paymentStatus = 'unpaid';
                }

                invoice.updatedBy = req.user.id;
                invoice.updatedAt = new Date();
                await invoice.save();
              }
            }
          } catch (invoiceError) {
            console.error('Error updating invoice when deleting payment:', invoiceError);
          }
        }

        // Delete the payment transaction
        await TajTransaction.findByIdAndDelete(payment._id);
        deletedPaymentsCount++;
      }
    }

    // Recalculate resident balance (subtract the deposit amount)
    // Use findByIdAndUpdate to avoid pre-save hook overwriting residentId
    const depositAmount = transaction.amount || 0;
    const newBalance = Math.max(0, (resident.balance || 0) - depositAmount);
    await TajResident.findByIdAndUpdate(resident._id, {
      balance: newBalance,
      updatedBy: req.user.id
    });

    // Delete the deposit transaction
    await TajTransaction.findByIdAndDelete(transaction._id);

    const message = deletedPaymentsCount > 0
      ? `Deposit deleted successfully. ${deletedPaymentsCount} associated payment(s) were also deleted and their effects reversed.`
      : 'Deposit deleted successfully';

    res.json({
      success: true,
      message,
      data: {
        newBalance,
        deletedPaymentsCount
      }
    });
  })
);

// Transfer money to another resident
router.post(
  '/:id/transfer',
  authMiddleware,
  [
    body('targetResidentId').notEmpty().withMessage('Target resident ID is required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('description').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { targetResidentId, amount, description } = req.body;
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    if (req.params.id === targetResidentId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to the same account'
      });
    }

    const sourceResident = await TajResident.findById(req.params.id);
    const targetResident = await TajResident.findById(targetResidentId);

    if (!sourceResident) {
      return res.status(404).json({ success: false, message: 'Source resident not found' });
    }
    if (!targetResident) {
      return res.status(404).json({ success: false, message: 'Target resident not found' });
    }

    const sourceBalanceBefore = sourceResident.balance || 0;
    if (sourceBalanceBefore < amountNum) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    // Update source resident balance
    const sourceBalanceAfter = sourceBalanceBefore - amountNum;
    sourceResident.balance = sourceBalanceAfter;
    sourceResident.updatedBy = req.user.id;
    await sourceResident.save();

    // Update target resident balance
    const targetBalanceBefore = targetResident.balance || 0;
    const targetBalanceAfter = targetBalanceBefore + amountNum;
    targetResident.balance = targetBalanceAfter;
    targetResident.updatedBy = req.user.id;
    await targetResident.save();

    // Create transaction records (one for source, one for target)
    const sourceTransaction = new TajTransaction({
      resident: sourceResident._id,
      transactionType: 'transfer',
      amount: amountNum,
      targetResident: targetResident._id,
      balanceBefore: sourceBalanceBefore,
      balanceAfter: sourceBalanceAfter,
      description: description || `Transfer to ${targetResident.name}`,
      createdBy: req.user.id
    });
    await sourceTransaction.save();

    const targetTransaction = new TajTransaction({
      resident: targetResident._id,
      transactionType: 'transfer',
      amount: amountNum,
      targetResident: sourceResident._id,
      balanceBefore: targetBalanceBefore,
      balanceAfter: targetBalanceAfter,
      description: description || `Transfer from ${sourceResident.name}`,
      createdBy: req.user.id
    });
    await targetTransaction.save();

    await sourceTransaction.populate('resident', 'name accountType');
    await sourceTransaction.populate('targetResident', 'name accountType');
    await sourceTransaction.populate('createdBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Transfer successful',
      data: {
        transaction: sourceTransaction,
        newBalance: sourceBalanceAfter
      }
    });
  })
);

// Assign properties to resident
router.post(
  '/:id/assign-properties',
  authMiddleware,
  [
    body('propertyIds').isArray().withMessage('Property IDs must be an array'),
    body('propertyIds.*').isMongoId().withMessage('Invalid property ID')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const resident = await TajResident.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const { propertyIds } = req.body;

    // Verify all properties exist
    const properties = await TajProperty.find({ _id: { $in: propertyIds } });
    if (properties.length !== propertyIds.length) {
      return res.status(400).json({ success: false, message: 'One or more properties not found' });
    }

    // Get current property assignments to handle reassignment
    const propertiesToAssign = await TajProperty.find({ _id: { $in: propertyIds } });
    const propertiesToReassign = propertiesToAssign.filter(p => p.resident && p.resident.toString() !== resident._id.toString());
    
    // Remove properties from previous residents (if any)
    if (propertiesToReassign.length > 0) {
      const previousResidentIds = [...new Set(propertiesToReassign.map(p => p.resident.toString()))];
      for (const prevResidentId of previousResidentIds) {
        const prevResident = await TajResident.findById(prevResidentId);
        if (prevResident) {
          const reassignedPropertyIds = propertiesToReassign
            .filter(p => p.resident.toString() === prevResidentId)
            .map(p => p._id.toString());
          prevResident.properties = prevResident.properties.filter(
            p => !reassignedPropertyIds.includes(p.toString())
          );
          prevResident.updatedBy = req.user.id;
          await prevResident.save();
        }
      }
    }

    // Add properties to this resident (avoid duplicates)
    const existingPropertyIds = resident.properties.map(p => p.toString());
    // Ensure propertyIds are strings for comparison
    const propertyIdsStr = propertyIds.map(id => id.toString());
    const newPropertyIds = propertyIdsStr.filter(id => !existingPropertyIds.includes(id));
    
    if (newPropertyIds.length > 0) {
      // Convert back to ObjectIds for storage
      const mongoose = require('mongoose');
      const newPropertyObjectIds = newPropertyIds.map(id => new mongoose.Types.ObjectId(id));
      resident.properties.push(...newPropertyObjectIds);
      resident.updatedBy = req.user.id;
      await resident.save();
    }

    // Update all properties to reference this resident (handles both new assignments and reassignments)
    await TajProperty.updateMany(
      { _id: { $in: propertyIds } },
      { $set: { resident: resident._id } }
    );

    await resident.populate('properties', 'propertyName plotNumber sector block fullAddress ownerName');
    const residentObj = resident.toObject();
    residentObj.propertyCount = resident.properties ? resident.properties.length : 0;

    res.json({
      success: true,
      message: `${newPropertyIds.length} property/properties assigned successfully`,
      data: residentObj
    });
  })
);

// Unassign properties from resident
router.post(
  '/:id/unassign-properties',
  authMiddleware,
  [
    body('propertyIds').isArray().withMessage('Property IDs must be an array'),
    body('propertyIds.*').isMongoId().withMessage('Invalid property ID')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const resident = await TajResident.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const { propertyIds } = req.body;

    // Remove properties from resident
    resident.properties = resident.properties.filter(
      p => !propertyIds.includes(p.toString())
    );
    resident.updatedBy = req.user.id;
    await resident.save();

    // Update properties to remove resident reference
    await TajProperty.updateMany(
      { _id: { $in: propertyIds } },
      { $set: { resident: null } }
    );

    await resident.populate('properties', 'propertyName plotNumber sector block fullAddress ownerName');
    const residentObj = resident.toObject();
    residentObj.propertyCount = resident.properties ? resident.properties.length : 0;

    res.json({
      success: true,
      message: `${propertyIds.length} property/properties unassigned successfully`,
      data: residentObj
    });
  })
);

// Auto-match properties by owner name
router.post(
  '/:id/auto-match-properties',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const resident = await TajResident.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    if (!resident.name) {
      return res.status(400).json({ success: false, message: 'Resident name is required for auto-matching' });
    }

    // Find properties with matching ownerName (case-insensitive, partial match)
    const nameRegex = new RegExp(resident.name.trim(), 'i');
    const matchedProperties = await TajProperty.find({
      ownerName: nameRegex,
      resident: { $in: [null, undefined] } // Only unassigned properties
    });

    if (matchedProperties.length === 0) {
      return res.json({
        success: true,
        message: 'No matching unassigned properties found',
        data: { matchedCount: 0, properties: [] }
      });
    }

    const propertyIds = matchedProperties.map(p => p._id);

    // Add properties to resident
    const existingPropertyIds = resident.properties.map(p => p.toString());
    const newPropertyIds = propertyIds.filter(id => !existingPropertyIds.includes(id.toString()));
    
    if (newPropertyIds.length > 0) {
      resident.properties.push(...newPropertyIds);
      resident.updatedBy = req.user.id;
      await resident.save();

      // Update properties to reference this resident
      await TajProperty.updateMany(
        { _id: { $in: newPropertyIds } },
        { $set: { resident: resident._id } }
      );
    }

    await resident.populate('properties', 'propertyName plotNumber sector block fullAddress ownerName');
    const residentObj = resident.toObject();
    residentObj.propertyCount = resident.properties ? resident.properties.length : 0;

    res.json({
      success: true,
      message: `${newPropertyIds.length} property/properties auto-matched and assigned`,
      data: {
        resident: residentObj,
        matchedProperties: matchedProperties.map(p => ({
          _id: p._id,
          propertyName: p.propertyName,
          plotNumber: p.plotNumber,
          sector: p.sector,
          block: p.block,
          fullAddress: p.fullAddress,
          ownerName: p.ownerName
        }))
      }
    });
  })
);

// Pay bill (generic payment)
router.post(
  '/:id/pay',
  authMiddleware,
  [
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('referenceType').optional().isIn(['CAM', 'Electricity', 'Water', 'RENT', 'ELECTRICITY', 'Other']),
    body('referenceId').optional(),
    body('referenceNumber').optional().trim(),
    body('description').optional().trim(),
    body('paymentMethod').optional().isIn(['Cash', 'Bank Transfer', 'Cheque', 'Online', 'Other']),
    body('bankName').optional().trim(),
    body('bankReference').optional().trim(),
    body('paymentDate').optional().isISO8601().withMessage('Payment date must be a valid date')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const resident = await TajResident.findById(req.params.id);
    if (!resident) {
      return res.status(404).json({ success: false, message: 'Resident not found' });
    }

    const { 
      amount, 
      referenceType, 
      referenceId, 
      referenceNumber, 
      description,
      paymentMethod,
      bankName,
      bankReference,
      paymentDate,
      depositUsages // Array of { depositId, amount } objects
    } = req.body;
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    // Normalize referenceId - handle string, ObjectId, or MongoDB Extended JSON { $oid: "..." }
    let refIdStr = referenceId;
    if (referenceId && typeof referenceId === 'object' && referenceId.$oid) {
      refIdStr = referenceId.$oid;
    } else if (referenceId && typeof referenceId !== 'string') {
      refIdStr = referenceId.toString ? referenceId.toString() : String(referenceId);
    }
    refIdStr = (refIdStr && typeof refIdStr === 'string') ? refIdStr.trim() : '';
    
    // Validate bank is provided for bank-related payment methods
    // Exception: If depositUsages are provided, bank is not required (deposit already has bank info)
    if ((paymentMethod === 'Bank Transfer' || paymentMethod === 'Cheque' || paymentMethod === 'Online') && !bankName) {
      const hasDepositUsages = depositUsages && Array.isArray(depositUsages) && depositUsages.length > 0;
      if (!hasDepositUsages) {
        return res.status(400).json({ success: false, message: 'Bank selection is required for this payment method' });
      }
    }
    
    const balanceBefore = resident.balance || 0;
    const hasDepositUsages = depositUsages && Array.isArray(depositUsages) && depositUsages.length > 0;

    // When paying from deposits (depositUsages provided), skip resident.balance check.
    // When resident.balance insufficient: for TCM (open invoice payer), allow if totalRemainingDeposits >= amount.
    let effectiveBalance = balanceBefore;
    let autoAllocatedDepositUsages = []; // Used when effectiveBalance allows payment - so Balance column decreases
    if (!hasDepositUsages && balanceBefore < amountNum) {
      const allDeposits = await TajTransaction.find({
        resident: resident._id,
        transactionType: 'deposit',
        $or: [
          { referenceNumberExternal: { $not: /^REV-/ } },
          { referenceNumberExternal: { $exists: false } },
          { referenceNumberExternal: null }
        ]
      }).select('amount _id createdAt').lean();
      const depositIds = allDeposits.map(d => d._id);
      const depositUsageMap = {};
      if (depositIds.length > 0) {
        const usedInPayments = await TajTransaction.find({
          'depositUsages.depositId': { $in: depositIds },
          transactionType: 'bill_payment'
        }).select('depositUsages').lean();
        usedInPayments.forEach(p => {
          (p.depositUsages || []).forEach(u => {
            const depId = u.depositId?._id ? u.depositId._id.toString() : (u.depositId || '').toString();
            if (depId) depositUsageMap[depId] = (depositUsageMap[depId] || 0) + (u.amount || 0);
          });
        });
      }
      // Build list of { deposit, remaining } sorted by createdAt (FIFO)
      const depositsWithRemaining = allDeposits.map(d => {
        const used = depositUsageMap[d._id.toString()] || 0;
        const remaining = Math.max(0, (d.amount || 0) - used);
        return { deposit: d, remaining };
      }).filter(x => x.remaining > 0).sort((a, b) => (a.deposit.createdAt || 0) - (b.deposit.createdAt || 0));
      effectiveBalance = depositsWithRemaining.reduce((sum, x) => sum + x.remaining, 0);
      if (effectiveBalance < amountNum) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient balance'
        });
      }
      // Allocate amountNum across deposits (FIFO) so Balance column decreases correctly
      let toAllocate = amountNum;
      for (const { deposit, remaining } of depositsWithRemaining) {
        if (toAllocate <= 0) break;
        const use = Math.min(remaining, toAllocate);
        autoAllocatedDepositUsages.push({ depositId: deposit._id, amount: use });
        toAllocate -= use;
      }
    }

    // Deduct from balance; when paying from deposits or when effectiveBalance (totalRemainingDeposits) was used, allow balance to stay at 0 if out of sync (never go negative)
    const usedEffectiveBalance = !hasDepositUsages && balanceBefore < amountNum && effectiveBalance >= amountNum;
    const balanceAfter = (hasDepositUsages || usedEffectiveBalance)
      ? Math.max(0, balanceBefore - amountNum)
      : balanceBefore - amountNum;

    // Update resident balance
    resident.balance = balanceAfter;
    resident.updatedBy = req.user.id;
    await resident.save();

    // Prepare transaction data - only include referenceId if it's a valid ObjectId
    const transactionData = {
      resident: resident._id,
      transactionType: 'bill_payment',
      amount: amountNum,
      balanceBefore,
      balanceAfter,
      description: description || `Payment for ${referenceType || 'bill'}`,
      createdBy: req.user.id
    };

    // Only add optional fields if they have valid values
    if (referenceType) {
      transactionData.referenceType = referenceType;
    }
    if (refIdStr && require('mongoose').Types.ObjectId.isValid(refIdStr)) {
      transactionData.referenceId = refIdStr;
    }
    if (referenceNumber && referenceNumber.trim() !== '') {
      transactionData.referenceNumber = referenceNumber.trim();
    }
    if (paymentMethod) {
      transactionData.paymentMethod = paymentMethod;
    }
    if (bankName) {
      transactionData.bank = bankName;
    }
    if (bankReference && bankReference.trim() !== '') {
      transactionData.referenceNumberExternal = bankReference.trim();
    }
    
    // Add deposit usage tracking - from client or auto-allocated when paying from totalRemainingDeposits (TCM)
    const finalDepositUsages = hasDepositUsages
      ? depositUsages
      : (autoAllocatedDepositUsages.length > 0 ? autoAllocatedDepositUsages : null);
    if (finalDepositUsages && Array.isArray(finalDepositUsages) && finalDepositUsages.length > 0) {
      transactionData.depositUsages = finalDepositUsages.map(usage => ({
        depositId: usage.depositId,
        amount: parseFloat(usage.amount) || 0
      })).filter(usage => usage.depositId && usage.amount > 0);
    }

    // Create transaction record
    const transaction = new TajTransaction(transactionData);
    await transaction.save();

    // If referenceId is provided and it's a valid ObjectId, try to add payment to PropertyInvoice
    if (refIdStr && require('mongoose').Types.ObjectId.isValid(refIdStr)) {
      try {
        const invoice = await PropertyInvoice.findById(refIdStr);
        if (invoice) {
          // Check if due date + 4-day grace period has ended (payment date after due date + grace) and invoice is unpaid/partially paid
          const GRACE_PERIOD_DAYS = 6;
          const paymentDateObj = paymentDate ? new Date(paymentDate) : new Date();
          const dueDateObj = invoice.dueDate ? new Date(invoice.dueDate) : null;
          const paymentStart = new Date(paymentDateObj);
          paymentStart.setHours(0, 0, 0, 0);
          const dueStart = dueDateObj ? new Date(dueDateObj) : null;
          if (dueStart) dueStart.setHours(0, 0, 0, 0);
          const dueWithGrace = dueStart ? new Date(dueStart) : null;
          if (dueWithGrace) dueWithGrace.setDate(dueWithGrace.getDate() + GRACE_PERIOD_DAYS);
          const isOverdue = dueWithGrace && paymentStart > dueWithGrace;
          const isUnpaid = invoice.paymentStatus === 'unpaid' || invoice.paymentStatus === 'partial_paid';
          let paymentNotesWithSurcharge;

          // Calculate late payment surcharge if overdue and unpaid
          let latePaymentSurcharge = 0;
          if (isOverdue && isUnpaid) {
            // Calculate surcharge based on charges for the month (not including arrears)
            // For electricity: 10% of totalBill
            // For CAM: 10% of CAM amount
            // For Rent: 10% of rent amount
            // For general invoices: 10% of subtotal (charges for the month)
            
            const chargesForMonth = invoice.subtotal || 0;
            // If invoice has charges array, sum up the amount (not arrears) for each charge
            if (invoice.charges && Array.isArray(invoice.charges) && invoice.charges.length > 0) {
              const totalChargesAmount = invoice.charges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
              if (totalChargesAmount > 0) {
                latePaymentSurcharge = Math.max(Math.round(totalChargesAmount * 0.1), 0);
              } else if (chargesForMonth > 0) {
                latePaymentSurcharge = Math.max(Math.round(chargesForMonth * 0.1), 0);
              }
            } else if (chargesForMonth > 0) {
              latePaymentSurcharge = Math.max(Math.round(chargesForMonth * 0.1), 0);
            }
            
            // Store surcharge in payment notes if applicable
            if (latePaymentSurcharge > 0) {
              const existingNotes = description || `Payment from deposit - ${transaction._id}`;
              paymentNotesWithSurcharge = `${existingNotes} (Includes late payment surcharge: ${latePaymentSurcharge.toFixed(2)})`;
            }
          }
          const finalPaymentNotes = (typeof paymentNotesWithSurcharge !== 'undefined')
            ? paymentNotesWithSurcharge
            : (description || `Payment from deposit - ${transaction._id}`);

          // Add payment to invoice - PropertyInvoice only allows Cash/Bank Transfer/Cheque/Online
          const allowedMethods = ['Cash', 'Bank Transfer', 'Cheque', 'Online'];
          const invoicePaymentMethod = (paymentMethod && allowedMethods.includes(paymentMethod))
            ? paymentMethod
            : 'Bank Transfer';
          const paymentEntry = {
            amount: amountNum,
            paymentDate: paymentDateObj,
            paymentMethod: invoicePaymentMethod,
            bankName: bankName || '',
            reference: bankReference || referenceNumber || '',
            notes: finalPaymentNotes,
            recordedBy: req.user.id,
            recordedAt: new Date(),
            latePaymentSurcharge: latePaymentSurcharge > 0 ? latePaymentSurcharge : undefined
          };
          
          invoice.payments.push(paymentEntry);
          invoice.markModified('payments'); // Ensure Mongoose detects the array change (fixes TCM open invoice balance not updating)
          await invoice.save(); // This will trigger pre-save hook to update totalPaid, balance, and status

          // When an invoice is paid, refresh carry-forward arrears on future invoices of the same
          // charge type(s) so their grandTotal/balance stays accurate (covers ELC, RENT, CAM, etc.).
          if (invoice.property && Array.isArray(invoice.chargeTypes) && invoice.chargeTypes.length > 0) {
            const anchorDate = invoice.invoiceDate || invoice.createdAt || new Date();
            for (const chargeType of invoice.chargeTypes) {
              await recalculateFutureInvoicesByChargeType(invoice.property, chargeType, anchorDate);
            }
          }

          // Invalidate invoice caches so Resident Details and Invoices pages show updated status
          clearCached(CACHE_KEYS.INVOICES_OVERVIEW);
          if (invoice.property) {
            clearCached(`${CACHE_KEYS.INVOICES_OVERVIEW}_property_${invoice.property}`);
          } else {
            // Open invoices (TCM) - clear open invoices cache
            clearCached(CACHE_KEYS.OPEN_INVOICES_OVERVIEW);
          }
        }
      } catch (invoiceError) {
        // Log full error to help debug invoice update failures
        console.error('Error updating PropertyInvoice with payment:', {
          referenceId: refIdStr,
          amount: amountNum,
          error: invoiceError.message,
          stack: invoiceError.stack
        });
        // Don't throw - transaction was already created; failing would leave inconsistent state
        // Invoice can be manually reconciled if needed
      }
    }

    await transaction.populate('resident', 'name accountType');
    await transaction.populate('createdBy', 'firstName lastName');

    // Invalidate residents cache so Balance column (totalRemainingDeposits) updates for TCM
    clearCached(CACHE_KEYS.RESIDENTS_LIST);

    res.json({
      success: true,
      message: 'Payment successful',
      data: {
        transaction,
        newBalance: balanceAfter
      }
    });
  })
);

// Get all deposits across all residents (for Deposits page)
router.get('/deposits/all', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, startDate, endDate, suspenseAccount } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build query (exclude reversal transactions)
  const query = {
    transactionType: 'deposit',
    $or: [
      { referenceNumberExternal: { $not: /^REV-/ } },
      { referenceNumberExternal: { $exists: false } },
      { referenceNumberExternal: null }
    ]
  };

  // Suspense Account filter: deposits where resident or residentId is unknown
  if (suspenseAccount === 'true') {
    // Find residents with missing name or residentId
    const unknownResidents = await TajResident.find({
      $or: [
        { name: { $exists: false } },
        { name: null },
        { name: '' },
        { residentId: { $exists: false } },
        { residentId: null },
        { residentId: '' }
      ]
    }).select('_id').lean();
    const unknownResidentIds = unknownResidents.map(r => r._id);
    
    if (unknownResidentIds.length > 0) {
      query.resident = { $in: unknownResidentIds };
    } else {
      // No unknown residents found, return empty result
      query.resident = { $in: [] };
    }
  } else {
    // Exclude suspense account deposits (unknown residents) from regular deposits
    const unknownResidents = await TajResident.find({
      $or: [
        { name: { $exists: false } },
        { name: null },
        { name: '' },
        { residentId: { $exists: false } },
        { residentId: null },
        { residentId: '' }
      ]
    }).select('_id').lean();
    const unknownResidentIds = unknownResidents.map(r => r._id);
    
    if (unknownResidentIds.length > 0) {
      query.resident = { $nin: unknownResidentIds }; // Exclude unknown residents
    }
  }

  // Date filter
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Search filter (by resident name, transaction number, or description)
  if (search) {
    const searchPattern = { $regex: search, $options: 'i' };
    const searchConditions = [
      { referenceNumberExternal: searchPattern },
      { description: searchPattern }
    ];
    
    // For suspense account, search in transaction fields only
    // For regular deposits, also search by resident
    if (suspenseAccount !== 'true') {
      const residents = await TajResident.find({
        $or: [
          { name: searchPattern },
          { residentId: searchPattern }
        ]
      }).select('_id').lean();
      const residentIds = residents.map(r => r._id);
      if (residentIds.length > 0) {
        searchConditions.push({ resident: { $in: residentIds } });
      }
    }
    
    // Combine with existing $or conditions (for reversal filter)
    const existingOrConditions = query.$or || [];
    if (existingOrConditions.length > 0) {
      query.$and = [
        { $or: existingOrConditions },
        { $or: searchConditions }
      ];
      delete query.$or;
    } else {
      query.$or = searchConditions;
    }
  }

  // Get total count
  const total = await TajTransaction.countDocuments(query);

  // Get deposits with pagination
  const deposits = await TajTransaction.find(query)
    .select('_id amount description paymentMethod bank referenceNumberExternal chargeType createdAt balanceBefore balanceAfter')
    .populate('resident', 'name residentId accountType')
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  // Calculate remaining amounts for deposits (optimized)
  const depositIds = deposits.map(d => d._id);
  if (depositIds.length > 0) {
    const depositUsageMap = {};
    const usedInPayments = await TajTransaction.find({
      'depositUsages.depositId': { $in: depositIds },
      transactionType: 'bill_payment'
    }).select('depositUsages').lean();

    usedInPayments.forEach(payment => {
      if (payment.depositUsages && Array.isArray(payment.depositUsages)) {
        payment.depositUsages.forEach(usage => {
          const depositId = usage.depositId?.toString();
          if (depositId && depositIds.some(id => id.toString() === depositId)) {
            depositUsageMap[depositId] = (depositUsageMap[depositId] || 0) + (usage.amount || 0);
          }
        });
      }
    });

    // Add remaining amount to each deposit
    deposits.forEach(deposit => {
      const depositId = deposit._id.toString();
      const totalUsed = depositUsageMap[depositId] || 0;
      deposit.remainingAmount = Math.max(0, (deposit.amount || 0) - totalUsed);
      deposit.totalUsed = totalUsed;
    });
  } else {
    deposits.forEach(deposit => {
      deposit.remainingAmount = deposit.amount || 0;
      deposit.totalUsed = 0;
    });
  }

  res.json({
    success: true,
    data: {
      deposits,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNextPage: page < Math.ceil(total / parseInt(limit)),
        hasPrevPage: page > 1,
        limit: parseInt(limit)
      }
    }
  });
}));

module.exports = router;

