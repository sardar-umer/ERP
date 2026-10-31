const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const PropertyInvoice = require('../models/tajResidencia/PropertyInvoice');
const TajProperty = require('../models/tajResidencia/TajProperty');
const CAMCharge = require('../models/tajResidencia/CAMCharge');
const WaterCharge = require('../models/tajResidencia/WaterCharge');
const Electricity = require('../models/tajResidencia/Electricity');
const TajRentalAgreement = require('../models/tajResidencia/TajRentalAgreement');
const TajTransaction = require('../models/tajResidencia/TajTransaction');
const TajResident = require('../models/tajResidencia/TajResident');
const { authMiddleware } = require('../middleware/auth');
const { numberToWords, getCAMChargeForProperty, getWaterChargeForProperty } = require('../utils/camChargesHelper');
const FinanceHelper = require('../utils/financeHelper');
const { getPreviousReading, getElectricitySlabForUnits, calculateElectricityCharges, getEffectiveArrearsForInvoice } = require('../utils/electricityBillHelper');
const dayjs = require('dayjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const asyncHandler = require('../middleware/errorHandler').asyncHandler;
const ReconciliationRecord = require('../models/tajResidencia/ReconciliationRecord');
const {
  getCached,
  setCached,
  clearCached,
  CACHE_KEYS
} = require('../utils/tajUtilitiesOptimizer');

/** Avoid SyntaxError from RegExp when sector names contain metacharacters (e.g. `[`, `(`). */
const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Generate invoice number with type prefix
const generateInvoiceNumber = (propertySrNo, year, month, type = 'GEN', meterSuffix = '') => {
  const paddedMonth = String(month).padStart(2, '0');
  const paddedIndex = String(propertySrNo || 1).padStart(4, '0');
  
  // Determine prefix based on type
  const prefixMap = {
    'CAM': 'INV-CMC',
    'CMC': 'INV-CMC',
    'ELECTRICITY': 'INV-ELC',
    'ELC': 'INV-ELC',
    'RENT': 'INV-REN',
    'REN': 'INV-REN',
    'WATER': 'INV-WTR',
    'WTR': 'INV-WTR',
    'MIXED': 'INV-MIX',
    'MIX': 'INV-MIX'
  };
  
  const prefix = prefixMap[type] || 'INV';
  const suffix = meterSuffix ? `-${meterSuffix}` : '';
  return `${prefix}-${year}-${paddedMonth}-${paddedIndex}${suffix}`;
};

// Open invoices use category-based numbers, e.g. INV-OTH-2026-04-0001
const getOpenInvoiceCategoryPrefix = (chargeType = '') => {
  const normalized = String(chargeType || '').toUpperCase().trim();
  const map = {
    CAM: 'CMC',
    CMC: 'CMC',
    ELECTRICITY: 'ELC',
    ELC: 'ELC',
    RENT: 'REN',
    REN: 'REN',
    WATER: 'WTR',
    WTR: 'WTR',
    OTHER: 'OTH'
  };
  if (map[normalized]) return map[normalized];
  const cleaned = normalized.replace(/[^A-Z]/g, '');
  return cleaned ? cleaned.slice(0, 3).padEnd(3, 'X') : 'OTH';
};

/**
 * Calculate overdue arrears from previous unpaid invoices for a specific property.
 * Each property's arrears are calculated independently — only invoices belonging to
 * this property are included (never cross-property).
 *
 * When chargeTypesFilter is provided (e.g. ['ELECTRICITY'], ['CAM'], ['RENT']), only the
 * portion of each invoice's balance attributable to those charge types is included —
 * so electricity invoices get only electricity arrears, CAM only CAM, etc.
 *
 * Proportion is calculated from base charge amounts only (charge.amount, not charge.arrears)
 * because invoice.balance already captures both the base charges AND any previously
 * carried-forward arrears — using charge.arrears in the numerator would double-count them.
 *
 * @param {ObjectId} propertyId - Property ID
 * @param {Date} currentDate - Current date (defaults to now)
 * @param {string[]} [chargeTypesFilter] - Optional. e.g. ['ELECTRICITY'], ['CAM'], ['RENT']
 * @returns {Number} Total overdue arrears for this property (filtered by charge type if given)
 */
const calculateOverdueArrears = async (
  propertyId,
  currentDate = new Date(),
  chargeTypesFilter = null,
  options = {}
) => {
  if (!propertyId) return 0;
  try {
    const filterTypes = Array.isArray(chargeTypesFilter) && chargeTypesFilter.length > 0 ? chargeTypesFilter : null;
    const { beforePeriodFrom } = options;

    // Build query: unpaid/partial invoices for this property that match the charge type filter.
    // No grace-period gate — we want the last invoice regardless of how recent it is.
    const query = {
      property: propertyId,
      balance: { $gt: 0 },
      paymentStatus: { $in: ['unpaid', 'partial_paid'] },
      status: { $ne: 'Cancelled' }
    };

    // When billing a new month, only carry forward from invoices for earlier billing periods.
    if (beforePeriodFrom) {
      query.periodTo = { $lt: new Date(beforePeriodFrom) };
    }

    // If filtering by charge type, restrict to invoices that contain those types.
    if (filterTypes) {
      query.chargeTypes = { $in: filterTypes };
    }

    // Fetch only the single most-recent unpaid invoice, ordered by billing period end date
    // (most recent periodTo first). Using dueDate here would pick invoices with far-future
    // due dates over more recently billed ones, producing wrong carry-forward arrears.
    // createdAt is a secondary tie-breaker for invoices without a periodTo.
    const lastInvoice = await PropertyInvoice.findOne(query)
      .select('charges chargeTypes subtotal totalArrears grandTotal balance dueDate periodTo createdAt')
      .sort({ periodTo: -1, createdAt: -1 })
      .lean();

    if (!lastInvoice) return 0;

    // Base charges for the month (amounts only, excluding previously carried arrears).
    const baseChargesTotal = (lastInvoice.charges || []).reduce((sum, c) => sum + (c.amount || 0), 0) || lastInvoice.subtotal || 0;
    const baseBalance = Math.max(0, Number(lastInvoice.balance || 0));

    // Carry-forward rule:
    // - within due+grace => use payable (balance)
    // - after due+grace and unpaid => use payable-after-due
    // Important: if surcharge is already reflected in invoice balance/grandTotal, do not add it again.
    const GRACE_PERIOD_DAYS = 6;
    const todayStart = new Date(currentDate);
    todayStart.setHours(0, 0, 0, 0);
    const dueStart = lastInvoice.dueDate ? new Date(lastInvoice.dueDate) : null;
    if (dueStart) dueStart.setHours(0, 0, 0, 0);
    const dueWithGrace = dueStart ? new Date(dueStart) : null;
    if (dueWithGrace) dueWithGrace.setDate(dueWithGrace.getDate() + GRACE_PERIOD_DAYS);
    const isOverdue = !!(dueWithGrace && todayStart > dueWithGrace);
    const isUnpaid = baseBalance > 0;

    let overdueAmount = baseBalance;
    if (isOverdue && isUnpaid) {
      const lateSurcharge = Math.max(Math.round(baseChargesTotal * 0.1), 0);
      const originalGrandTotal = Number(lastInvoice.subtotal || 0) + Number(lastInvoice.totalArrears || 0);
      const grandTotal = Number(lastInvoice.grandTotal || 0);
      const surchargeAlreadyIncluded = grandTotal > originalGrandTotal;
      overdueAmount = surchargeAlreadyIncluded ? baseBalance : (baseBalance + lateSurcharge);
    }

    // Arrears = balance of the last invoice + late surcharge.
    if (!filterTypes) {
      return overdueAmount;
    }

    // When filtering by charge type, use the proportion of base charges for that type
    // so that a mixed invoice (e.g. RENT + CAM) is split correctly.
    const baseForTypes = (lastInvoice.charges || [])
      .filter((c) => filterTypes.includes(c.type))
      .reduce((sum, c) => sum + (c.amount || 0), 0);
    const proportion = baseChargesTotal > 0 ? baseForTypes / baseChargesTotal : 0;

    return Math.round(overdueAmount * proportion * 100) / 100;
  } catch (error) {
    console.error('Error calculating overdue arrears:', error);
    return 0;
  }
};

// Helper: Normalize readings map from various input formats
const normalizeReadingsMap = (meterReadings, currentReading, metersToProcess) => {
  const readingsMap = {};
  
  if (meterReadings && typeof meterReadings === 'object' && Object.keys(meterReadings).length > 0) {
    Object.entries(meterReadings).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        readingsMap[String(key)] = {
          currentReading: parseFloat(value.currentReading),
          previousReading: value.previousReading !== undefined ? parseFloat(value.previousReading) : undefined
        };
      } else {
      readingsMap[String(key)] = parseFloat(value) || 0;
      }
    });
  } else if (typeof currentReading === 'object' && currentReading !== null) {
    Object.entries(currentReading).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        readingsMap[String(key)] = {
          currentReading: parseFloat(value.currentReading),
          previousReading: value.previousReading !== undefined ? parseFloat(value.previousReading) : undefined
        };
      } else {
      readingsMap[String(key)] = parseFloat(value) || 0;
      }
    });
  } else if (currentReading !== undefined && currentReading !== null && currentReading !== '' && metersToProcess.length > 0) {
    readingsMap[String(metersToProcess[0].meterNo || '')] = parseFloat(currentReading) || 0;
  }
  
  return readingsMap;
};

// Helper: Update invoice fields
const updateInvoiceFields = (invoice, { charges, subtotal, totalArrears, grandTotal, periodFrom, periodTo, chargeTypes }) => {
  invoice.charges = charges;
  invoice.subtotal = subtotal;
  invoice.totalArrears = totalArrears;
  invoice.grandTotal = grandTotal;
  invoice.amountInWords = numberToWords(grandTotal);
  if (chargeTypes) invoice.chargeTypes = chargeTypes;
  if (periodFrom) invoice.periodFrom = new Date(periodFrom);
  if (periodTo) {
    invoice.periodTo = new Date(periodTo);
    invoice.dueDate = new Date(periodTo);
  }
};

// Helper: Populate invoice references
const populateInvoiceReferences = async (invoice, { camCharge, waterCharge, electricityBill }) => {
  await invoice.populate({
    path: 'property',
    populate: {
      path: 'resident',
      select: 'name accountType contactNumber email residentId'
    }
  });
  if (camCharge) await invoice.populate('camCharge');
  if (waterCharge) await invoice.populate('waterCharge');
  if (electricityBill) await invoice.populate('electricityBill');
};

// Ensure a consistent waterCharge payload shape for WATER invoices.
// Some invoices can have WATER in charges but no linked waterCharge reference.
const normalizeWaterChargePayload = (invoiceObj) => {
  if (!invoiceObj || typeof invoiceObj !== 'object') return invoiceObj;

  const hasWaterType = Array.isArray(invoiceObj.chargeTypes) && invoiceObj.chargeTypes.includes('WATER');
  const hasLinkedWaterCharge = !!invoiceObj.waterCharge;

  if (!hasLinkedWaterCharge) {
    const waterLine = Array.isArray(invoiceObj.charges)
      ? invoiceObj.charges.find((c) => String(c?.type || '').toUpperCase() === 'WATER')
      : null;

    if (hasWaterType && waterLine) {
      invoiceObj.waterCharge = {
        invoiceNumber: invoiceObj.invoiceNumber || null,
        amount: Number(waterLine.amount) || 0,
        arrears: Number(waterLine.arrears) || 0
      };
      return invoiceObj;
    }

    invoiceObj.waterCharge = null;
  }

  return invoiceObj;
};

// Helper: Create new invoice (always creates new, never updates existing)
// If invoice number exists, generates new unique number with timestamp
const createOrUpdateInvoice = async (invoiceData, invoiceNumber, propertyId, userId, periodFrom, periodTo, propertySrNo, invoiceType) => {
  const now = dayjs();
  const currentYear = now.year();
  const currentMonth = now.month() + 1;
  
  // Determine the month/year from periodTo (or periodFrom if periodTo is not available)
  const periodDate = periodTo ? dayjs(periodTo) : (periodFrom ? dayjs(periodFrom) : now);
  const periodYear = periodDate.year();
  const periodMonth = periodDate.month() + 1;
  
  // Check if invoice with this number already exists
  let existingInvoice = await PropertyInvoice.findOne({ invoiceNumber });
  
  // If invoice exists, always generate a new unique invoice number
  if (existingInvoice) {
    const timestamp = Date.now().toString().slice(-4);
    const baseSuffix = invoiceData.chargeTypes?.[0] === 'ELECTRICITY' && invoiceNumber.includes('-M') 
      ? invoiceNumber.split('-M')[1].split('-')[0] 
      : '';
    // generateInvoiceNumber prepends its own '-' to meterSuffix, so pass without a leading dash
    invoiceData.invoiceNumber = generateInvoiceNumber(
      propertySrNo,
      periodYear,
      periodMonth,
      invoiceType,
      baseSuffix ? `M${baseSuffix}-${timestamp}` : timestamp
    );
  }
  
  // Always create new invoice (never update existing)
  let invoice;
  let attempts = 0;
  const maxAttempts = 5;
  
  while (attempts < maxAttempts) {
    try {
      invoice = new PropertyInvoice(invoiceData);
      await invoice.save();

      // Create Accounts Receivable entry and post to GL
      try {
        const property = await TajProperty.findById(invoice.property)
          .populate('resident', 'name email')
          .populate('rentalAgreement', 'tenantName tenantContact');
        if (property) {
          const customerName = property.resident?.name || property.tenantName || property.rentalAgreement?.tenantName || property.address || property.plotNumber || 'Property Tenant';
          const customerEmail = property.resident?.email || property.tenantEmail || property.rentalAgreement?.tenantContact || '';
          const customerId = property.resident?._id || property._id;
          await FinanceHelper.createARFromInvoice({
            customerName,
            customerEmail,
            customerId,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate,
            dueDate: invoice.dueDate,
            amount: invoice.grandTotal,
            department: 'general',
            module: 'taj_utilities',
            referenceId: invoice._id,
            charges: invoice.charges,
            createdBy: userId
          });
        }
      } catch (arError) {
        console.error('❌ Error creating AR for property invoice:', arError);
        // We don't fail the invoice creation if AR fails, but we log it
      }

      return { invoice, isNew: true };
    } catch (error) {
      if (error.code === 11000 && error.keyPattern?.invoiceNumber) {
        // Duplicate key error - generate new invoice number with timestamp
        attempts++;
        const timestamp = Date.now().toString().slice(-4) + attempts;
        const baseSuffix = invoiceData.chargeTypes?.[0] === 'ELECTRICITY' && invoiceData.invoiceNumber.includes('-M') 
          ? invoiceData.invoiceNumber.split('-M')[1].split('-')[0] 
          : '';
        // generateInvoiceNumber prepends its own '-' to meterSuffix, so pass without a leading dash
        invoiceData.invoiceNumber = generateInvoiceNumber(
          propertySrNo,
          periodYear,
          periodMonth,
          invoiceType,
          baseSuffix ? `M${baseSuffix}-${timestamp}` : timestamp
        );
      } else {
        throw error;
      }
    }
  }
  
  throw new Error('Failed to create invoice after multiple attempts');
};

// Helper: Create electricity bill data
const createElectricityBillData = (meter, property, calculatedCharges, { prvReading, curReading, unitsConsumed, unitRate, unitsSlab, previousArrears }, periodFrom, periodTo, billInvoiceNumber, userId) => {
  const now = dayjs();
  return {
    invoiceNumber: billInvoiceNumber,
    meterNo: meter.meterNo || '',
    propertyType: 'Residential',
    prvReading,
    curReading,
    unitsConsumed,
    unitsConsumedForDays: unitsConsumed,
    iescoSlabs: unitsSlab || '',
    fromDate: periodFrom ? new Date(periodFrom) : now.startOf('month').toDate(),
    toDate: periodTo ? new Date(periodTo) : now.endOf('month').toDate(),
    month: now.format('MMM-YY'),
    dueDate: periodTo ? dayjs(periodTo).add(15, 'day').toDate() : now.add(30, 'day').toDate(),
    iescoUnitPrice: parseFloat(unitRate) || 0,
    electricityCost: calculatedCharges.electricityCost,
    fcSurcharge: calculatedCharges.fcSurcharge,
    meterRent: calculatedCharges.meterRent,
    njSurcharge: calculatedCharges.njSurcharge,
    gst: calculatedCharges.gst,
    electricityDuty: calculatedCharges.electricityDuty,
    tvFee: calculatedCharges.tvFee,
    fixedCharges: calculatedCharges.fixedCharges,
    totalBill: calculatedCharges.totalBill,
    withSurcharge: calculatedCharges.withSurcharge,
    receivedAmount: 0,
    balance: calculatedCharges.withSurcharge,
    arrears: previousArrears,
    amount: calculatedCharges.withSurcharge,
    amountInWords: numberToWords(calculatedCharges.withSurcharge),
    plotNo: property.plotNumber || '',
    rdaNo: property.rdaNumber || '',
    street: property.street || '',
    sector: property.sector || '',
    category: property.categoryType || '',
    address: property.address || property.fullAddress || '',
    project: property.project || '',
    owner: property.ownerName || '',
    contactNo: property.contactNumber || '',
    status: 'Active',
    createdBy: userId
  };
};

// Get rent calculation for property (RENT-only arrears from overdue invoices, same logic as CAM)
router.get('/property/:propertyId/rent-calculation', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const property = await TajProperty.findById(req.params.propertyId)
      .populate('rentalAgreement');
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    // RENT-only overdue arrears (same module-specific logic as CAM / electricity)
    const rentCarryForwardArrears = await calculateOverdueArrears(property._id, new Date(), ['RENT']);

    // Get monthly rent from rental agreement or property
    let monthlyRent = 0;
    let arrearsFromPayment = 0;
    
    // Try to get rent from rental agreement
    if (property.rentalAgreement?.monthlyRent) {
      monthlyRent = property.rentalAgreement.monthlyRent || 0;
    } else if (property.categoryType === 'Personal Rent' && property.rentalPayments?.length > 0) {
      // Fallback to latest rental payment
      const latestPayment = [...property.rentalPayments]
        .sort((a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0))[0];
      if (latestPayment) {
        monthlyRent = latestPayment.amount || 0;
        arrearsFromPayment = latestPayment.arrears || 0;
      }
    } else if (property.expectedRent) {
      monthlyRent = property.expectedRent || 0;
    }

    // Total arrears = arrears from payment + carry forward from invoices
    const totalArrears = arrearsFromPayment + rentCarryForwardArrears;

    console.log(`[RENT-CALC] Property ${property._id} (${property.propertyName}):`, {
      monthlyRent,
      arrearsFromPayment,
      rentCarryForwardArrears,
      totalArrears,
      hasAgreement: !!property.rentalAgreement,
      agreementRent: property.rentalAgreement?.monthlyRent,
      hasRentalPayments: !!(property.rentalPayments && property.rentalPayments.length > 0)
    });

    res.json({
      success: true,
      data: {
        monthlyRent,
        arrearsFromPayment,
        carryForwardArrears: rentCarryForwardArrears,
        totalArrears,
        rentalAgreement: property.rentalAgreement
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Get CAM calculation for property (slab amount + overdue arrears)
router.get('/property/:propertyId/cam-calculation', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const property = await TajProperty.findById(req.params.propertyId).lean();
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    const propertySize = property.areaValue ?? 0;
    const areaUnit = property.areaUnit || 'Marla';
    const zoneType = property.zoneType || 'Residential';
    const camChargeInfo = await getCAMChargeForProperty(propertySize, areaUnit, zoneType);
    const amount = camChargeInfo?.amount ?? 0;
    const periodFrom = req.query.periodFrom ? new Date(req.query.periodFrom) : dayjs().startOf('month').toDate();
    const arrears = await calculateOverdueArrears(property._id, new Date(), ['CAM'], { beforePeriodFrom: periodFrom });
    let description = 'CAM Charges';
    if (zoneType && String(zoneType).toLowerCase() === 'commercial') {
      description = 'Commercial CAM Charges';
    } else if (propertySize > 0) {
      description = `CAM Charges (${propertySize} ${areaUnit})`;
    }
    if (arrears > 0) description += ' (with Carry Forward Arrears)';
    res.json({
      success: true,
      data: { amount, arrears, total: Math.round((amount + arrears) * 100) / 100, description }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Get Water calculation for property (slab amount + overdue arrears)
router.get('/property/:propertyId/water-calculation', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const property = await TajProperty.findById(req.params.propertyId).lean();
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    if (!property.hasWaterCharges) {
      return res.status(400).json({
        success: false,
        message: 'Water charges are not enabled for this property'
      });
    }
    const propertySize = property.areaValue ?? 0;
    const areaUnit = property.areaUnit || 'Marla';
    const zoneType = property.zoneType || 'Residential';
    const waterChargeInfo = await getWaterChargeForProperty(propertySize, areaUnit, zoneType);
    const amount = waterChargeInfo?.amount ?? 0;
    const arrears = await calculateOverdueArrears(property._id, new Date(), ['WATER']);
    let description = 'Water Charges';
    if (zoneType && String(zoneType).toLowerCase() === 'commercial') {
      description = 'Commercial Water Charges';
    } else if (propertySize > 0) {
      description = `Water Charges (${propertySize} ${areaUnit})`;
    }
    if (arrears > 0) description += ' (with Carry Forward Arrears)';
    res.json({
      success: true,
      data: { amount, arrears, total: Math.round((amount + arrears) * 100) / 100, description }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Get previous reading and calculate charges for property
router.get('/property/:propertyId/electricity-calculation', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const property = await TajProperty.findById(req.params.propertyId)
      .populate('rentalAgreement');
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const { unitsConsumed, currentReading, meterNo: requestedMeterNo, previousReading: requestedPreviousReading, periodFrom: requestedPeriodFrom } = req.query;
    
    // Get active meters from property
    const activeMeters = (property.meters || []).filter(m => m.isActive !== false);
    
    // If specific meter requested, use that; otherwise use first meter or legacy meter
    let targetMeter = null;
    if (requestedMeterNo && activeMeters.length > 0) {
      targetMeter = activeMeters.find(m => m.meterNo === requestedMeterNo);
    }
    
    if (!targetMeter) {
      targetMeter = activeMeters.length > 0 
        ? activeMeters[0]
        : { meterNo: property.meterNumber || property.electricityWaterMeterNo || '', floor: property.floor || 'Ground Floor' };
    }
    
    const meterNo = targetMeter.meterNo || '';
    const propertyKey = property.address || property.plotNumber || property.ownerName;
    
    // Get previous reading (pass periodFrom so arrears = only immediately previous invoice's balance)
    const isMultiMeterProperty = activeMeters.length > 1;
    const { prvReading: autoPrvReading, previousArrears } = await getPreviousReading(
      meterNo,
      propertyKey,
      req.params.propertyId,
      requestedPeriodFrom,
      isMultiMeterProperty
    );
    
    // PRIORITY: Use requested previous reading if provided (manual override), otherwise use auto-fetched one
    const prvReading = requestedPreviousReading !== undefined 
      ? parseFloat(requestedPreviousReading) 
      : autoPrvReading;
    
    // Calculate units consumed - prioritize direct unitsConsumed parameter
    let finalUnitsConsumed = 0;
    let curReading = 0;
    
    if (unitsConsumed !== undefined && unitsConsumed !== null && unitsConsumed !== '') {
      // Use units consumed directly (simplest approach)
      finalUnitsConsumed = Math.max(0, parseFloat(unitsConsumed) || 0);
      curReading = prvReading + finalUnitsConsumed; // Calculate current reading for display
    } else if (currentReading !== undefined && currentReading !== null && currentReading !== '') {
      // Fallback: calculate from current reading
      curReading = parseFloat(currentReading) || 0;
      
      if (curReading < prvReading) {
        return res.status(400).json({ 
          success: false, 
          message: `Current reading (${curReading}) cannot be less than previous reading (${prvReading})` 
        });
      }
      
      finalUnitsConsumed = Math.max(0, curReading - prvReading);
    }
    
    // Only calculate if we have units consumed
    if (finalUnitsConsumed > 0 || unitsConsumed === 0 || currentReading !== undefined) {
      const { slab, unitRate, fixRate, unitsSlab } = await getElectricitySlabForUnits(finalUnitsConsumed);
      
      if (!slab && finalUnitsConsumed > 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'No matching slab found for units consumed' 
        });
      }
      
      // Meter Rent, TV Fee, and NJ Surcharge removed from calculation
      const meterRent = 0;
      const tvFee = 0;
      const charges = calculateElectricityCharges(finalUnitsConsumed, unitRate, fixRate || 0, meterRent, tvFee);
      
      return res.json({
        success: true,
        data: {
          previousReading: prvReading,
          currentReading: curReading || (prvReading + finalUnitsConsumed),
          unitsConsumed: finalUnitsConsumed,
          previousArrears,
          meterNo,
          meterFloor: targetMeter.floor,
          slab: {
            unitsSlab,
            unitRate,
            fixRate
          },
          charges,
          grandTotal: charges.withSurcharge + previousArrears,
          // Include all meters info for frontend
          allMeters: activeMeters.length > 0 ? activeMeters.map(m => ({
            meterNo: m.meterNo || '',
            floor: m.floor || '',
            isActive: m.isActive !== false
          })) : undefined
        }
      });
    }
    
    // Return basic info if no calculation requested
    res.json({
      success: true,
      data: {
        previousReading: prvReading,
        previousArrears,
        meterNo,
        meterFloor: targetMeter.floor,
        // Include all meters info for frontend
        allMeters: activeMeters.length > 0 ? activeMeters.map(m => ({
          meterNo: m.meterNo || '',
          floor: m.floor || '',
          isActive: m.isActive !== false
        })) : undefined
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Create invoice for a property (shared by POST /property/:id and Taj bulk-create endpoints)
async function createPropertyInvoiceForProperty(req, res) {
  try {
    const property = await TajProperty.findById(req.params.propertyId)
      .populate('rentalAgreement');
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const { periodFrom, periodTo, dueDate, invoiceDate, includeCAM, includeWater, includeElectricity, includeRent, charges: requestCharges, calculationData } = req.body;

    // Find latest charges/bills
    const propertyKey = property.address || property.plotNumber || property.ownerName;
    const conditions = [];
    if (propertyKey) conditions.push({ address: propertyKey });
    if (property.plotNumber) conditions.push({ plotNo: property.plotNumber });
    if (property.ownerName) conditions.push({ owner: property.ownerName });

    const charges = [];
    let camCharge = null;
    let waterCharge = null;
    let electricityBill = null;
    let rentPayment = null;
    let rentChargeAdded = false; // Track if rent charge was calculated from agreement
    let rentCarryForwardArrears = 0; // Carry forward arrears from previous invoices
    const meterBillsData = []; // Store data for additional meters
    let useProvidedCAM = false;
    let useProvidedWater = false;
    let usedProvidedElectricity = false;
    let electricityArrearsAlreadyApplied = false;

    // Get CAM Charge
    if (includeCAM === true) {
      // Use CAM charge from request when frontend sends charges (same behavior as Electricity: prefer form values)
      const hasProvidedCharges = requestCharges && Array.isArray(requestCharges) && requestCharges.length > 0;
      const camChargeFromRequest = hasProvidedCharges ? requestCharges.find(c => String(c?.type || '').toUpperCase() === 'CAM') : null;
      useProvidedCAM = !!camChargeFromRequest;

      if (useProvidedCAM) {
        const camAmount = Number(camChargeFromRequest.amount) || 0;
        const camArrears = Number(camChargeFromRequest.arrears) || 0;
        const providedTotal = (camChargeFromRequest.total !== undefined && camChargeFromRequest.total !== null && camChargeFromRequest.total !== '')
          ? Number(camChargeFromRequest.total)
          : null;
        const camTotal = (typeof providedTotal === 'number' && providedTotal > 0) ? providedTotal : (camAmount + camArrears);
        charges.push({
          type: 'CAM',
          description: camChargeFromRequest.description || 'CAM Charges',
          amount: camAmount,
          arrears: camArrears,
          total: camTotal
        });
      } else {
        // Future CAM invoices: carry forward only from the latest relevant invoice
        // (no cumulative sum of all historical unpaid invoices).
        let carryForwardArrears = 0;
        try {
          const billingStart = periodFrom ? new Date(periodFrom) : new Date();
          const asOf = invoiceDate ? new Date(invoiceDate) : new Date();
          carryForwardArrears = await calculateOverdueArrears(property._id, asOf, ['CAM'], {
            beforePeriodFrom: billingStart
          });
        } catch (err) {
          console.error(`[CAM-INVOICE] calculateOverdueArrears failed for ${property._id}:`, err.message);
          carryForwardArrears = 0;
        }

        if (conditions.length > 0) {
          camCharge = await CAMCharge.findOne({ $or: conditions })
            .sort({ createdAt: -1 })
            .lean();
        }

        if (camCharge) {
          const camAmount = camCharge.amount || 0;
          const existingArrears = camCharge.arrears || 0;
          const totalArrears = existingArrears + carryForwardArrears;
          charges.push({
            type: 'CAM',
            description: carryForwardArrears > 0 ? 'CAM Charges (with Carry Forward Arrears)' : 'CAM Charges',
            amount: camAmount,
            arrears: totalArrears,
            total: camAmount + totalArrears
          });
        } else {
          const propertySize = property.areaValue || 0;
          const areaUnit = property.areaUnit || 'Marla';
          const zoneType = property.zoneType || 'Residential';
          let camAmount = 0;
          let camDescription = 'CAM Charges';
          if (zoneType === 'Commercial') {
            const camChargeInfo = await getCAMChargeForProperty(0, areaUnit, zoneType);
            camAmount = camChargeInfo.amount || 0;
            camDescription = 'Commercial CAM Charges';
          } else if (propertySize > 0) {
            const camChargeInfo = await getCAMChargeForProperty(propertySize, areaUnit, zoneType);
            camAmount = camChargeInfo.amount || 0;
            camDescription = `CAM Charges (${propertySize} ${areaUnit})`;
          }
          if (carryForwardArrears > 0) camDescription += ` + Carry Forward Arrears`;
          charges.push({
            type: 'CAM',
            description: camDescription,
            amount: camAmount,
            arrears: carryForwardArrears,
            total: camAmount + carryForwardArrears
          });
        }
      }
    }

    // Get Water charge (fixed slab; property must have water billing enabled)
    if (includeWater === true) {
      if (!property.hasWaterCharges) {
        return res.status(400).json({
          success: false,
          message: 'Water charges are not enabled for this property. Enable "Water charges" on the property first.'
        });
      }
      const hasProvidedCharges = requestCharges && Array.isArray(requestCharges) && requestCharges.length > 0;
      const waterChargeFromRequest = hasProvidedCharges ? requestCharges.find(c => String(c?.type || '').toUpperCase() === 'WATER') : null;
      useProvidedWater = !!waterChargeFromRequest;

      if (useProvidedWater) {
        const wAmount = Number(waterChargeFromRequest.amount) || 0;
        const wArrears = Number(waterChargeFromRequest.arrears) || 0;
        const providedTotal = (waterChargeFromRequest.total !== undefined && waterChargeFromRequest.total !== null && waterChargeFromRequest.total !== '')
          ? Number(waterChargeFromRequest.total)
          : null;
        const wTotal = (typeof providedTotal === 'number' && providedTotal > 0) ? providedTotal : (wAmount + wArrears);
        charges.push({
          type: 'WATER',
          description: waterChargeFromRequest.description || 'Water Charges',
          amount: wAmount,
          arrears: wArrears,
          total: wTotal
        });
      } else {
        let carryForwardArrears = 0;
        const previousWaterInvoices = await PropertyInvoice.find({
          property: property._id,
          chargeTypes: { $in: ['WATER'] },
          paymentStatus: { $in: ['unpaid', 'partial_paid'] },
          balance: { $gt: 0 }
        })
          .select('charges grandTotal totalPaid balance')
          .sort({ invoiceDate: 1 })
          .lean();

        previousWaterInvoices.forEach(inv => {
          const invW = inv.charges?.find(c => c.type === 'WATER');
          if (invW) {
            const hasOnlyWater = inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'WATER';
            if (hasOnlyWater) {
              carryForwardArrears += (inv.balance || 0);
            } else {
              const wPart = (invW.amount || 0) + (invW.arrears || 0);
              const invoiceTotal = inv.grandTotal || 0;
              if (invoiceTotal > 0) {
                carryForwardArrears += (inv.balance || 0) * (wPart / invoiceTotal);
              }
            }
          }
        });
        carryForwardArrears = Math.round(carryForwardArrears * 100) / 100;

        if (conditions.length > 0) {
          waterCharge = await WaterCharge.findOne({ $or: conditions })
            .sort({ createdAt: -1 })
            .lean();
        }

        if (waterCharge) {
          const wAmount = waterCharge.amount || 0;
          const existingArrears = waterCharge.arrears || 0;
          const totalArrears = existingArrears + carryForwardArrears;
          charges.push({
            type: 'WATER',
            description: carryForwardArrears > 0 ? 'Water Charges (with Carry Forward Arrears)' : 'Water Charges',
            amount: wAmount,
            arrears: totalArrears,
            total: wAmount + totalArrears
          });
        } else {
          const propertySize = property.areaValue || 0;
          const areaUnit = property.areaUnit || 'Marla';
          const zoneType = property.zoneType || 'Residential';
          let wAmount = 0;
          let wDescription = 'Water Charges';
          if (zoneType === 'Commercial') {
            const wInfo = await getWaterChargeForProperty(0, areaUnit, zoneType);
            wAmount = wInfo.amount || 0;
            wDescription = 'Commercial Water Charges';
          } else if (propertySize > 0) {
            const wInfo = await getWaterChargeForProperty(propertySize, areaUnit, zoneType);
            wAmount = wInfo.amount || 0;
            wDescription = `Water Charges (${propertySize} ${areaUnit})`;
          }
          if (carryForwardArrears > 0) wDescription += ` + Carry Forward Arrears`;
          charges.push({
            type: 'WATER',
            description: wDescription,
            amount: wAmount,
            arrears: carryForwardArrears,
            total: wAmount + carryForwardArrears
          });
        }
      }
    }

    // Get Electricity Bill - Handle multiple meters
    let hasReadings = false; // Declare at function scope
    if (includeElectricity === true) {
      // Note: Carry forward arrears are now calculated in getPreviousReading function
      // which is called when processing meter readings, so no need to calculate separately here
      const { currentReading, meterReadings } = req.body;
      
      // Check if frontend provided charges with correct calculation (from units consumed)
      // If charges are provided with amounts, use those instead of recalculating
      const hasProvidedCharges = requestCharges && Array.isArray(requestCharges) && requestCharges.length > 0;
      const electricityChargeFromRequest = hasProvidedCharges ? requestCharges.find(c => c.type === 'ELECTRICITY') : null;
      const shouldUseProvidedCharges = electricityChargeFromRequest && electricityChargeFromRequest.amount > 0;
      
      // Get active meters from property
      const activeMeters = (property.meters || []).filter(m => m.isActive !== false);
      
      // If no meters array, fallback to legacy single meter
      const metersToProcess = activeMeters.length > 0 
        ? activeMeters 
        : (property.meterNumber || property.electricityWaterMeterNo 
          ? [{ meterNo: property.meterNumber || property.electricityWaterMeterNo || '', floor: property.floor || 'Ground Floor' }]
          : []);
      
      // PRIORITY: If frontend provided charges (calculated from units consumed), use those
      // Only recalculate from readings if charges were NOT provided
      if (shouldUseProvidedCharges) {
        usedProvidedElectricity = true;
        // Use charges provided from frontend - they're already calculated correctly from units consumed
        // Still need to create electricity bill record for reference, but use provided charge values
        const now = dayjs();
        const billInvoiceNumber = `ELEC-${now.format('YYYY-MM')}-${String(property.srNo || 1).padStart(4, '0')}`;
        
        // Get meter info for bill record
        const firstMeter = metersToProcess.length > 0 ? metersToProcess[0] : { meterNo: property.meterNumber || property.electricityWaterMeterNo || '', floor: property.floor || 'Ground Floor' };
        const meterNo = firstMeter.meterNo || '';
        const propertyKey = property.address || property.plotNumber || property.ownerName;
        
        // Get previous reading and arrears (arrears = only immediately previous invoice's balance)
        const { prvReading: autoPrvReading, previousArrears } = await getPreviousReading(
          meterNo,
          propertyKey,
          property._id,
          periodFrom,
          metersToProcess.length > 1
        );
        // Use provided arrears if present; otherwise fall back to getPreviousReading (avoids storing 0 when carry-forward exists)
        const arrearsToUse = (electricityChargeFromRequest.arrears != null && electricityChargeFromRequest.arrears > 0)
          ? electricityChargeFromRequest.arrears
          : (previousArrears || 0);
        
        // PRIORITY: Use previousReading from calculationData if provided, otherwise fallback to auto-fetched one
        const prvReading = calculationData?.previousReading !== undefined 
          ? parseFloat(calculationData.previousReading) 
          : autoPrvReading;

        // Use values from calculationData if provided by frontend, otherwise fallback to request parameters
        const unitsConsumed = calculationData?.unitsConsumed !== undefined 
          ? parseFloat(calculationData.unitsConsumed) 
          : (parseFloat(currentReading) ? Math.max(0, parseFloat(currentReading) - prvReading) : 0);
          
        const curReading = calculationData?.currentReading !== undefined 
          ? parseFloat(calculationData.currentReading) 
          : (parseFloat(currentReading) || prvReading + unitsConsumed);
        
        // Create minimal electricity bill record for reference
        const billData = {
          invoiceNumber: billInvoiceNumber,
          meterNo: meterNo,
          propertyType: 'Residential',
          prvReading: prvReading, // Now uses the correct validated reading
          curReading: curReading,
          unitsConsumed: unitsConsumed,
          unitsConsumedForDays: unitsConsumed, // Explicitly save units consumed for calculation reference
          iescoSlabs: calculationData?.slab?.unitsSlab || '',
          iescoUnitPrice: parseFloat(calculationData?.slab?.unitRate) || 0,
          electricityCost: calculationData?.charges?.electricityCost || 0,
          fcSurcharge: calculationData?.charges?.fcSurcharge || 0,
          meterRent: calculationData?.charges?.meterRent || 0,
          njSurcharge: calculationData?.charges?.njSurcharge || 0,
          gst: calculationData?.charges?.gst || 0,
          electricityDuty: calculationData?.charges?.electricityDuty || 0,
          tvFee: calculationData?.charges?.tvFee || 0,
          fixedCharges: calculationData?.charges?.fixedCharges || (calculationData?.slab?.fixRate || 0),
          fromDate: periodFrom ? new Date(periodFrom) : now.startOf('month').toDate(),
          toDate: periodTo ? new Date(periodTo) : now.endOf('month').toDate(),
          month: now.format('MMM-YY'),
          dueDate: periodTo ? dayjs(periodTo).add(15, 'day').toDate() : now.add(30, 'day').toDate(),
          totalBill: electricityChargeFromRequest.amount || 0,
          withSurcharge: electricityChargeFromRequest.amount || 0,
          arrears: arrearsToUse,
          amount: electricityChargeFromRequest.amount || 0,
          plotNo: property.plotNumber || '',
          rdaNo: property.rdaNumber || '',
          street: property.street || '',
          sector: property.sector || '',
          category: property.categoryType || '',
          address: property.address || property.fullAddress || '',
          project: property.project || '',
          owner: property.ownerName || '',
          contactNo: property.contactNumber || '',
          status: 'Active',
          createdBy: req.user.id
        };
        
        electricityBill = new Electricity(billData);
        await electricityBill.save();
        
        // Use the charges provided from frontend (already calculated correctly from units consumed)
        charges.push({
          type: 'ELECTRICITY',
          description: electricityChargeFromRequest.description || 'Electricity Bill',
          amount: electricityChargeFromRequest.amount || 0,
          arrears: arrearsToUse,
          total: (electricityChargeFromRequest.amount || 0) + arrearsToUse
        });
        electricityArrearsAlreadyApplied = true;
        
        hasReadings = false; // Mark that we didn't recalculate from readings
      } else {
        // No charges provided from frontend - recalculate from readings if available
      hasReadings = (currentReading !== undefined && currentReading !== null && currentReading !== '') ||
                    (meterReadings && typeof meterReadings === 'object' && Object.keys(meterReadings).length > 0);
      
      if (hasReadings) {
        const readingsMap = normalizeReadingsMap(meterReadings, currentReading, metersToProcess);
        const now = dayjs();
        const monthYear = `${now.year()}-${String(now.month() + 1).padStart(2, '0')}`;
        const propertyKey = property.address || property.plotNumber || property.ownerName;
        const meterRent = property.hasElectricityWater ? 75 : 0;
        const tvFee = property.hasElectricityWater ? 35 : 0;
        
        // Process each meter
        for (let meterIndex = 0; meterIndex < metersToProcess.length; meterIndex++) {
          const meter = metersToProcess[meterIndex];
          const meterNo = String(meter.meterNo || '');
          
          // Get current reading for this meter
          let curReading;
            let prvReadingFromPayload;
            
            const meterReading = readingsMap[meterNo];
            if (meterReading !== undefined) {
              if (typeof meterReading === 'object') {
                curReading = meterReading.currentReading;
                prvReadingFromPayload = meterReading.previousReading;
              } else {
                curReading = meterReading;
              }
          } else if (meterReadings && typeof meterReadings === 'object') {
            continue; // Skip if meterReadings provided but this meter has no reading
          } else if (meterIndex === 0 && typeof currentReading === 'number') {
            curReading = parseFloat(currentReading) || 0;
          } else {
            continue; // Skip if no reading for this meter
          }
          
          // Get previous reading for this meter (arrears = only immediately previous invoice's balance)
            const { prvReading: autoPrvReading, previousArrears } = await getPreviousReading(
              meterNo,
              propertyKey,
              property._id,
              periodFrom,
              metersToProcess.length > 1
            );
            
            // PRIORITY: Use prvReading from payload if provided (manually adjusted), otherwise use auto-fetched one
            const prvReading = prvReadingFromPayload !== undefined ? prvReadingFromPayload : autoPrvReading;
          
          // Validate current reading
          if (curReading < prvReading) {
            return res.status(400).json({ 
              success: false, 
              message: `Current reading (${curReading}) for meter ${meterNo || meter.floor} cannot be less than previous reading (${prvReading})` 
            });
          }
          
          // Calculate units consumed and charges
          const unitsConsumed = Math.max(0, curReading - prvReading);
          const { slab, unitRate, fixRate, unitsSlab } = await getElectricitySlabForUnits(unitsConsumed);
          
          if (!slab && unitsConsumed > 0) {
            return res.status(400).json({ 
              success: false, 
              message: `No matching slab found for units consumed (${unitsConsumed}) for meter ${meterNo || meter.floor}` 
            });
          }
          
          const calculatedCharges = calculateElectricityCharges(unitsConsumed, unitRate, fixRate || 0, meterRent, tvFee);
          
          // Generate bill invoice number with meter suffix
          const meterSuffix = metersToProcess.length > 1 ? `M${meterIndex + 1}` : '';
          const billInvoiceNumber = `ELEC-${monthYear}-${String(property.srNo || 1).padStart(4, '0')}${meterSuffix ? `-${meterSuffix}` : ''}`;
          
          // Create electricity bill for this meter
          const billData = createElectricityBillData(
            meter, property, calculatedCharges,
            { prvReading, curReading, unitsConsumed, unitRate, unitsSlab, previousArrears },
            periodFrom, periodTo, billInvoiceNumber, req.user.id
          );
          
          const meterBill = new Electricity(billData);
          await meterBill.save();
          
          // Store first meter's bill for backward compatibility, or create separate invoices
          if (meterIndex === 0) {
            electricityBill = meterBill;
            // previousArrears already includes carry forward from getPreviousReading
            const electricityDescription = metersToProcess.length > 1 
              ? `Electricity Bill - ${meter.floor || 'Meter 1'}` 
              : (previousArrears > 0 ? 'Electricity Bill (with Carry Forward Arrears)' : 'Electricity Bill');
            
            charges.push({
              type: 'ELECTRICITY',
              description: electricityDescription,
              amount: calculatedCharges.withSurcharge,
              arrears: previousArrears,
              total: calculatedCharges.withSurcharge + previousArrears
            });
            electricityArrearsAlreadyApplied = true;
          } else {
            // For additional meters, store data to create separate invoices
            // Note: Carry forward arrears only added to first meter to avoid duplication
            meterBillsData.push({
              bill: meterBill,
              meter: meter,
              meterIndex: meterIndex + 1,
              charges: {
                type: 'ELECTRICITY',
                description: `Electricity Bill - ${meter.floor || `Meter ${meterIndex + 1}`}`,
                amount: calculatedCharges.withSurcharge,
                arrears: previousArrears,
                total: calculatedCharges.withSurcharge + previousArrears
              }
            });
          }
        }
        } else if (requestCharges && Array.isArray(requestCharges) && requestCharges.length > 0 && !hasReadings) {
          // Use manually entered charges from request (only if no readings were processed and charges not already used)
        const electricityCharge = requestCharges.find(c => c.type === 'ELECTRICITY');
        if (electricityCharge && electricityCharge.amount > 0) {
          // Create a minimal electricity bill record for reference
          const now = dayjs();
          const billInvoiceNumber = `ELEC-${now.format('YYYY-MM')}-${String(property.srNo || 1).padStart(4, '0')}`;
          
          const billData = {
            invoiceNumber: billInvoiceNumber,
            meterNo: property.meterNumber || '',
            propertyType: 'Residential',
            fromDate: periodFrom ? new Date(periodFrom) : now.startOf('month').toDate(),
            toDate: periodTo ? new Date(periodTo) : now.endOf('month').toDate(),
            month: now.format('MMM-YY'),
            dueDate: periodTo ? new Date(periodTo) : now.add(30, 'day').toDate(),
            totalBill: electricityCharge.amount || 0,
            withSurcharge: electricityCharge.amount || 0,
            arrears: electricityCharge.arrears || 0,
            amount: electricityCharge.amount || 0,
            plotNo: property.plotNumber || '',
            rdaNo: property.rdaNumber || '',
            street: property.street || '',
            sector: property.sector || '',
            category: property.categoryType || '',
            address: property.address || property.fullAddress || '',
            project: property.project || '',
            owner: property.ownerName || '',
            contactNo: property.contactNumber || '',
            status: 'Active',
            createdBy: req.user.id
          };
          
          electricityBill = new Electricity(billData);
          await electricityBill.save();
          
          // For manual charges, calculate carry forward arrears from PropertyInvoice
          let manualCarryForwardArrears = 0;
          const previousElectricityInvoices = await PropertyInvoice.find({
            property: property._id,
            chargeTypes: { $in: ['ELECTRICITY'] },
            paymentStatus: { $in: ['unpaid', 'partial_paid'] },
            balance: { $gt: 0 }
          })
          .populate('electricityBill', 'meterNo')
          .select('charges grandTotal totalPaid balance electricityBill')
          .sort({ invoiceDate: 1 })
          .lean();
          
          const currentMeterNo = electricityBill?.meterNo || property.meterNumber || '';
          previousElectricityInvoices.forEach(inv => {
            if (currentMeterNo && inv.electricityBill?.meterNo && String(inv.electricityBill.meterNo) !== String(currentMeterNo)) {
              return; // Skip invoices belonging to other meters in multi-meter setups
            }
            const electricityCharges = inv.charges?.filter(c => c.type === 'ELECTRICITY') || [];
            if (electricityCharges.length > 0) {
              const hasOnlyElectricity = inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'ELECTRICITY';
              if (hasOnlyElectricity) {
                manualCarryForwardArrears += (inv.balance || 0);
              } else {
                const electricityTotal = electricityCharges.reduce((sum, c) => sum + (c.amount || 0) + (c.arrears || 0), 0);
                const invoiceTotal = inv.grandTotal || 0;
                if (invoiceTotal > 0) {
                  const electricityProportion = electricityTotal / invoiceTotal;
                  manualCarryForwardArrears += (inv.balance || 0) * electricityProportion;
                }
              }
            }
          });
          
          manualCarryForwardArrears = Math.round(manualCarryForwardArrears * 100) / 100;
          
          const totalElectricityArrears = (electricityCharge.arrears || 0) + manualCarryForwardArrears;
          const electricityDesc = electricityCharge.description || 
            (manualCarryForwardArrears > 0 ? 'Electricity Bill (with Carry Forward Arrears)' : 'Electricity Bill');
          
          charges.push({
            type: 'ELECTRICITY',
            description: electricityDesc,
            amount: electricityCharge.amount || 0,
            arrears: totalElectricityArrears,
            total: (electricityCharge.amount || 0) + totalElectricityArrears
          });
          electricityArrearsAlreadyApplied = true;
        }
      } else if (conditions.length > 0) {
        // Fallback to existing bill
        electricityBill = await Electricity.findOne({ $or: conditions })
          .sort({ toDate: -1, createdAt: -1 })
          .lean();
        
        if (electricityBill) {
          // For existing bill, calculate carry forward arrears from PropertyInvoice
          let existingBillCarryForwardArrears = 0;
          const previousElectricityInvoices = await PropertyInvoice.find({
            property: property._id,
            chargeTypes: { $in: ['ELECTRICITY'] },
            paymentStatus: { $in: ['unpaid', 'partial_paid'] },
            balance: { $gt: 0 }
          })
          .populate('electricityBill', 'meterNo')
          .select('charges grandTotal totalPaid balance electricityBill')
          .sort({ invoiceDate: 1 })
          .lean();
          
          const currentMeterNo = electricityBill.meterNo || '';
          previousElectricityInvoices.forEach(inv => {
            if (currentMeterNo && inv.electricityBill?.meterNo && String(inv.electricityBill.meterNo) !== String(currentMeterNo)) {
              return; // Skip invoices belonging to other meters in multi-meter setups
            }
            const electricityCharges = inv.charges?.filter(c => c.type === 'ELECTRICITY') || [];
            if (electricityCharges.length > 0) {
              const hasOnlyElectricity = inv.chargeTypes?.length === 1 && inv.chargeTypes[0] === 'ELECTRICITY';
              if (hasOnlyElectricity) {
                existingBillCarryForwardArrears += (inv.balance || 0);
              } else {
                const electricityTotal = electricityCharges.reduce((sum, c) => sum + (c.amount || 0) + (c.arrears || 0), 0);
                const invoiceTotal = inv.grandTotal || 0;
                if (invoiceTotal > 0) {
                  const electricityProportion = electricityTotal / invoiceTotal;
                  existingBillCarryForwardArrears += (inv.balance || 0) * electricityProportion;
                }
              }
            }
          });
          
          existingBillCarryForwardArrears = Math.round(existingBillCarryForwardArrears * 100) / 100;
          
          const totalElectricityArrears = (electricityBill.arrears || 0) + existingBillCarryForwardArrears;
          const electricityDesc = existingBillCarryForwardArrears > 0 
            ? 'Electricity Bill (with Carry Forward Arrears)' 
            : 'Electricity Bill';
          
          charges.push({
            type: 'ELECTRICITY',
            description: electricityDesc,
            amount: electricityBill.withSurcharge || electricityBill.totalBill || 0,
            arrears: totalElectricityArrears,
            total: (electricityBill.withSurcharge || electricityBill.totalBill || 0) + totalElectricityArrears
          });
          electricityArrearsAlreadyApplied = true;
          }
        }
      }
    }

    // Get Rent Payment from Rental Agreement (especially for Personal Rent category)
    // Inline rent charge creation (no helper) to avoid "createRentCharge is not defined" in production
    if (includeRent === true) {
      // RENT-only overdue arrears (same module-specific logic as CAM / electricity)
      try {
        rentCarryForwardArrears = await calculateOverdueArrears(property._id, new Date(), ['RENT']);
      } catch (err) {
        console.error(`[RENT-INVOICE] calculateOverdueArrears failed for ${property._id}:`, err.message);
        rentCarryForwardArrears = 0;
      }

      const pushRentCharge = (amount, arrears) => {
        const totalRentArrears = (arrears || 0) + rentCarryForwardArrears;
        charges.push({
          type: 'RENT',
          description: rentCarryForwardArrears > 0 ? 'Rental Charges (with Carry Forward Arrears)' : 'Rental Charges',
          amount: amount || 0,
          arrears: totalRentArrears,
          total: (amount || 0) + totalRentArrears
        });
      };

      let agreement = null;

      // Try to get rent from rental agreement (priority for Personal Rent)
      if (property.categoryType === 'Personal Rent' || property.rentalAgreement) {
        if (property.rentalAgreement?.monthlyRent !== undefined) {
          agreement = property.rentalAgreement;
        } else if (property.rentalAgreement) {
          try {
            const agreementId = typeof property.rentalAgreement === 'object'
              ? (property.rentalAgreement._id || property.rentalAgreement)
              : property.rentalAgreement;
            agreement = await TajRentalAgreement.findById(agreementId).lean();
          } catch (err) { /* continue */ }
        }
        if (!agreement && property.categoryType === 'Personal Rent' && property.propertyName) {
          try {
            agreement = await TajRentalAgreement.findOne({
              propertyName: property.propertyName,
              status: { $in: ['Active', 'Expired'] }
            }).sort({ createdAt: -1 }).lean();
          } catch (err) { /* continue */ }
        }
        if (agreement?.monthlyRent) {
          pushRentCharge(agreement.monthlyRent, 0);
          rentChargeAdded = true;
        }
      }

      // Fallback: existing rent payments (legacy)
      if (!rentChargeAdded && property.categoryType === 'Personal Rent' && property.rentalPayments?.length > 0) {
        const latestRentPayment = [...property.rentalPayments]
          .sort((a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0))[0];
        if (latestRentPayment) {
          rentPayment = latestRentPayment;
          pushRentCharge(latestRentPayment.amount, latestRentPayment.arrears);
          rentChargeAdded = true;
        }
      }
    }

    // If manual charges provided, update or add them to charges array
    // BUT: Don't override charges if we just calculated them from readings
    // For rental charges, if backend already calculated from agreement, use that instead of manual charges
    const hasCalculatedCharges = includeElectricity === true && hasReadings && (electricityBill || meterBillsData.length > 0);
    const hasCalculatedRentCharge = includeRent === true && rentChargeAdded;
    
    if (requestCharges?.length > 0 && !hasCalculatedCharges) {
      requestCharges.forEach(charge => {
        // For RENT charges, if backend already calculated them from agreement,
        // update the existing charge with manually entered values (if provided)
        if (charge.type === 'RENT' && hasCalculatedRentCharge) {
          const existingRentIndex = charges.findIndex(c => c.type === 'RENT');
          if (existingRentIndex >= 0) {
            const existingCharge = charges[existingRentIndex];
            // If user manually entered amount or arrears, use those values
            // This allows users to override values for the first invoice
            const manualAmount = (charge.amount !== undefined && charge.amount !== null) 
              ? charge.amount 
              : existingCharge.amount;
            const manualArrears = (charge.arrears !== undefined && charge.arrears !== null) 
              ? charge.arrears 
              : 0;
            // When client sends arrears: it's totalArrears from getRentCalculation (already includes CF)
            // Use as-is. When not sent: use backend carry forward only.
            const totalArrears = (charge.arrears !== undefined && charge.arrears !== null)
              ? (Number(charge.arrears) || 0)
              : (0 + rentCarryForwardArrears);
            charges[existingRentIndex] = {
              ...existingCharge,
              amount: manualAmount || 0,
              arrears: totalArrears,
              total: (manualAmount || 0) + totalArrears
            };
          }
          return; // Skip adding new charge, we updated the existing one
        }
        
        // For RENT charges: client sends totalArrears from getRentCalculation (already includes carry forward)
        // Use charge.arrears as-is - do NOT add rentCarryForwardArrears again (would double-count)
        let chargeData;
        if (charge.type === 'RENT' && includeRent === true) {
          const rentArrears = charge.arrears !== undefined && charge.arrears !== null ? Number(charge.arrears) || 0 : 0;
          chargeData = {
            type: 'RENT',
            description: rentArrears > 0 ? 'Rental Charges (with Carry Forward Arrears)' : 'Rental Charges',
            amount: charge.amount || 0,
            arrears: rentArrears,
            total: (charge.amount || 0) + rentArrears
          };
        } else {
          chargeData = {
            type: charge.type,
            description: charge.description || `${charge.type} Charges`,
            amount: charge.amount || 0,
            arrears: charge.arrears || 0,
            total: (charge.amount || 0) + (charge.arrears || 0)
          };
        }
        
        const existingIndex = charges.findIndex(c => c.type === charge.type);
        if (existingIndex >= 0) {
          charges[existingIndex] = chargeData;
        } else {
          charges.push(chargeData);
        }
      });
    }
    
    // Allow creating invoice with empty charges if manually entered charges are provided (even if empty array)
    // This allows frontend to initialize invoice and user can fill in charges
    const hasManualChargesRequest = requestCharges !== undefined;
    
    // For Personal Rent properties, always allow creating invoice even if no charges found
    // (user can manually enter the rent amount)
    if (charges.length === 0 && !hasManualChargesRequest && property.categoryType !== 'Personal Rent') {
      return res.status(400).json({ 
        success: false, 
        message: 'No charges found for this property. Please ensure CAM, Water, Electricity, or Rent charges exist, or provide charges manually.' 
      });
    }
    
    // If no charges found, create with default empty charge based on what was requested
    // This is especially important for Personal Rent properties
    if (charges.length === 0) {
      // Determine charge type based on what was requested
      if (includeRent) {
        charges.push({
          type: 'RENT',
          description: 'Rental Charges',
          amount: 0,
          arrears: 0,
          total: 0
        });
      } else if (includeElectricity) {
        charges.push({
          type: 'ELECTRICITY',
          description: 'Electricity Bill',
          amount: 0,
          arrears: 0,
          total: 0
        });
      } else if (includeCAM) {
        charges.push({
          type: 'CAM',
          description: 'CAM Charges',
          amount: 0,
          arrears: 0,
          total: 0
        });
      } else if (includeWater) {
        charges.push({
          type: 'WATER',
          description: 'Water Charges',
          amount: 0,
          arrears: 0,
          total: 0
        });
      }
    }

    // Add module-specific overdue arrears: only the portion for each charge type (electricity/CAM/rent).
    // Skip for charge types that already have correct module-only arrears (from frontend or from backend createRentCharge).
    const usedProvidedRent = includeRent === true && requestCharges?.some(c => String(c?.type || '').toUpperCase() === 'RENT') && !rentChargeAdded;
    const rentArrearsAlreadyApplied = chargeType => (chargeType === 'RENT' && (usedProvidedRent || rentChargeAdded));
    const chargeTypesInInvoice = [...new Set(charges.map((c) => c.type))];
    for (const chargeType of chargeTypesInInvoice) {
      if (chargeType === 'CAM' && useProvidedCAM) continue;
      if (chargeType === 'WATER' && useProvidedWater) continue;
      if (chargeType === 'ELECTRICITY' && (usedProvidedElectricity || electricityArrearsAlreadyApplied)) continue;
      if (rentArrearsAlreadyApplied(chargeType)) continue;
      const overdueForType = await calculateOverdueArrears(property._id, new Date(), [chargeType]);
      if (overdueForType > 0) {
        const charge = charges.find((c) => c.type === chargeType);
        if (charge) {
          charge.arrears = (charge.arrears || 0) + overdueForType;
          charge.total = (charge.amount || 0) + (charge.arrears || 0);
        }
      }
    }
    
    // Calculate totals
    const subtotal = charges.reduce((sum, charge) => sum + charge.amount, 0);
    const totalArrears = charges.reduce((sum, charge) => sum + charge.arrears, 0);
    const grandTotal = subtotal + totalArrears;

    // Determine invoice type based on charge types
    let invoiceType = 'GEN';
    if (charges.length === 1) {
      const chargeType = charges[0].type;
      if (chargeType === 'CAM') {
        invoiceType = 'CAM';
      } else if (chargeType === 'WATER') {
        invoiceType = 'WATER';
      } else if (chargeType === 'ELECTRICITY') {
        invoiceType = 'ELECTRICITY';
      } else if (chargeType === 'RENT') {
        invoiceType = 'RENT';
      }
    } else if (charges.length > 1) {
      invoiceType = 'MIXED';
    }

    // Get active meters from property for electricity check
    const activeMeters = (property.meters || []).filter(m => m.isActive !== false);

    // Handle multiple meters for electricity invoices
    const now = dayjs();
    const hasMultipleMeters = activeMeters.length > 1 && includeElectricity === true && electricityBill && meterBillsData.length > 0;
    
    // If we have multiple meters with electricity, create separate invoices for each
    if (hasMultipleMeters) {
      const createdInvoices = [];
      const year = now.year();
      const month = now.month() + 1;
      
      // Check if invoices already exist for this month before creating
      // Only check for duplicates if periodTo or periodFrom is provided
      if (periodTo || periodFrom) {
        const periodDate = periodTo ? dayjs(periodTo) : dayjs(periodFrom);
        const periodYear = periodDate.year();
        const periodMonth = periodDate.month() + 1;
        const monthStart = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`).startOf('month').toDate();
        const monthEnd = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`).endOf('month').toDate();
        
        // Get unique charge types from charges array
        const chargeTypesArray = [...new Set(charges.map(c => c.type))];
        
        // Check for existing invoice for first meter (match by meter number)
        if (electricityBill && electricityBill.meterNo) {
          const meterNo = electricityBill.meterNo;
          const existingFirstInvoices = await PropertyInvoice.aggregate([
            {
              $match: {
                property: property._id,
                $or: [
                  { periodTo: { $gte: monthStart, $lte: monthEnd } },
                  { periodFrom: { $gte: monthStart, $lte: monthEnd } }
                ],
                chargeTypes: { 
                  $all: chargeTypesArray, 
                  $size: chargeTypesArray.length 
                }
              }
            },
            {
              $lookup: {
                from: 'electricities',
                localField: 'electricityBill',
                foreignField: '_id',
                as: 'electricityBillDoc'
              }
            },
            {
              $match: {
                'electricityBillDoc.0.meterNo': meterNo
              }
            }
          ]);
          
          if (existingFirstInvoices && existingFirstInvoices.length > 0) {
            return res.status(400).json({
              success: false,
              message: `An invoice already exists for meter ${meterNo} for ${dayjs(monthStart).format('MMMM YYYY')}. Please edit the existing invoice instead.`,
              data: { existingInvoiceId: existingFirstInvoices[0]._id }
            });
          }
        }
        
        // Check for existing invoices for additional meters (match by meter number)
        for (const { bill: meterBill, meter, meterIndex } of meterBillsData) {
          const meterNo = meterBill.meterNo || meter.meterNo || '';
          if (meterNo) {
            const existingMeterInvoices = await PropertyInvoice.aggregate([
              {
                $match: {
                  property: property._id,
                  $or: [
                    { periodTo: { $gte: monthStart, $lte: monthEnd } },
                    { periodFrom: { $gte: monthStart, $lte: monthEnd } }
                  ],
                  chargeTypes: ['ELECTRICITY']
                }
              },
              {
                $lookup: {
                  from: 'electricities',
                  localField: 'electricityBill',
                  foreignField: '_id',
                  as: 'electricityBillDoc'
                }
              },
              {
                $match: {
                  'electricityBillDoc.meterNo': meterNo
                }
              }
            ]);
            
            if (existingMeterInvoices && existingMeterInvoices.length > 0) {
              return res.status(400).json({
                success: false,
                message: `An invoice already exists for meter ${meterNo} for ${dayjs(monthStart).format('MMMM YYYY')}. Please edit the existing invoice instead.`,
                data: { existingInvoiceId: existingMeterInvoices[0]._id }
              });
            }
          }
        }
      }
      
      // Create invoice for first meter (already processed above)
      const firstInvoiceNumber = generateInvoiceNumber(property.srNo, year, month, invoiceType, activeMeters.length > 1 ? 'M1' : '');
      
      const firstInvoiceData = {
        property: property._id,
        invoiceNumber: firstInvoiceNumber,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : (periodTo ? dayjs(periodTo).add(15, 'day').toDate() : now.add(30, 'day').toDate()),
        periodFrom: periodFrom ? new Date(periodFrom) : undefined,
        periodTo: periodTo ? new Date(periodTo) : undefined,
        chargeTypes: charges.map(c => c.type),
        camCharge: camCharge?._id,
        waterCharge: waterCharge?._id,
        electricityBill: electricityBill?._id,
        rentPayment: rentPayment?._id,
        charges,
        subtotal,
        totalArrears,
        grandTotal,
        amountInWords: numberToWords(grandTotal),
        totalPaid: 0, // Explicitly set initial totalPaid
        balance: grandTotal, // Explicitly set initial balance (grandTotal - 0)
        calculationData: calculationData, // Persist calculation breakdown
        status: 'Issued',
        paymentStatus: 'unpaid',
        createdBy: req.user.id
      };
      
      const { invoice: firstInvoice } = await createOrUpdateInvoice(
        firstInvoiceData, firstInvoiceNumber, property._id, req.user.id, periodFrom, periodTo, property.srNo, invoiceType
      );
      
      await populateInvoiceReferences(firstInvoice, { camCharge, waterCharge, electricityBill });
      createdInvoices.push(firstInvoice.toObject());
      
      // Create invoices for additional meters
      for (const { bill: meterBill, meter, meterIndex, charges: meterCharges } of meterBillsData) {
        const meterSubtotal = meterCharges.amount || 0;
        const meterArrears = meterCharges.arrears || 0;
        const meterGrandTotal = meterSubtotal + meterArrears;
        const meterInvoiceNumber = generateInvoiceNumber(property.srNo, year, month, invoiceType, `M${meterIndex}`);
        
        const meterInvoiceData = {
          property: property._id,
          invoiceNumber: meterInvoiceNumber,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
          dueDate: dueDate ? new Date(dueDate) : (periodTo ? dayjs(periodTo).add(15, 'day').toDate() : now.add(30, 'day').toDate()),
          periodFrom: periodFrom ? new Date(periodFrom) : undefined,
          periodTo: periodTo ? new Date(periodTo) : undefined,
          chargeTypes: ['ELECTRICITY'],
          electricityBill: meterBill._id,
          charges: [meterCharges],
          subtotal: meterSubtotal,
          totalArrears: meterArrears,
          grandTotal: meterGrandTotal,
          amountInWords: numberToWords(meterGrandTotal),
          totalPaid: 0, // Explicitly set initial totalPaid
          balance: meterGrandTotal, // Explicitly set initial balance (grandTotal - 0)
          status: 'Issued',
          paymentStatus: 'unpaid',
          createdBy: req.user.id
        };
        
        const { invoice: meterInvoice } = await createOrUpdateInvoice(
          meterInvoiceData, meterInvoiceNumber, property._id, req.user.id, periodFrom, periodTo, property.srNo, invoiceType
        );
        
        await populateInvoiceReferences(meterInvoice, { electricityBill: meterBill });
        createdInvoices.push(meterInvoice.toObject());
      }
      
      // OPTIMIZATION: Invalidate caches on bulk invoice creation
      clearCached(CACHE_KEYS.INVOICES_OVERVIEW);
      clearCached(`${CACHE_KEYS.INVOICES_OVERVIEW}_property_${property._id}`);
      
      return res.status(201).json({
        success: true,
        message: `Invoices created successfully for ${createdInvoices.length} meter(s)`,
        data: createdInvoices.length === 1 ? createdInvoices[0] : createdInvoices
      });
    }
    
    // Single invoice creation (original logic for non-multiple meters or non-electricity)
    const invoiceNumber = generateInvoiceNumber(property.srNo, now.year(), now.month() + 1, invoiceType);
    
    // Check if invoice already exists for this month before creating
    // Only check for duplicates if periodTo or periodFrom is provided
    if (periodTo || periodFrom) {
      const periodDate = periodTo ? dayjs(periodTo) : dayjs(periodFrom);
      const periodYear = periodDate.year();
      const periodMonth = periodDate.month() + 1;
      const monthStart = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`).startOf('month').toDate();
      const monthEnd = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`).endOf('month').toDate();
      
      // Get unique charge types from charges array
      const chargeTypesArray = [...new Set(charges.map(c => c.type))];
      
      // Build query to find existing invoice for same month
      const duplicateQuery = {
        property: property._id,
        $or: [
          { periodTo: { $gte: monthStart, $lte: monthEnd } },
          { periodFrom: { $gte: monthStart, $lte: monthEnd } }
        ],
        chargeTypes: { 
          $all: chargeTypesArray, 
          $size: chargeTypesArray.length 
        }
      };
      
      // For electricity invoices, match by meter number instead of electricityBill._id
      // (since each invoice creates a new Electricity document)
      if (chargeTypesArray.includes('ELECTRICITY') && electricityBill) {
        // Use aggregation to find invoices with matching meter number
        const meterNo = electricityBill.meterNo || '';
        if (meterNo) {
          const existingInvoices = await PropertyInvoice.aggregate([
            {
              $match: {
                property: property._id,
                $or: [
                  { periodTo: { $gte: monthStart, $lte: monthEnd } },
                  { periodFrom: { $gte: monthStart, $lte: monthEnd } }
                ],
                chargeTypes: { 
                  $all: chargeTypesArray, 
                  $size: chargeTypesArray.length 
                }
              }
            },
            {
              $lookup: {
                from: 'electricities',
                localField: 'electricityBill',
                foreignField: '_id',
                as: 'electricityBillDoc'
              }
            },
            {
              $unwind: {
                path: '$electricityBillDoc',
                preserveNullAndEmptyArrays: false
              }
            },
            {
              $match: {
                'electricityBillDoc.meterNo': meterNo
              }
            }
          ]);
          
          if (existingInvoices && existingInvoices.length > 0) {
            return res.status(400).json({
              success: false,
              message: `An invoice already exists for meter ${meterNo} for ${dayjs(monthStart).format('MMMM YYYY')}. Please edit the existing invoice instead.`,
              data: { existingInvoiceId: existingInvoices[0]._id }
            });
          }
        } else {
          // Fallback: if meterNo is not available, use electricityBill._id (less reliable)
          duplicateQuery.electricityBill = electricityBill._id;
        }
      }
      
      // For CAM charges, check for duplicates
      // If camCharge exists, match by camCharge reference
      // If camCharge is null, still check for duplicates by charge type and month (same property, same month, CAM charges)
      if (chargeTypesArray.includes('CAM')) {
        if (camCharge) {
          duplicateQuery.camCharge = camCharge._id;
        } else {
          // If camCharge is null, we still want to prevent duplicates for the same month
          // Check for any CAM invoice for this property in this month
          // The chargeTypes filter above already ensures it's a CAM invoice
        }
      }

      if (chargeTypesArray.includes('WATER')) {
        if (waterCharge) {
          duplicateQuery.waterCharge = waterCharge._id;
        }
      }
      
      // For RENT charges, match the rentPayment reference if available
      if (chargeTypesArray.includes('RENT') && rentPayment) {
        duplicateQuery.rentPayment = rentPayment._id;
      }
      
      const existingInvoice = await PropertyInvoice.findOne(duplicateQuery);
      if (existingInvoice) {
        return res.status(400).json({
          success: false,
          message: `An invoice already exists for ${dayjs(monthStart).format('MMMM YYYY')}. Please edit the existing invoice instead.`,
          data: { existingInvoiceId: existingInvoice._id }
        });
      }
    }
    
    const invoiceData = {
      property: property._id,
      invoiceNumber,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : (periodTo ? new Date(periodTo) : now.add(30, 'day').toDate()),
      periodFrom: periodFrom ? new Date(periodFrom) : undefined,
      periodTo: periodTo ? new Date(periodTo) : undefined,
      chargeTypes: charges.map(c => c.type),
      camCharge: camCharge?._id,
      waterCharge: waterCharge?._id,
      electricityBill: electricityBill?._id,
      rentPayment: rentPayment?._id,
      charges,
      subtotal,
      totalArrears,
      grandTotal,
      amountInWords: numberToWords(grandTotal),
      totalPaid: 0, // Explicitly set initial totalPaid
      balance: grandTotal, // Explicitly set initial balance (grandTotal - 0)
      calculationData: calculationData, // Persist calculation breakdown
      status: 'Issued',
      paymentStatus: 'unpaid',
      createdBy: req.user.id
    };

    const { invoice, isNew } = await createOrUpdateInvoice(
      invoiceData, invoiceNumber, property._id, req.user.id, periodFrom, periodTo, property.srNo, invoiceType
    );
    
    await populateInvoiceReferences(invoice, { camCharge, waterCharge, electricityBill });
    
    const invoiceObj = invoice.toObject();
    
    // OPTIMIZATION: Invalidate caches on invoice creation
    clearCached(CACHE_KEYS.INVOICES_OVERVIEW);
    clearCached(`${CACHE_KEYS.INVOICES_OVERVIEW}_property_${property._id}`);
    
    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoiceObj
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

router.post('/property/:propertyId', authMiddleware, asyncHandler(createPropertyInvoiceForProperty));

/** Run createPropertyInvoiceForProperty and capture the first res.json (for Taj bulk endpoints). */
function invokeCreatePropertyInvoice(mockReq) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (!settled) {
          settled = true;
          resolve({ statusCode: this.statusCode, body: payload });
        }
      }
    };
    Promise.resolve(createPropertyInvoiceForProperty(mockReq, res)).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function invoiceOverlapsBulkMonth(invoice, chargeType, monthStartMs, monthEndMs) {
  if (!invoice?.chargeTypes?.includes(chargeType)) return false;
  const invFromMs = invoice.periodFrom ? dayjs(invoice.periodFrom).startOf('day').valueOf() : null;
  const invToMs = invoice.periodTo ? dayjs(invoice.periodTo).endOf('day').valueOf() : null;
  const startMs = invFromMs ?? invToMs;
  const endMs = invToMs ?? invFromMs;
  if (startMs === null || endMs === null) return false;
  return startMs <= monthEndMs && endMs >= monthStartMs;
}

async function buildCamChargesArray(property, options = {}) {
  const propertySize = property.areaValue ?? 0;
  const areaUnit = property.areaUnit || 'Marla';
  const zoneType = property.zoneType || 'Residential';
  const camChargeInfo = await getCAMChargeForProperty(propertySize, areaUnit, zoneType);
  const amount = camChargeInfo?.amount ?? 0;
  const asOf = options.invoiceDate ? new Date(options.invoiceDate) : new Date();
  const beforePeriodFrom = options.periodFrom ? new Date(options.periodFrom) : null;
  const arrears = await calculateOverdueArrears(property._id, asOf, ['CAM'], {
    beforePeriodFrom: beforePeriodFrom || dayjs().startOf('month').toDate()
  });
  let description = 'CAM Charges';
  if (zoneType && String(zoneType).toLowerCase() === 'commercial') {
    description = 'Commercial CAM Charges';
  } else if (propertySize > 0) {
    description = `CAM Charges (${propertySize} ${areaUnit})`;
  }
  if (arrears > 0) description += ' (with Carry Forward Arrears)';
  return [
    {
      type: 'CAM',
      description,
      amount,
      arrears,
      total: Math.round((amount + arrears) * 100) / 100
    }
  ];
}

async function buildWaterChargesArray(property) {
  if (!property.hasWaterCharges) {
    return [];
  }
  const propertySize = property.areaValue ?? 0;
  const areaUnit = property.areaUnit || 'Marla';
  const zoneType = property.zoneType || 'Residential';
  const waterChargeInfo = await getWaterChargeForProperty(propertySize, areaUnit, zoneType);
  const amount = waterChargeInfo?.amount ?? 0;
  const arrears = await calculateOverdueArrears(property._id, new Date(), ['WATER']);
  let description = 'Water Charges';
  if (zoneType && String(zoneType).toLowerCase() === 'commercial') {
    description = 'Commercial Water Charges';
  } else if (propertySize > 0) {
    description = `Water Charges (${propertySize} ${areaUnit})`;
  }
  if (arrears > 0) description += ' (with Carry Forward Arrears)';
  return [
    {
      type: 'WATER',
      description,
      amount,
      arrears,
      total: Math.round((amount + arrears) * 100) / 100
    }
  ];
}

async function buildRentChargesArray(property) {
  const rentCarryForwardArrears = await calculateOverdueArrears(property._id, new Date(), ['RENT']);
  let monthlyRent = 0;
  let arrearsFromPayment = 0;
  if (property.rentalAgreement?.monthlyRent) {
    monthlyRent = property.rentalAgreement.monthlyRent || 0;
  } else if (property.categoryType === 'Personal Rent' && property.rentalPayments?.length > 0) {
    const latestPayment = [...property.rentalPayments]
      .sort((a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0))[0];
    if (latestPayment) {
      monthlyRent = latestPayment.amount || 0;
      arrearsFromPayment = latestPayment.arrears || 0;
    }
  } else if (property.expectedRent) {
    monthlyRent = property.expectedRent || 0;
  }
  const totalArrears = arrearsFromPayment + rentCarryForwardArrears;
  const rentDescription =
    rentCarryForwardArrears > 0 ? 'Rental Charges (with Carry Forward Arrears)' : 'Rental Charges';
  return [
    {
      type: 'RENT',
      description: rentDescription,
      amount: monthlyRent,
      arrears: totalArrears,
      total: monthlyRent + totalArrears
    }
  ];
}

const BULK_MAX_PROPERTIES = 600;

// @route   POST /api/taj-utilities/invoices/repair-cam-chain
// @desc    Rebuild CAM invoice arrears chain for one or more properties (CAM-only).
// @access  Private
router.post('/repair-cam-chain', authMiddleware, asyncHandler(async (req, res) => {
  const { propertyId, propertyIds, srNo, fromInvoiceNumber, dryRun } = req.body || {};
  const ids = new Set();

  if (propertyId) ids.add(String(propertyId));
  if (Array.isArray(propertyIds)) propertyIds.forEach((id) => ids.add(String(id)));

  if (srNo != null && srNo !== '') {
    const property = await TajProperty.findOne({ srNo: Number(srNo) }).select('_id srNo ownerName').lean();
    if (!property) {
      return res.status(404).json({ success: false, message: `Property with srNo ${srNo} not found` });
    }
    ids.add(String(property._id));
  }

  if (ids.size === 0) {
    return res.status(400).json({ success: false, message: 'Provide propertyId, propertyIds, or srNo' });
  }

  const { repairCamInvoiceChain } = require('../utils/camInvoiceArrears');
  const results = [];
  for (const id of ids) {
    const property = await TajProperty.findById(id).select('srNo ownerName').lean();
    const repair = await repairCamInvoiceChain(id, {
      fromInvoiceNumber: fromInvoiceNumber || undefined,
      dryRun: !!dryRun
    });
    results.push({
      propertyId: id,
      srNo: property?.srNo,
      ownerName: property?.ownerName,
      ...repair
    });
  }

  res.json({
    success: true,
    dryRun: !!dryRun,
    message: dryRun
      ? 'Dry run only — no invoices were saved'
      : 'CAM invoice chain repaired',
    results
  });
}));

// @route   POST /api/taj-utilities/invoices/bulk-create-cam-invoices
// @desc    Create CAM invoices for many properties in one request (server-side; not Recovery).
// @access  Private
router.post('/bulk-create-cam-invoices', authMiddleware, asyncHandler(async (req, res) => {
  const { propertyIds, periodFrom, periodTo, dueDate, invoiceDate } = req.body;
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
    return res.status(400).json({ success: false, message: 'propertyIds must be a non-empty array' });
  }
  if (propertyIds.length > BULK_MAX_PROPERTIES) {
    return res.status(400).json({ success: false, message: `At most ${BULK_MAX_PROPERTIES} properties per request` });
  }
  if (!periodFrom || !periodTo) {
    return res.status(400).json({ success: false, message: 'periodFrom and periodTo are required' });
  }
  const periodFromD = new Date(periodFrom);
  const periodToD = new Date(periodTo);
  const targetMonthStartMs = dayjs(periodFrom).startOf('month').startOf('day').valueOf();
  const targetMonthEndMs = dayjs(periodFrom).endOf('month').endOf('day').valueOf();
  const invoiceDateD = invoiceDate ? new Date(invoiceDate) : new Date();
  const dueDateD = dueDate ? new Date(dueDate) : periodToD;

  const results = [];
  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const rawId of propertyIds) {
    const propertyId = String(rawId);
    try {
      const property = await TajProperty.findById(propertyId).lean();
      if (!property) {
        results.push({ propertyId, status: 'failed', message: 'Property not found' });
        failedCount++;
        continue;
      }

      const invoices = await PropertyInvoice.find({ property: propertyId })
        .select('chargeTypes periodFrom periodTo')
        .lean();
      const exists = invoices.some((inv) =>
        invoiceOverlapsBulkMonth(inv, 'CAM', targetMonthStartMs, targetMonthEndMs)
      );
      if (exists) {
        results.push({ propertyId, status: 'skipped', message: 'CAM invoice already exists for this month' });
        skippedCount++;
        continue;
      }

      const charges = await buildCamChargesArray(property, {
        periodFrom: periodFromD,
        invoiceDate: invoiceDateD
      });
      const mockReq = {
        params: { propertyId },
        body: {
          includeCAM: true,
          includeElectricity: false,
          includeRent: false,
          invoiceDate: invoiceDateD,
          periodFrom: periodFromD,
          periodTo: periodToD,
          dueDate: dueDateD,
          charges
        },
        user: req.user
      };
      const inv = await invokeCreatePropertyInvoice(mockReq);
      if (inv.statusCode === 201 && inv.body?.success) {
        createdCount++;
        results.push({
          propertyId,
          status: 'created',
          invoiceId: inv.body?.data?._id
        });
      } else if (inv.statusCode === 400 && /already exists/i.test(inv.body?.message || '')) {
        skippedCount++;
        results.push({ propertyId, status: 'skipped', message: inv.body?.message });
      } else {
        failedCount++;
        results.push({
          propertyId,
          status: 'failed',
          message: inv.body?.message || 'Create failed'
        });
      }
    } catch (e) {
      failedCount++;
      results.push({ propertyId, status: 'failed', message: e.message });
    }
  }

  res.json({
    success: true,
    summary: {
      total: propertyIds.length,
      createdCount,
      skippedCount,
      failedCount
    },
    results
  });
}));

// @route   POST /api/taj-utilities/invoices/bulk-create-water-invoices
// @desc    Create Water invoices for many properties in one request
// @access  Private
router.post('/bulk-create-water-invoices', authMiddleware, asyncHandler(async (req, res) => {
  const { propertyIds, periodFrom, periodTo, dueDate, invoiceDate } = req.body;
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
    return res.status(400).json({ success: false, message: 'propertyIds must be a non-empty array' });
  }
  if (propertyIds.length > BULK_MAX_PROPERTIES) {
    return res.status(400).json({ success: false, message: `At most ${BULK_MAX_PROPERTIES} properties per request` });
  }
  if (!periodFrom || !periodTo) {
    return res.status(400).json({ success: false, message: 'periodFrom and periodTo are required' });
  }
  const periodFromD = new Date(periodFrom);
  const periodToD = new Date(periodTo);
  const targetMonthStartMs = dayjs(periodFrom).startOf('month').startOf('day').valueOf();
  const targetMonthEndMs = dayjs(periodFrom).endOf('month').endOf('day').valueOf();
  const invoiceDateD = invoiceDate ? new Date(invoiceDate) : new Date();
  const dueDateD = dueDate ? new Date(dueDate) : periodToD;

  const results = [];
  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const rawId of propertyIds) {
    const propertyId = String(rawId);
    try {
      const property = await TajProperty.findById(propertyId).lean();
      if (!property) {
        results.push({ propertyId, status: 'failed', message: 'Property not found' });
        failedCount++;
        continue;
      }
      if (!property.hasWaterCharges) {
        results.push({ propertyId, status: 'skipped', message: 'Water charges not enabled for property' });
        skippedCount++;
        continue;
      }

      const invoices = await PropertyInvoice.find({ property: propertyId })
        .select('chargeTypes periodFrom periodTo')
        .lean();
      const exists = invoices.some((inv) =>
        invoiceOverlapsBulkMonth(inv, 'WATER', targetMonthStartMs, targetMonthEndMs)
      );
      if (exists) {
        results.push({ propertyId, status: 'skipped', message: 'Water invoice already exists for this month' });
        skippedCount++;
        continue;
      }

      const charges = await buildWaterChargesArray(property);
      if (!charges.length || (charges[0].amount || 0) <= 0) {
        results.push({ propertyId, status: 'failed', message: 'No water slab amount for property' });
        failedCount++;
        continue;
      }

      const mockReq = {
        params: { propertyId },
        body: {
          includeCAM: false,
          includeWater: true,
          includeElectricity: false,
          includeRent: false,
          invoiceDate: invoiceDateD,
          periodFrom: periodFromD,
          periodTo: periodToD,
          dueDate: dueDateD,
          charges
        },
        user: req.user
      };
      const inv = await invokeCreatePropertyInvoice(mockReq);
      if (inv.statusCode === 201 && inv.body?.success) {
        createdCount++;
        results.push({
          propertyId,
          status: 'created',
          invoiceId: inv.body?.data?._id
        });
      } else if (inv.statusCode === 400 && /already exists/i.test(inv.body?.message || '')) {
        skippedCount++;
        results.push({ propertyId, status: 'skipped', message: inv.body?.message });
      } else {
        failedCount++;
        results.push({
          propertyId,
          status: 'failed',
          message: inv.body?.message || 'Create failed'
        });
      }
    } catch (e) {
      failedCount++;
      results.push({ propertyId, status: 'failed', message: e.message });
    }
  }

  res.json({
    success: true,
    summary: {
      total: propertyIds.length,
      createdCount,
      skippedCount,
      failedCount
    },
    results
  });
}));

// @route   POST /api/taj-utilities/invoices/bulk-create-rent-invoices
// @desc    Create rental (RENT) invoices for many properties in one request (server-side; not Recovery).
// @access  Private
router.post('/bulk-create-rent-invoices', authMiddleware, asyncHandler(async (req, res) => {
  const { propertyIds, periodFrom, periodTo, dueDate, invoiceDate } = req.body;
  if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
    return res.status(400).json({ success: false, message: 'propertyIds must be a non-empty array' });
  }
  if (propertyIds.length > BULK_MAX_PROPERTIES) {
    return res.status(400).json({ success: false, message: `At most ${BULK_MAX_PROPERTIES} properties per request` });
  }
  if (!periodFrom || !periodTo) {
    return res.status(400).json({ success: false, message: 'periodFrom and periodTo are required' });
  }
  const periodFromD = new Date(periodFrom);
  const periodToD = new Date(periodTo);
  const targetMonthStartMs = dayjs(periodFrom).startOf('month').startOf('day').valueOf();
  const targetMonthEndMs = dayjs(periodFrom).endOf('month').endOf('day').valueOf();
  const invoiceDateD = invoiceDate ? new Date(invoiceDate) : new Date();
  const dueDateD = dueDate ? new Date(dueDate) : periodToD;

  const results = [];
  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const rawId of propertyIds) {
    const propertyId = String(rawId);
    try {
      const property = await TajProperty.findById(propertyId).populate('rentalAgreement').lean();
      if (!property) {
        results.push({ propertyId, status: 'failed', message: 'Property not found' });
        failedCount++;
        continue;
      }

      const invoices = await PropertyInvoice.find({ property: propertyId })
        .select('chargeTypes periodFrom periodTo')
        .lean();
      const exists = invoices.some((inv) =>
        invoiceOverlapsBulkMonth(inv, 'RENT', targetMonthStartMs, targetMonthEndMs)
      );
      if (exists) {
        results.push({ propertyId, status: 'skipped', message: 'Rental invoice already exists for this month' });
        skippedCount++;
        continue;
      }

      const charges = await buildRentChargesArray(property);
      const mockReq = {
        params: { propertyId },
        body: {
          includeCAM: false,
          includeElectricity: false,
          includeRent: true,
          invoiceDate: invoiceDateD,
          periodFrom: periodFromD,
          periodTo: periodToD,
          dueDate: dueDateD,
          charges
        },
        user: req.user
      };
      const inv = await invokeCreatePropertyInvoice(mockReq);
      if (inv.statusCode === 201 && inv.body?.success) {
        createdCount++;
        results.push({
          propertyId,
          status: 'created',
          invoiceId: inv.body?.data?._id
        });
      } else if (inv.statusCode === 400 && /already exists/i.test(inv.body?.message || '')) {
        skippedCount++;
        results.push({ propertyId, status: 'skipped', message: inv.body?.message });
      } else {
        failedCount++;
        results.push({
          propertyId,
          status: 'failed',
          message: inv.body?.message || 'Create failed'
        });
      }
    } catch (e) {
      failedCount++;
      results.push({ propertyId, status: 'failed', message: e.message });
    }
  }

  res.json({
    success: true,
    summary: {
      total: propertyIds.length,
      createdCount,
      skippedCount,
      failedCount
    },
    results
  });
}));

// Create open invoice (without property) - for ground booking, billboard, events, etc.
router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { 
      invoiceNumber, 
      invoiceDate, 
      dueDate, 
      periodFrom, 
      periodTo, 
      charges, 
      customerName, 
      customerEmail, 
      customerPhone, 
      customerAddress,
      sector
    } = req.body;

    if (!charges || !Array.isArray(charges) || charges.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one charge is required' });
    }

    // Calculate totals
    const subtotal = charges.reduce((sum, charge) => sum + (charge.amount || 0), 0);
    const totalArrears = charges.reduce((sum, charge) => sum + (charge.arrears || 0), 0);
    const grandTotal = subtotal + totalArrears;

    const firstChargeType = Array.isArray(charges) && charges.length > 0 ? charges[0]?.type : '';
    const categoryPrefix = getOpenInvoiceCategoryPrefix(firstChargeType);
    const now = dayjs();
    const currentYear = now.year();
    const currentMonth = now.month() + 1;

    // Generate invoice number if not provided or empty
    let finalInvoiceNumber = invoiceNumber ? String(invoiceNumber).trim() : '';
    if (!finalInvoiceNumber || finalInvoiceNumber.trim() === '') {
      // Find the last open invoice (property: null) for the current month/year
      // Format: INV-<CATEGORY>-YYYY-MM-XXXX (e.g. INV-OTH-2026-04-0001)
      const lastInvoice = await PropertyInvoice.findOne({
        property: null,
        invoiceNumber: { $regex: `^INV-${categoryPrefix}-${currentYear}-${String(currentMonth).padStart(2, '0')}-` }
      })
        .sort({ invoiceNumber: -1 })
        .select('invoiceNumber')
        .lean();
      
      let nextIndex = 1;
      if (lastInvoice && lastInvoice.invoiceNumber) {
        // Extract the index from the last invoice number
        // Format: INV-<CATEGORY>-YYYY-MM-XXXX
        const parts = lastInvoice.invoiceNumber.split('-');
        const indexPart = parts[5 - 1];
        const lastIndex = parseInt(indexPart, 10);
        if (!isNaN(lastIndex)) {
          nextIndex = lastIndex + 1;
        }
      }

      finalInvoiceNumber = `INV-${categoryPrefix}-${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(nextIndex).padStart(4, '0')}`;
    }

    // Check for duplicate invoice number (fallback safety check)
    const existingInvoice = await PropertyInvoice.findOne({ invoiceNumber: finalInvoiceNumber });
    if (existingInvoice) {
      // If duplicate exists, find the highest index and increment
      const providedParts = finalInvoiceNumber.split('-');
      const derivedPrefix =
        providedParts.length >= 5 && providedParts[0] === 'INV'
          ? providedParts[1]
          : categoryPrefix;
      const yearForIncrement =
        providedParts.length >= 5 ? parseInt(providedParts[2], 10) || currentYear : currentYear;
      const monthForIncrement =
        providedParts.length >= 5 ? parseInt(providedParts[3], 10) || currentMonth : currentMonth;
      const basePattern = `INV-${derivedPrefix}-${yearForIncrement}-${String(monthForIncrement).padStart(2, '0')}-`;
      
      const allInvoices = await PropertyInvoice.find({
        invoiceNumber: { $regex: `^${basePattern}` }
      })
        .select('invoiceNumber')
        .lean();
      
      let maxIndex = 0;
      allInvoices.forEach(inv => {
        const parts = inv.invoiceNumber.split('-');
        const indexPart = parts.length >= 5 ? parts[4] : null;
        const index = parseInt(indexPart, 10);
        if (!isNaN(index) && index > maxIndex) {
          maxIndex = index;
        }
      });

      finalInvoiceNumber = `INV-${derivedPrefix}-${yearForIncrement}-${String(monthForIncrement).padStart(2, '0')}-${String(maxIndex + 1).padStart(4, '0')}`;
    }

    const invoiceData = {
      property: null, // No property for open invoices
      invoiceNumber: finalInvoiceNumber,
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : (periodTo ? dayjs(periodTo).add(15, 'day').toDate() : dayjs().add(30, 'day').toDate()),
      periodFrom: periodFrom ? new Date(periodFrom) : undefined,
      periodTo: periodTo ? new Date(periodTo) : undefined,
      chargeTypes: [...new Set(charges.map(c => c.type))],
      charges: charges.map(c => ({
        type: c.type,
        description: c.description || '',
        amount: c.amount || 0,
        arrears: c.arrears || 0,
        total: (c.amount || 0) + (c.arrears || 0)
      })),
      subtotal,
      totalArrears,
      grandTotal,
      amountInWords: numberToWords(grandTotal),
      customerName: customerName || '',
      customerEmail: customerEmail || '',
      customerPhone: customerPhone || '',
      customerAddress: customerAddress || '',
      sector: sector || '',
      totalPaid: 0,
      balance: grandTotal,
      status: 'Issued',
      paymentStatus: 'unpaid',
      createdBy: req.user.id
    };

    const invoice = new PropertyInvoice(invoiceData);
    await invoice.save();

    // Don't create AR entry for open invoices (no property/resident)

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice.toObject()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Get month-wise reports (invoices, arrears, payments received)
router.get('/reports', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { startMonth, endMonth, chargeType } = req.query;
    const now = dayjs();
    const defaultStart = now.subtract(12, 'month');
    const start = startMonth ? dayjs(startMonth + '-01') : defaultStart.startOf('month');
    const end = endMonth ? dayjs(endMonth + '-01').endOf('month') : now.endOf('month');

    const monthStart = start.toDate();
    const monthEnd = end.toDate();

    const filter = { status: { $ne: 'Cancelled' } };
    // chargeType: all | CAM | ELECTRICITY | RENT | OPEN_INVOICE | Mixed | DEPOSITS
    if (chargeType && chargeType !== 'all') {
      if (chargeType === 'OPEN_INVOICE') {
        filter.property = null;
      } else if (chargeType === 'Mixed') {
        filter.$expr = { $gt: [{ $size: { $ifNull: ['$chargeTypes', []] } }, 1] };
      } else {
        filter.chargeTypes = { $in: [chargeType] };
      }
    }

    // Aggregation: same logic as month-summary so Payments Received matches Invoices page (sum of totalPaid by invoice month)
    const periodField = { $ifNull: ['$periodTo', '$invoiceDate'] };
    const subtotalExpr = {
      $ifNull: [
        '$subtotal',
        {
          $reduce: {
            input: { $ifNull: ['$charges', []] },
            initialValue: 0,
            in: { $add: ['$$value', { $ifNull: ['$$this.amount', 0] }] }
          }
        }
      ]
    };
    const pipeline = [
      { $match: filter },
      { $match: { $expr: { $and: [
        { $gte: [periodField, monthStart] },
        { $lte: [periodField, monthEnd] }
      ] } } },
      { $addFields: {
        monthKey: { $dateToString: { format: '%Y-%m', date: periodField } },
        subtotalComputed: subtotalExpr
      } },
      { $group: {
        _id: '$monthKey',
        invoiceAmount: { $sum: '$subtotalComputed' },
        arrears: { $sum: { $ifNull: ['$totalArrears', 0] } },
        paymentsReceived: { $sum: { $ifNull: ['$totalPaid', 0] } },
        invoiceCount: { $sum: 1 }
      } }
    ];

    const aggResult = await PropertyInvoice.aggregate(pipeline);

    const monthMap = {};
    let m = start.startOf('month');
    while (m.isBefore(end) || m.isSame(end, 'month')) {
      const key = m.format('YYYY-MM');
      monthMap[key] = {
        month: key,
        monthLabel: m.format('MMM YYYY'),
        invoiceAmount: 0,
        arrears: 0,
        paymentsReceived: 0,
        invoiceCount: 0
      };
      m = m.add(1, 'month');
    }
    for (const row of aggResult) {
      if (monthMap[row._id]) {
        monthMap[row._id].invoiceAmount = row.invoiceAmount || 0;
        monthMap[row._id].arrears = row.arrears || 0;
        monthMap[row._id].paymentsReceived = row.paymentsReceived || 0;
        monthMap[row._id].invoiceCount = row.invoiceCount || 0;
      }
    }

    // Fetch deposits for export sheet only (Deposit Date, Resident ID, Amount in Excel)
    const depositQuery = {
      transactionType: 'deposit',
      $or: [
        { referenceNumberExternal: { $not: /^REV-/ } },
        { referenceNumberExternal: { $exists: false } },
        { referenceNumberExternal: null }
      ]
    };
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
    const unknownResidentIds = (unknownResidents || []).map(r => r._id);
    if (unknownResidentIds.length > 0) {
      depositQuery.resident = { $nin: unknownResidentIds };
    }
    // Deposits are bucketed by Pakistan month (same as the Deposits page), not the server's local month
    const depositRangeStart = new Date(`${start.format('YYYY-MM')}-01T00:00:00+05:00`);
    const depositRangeEnd = new Date(`${end.add(1, 'month').format('YYYY-MM')}-01T00:00:00+05:00`);
    const depositMonthKey = (date) => new Date(new Date(date).getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 7);
    depositQuery.createdAt = { $gte: depositRangeStart, $lt: depositRangeEnd };

    const deposits = await TajTransaction.find(depositQuery)
      .select('amount createdAt')
      .populate('resident', 'residentId name')
      .sort({ createdAt: 1 })
      .lean();

    for (const key of Object.keys(monthMap)) {
      monthMap[key].deposits = (deposits || [])
        .filter(d => d.createdAt && depositMonthKey(d.createdAt) === key)
        .map(d => ({
          depositDate: d.createdAt,
          residentId: d.resident?.residentId || '—',
          residentName: d.resident?.name || '—',
          amount: d.amount || 0
        }));
      monthMap[key].depositTotal = (monthMap[key].deposits || []).reduce((s, d) => s + (d.amount || 0), 0);
      monthMap[key].suspenseAmount = 0;
    }

    if (unknownResidentIds.length > 0) {
      const suspenseDeposits = await TajTransaction.find({
        transactionType: 'deposit',
        resident: { $in: unknownResidentIds },
        createdAt: { $gte: depositRangeStart, $lt: depositRangeEnd },
        $or: [
          { referenceNumberExternal: { $not: /^REV-/ } },
          { referenceNumberExternal: { $exists: false } },
          { referenceNumberExternal: null }
        ]
      })
        .select('amount createdAt')
        .lean();
      for (const d of suspenseDeposits || []) {
        if (!d.createdAt) continue;
        const monthKey = depositMonthKey(d.createdAt);
        if (monthMap[monthKey]) {
          monthMap[monthKey].suspenseAmount = (monthMap[monthKey].suspenseAmount || 0) + (d.amount || 0);
        }
      }
    }

    if (chargeType === 'DEPOSITS') {
      for (const key of Object.keys(monthMap)) {
        const row = monthMap[key];
        const depositTotal = row.depositTotal || 0;
        const suspenseAmount = row.suspenseAmount || 0;
        row.invoiceAmount = suspenseAmount;
        row.arrears = depositTotal;
        row.invoiceCount = 0;
        row.paymentsReceived = depositTotal + suspenseAmount;
      }
    }

    const byMonth = Object.keys(monthMap)
      .sort()
      .map((k) => monthMap[k]);

    const totals = {
      invoiceAmount: byMonth.reduce((s, r) => s + r.invoiceAmount, 0),
      arrears: byMonth.reduce((s, r) => s + r.arrears, 0),
      paymentsReceived: byMonth.reduce((s, r) => s + r.paymentsReceived, 0),
      invoiceCount: byMonth.reduce((s, r) => s + r.invoiceCount, 0),
      /** Same as Reconciliation "Amount (Deposit + Suspense)" summed over months. */
      depositPlusSuspense: byMonth.reduce(
        (s, r) => s + (Number(r.depositTotal) || 0) + (Number(r.suspenseAmount) || 0),
        0
      )
    };

    res.json({
      success: true,
      data: {
        byMonth,
        totals
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Reconciliation: multer for attachment uploads
const reconciliationStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'reconciliation');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const monthKey = req.body?.monthKey || 'month';
    const ext = path.extname(file.originalname) || '';
    cb(null, `recon-${monthKey}-${Date.now()}${ext}`);
  }
});
const reconciliationUpload = multer({
  storage: reconciliationStorage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Get reconciliation records (optionally by monthKeys)
router.get('/reconciliation', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { monthKeys } = req.query;
    const filter = {};
    if (monthKeys) {
      const keys = monthKeys.split(',').map(k => k.trim()).filter(Boolean);
      if (keys.length) filter.monthKey = { $in: keys };
    }
    const records = await ReconciliationRecord.find(filter).lean();
    const byMonth = records.reduce((acc, r) => {
      acc[r.monthKey] = {
        reconcileAmount: r.reconcileAmount,
        attachmentPath: r.attachmentPath,
        attachmentOriginalName: r.attachmentOriginalName,
        savedAt: r.updatedAt
      };
      return acc;
    }, {});
    res.json({ success: true, data: byMonth });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Save reconciliation (reconcile amount + optional attachment)
router.post('/reconciliation/save', authMiddleware, reconciliationUpload.single('attachment'), asyncHandler(async (req, res) => {
  try {
    const { monthKey, reconcileAmount } = req.body;
    if (!monthKey) {
      return res.status(400).json({ success: false, message: 'monthKey is required' });
    }
    const amount = parseFloat(reconcileAmount);
    if (Number.isNaN(amount) || amount < 0) {
      return res.status(400).json({ success: false, message: 'Valid reconcileAmount is required' });
    }
    const attachmentPath = req.file ? req.file.path : null;
    const attachmentOriginalName = req.file ? req.file.originalname : null;
    const userId = req.user?.userId || req.user?._id;

    let record = await ReconciliationRecord.findOne({ monthKey });
    if (record) {
      if (req.file && record.attachmentPath && fs.existsSync(record.attachmentPath)) {
        try { fs.unlinkSync(record.attachmentPath); } catch (_) {}
      }
      record.reconcileAmount = amount;
      if (attachmentPath) record.attachmentPath = attachmentPath;
      if (attachmentOriginalName) record.attachmentOriginalName = attachmentOriginalName;
      record.updatedAt = new Date();
      if (userId) record.createdBy = userId;
      await record.save();
    } else {
      record = await ReconciliationRecord.create({
        monthKey,
        reconcileAmount: amount,
        attachmentPath,
        attachmentOriginalName,
        createdBy: userId
      });
    }
    res.json({
      success: true,
      message: 'Reconciliation saved',
      data: {
        monthKey: record.monthKey,
        reconcileAmount: record.reconcileAmount,
        attachmentOriginalName: record.attachmentOriginalName,
        savedAt: record.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Month-wise summary must be registered BEFORE /:id, or "month-summary" is captured as an invoice id.
router.get('/month-summary', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { propertyId, status, paymentStatus, chargeType, residentId, sector, openInvoices } = req.query;
    const filter = { status: { $ne: 'Cancelled' } };
    if (openInvoices === 'true') {
      filter.property = null;
    } else if (propertyId) {
      if (!mongoose.isValidObjectId(propertyId)) {
        return res.status(400).json({ success: false, message: 'Invalid propertyId' });
      }
      filter.property = new mongoose.Types.ObjectId(propertyId);
    }
    if (status) filter.status = status;
    if (paymentStatus != null && paymentStatus !== '') {
      const ps = Array.isArray(paymentStatus) ? paymentStatus.join(',') : String(paymentStatus);
      if (ps.includes(',')) {
        filter.paymentStatus = { $in: ps.split(',').map((s) => s.trim()).filter(Boolean) };
      } else {
        filter.paymentStatus = ps;
      }
    }
    if (chargeType) filter.chargeTypes = { $in: [chargeType] };

    const pipeline = [{ $match: filter }];

    if (residentId || sector) {
      if (residentId && !mongoose.isValidObjectId(residentId)) {
        return res.status(400).json({ success: false, message: 'Invalid residentId' });
      }
      pipeline.push({ $lookup: { from: 'tajproperties', localField: 'property', foreignField: '_id', as: 'prop' } });
      pipeline.push({ $unwind: { path: '$prop', preserveNullAndEmptyArrays: true } });
      if (residentId) {
        pipeline.push({ $match: { 'prop.resident': new mongoose.Types.ObjectId(residentId) } });
      }
      if (sector) {
        const sectorPattern = new RegExp(escapeRegExp(String(sector)), 'i');
        pipeline.push({
          $match: {
            $or: [{ 'prop.sector': sector }, { 'prop.sector.name': sectorPattern }]
          }
        });
      }
    }

    pipeline.push(
      { $addFields: { monthKey: { $dateToString: { format: '%Y-%m', date: { $ifNull: ['$periodTo', '$invoiceDate'] } } } } },
      { $group: { _id: '$monthKey', total: { $sum: '$grandTotal' }, paid: { $sum: '$totalPaid' }, balance: { $sum: '$balance' }, invoiceCount: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    );

    const summary = await PropertyInvoice.aggregate(pipeline);
    const byMonth = summary.reduce((acc, row) => {
      acc[row._id] = { total: row.total || 0, paid: row.paid || 0, balance: row.balance || 0, invoiceCount: row.invoiceCount || 0 };
      return acc;
    }, {});

    res.json({ success: true, data: byMonth });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

/**
 * Dashboard rollups: allocate each invoice's balance across charge lines so
 * RENT / GROUND / OTHER do not double-count CAM, WATER, or ELECTRICITY lines.
 * Must be registered before GET /:id.
 */
const classifyChargeLineBucket = (chargeType) => {
  const raw = String(chargeType == null ? '' : chargeType).trim();
  const t = raw.toUpperCase().replace(/\s+/g, '_');
  if (/GROUND/i.test(raw) || t.includes('GROUND')) return 'ground';
  if (t === 'RENT' || t === 'REN') return 'rent';
  const util = ['CAM', 'CMC', 'WATER', 'WTR', 'ELECTRICITY', 'ELC'];
  if (util.includes(t)) return 'utility';
  if (raw.toLowerCase() === 'electricity') return 'utility';
  if (raw === 'Water') return 'utility';
  return 'other';
};

const emptyChargeRollup = () => ({
  invoiceIds: new Set(),
  propertyIds: new Set(),
  sumAmount: 0,
  sumArrears: 0,
  balanceUnpaid: 0
});

const finalizeRollup = (r) => {
  const round2 = (n) => Math.round(Number(n) * 100) / 100;
  const no = r.propertyIds.size > 0 ? r.propertyIds.size : r.invoiceIds.size;
  return {
    invoiceCount: r.invoiceIds.size,
    propertyCount: r.propertyIds.size,
    totalProperties: no,
    totalAmountAllPages: round2(r.sumAmount),
    totalArrears: round2(r.sumArrears),
    totalArrearsAllPages: round2(r.balanceUnpaid),
    totalAmount: round2(r.sumAmount)
  };
};

router.get('/charge-rollups', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const filter = { status: { $ne: 'Cancelled' } };
    const startRaw = req.query.startDate;
    const endRaw = req.query.endDate;
    if (startRaw) {
      const d = dayjs(startRaw).startOf('day').toDate();
      filter.invoiceDate = { ...(filter.invoiceDate || {}), $gte: d };
    }
    if (endRaw) {
      const d = dayjs(endRaw).endOf('day').toDate();
      filter.invoiceDate = { ...(filter.invoiceDate || {}), $lte: d };
    }

    const invoices = await PropertyInvoice.find(filter)
      .select('charges grandTotal balance totalArrears chargeTypes property invoiceDate')
      .lean();

    const ground = emptyChargeRollup();
    const rent = emptyChargeRollup();
    const other = emptyChargeRollup();

    for (const inv of invoices) {
      const invBalance = Number(inv.balance) || 0;
      const grand = Math.max(Number(inv.grandTotal) || 0, 1e-9);
      const charges = Array.isArray(inv.charges) && inv.charges.length > 0 ? inv.charges : null;

      const addLine = (bucket, amt, arr, lineGT) => {
        if (!bucket) return;
        bucket.invoiceIds.add(String(inv._id));
        if (inv.property) bucket.propertyIds.add(String(inv.property));
        bucket.sumAmount += amt;
        bucket.sumArrears += arr;
        bucket.balanceUnpaid += invBalance * (lineGT / grand);
      };

      if (charges && charges.length > 0) {
        for (const ch of charges) {
          const amt = Number(ch.amount) || 0;
          const arr = Number(ch.arrears) || 0;
          const lineGT = Number(ch.total) || amt + arr;
          const buck = classifyChargeLineBucket(ch.type);
          if (buck === 'utility') continue;
          const bucket = buck === 'ground' ? ground : buck === 'rent' ? rent : other;
          addLine(bucket, amt, arr, lineGT);
        }
      } else {
        const types = inv.chargeTypes || [];
        if (!types.length) continue;
        const buck = classifyChargeLineBucket(types[0]);
        if (buck === 'utility') continue;
        const bucket = buck === 'ground' ? ground : buck === 'rent' ? rent : other;
        const lineGT = Math.max(Number(inv.grandTotal) || 0, 1e-9);
        const arr = Number(inv.totalArrears) || 0;
        const amt = Math.max(0, lineGT - arr);
        addLine(bucket, amt, arr, lineGT);
      }
    }

    res.json({
      success: true,
      data: {
        ground: finalizeRollup(ground),
        rent: finalizeRollup(rent),
        other: finalizeRollup(other)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

/**
 * Open invoices (no property) split by charge-line bucket GROUND vs OTHER.
 * Billing month = periodTo ?? invoiceDate (same window as GET /reports).
 */
router.get('/reports/open-invoice-bucket', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { startMonth, endMonth, bucket } = req.query;
    const b = String(bucket || '');
    if (b !== 'ground' && b !== 'other') {
      return res.status(400).json({ success: false, message: 'bucket must be ground or other' });
    }
    const now = dayjs();
    const defaultStart = now.subtract(12, 'month');
    const start = startMonth ? dayjs(startMonth + '-01') : defaultStart.startOf('month');
    const end = endMonth ? dayjs(endMonth + '-01').endOf('month') : now.endOf('month');
    const monthStart = start.toDate();
    const monthEnd = end.toDate();

    const monthMap = {};
    let mo = start.startOf('month');
    while (mo.isBefore(end) || mo.isSame(end, 'month')) {
      const key = mo.format('YYYY-MM');
      monthMap[key] = {
        month: key,
        monthLabel: mo.format('MMM YYYY'),
        invoiceAmount: 0,
        arrears: 0,
        paymentsReceived: 0,
        invoiceCount: 0
      };
      mo = mo.add(1, 'month');
    }

    const invoices = await PropertyInvoice.find({ status: { $ne: 'Cancelled' }, property: null })
      .select('charges chargeTypes periodTo invoiceDate totalArrears grandTotal totalPaid')
      .lean();

    const periodVal = (inv) => inv.periodTo || inv.invoiceDate;

    for (const inv of invoices) {
      const p = periodVal(inv);
      const pd = p ? new Date(p) : null;
      if (!pd || pd < monthStart || pd > monthEnd) continue;

      const monthKey = dayjs(pd).format('YYYY-MM');
      if (!monthMap[monthKey]) continue;

      const charges = Array.isArray(inv.charges) && inv.charges.length > 0 ? inv.charges : null;
      const grand = Math.max(Number(inv.grandTotal) || 0, 1e-9);
      const invPaid = Number(inv.totalPaid) || 0;

      let lineAmt = 0;
      let lineArr = 0;
      let linePaid = 0;

      if (charges) {
        for (const ch of charges) {
          const buck = classifyChargeLineBucket(ch.type);
          if (buck === 'utility' || buck === 'rent') continue;
          if (b === 'ground' && buck !== 'ground') continue;
          if (b === 'other' && buck !== 'other') continue;
          const amt = Number(ch.amount) || 0;
          const arr = Number(ch.arrears) || 0;
          const lineGT = Number(ch.total) || amt + arr;
          lineAmt += amt;
          lineArr += arr;
          linePaid += invPaid * (lineGT / grand);
        }
      } else {
        const types = inv.chargeTypes || [];
        if (!types.length) continue;
        const buck = classifyChargeLineBucket(types[0]);
        if (buck === 'utility' || buck === 'rent') continue;
        if (b === 'ground' && buck !== 'ground') continue;
        if (b === 'other' && buck !== 'other') continue;
        const lineGT = Math.max(Number(inv.grandTotal) || 0, 1e-9);
        const arr = Number(inv.totalArrears) || 0;
        const amt = Math.max(0, lineGT - arr);
        lineAmt = amt;
        lineArr = arr;
        linePaid = invPaid;
      }

      if (!(lineAmt || lineArr || linePaid)) continue;

      monthMap[monthKey].invoiceAmount += lineAmt;
      monthMap[monthKey].arrears += lineArr;
      monthMap[monthKey].paymentsReceived += linePaid;
      monthMap[monthKey].invoiceCount += 1;
    }

    const byMonth = Object.keys(monthMap)
      .sort()
      .map((k) => monthMap[k]);

    const totals = {
      invoiceAmount: byMonth.reduce((s, r) => s + r.invoiceAmount, 0),
      arrears: byMonth.reduce((s, r) => s + r.arrears, 0),
      paymentsReceived: byMonth.reduce((s, r) => s + r.paymentsReceived, 0),
      invoiceCount: byMonth.reduce((s, r) => s + r.invoiceCount, 0)
    };

    res.json({ success: true, data: { byMonth, totals } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

/**
 * Top residents by outstanding balance for selected dashboard charge types (CAM, WATER, ELECTRICITY, RENT, GROUND, OTHER).
 * Allocates each invoice's balance across charge lines (same buckets as charge-rollups). No chargeTypes = TajResident.balance (all types).
 */
const utilityDashboardKind = (chType) => {
  const raw = String(chType == null ? '' : chType);
  const t = raw.toUpperCase().replace(/\s+/g, '_');
  if (t.includes('CAM') || t === 'CMC') return 'CAM';
  if (t.includes('WATER') || t === 'WTR') return 'WATER';
  if (t.includes('ELECTRICITY') || t === 'ELC') return 'ELECTRICITY';
  if (raw.toLowerCase() === 'electricity') return 'ELECTRICITY';
  if (raw === 'Water') return 'WATER';
  return null;
};

const lineMatchesDashboardFilters = (chType, selected) => {
  if (!selected || selected.size === 0) return false;
  const buck = classifyChargeLineBucket(chType);
  if (buck === 'rent') return selected.has('RENT');
  if (buck === 'ground') return selected.has('GROUND');
  if (buck === 'other') return selected.has('OTHER');
  if (buck === 'utility') {
    const k = utilityDashboardKind(chType);
    return Boolean(k && selected.has(k));
  }
  return false;
};

const normalizePhoneKey = (raw) => {
  if (raw == null || raw === '') return '';
  const d = String(raw).replace(/\D/g, '');
  if (d.length >= 10) return d.slice(-10);
  return d;
};

router.get('/dashboard-residents-outstanding', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const rawTypes = req.query.chargeTypes;
    const typeList = String(rawTypes || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const allowed = new Set(['CAM', 'WATER', 'ELECTRICITY', 'RENT', 'GROUND', 'OTHER']);
    const selected = new Set(typeList.filter((t) => allowed.has(t)));

    if (selected.size === 0) {
      const query = {
        balance: { $gt: 0 },
        $and: [
          {
            $or: [
              { name: { $exists: true, $ne: null, $ne: '' } },
              { residentId: { $exists: true, $ne: null, $ne: '' } }
            ]
          }
        ]
      };
      const residents = await TajResident.find(query)
        .select('_id residentId name balance properties')
        .populate('properties', 'propertyName plotNumber sector block fullAddress ownerName')
        .sort({ balance: -1 })
        .limit(limit)
        .lean();
      return res.json({ success: true, data: residents });
    }

    const [invoices, allResidents] = await Promise.all([
      PropertyInvoice.find({ status: { $ne: 'Cancelled' }, balance: { $gt: 0.005 } })
        .select('charges grandTotal balance chargeTypes property customerEmail customerPhone')
        .populate({
          path: 'property',
          select: 'propertyName plotNumber sector block fullAddress ownerName resident',
          populate: { path: 'resident', select: '_id residentId name email contactNumber' }
        })
        .lean(),
      TajResident.find({
        $and: [
          {
            $or: [
              { name: { $exists: true, $ne: null, $ne: '' } },
              { residentId: { $exists: true, $ne: null, $ne: '' } }
            ]
          }
        ]
      })
        .select('_id residentId name email contactNumber properties')
        .populate('properties', 'propertyName plotNumber sector block fullAddress ownerName')
        .lean()
    ]);

    const byEmail = new Map();
    const byPhone = new Map();
    const residentById = new Map();
    for (const r of allResidents) {
      residentById.set(r._id.toString(), r);
      if (r.email) byEmail.set(String(r.email).trim().toLowerCase(), r._id.toString());
      const pk = normalizePhoneKey(r.contactNumber);
      if (pk) byPhone.set(pk, r._id.toString());
    }

    const agg = new Map();

    const addBal = (residentKey, amount, propLabel, residentDoc) => {
      if (!residentKey || !(Number(amount) > 0)) return;
      if (!agg.has(residentKey)) {
        agg.set(residentKey, {
          _id: residentDoc?._id || residentKey,
          residentId: residentDoc?.residentId,
          name: residentDoc?.name,
          properties: residentDoc?.properties,
          balance: 0,
          _labels: new Set()
        });
      }
      const row = agg.get(residentKey);
      row.balance += Number(amount) || 0;
      if (propLabel) row._labels.add(propLabel);
    };

    for (const inv of invoices) {
      const grand = Math.max(Number(inv.grandTotal) || 0, 1e-9);
      const invBalance = Number(inv.balance) || 0;
      if (invBalance <= 0) continue;

      let residentDoc = null;
      let residentKey = null;
      const prop = inv.property;
      if (prop) {
        const res = prop.resident;
        if (res && typeof res === 'object' && res._id) {
          residentDoc = res;
          residentKey = res._id.toString();
        } else if (res) {
          residentKey = String(res);
          residentDoc = residentById.get(residentKey) || null;
        }
      }
      if (!residentKey) {
        const em = inv.customerEmail && String(inv.customerEmail).trim().toLowerCase();
        const pk = normalizePhoneKey(inv.customerPhone);
        if (em && byEmail.has(em)) residentKey = byEmail.get(em);
        else if (pk && byPhone.has(pk)) residentKey = byPhone.get(pk);
        if (residentKey) residentDoc = residentById.get(residentKey) || null;
      }

      if (!residentKey) continue;

      const charges = Array.isArray(inv.charges) && inv.charges.length > 0 ? inv.charges : null;
      let allocated = 0;

      if (charges) {
        for (const ch of charges) {
          if (!lineMatchesDashboardFilters(ch.type, selected)) continue;
          const lineGT = Number(ch.total) || (Number(ch.amount) || 0) + (Number(ch.arrears) || 0);
          const share = invBalance * (lineGT / grand);
          allocated += share;
        }
      } else {
        const types = inv.chargeTypes || [];
        for (const t of types) {
          if (lineMatchesDashboardFilters(t, selected)) {
            allocated = invBalance;
            break;
          }
        }
      }

      if (allocated > 0) {
        const p = inv.property;
        const propLabel = p
          ? p.propertyName ||
            p.fullAddress ||
            [p.plotNumber, p.sector, p.block].filter(Boolean).join(' ')
          : '';
        if (!residentDoc) residentDoc = residentById.get(residentKey) || null;
        addBal(residentKey, allocated, propLabel, residentDoc);
      }
    }

    const rows = [...agg.values()]
      .map((row) => {
        const { _labels, ...rest } = row;
        const labels = _labels && _labels.size ? [..._labels] : [];
        let properties = rest.properties;
        if ((!properties || properties.length === 0) && labels.length) {
          properties = labels.map((l) => ({ propertyName: l }));
        }
        return { ...rest, properties, balance: Math.round(rest.balance * 100) / 100 };
      })
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Get invoice by ID
router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const invoice = await PropertyInvoice.findById(req.params.id)
      .populate({
        path: 'property',
        populate: {
          path: 'resident',
          select: 'name accountType contactNumber email residentId'
        }
      })
      .populate('camCharge')
      .populate('waterCharge')
      .populate('electricityBill')
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const invoiceObj = normalizeWaterChargePayload(invoice.toObject());
    res.json({ success: true, data: invoiceObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Get invoices for a property
router.get('/property/:propertyId', authMiddleware, asyncHandler(async (req, res) => {
  try {
    // OPTIMIZATION: Check cache first
    const cacheKey = `${CACHE_KEYS.INVOICES_OVERVIEW}_property_${req.params.propertyId}`;
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('📋 Returning cached invoices for property');
      return res.json(cached);
    }
    
    // OPTIMIZATION: Select only needed fields and use lean
    const invoices = await PropertyInvoice.find({ property: req.params.propertyId })
      .select('_id invoiceNumber invoiceDate periodFrom periodTo dueDate chargeTypes charges subtotal totalArrears grandTotal amountInWords payments totalPaid balance status paymentStatus camCharge waterCharge electricityBill rentPayment property createdAt updatedAt calculationData')
      .populate({
        path: 'property',
        select: 'propertyName plotNumber address ownerName tenantName resident sector areaValue areaUnit meters floor electricityWaterMeterNo',
        populate: {
          path: 'resident',
          select: 'name accountType contactNumber email residentId'
        }
      })
      .populate('camCharge', 'invoiceNumber amount arrears')
      .populate('waterCharge', 'invoiceNumber amount arrears')
      .populate('electricityBill', 'invoiceNumber meterNo prvReading curReading unitsConsumed unitsConsumedForDays iescoSlabs iescoUnitPrice electricityCost fcSurcharge gst electricityDuty fixedCharges totalBill withSurcharge receivedAmount arrears fromDate toDate dueDate month address')
      .populate('payments.recordedBy', 'firstName lastName')
      .sort({ invoiceDate: -1 })
      .lean();

    // OPTIMIZATION: Fetch all transactions for all invoices in one query
    const invoiceIds = invoices.map(inv => inv._id);
    const allTransactions = await TajTransaction.find({
      referenceId: { $in: invoiceIds },
        transactionType: 'bill_payment'
      })
      .select('referenceId amount createdAt bank depositUsages')
      .populate('depositUsages.depositId', 'bank')
      .sort({ createdAt: -1 })
      .lean();
    
    // Group transactions by invoice ID
    const transactionsByInvoice = new Map();
    allTransactions.forEach(txn => {
      const invoiceId = txn.referenceId?.toString();
      if (invoiceId) {
        if (!transactionsByInvoice.has(invoiceId)) {
          transactionsByInvoice.set(invoiceId, []);
        }
        transactionsByInvoice.get(invoiceId).push(txn);
      }
    });

    // Enhance payments with bank information from transactions
    const invoicesWithBankInfo = invoices.map((invoice) => {
      const invoiceObj = { ...invoice };
      
      // Get transactions for this invoice from the pre-fetched map
      const transactions = transactionsByInvoice.get(invoice._id.toString()) || [];
      
      // Match payments to transactions and enhance with bank info
      if (invoiceObj.payments && Array.isArray(invoiceObj.payments)) {
        invoiceObj.payments = invoiceObj.payments.map((payment) => {
          const paymentObj = { ...payment };
          
          // Try to find a matching transaction
          // Match by amount and payment date (within 1 day tolerance)
          const matchingTransaction = transactions.find(txn => {
            const amountMatch = Math.abs(txn.amount - (payment.amount || 0)) < 0.01;
            const dateMatch = payment.paymentDate && 
              Math.abs(new Date(txn.createdAt).getTime() - new Date(payment.paymentDate).getTime()) < 24 * 60 * 60 * 1000;
            return amountMatch && (dateMatch || !payment.paymentDate);
          });
          
          // If payment doesn't have bankName but transaction has bank info, use it
          if (!paymentObj.bankName && matchingTransaction) {
            // First try to get bank from transaction directly
            if (matchingTransaction.bank) {
              paymentObj.bankName = matchingTransaction.bank;
            } 
            // If not, try to get from deposit transactions
            else if (matchingTransaction.depositUsages && Array.isArray(matchingTransaction.depositUsages) && matchingTransaction.depositUsages.length > 0) {
              const firstDeposit = matchingTransaction.depositUsages[0]?.depositId;
              if (firstDeposit && firstDeposit.bank) {
                paymentObj.bankName = firstDeposit.bank;
              }
            }
          }
          
          return paymentObj;
        });
      }
      
      return normalizeWaterChargePayload(invoiceObj);
    });

    const response = { success: true, data: invoicesWithBankInfo };
    
    // OPTIMIZATION: Cache the response
    setCached(cacheKey, response);
    
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Update invoice
router.put('/:id', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const invoice = await PropertyInvoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const { invoiceNumber, invoiceDate, dueDate, periodFrom, periodTo, charges, subtotal, totalArrears, grandTotal, customerName, customerEmail, customerPhone, customerAddress, sector } = req.body;

    // Check for duplicate invoices ONLY if periodTo or periodFrom is being changed to a different month
    const updatedPeriodFrom = periodFrom !== undefined ? (periodFrom ? new Date(periodFrom) : null) : invoice.periodFrom;
    const updatedPeriodTo = periodTo !== undefined ? (periodTo ? new Date(periodTo) : null) : invoice.periodTo;
    const updatedCharges = charges !== undefined ? charges : invoice.charges;
    
    // Only check for duplicates if the period is actually being changed to a different month
    const originalPeriodTo = invoice.periodTo ? dayjs(invoice.periodTo) : null;
    const originalPeriodFrom = invoice.periodFrom ? dayjs(invoice.periodFrom) : null;
    const newPeriodTo = updatedPeriodTo ? dayjs(updatedPeriodTo) : null;
    const newPeriodFrom = updatedPeriodFrom ? dayjs(updatedPeriodFrom) : null;
    
    // Check if period month/year has actually changed
    const periodChanged = (periodTo !== undefined && newPeriodTo && (!originalPeriodTo || 
      newPeriodTo.month() !== originalPeriodTo.month() || newPeriodTo.year() !== originalPeriodTo.year())) ||
      (periodFrom !== undefined && newPeriodFrom && (!originalPeriodFrom || 
      newPeriodFrom.month() !== originalPeriodFrom.month() || newPeriodFrom.year() !== originalPeriodFrom.year()));
    
    if (periodChanged && (updatedPeriodTo || updatedPeriodFrom)) {
      const periodDate = updatedPeriodTo ? dayjs(updatedPeriodTo) : dayjs(updatedPeriodFrom);
      const periodYear = periodDate.year();
      const periodMonth = periodDate.month() + 1;
      const monthStart = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`).startOf('month').toDate();
      const monthEnd = dayjs(`${periodYear}-${String(periodMonth).padStart(2, '0')}-01`).endOf('month').toDate();
      
      // Get unique charge types from charges array
      const chargeTypesArray = [...new Set(updatedCharges.map(c => c.type))];
      
      // Build query to find existing invoice for same month (excluding current invoice)
      const duplicateQuery = {
        _id: { $ne: invoice._id }, // Exclude current invoice
        property: invoice.property,
        $or: [
          { periodTo: { $gte: monthStart, $lte: monthEnd } },
          { periodFrom: { $gte: monthStart, $lte: monthEnd } }
        ],
        chargeTypes: { 
          $all: chargeTypesArray, 
          $size: chargeTypesArray.length 
        }
      };
      
      // For electricity invoices, match by meter number instead of electricityBill._id
      if (chargeTypesArray.includes('ELECTRICITY') && invoice.electricityBill) {
        // Populate electricityBill to get meterNo
        await invoice.populate('electricityBill');
        const meterNo = invoice.electricityBill?.meterNo || '';
        if (meterNo) {
          const existingInvoices = await PropertyInvoice.aggregate([
            {
              $match: {
                _id: { $ne: invoice._id }, // Exclude current invoice
                property: invoice.property,
                $or: [
                  { periodTo: { $gte: monthStart, $lte: monthEnd } },
                  { periodFrom: { $gte: monthStart, $lte: monthEnd } }
                ],
                chargeTypes: { 
                  $all: chargeTypesArray, 
                  $size: chargeTypesArray.length 
                }
              }
            },
            {
              $lookup: {
                from: 'electricities',
                localField: 'electricityBill',
                foreignField: '_id',
                as: 'electricityBillDoc'
              }
            },
            {
              $match: {
                'electricityBillDoc.0.meterNo': meterNo
              }
            }
          ]);
          
          if (existingInvoices && existingInvoices.length > 0) {
            return res.status(400).json({
              success: false,
              message: `An invoice already exists for meter ${meterNo} for ${dayjs(monthStart).format('MMMM YYYY')}. Please edit the existing invoice instead.`,
              data: { existingInvoiceId: existingInvoices[0]._id }
            });
          }
        } else {
          // Fallback: if meterNo is not available, use electricityBill._id
          duplicateQuery.electricityBill = invoice.electricityBill;
        }
      }
      
      // For CAM charges, check for duplicates
      // If camCharge exists, match by camCharge reference
      // If camCharge is null, still check for duplicates by charge type and month
      if (chargeTypesArray.includes('CAM')) {
        if (invoice.camCharge) {
          duplicateQuery.camCharge = invoice.camCharge;
        }
        // If camCharge is null, the chargeTypes filter above already ensures it's a CAM invoice
        // So we'll still catch duplicates for the same property and month
      }

      if (chargeTypesArray.includes('WATER')) {
        if (invoice.waterCharge) {
          duplicateQuery.waterCharge = invoice.waterCharge;
        }
      }
      
      // For RENT charges, match the rentPayment reference if available
      if (chargeTypesArray.includes('RENT') && invoice.rentPayment) {
        duplicateQuery.rentPayment = invoice.rentPayment;
      }
      
      const existingInvoice = await PropertyInvoice.findOne(duplicateQuery);
      if (existingInvoice) {
        return res.status(400).json({
          success: false,
          message: `An invoice already exists for ${dayjs(monthStart).format('MMMM YYYY')}. Please edit the existing invoice instead.`,
          data: { existingInvoiceId: existingInvoice._id }
        });
      }
    }

    // Update invoice fields
    if (invoiceNumber !== undefined) invoice.invoiceNumber = invoiceNumber;
    if (invoiceDate !== undefined) invoice.invoiceDate = invoiceDate ? new Date(invoiceDate) : invoice.invoiceDate;
    if (dueDate !== undefined) invoice.dueDate = dueDate ? new Date(dueDate) : invoice.dueDate;
    if (periodFrom !== undefined) invoice.periodFrom = periodFrom ? new Date(periodFrom) : invoice.periodFrom;
    if (periodTo !== undefined) invoice.periodTo = periodTo ? new Date(periodTo) : invoice.periodTo;
    if (charges !== undefined) {
      invoice.charges = charges;
      // Update chargeTypes based on charges
      invoice.chargeTypes = [...new Set(charges.map(c => c.type))];
    }
    if (subtotal !== undefined) invoice.subtotal = subtotal;
    if (totalArrears !== undefined) invoice.totalArrears = totalArrears;
    if (grandTotal !== undefined) {
      invoice.grandTotal = grandTotal;
      invoice.amountInWords = numberToWords(grandTotal);
    }
    // Update customer fields for open invoices
    if (customerName !== undefined) invoice.customerName = customerName;
    if (customerEmail !== undefined) invoice.customerEmail = customerEmail;
    if (customerPhone !== undefined) invoice.customerPhone = customerPhone;
    if (customerAddress !== undefined) invoice.customerAddress = customerAddress;
    if (sector !== undefined) invoice.sector = sector;

    invoice.updatedBy = req.user.id;
    invoice.updatedAt = new Date();

    await invoice.save();

    // OPTIMIZATION: Invalidate caches on invoice update
    clearCached(CACHE_KEYS.INVOICES_OVERVIEW);
    if (invoice.property) {
      clearCached(`${CACHE_KEYS.INVOICES_OVERVIEW}_property_${invoice.property}`);
    }

    // Populate references
    await invoice.populate({
      path: 'property',
      populate: {
        path: 'resident',
        select: 'name accountType contactNumber email residentId'
      }
    });
    await invoice.populate('camCharge');
    await invoice.populate('waterCharge');
    await invoice.populate('electricityBill');

    const updatedInvoiceObj = normalizeWaterChargePayload(invoice.toObject());

    res.json({
      success: true,
      message: 'Invoice updated successfully',
      data: updatedInvoiceObj
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Get all invoices
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  try {
    // Extract pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    // OPTIMIZATION: Check cache first (only if no filters and default pagination)
    const hasFilters = req.query.propertyId || req.query.status || req.query.paymentStatus || req.query.chargeType || req.query.residentId || req.query.sector || req.query.search || req.query.monthYear || req.query.openInvoices;
    const isDefaultPagination = page === 1 && limit === 50;
    const cacheKey = (hasFilters || !isDefaultPagination) ? null : CACHE_KEYS.INVOICES_OVERVIEW;
    
    if (cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) {
        console.log('📋 Returning cached invoices list');
        return res.json(cached);
      }
    }
    
    const { propertyId, status, paymentStatus, chargeType, residentId, sector, search, monthYear, openInvoices } = req.query;
    const filter = {};
    
    // Filter: openInvoices=true shows only invoices without properties
    // If openInvoices is not set and no propertyId is specified, show ALL invoices (both property-based and open)
    if (openInvoices === 'true') {
      filter.property = null; // Only open invoices (no property)
    } else if (propertyId) {
      // If propertyId is specified, filter by that property
      filter.property = propertyId;
    } else {
      // No filter on property - this will return both property-based and open invoices
      // This allows the Invoices page to show all invoices
    }
    if (status) filter.status = status;
    if (paymentStatus) {
      // Support comma-separated paymentStatus values (e.g., "unpaid,partial_paid")
      if (paymentStatus.includes(',')) {
        const statuses = paymentStatus.split(',').map(s => s.trim()).filter(s => s);
        filter.paymentStatus = { $in: statuses };
      } else {
        filter.paymentStatus = paymentStatus;
      }
    }
    if (chargeType) filter.chargeTypes = { $in: [chargeType] };
    
    // Handle month/year filter
    if (monthYear) {
      // monthYear format: "YYYY-MM" (e.g., "2026-01")
      const [year, month] = monthYear.split('-');
      if (year && month) {
        const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
        
        // Filter by periodTo (billing period end) or invoiceDate if periodTo is not available
        // Use periodTo if it exists, otherwise fall back to invoiceDate
        filter.$or = [
          { 
            periodTo: { 
              $exists: true,
              $gte: startDate, 
              $lte: endDate 
            } 
          },
          { 
            $and: [
              { periodTo: { $exists: false } },
              { invoiceDate: { $gte: startDate, $lte: endDate } }
            ]
          }
        ];
      }
    }

    // Handle search parameter - search across all invoices
    let searchFilter = {};
    let propertyIdsFromSearch = [];
    let residentIdsFromSearch = [];
    
    if (search) {
      const searchPattern = new RegExp(search, 'i');
      const TajProperty = require('../models/tajResidencia/TajProperty');
      const TajResident = require('../models/tajResidencia/TajResident');
      
      // Search by invoice number
      searchFilter.$or = [
        { invoiceNumber: searchPattern }
      ];
      
      // Determine if we should search open invoices
      // Search open invoices when: openInvoices=true, OR when showing all invoices (filter.property is undefined)
      const shouldSearchOpenInvoices = openInvoices === 'true' || filter.property === undefined;
      
      // Determine if we should search property-based invoices
      // Search property-based invoices when: openInvoices is not 'true', AND (filter.property is undefined OR filter.property is set)
      const shouldSearchPropertyInvoices = openInvoices !== 'true' && (filter.property === undefined || filter.property !== null);
      
      // For open invoices, search customer fields
      if (shouldSearchOpenInvoices) {
        searchFilter.$or.push(
          { customerName: searchPattern },
          { customerEmail: searchPattern },
          { customerPhone: searchPattern },
          { customerAddress: searchPattern }
        );
      }
      
      // For property-based invoices, search property and resident fields
      if (shouldSearchPropertyInvoices) {
        // Find properties matching owner name
        const matchingProperties = await TajProperty.find({
          ownerName: searchPattern
        }).select('_id').lean();
        propertyIdsFromSearch = matchingProperties.map(p => p._id);
        
        // Find residents matching name, residentId, or CNIC
        const matchingResidents = await TajResident.find({
          $or: [
            { name: searchPattern },
            { residentId: searchPattern },
            { cnic: searchPattern }
          ]
        }).select('_id').lean();
        residentIdsFromSearch = matchingResidents.map(r => r._id);
        
        // Find properties for matching residents
        if (residentIdsFromSearch.length > 0) {
          const propertiesForResidents = await TajProperty.find({
            resident: { $in: residentIdsFromSearch }
          }).select('_id').lean();
          const propertyIdsFromResidents = propertiesForResidents.map(p => p._id);
          propertyIdsFromSearch = [...new Set([...propertyIdsFromSearch, ...propertyIdsFromResidents])];
        }
        
        // Add property IDs to search filter
        if (propertyIdsFromSearch.length > 0) {
          searchFilter.$or.push({ property: { $in: propertyIdsFromSearch } });
        }
      }
    }

    // Combine filters
    const combinedFilter = { ...filter, ...searchFilter };

    // Get total count for pagination (before applying resident/sector filters and in-memory filtering)
    let total = await PropertyInvoice.countDocuments(combinedFilter);

    // OPTIMIZATION: Select only needed fields and use lean with pagination
    // Fetch all matching invoices first (for search across all pages)
    let invoices = await PropertyInvoice.find(combinedFilter)
      // Include payments (amount + paymentDate) so frontend can apply
      // "due date + grace period" logic correctly when deciding whether
      // to use Payable vs Payable After Due Date for each invoice.
      .select('_id invoiceNumber invoiceDate periodFrom periodTo dueDate chargeTypes charges subtotal totalArrears grandTotal totalPaid balance status paymentStatus payments amountInWords property createdBy customerName customerEmail customerPhone customerAddress sector')
      .populate({
        path: 'property',
        select: 'propertyName plotNumber address ownerName resident sector areaValue areaUnit',
        populate: {
          path: 'resident',
          select: 'name accountType _id residentId cnic'
        }
      })
      .populate('createdBy', 'firstName lastName')
      .sort({ invoiceDate: -1 })
      .lean();
    
    // Additional filtering for property-based invoices search (to ensure we catch all matches)
    // For open invoices, search is already done at database level
    // This in-memory filter is mainly for property-based invoices when filtering by propertyId
    if (search && openInvoices !== 'true' && filter.property !== null && filter.property !== undefined) {
      const searchLower = search.toLowerCase();
      invoices = invoices.filter(invoice => {
        // Search invoice number (already handled in DB query, but double-check)
        if (invoice.invoiceNumber?.toLowerCase().includes(searchLower)) return true;
        
        // For property-based invoices, search property/resident fields
        if (invoice.property) {
          // Search property owner name
          if (invoice.property?.ownerName?.toLowerCase().includes(searchLower)) return true;
          
          // Search resident name
          if (invoice.property?.resident?.name?.toLowerCase().includes(searchLower)) return true;
          
          // Search resident ID (check both string and number formats)
          const residentId = invoice.property?.resident?.residentId;
          if (residentId) {
            const residentIdStr = String(residentId).toLowerCase();
            if (residentIdStr.includes(searchLower)) return true;
          }
          
          // Search CNIC
          if (invoice.property?.resident?.cnic?.toLowerCase().includes(searchLower)) return true;
        }
        
        return false;
      });
      
      // Update total count after search filtering
      total = invoices.length;
    }
    
    // Apply resident filter if provided
    if (residentId) {
      invoices = invoices.filter(invoice => {
        const propertyResident = invoice.property?.resident;
        if (!propertyResident) return false;
        const residentIdValue = typeof propertyResident === 'object' && propertyResident !== null
          ? (propertyResident._id || propertyResident.id || propertyResident)
          : propertyResident;
        return String(residentIdValue) === String(residentId);
      });
    }
    
    // Apply sector filter if provided (only for property-based invoices)
    if (sector && openInvoices !== 'true') {
      invoices = invoices.filter(invoice => {
        const propertySector = invoice.property?.sector;
        if (!propertySector) return false;
        const sectorValue = typeof propertySector === 'object' && propertySector !== null
          ? (propertySector.name || propertySector.sectorName || String(propertySector))
          : String(propertySector);
        return sectorValue.toLowerCase() === String(sector).toLowerCase();
      });
    }
    
    // Get total count after all filters (search, resident, sector)
    // Update total if we did in-memory filtering
    if (search && openInvoices !== 'true' && filter.property !== null && filter.property !== undefined) {
      // Property-based invoices: search was done in-memory, update total
      total = invoices.length;
    } else if (residentId || (sector && openInvoices !== 'true')) {
      // Resident or sector filters are applied in-memory, update total
      total = invoices.length;
    }
    // For open invoices with DB-level search, total from countDocuments is already correct
    
    // Apply pagination after all filtering
    invoices = invoices.slice(skip, skip + limit);

    const totalPages = Math.ceil(total / limit);
    const response = { 
      success: true, 
      data: invoices,
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
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Delete payment from invoice
router.delete('/:invoiceId/payments/:paymentId', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const invoice = await PropertyInvoice.findById(req.params.invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const paymentIndex = invoice.payments.findIndex(
      p => p._id.toString() === req.params.paymentId
    );

    if (paymentIndex === -1) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Remove payment from array
    invoice.payments.splice(paymentIndex, 1);

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

    // OPTIMIZATION: Invalidate caches on payment deletion
    clearCached(CACHE_KEYS.INVOICES_OVERVIEW);
    if (invoice.property) {
      clearCached(`${CACHE_KEYS.INVOICES_OVERVIEW}_property_${invoice.property}`);
    }

    res.json({
      success: true,
      message: 'Payment deleted successfully',
      data: invoice
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

// Delete invoice
router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const invoice = await PropertyInvoice.findById(req.params.id).populate('electricityBill').populate('property', 'resident');
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const propertyId = invoice.property?.toString() || invoice.property;
    
    // Find all payment transactions linked to this invoice
    const TajResident = require('../models/tajResidencia/TajResident');
    
    const paymentTransactions = await TajTransaction.find({
      transactionType: 'bill_payment',
      referenceId: invoice._id
    }).populate('resident').populate('depositUsages.depositId');

    // Reverse deposit usages for each payment transaction
    if (paymentTransactions.length > 0) {
      // Group reversals by resident to update balances correctly
      const residentReversals = {};
      
      for (const paymentTxn of paymentTransactions) {
        if (paymentTxn.depositUsages && Array.isArray(paymentTxn.depositUsages) && paymentTxn.depositUsages.length > 0) {
          const residentId = paymentTxn.resident._id?.toString() || paymentTxn.resident.toString();
          
          if (!residentReversals[residentId]) {
            residentReversals[residentId] = {
              resident: paymentTxn.resident,
              totalAmount: 0,
              reversals: []
            };
          }
          
          // Create reversal transactions for each deposit usage
          for (const depositUsage of paymentTxn.depositUsages) {
            const depositId = depositUsage.depositId?._id || depositUsage.depositId;
            const reversalAmount = depositUsage.amount || 0;
            
            if (reversalAmount > 0 && depositId) {
              // Get the deposit transaction to get its details
              const depositTxn = await TajTransaction.findById(depositId);
              if (depositTxn) {
                residentReversals[residentId].reversals.push({
                  depositTxn,
                  reversalAmount,
                  paymentTxnId: paymentTxn._id
                });
                residentReversals[residentId].totalAmount += reversalAmount;
              }
            }
          }
        }
      }
      
      // Process reversals for each resident
      for (const residentId in residentReversals) {
        const reversalData = residentReversals[residentId];
        const resident = await TajResident.findById(residentId);
        
        if (!resident) continue;
        
        let currentBalance = resident.balance || 0;
        const balanceBefore = currentBalance;
        
        // Create reversal transactions (one per deposit usage)
        for (const reversal of reversalData.reversals) {
          const balanceAfter = currentBalance + reversal.reversalAmount;
          
          const reversalTransaction = new TajTransaction({
            resident: resident._id,
            transactionType: 'deposit',
            amount: reversal.reversalAmount,
            balanceBefore: currentBalance,
            balanceAfter: balanceAfter,
            description: `Reversal: Invoice ${invoice.invoiceNumber || invoice._id} deleted - Deposit restored`,
            paymentMethod: reversal.depositTxn.paymentMethod || 'Bank Transfer',
            bank: reversal.depositTxn.bank || null,
            referenceNumberExternal: `REV-${reversal.paymentTxnId}`,
            createdBy: req.user.id
          });
          
          await reversalTransaction.save();
          currentBalance = balanceAfter; // Update for next reversal
        }
        
        // Update resident balance (add back the total reversed amount)
        if (reversalData.totalAmount > 0) {
          resident.balance = balanceBefore + reversalData.totalAmount;
          resident.updatedBy = req.user.id;
          await resident.save();
        }
      }
      
      // Delete all payment transactions linked to this invoice
      await TajTransaction.deleteMany({
        transactionType: 'bill_payment',
        referenceId: invoice._id
      });
    }
    
    // If invoice has ELECTRICITY charge type and references an electricity bill, delete it
    if (invoice.chargeTypes?.includes('ELECTRICITY') && invoice.electricityBill) {
      const electricityBillId = invoice.electricityBill._id || invoice.electricityBill;
      await Electricity.findByIdAndDelete(electricityBillId);
      
      // Invalidate electricity overview cache
      clearCached(CACHE_KEYS.ELECTRICITY_OVERVIEW);
    }
    
    await PropertyInvoice.findByIdAndDelete(req.params.id);

    // OPTIMIZATION: Invalidate caches on invoice deletion
    clearCached(CACHE_KEYS.INVOICES_OVERVIEW);
    if (propertyId) {
      clearCached(`${CACHE_KEYS.INVOICES_OVERVIEW}_property_${propertyId}`);
    }

    res.json({
      success: true,
      message: `Invoice deleted successfully${paymentTransactions.length > 0 ? `. ${paymentTransactions.length} payment(s) reversed and deposits restored.` : ''}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}));

module.exports = router;

