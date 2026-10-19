const express = require('express');
const router = express.Router();
const Loan = require('../models/hr/Loan');
const { assertPauseAllowed } = require('../utils/loanPauseSchedule');
const Employee = require('../models/hr/Employee');
const { authMiddleware } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');

const EMPLOYEE_DETAIL_POPULATE = {
  path: 'employee',
  select: 'employeeId firstName lastName email phone department position placementDepartment placementDesignation',
  populate: [
    { path: 'department', select: 'name code' },
    { path: 'placementDepartment', select: 'name code' },
    { path: 'position', select: 'title' },
    { path: 'placementDesignation', select: 'title' }
  ]
};

// Get all loans with pagination and filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      loanType,
      employeeId,
      startDate,
      endDate,
      search
    } = req.query;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (loanType) query.loanType = loanType;
    if (employeeId) query.employee = employeeId;

    // Date range filter
    if (startDate || endDate) {
      query.applicationDate = {};
      if (startDate) query.applicationDate.$gte = new Date(startDate);
      if (endDate) query.applicationDate.$lte = new Date(endDate);
    }

    // Search filter
    if (search) {
      const trimmed = search.trim();
      const matchingEmployees = await Employee.find({
        $or: [
          { firstName: { $regex: trimmed, $options: 'i' } },
          { lastName: { $regex: trimmed, $options: 'i' } },
          { employeeId: { $regex: trimmed, $options: 'i' } }
        ]
      }).select('_id');

      const empIds = matchingEmployees.map(e => e._id);

      query.$or = [
        { purpose: { $regex: trimmed, $options: 'i' } },
        { loanNumber: { $regex: trimmed, $options: 'i' } },
        { 'guarantor.name': { $regex: trimmed, $options: 'i' } },
        { employee: { $in: empIds } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      populate: [
        { path: 'employee', select: 'employeeId firstName lastName email department designation' },
        { path: 'approvedBy', select: 'firstName lastName' },
        { path: 'disbursedBy', select: 'firstName lastName' }
      ],
      sort: { createdAt: -1, applicationDate: -1 }
    };

    const loans = await Loan.paginate(query, options);

    // Ensure virtual fields are included
    const loansWithVirtuals = loans.docs.map(loan => {
      const loanObj = loan.toObject();
      loanObj.progressPercentage = loan.progressPercentage;
      loanObj.remainingInstallments = loan.remainingInstallments;
      loanObj.nextDueDate = loan.nextDueDate;
      return loanObj;
    });

    res.json({
      ...loans,
      docs: loansWithVirtuals
    });
  } catch (error) {
    console.error('Error fetching loans:', error);
    res.status(500).json({ message: 'Error fetching loans', error: error.message });
  }
});

// Get loan statistics - MUST BE BEFORE /:id route
router.get('/stats/overview', authMiddleware, async (req, res) => {
  try {
    const stats = await Loan.getLoanStatistics();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching loan statistics:', error);
    res.status(500).json({ message: 'Error fetching loan statistics', error: error.message });
  }
});

// Get employee loans - MUST BE BEFORE /:id route
router.get('/employee/:employeeId', authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.params;

    // First try to find employee by employeeId (string like "06386")
    let employee = await Employee.findOne({ employeeId: employeeId });

    if (!employee) {
      // If not found by employeeId, try by MongoDB ObjectId
      employee = await Employee.findById(employeeId);
    }

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Now find loans using the employee's MongoDB ObjectId
    const loans = await Loan.find({ employee: employee._id })
      .populate('employee', 'employeeId firstName lastName email')
      .sort({ applicationDate: -1 });

    res.json(loans);
  } catch (error) {
    console.error('Error fetching employee loans:', error);
    res.status(500).json({ message: 'Error fetching employee loans', error: error.message });
  }
});

// Get loan by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id)
      .populate(EMPLOYEE_DETAIL_POPULATE)
      .populate('approvedBy', 'firstName lastName')
      .populate('disbursedBy', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Include virtual fields
    const loanWithVirtuals = loan.toObject();
    loanWithVirtuals.progressPercentage = loan.progressPercentage;
    loanWithVirtuals.remainingInstallments = loan.remainingInstallments;
    loanWithVirtuals.nextDueDate = loan.nextDueDate;

    res.json(loanWithVirtuals);
  } catch (error) {
    console.error('Error fetching loan:', error);
    res.status(500).json({ message: 'Error fetching loan', error: error.message });
  }
});

// Create new loan application
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      employee,
      loanType,
      loanAmount,
      interestRate,
      loanTerm,
      purpose,
      collateral,
      collateralValue,
      guarantor,
      salaryDeduction,
      documents,
      monthlyInstallment: requestedEmi,
      emiManuallyAdjusted,
      isOngoingLoan,
      loanStartDate,
      installmentsAlreadyPaid
    } = req.body;

    // Validate employee exists
    const employeeExists = await Employee.findById(employee);
    if (!employeeExists) {
      return res.status(400).json({ message: 'Employee not found' });
    }

    const ongoing = Boolean(isOngoingLoan);

    if (ongoing && !loanStartDate) {
      return res.status(400).json({ message: 'Loan start date is required for ongoing loans' });
    }

    const paidEmiCount = Math.max(0, parseInt(installmentsAlreadyPaid, 10) || 0);
    if (ongoing && paidEmiCount < 0) {
      return res.status(400).json({ message: 'EMIs already paid must be 0 or greater' });
    }

    // Check if employee has any active loans (skip for ongoing import)
    if (!ongoing) {
      const activeLoans = await Loan.find({
        employee,
        status: { $in: ['Active', 'Disbursed'] }
      });

      if (activeLoans.length > 0) {
        return res.status(400).json({
          message: 'Employee has active loans. Cannot apply for new loan until existing loans are completed.'
        });
      }
    }

    // Calculate required fields before creating loan
    const principal = parseFloat(loanAmount);
    const annualRate = parseFloat(interestRate) || 0;
    const rate = annualRate / 100 / 12; // Monthly interest rate
    const time = parseInt(loanTerm, 10);
    const manualEmi = parseFloat(requestedEmi);
    const useManualEmi = Boolean(emiManuallyAdjusted) && Number.isFinite(manualEmi) && manualEmi > 0;

    let monthlyInstallment;
    if (useManualEmi) {
      monthlyInstallment = manualEmi;
    } else if (rate === 0) {
      monthlyInstallment = principal / time;
    } else {
      monthlyInstallment = principal * (rate * Math.pow(1 + rate, time)) / (Math.pow(1 + rate, time) - 1);
    }

    const startDate = ongoing ? new Date(loanStartDate) : undefined;

    if (ongoing && paidEmiCount > time) {
      return res.status(400).json({
        message: `EMIs already paid cannot exceed loan term (${time} months)`
      });
    }

    // Create loan object with calculated fields (schedule sets totalPayable with last-installment balance)
    const loanData = {
      employee,
      loanType,
      loanAmount,
      interestRate: annualRate,
      loanTerm: time,
      monthlyInstallment,
      totalPayable: monthlyInstallment * time,
      outstandingBalance: monthlyInstallment * time,
      emiManuallyAdjusted: useManualEmi,
      isOngoingLoan: ongoing,
      loanStartDate: startDate,
      installmentsAlreadyPaid: ongoing ? paidEmiCount : 0,
      amountAlreadyPaid: 0,
      purpose,
      collateral,
      collateralValue,
      guarantor,
      salaryDeduction,
      documents,
      createdBy: req.user.id
    };

    if (ongoing) {
      loanData.applicationDate = startDate;
      loanData.approvalDate = startDate;
      loanData.disbursementDate = startDate;
      loanData.approvedBy = req.user.id;
      loanData.disbursedBy = req.user.id;
      loanData.status = 'Active';
    }

    const loan = new Loan(loanData);

    // Generate loan schedule (balances last installment)
    loan.generateLoanSchedule();

    // If schedule could not clear principal, reject
    const lastRow = loan.loanSchedule?.[loan.loanSchedule.length - 1];
    if (lastRow && Number(lastRow.balance) > 0.01) {
      return res.status(400).json({
        message: 'Monthly EMI is too low to clear this loan in the selected months. Increase EMI or months.'
      });
    }
    if (lastRow && Number(lastRow.amount) <= 0) {
      return res.status(400).json({
        message: 'Monthly EMI is too high for this loan amount and term. Reduce EMI.'
      });
    }

    if (ongoing) {
      loan.applyPriorInstallments(paidEmiCount);
    }

    await loan.save();

    // Populate employee details for response
    await loan.populate('employee', 'employeeId firstName lastName email');

    res.status(201).json({
      message: ongoing
        ? 'Ongoing loan imported successfully'
        : 'Loan application submitted successfully',
      loan
    });
  } catch (error) {
    console.error('Error creating loan:', error);
    res.status(500).json({ message: 'Error creating loan', error: error.message });
  }
});

// Update loan application
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Only allow updates if loan is pending
    if (loan.status !== 'Pending') {
      return res.status(400).json({
        message: 'Cannot update loan application after it has been processed'
      });
    }

    const updateData = {
      ...req.body,
      updatedBy: req.user.id
    };

    // Remove fields that shouldn't be updated
    delete updateData.status;
    delete updateData.approvalDate;
    delete updateData.disbursementDate;
    delete updateData.approvedBy;
    delete updateData.disbursedBy;
    delete updateData.createdBy;
    delete updateData.loanSchedule;

    const manualEmi =
      Boolean(updateData.emiManuallyAdjusted) && Number(updateData.monthlyInstallment) > 0;

    // Assign then save so pre-save + schedule regeneration run
    const editable = [
      'employee', 'loanType', 'loanAmount', 'interestRate', 'loanTerm',
      'purpose', 'collateral', 'collateralValue', 'guarantor', 'salaryDeduction',
      'documents', 'updatedBy'
    ];
    editable.forEach((k) => {
      if (updateData[k] !== undefined) loan[k] = updateData[k];
    });

    if (manualEmi) {
      loan.monthlyInstallment = Math.round(Number(updateData.monthlyInstallment) * 100) / 100;
      loan.emiManuallyAdjusted = true;
    } else if (updateData.emiManuallyAdjusted === false) {
      loan.emiManuallyAdjusted = false;
    }

    loan.generateLoanSchedule();

    const lastRow = loan.loanSchedule?.[loan.loanSchedule.length - 1];
    if (lastRow && Number(lastRow.balance) > 0.5) {
      return res.status(400).json({
        message: 'Monthly EMI is too low to clear this loan in the selected months. Increase EMI or months.'
      });
    }
    if (lastRow && Number(lastRow.amount) <= 0) {
      return res.status(400).json({
        message: 'Monthly EMI is too high for this loan amount and term. Reduce EMI.'
      });
    }

    await loan.save();
    await loan.populate('employee', 'employeeId firstName lastName email');

    res.json({
      message: 'Loan application updated successfully',
      loan
    });
  } catch (error) {
    console.error('Error updating loan:', error);
    res.status(500).json({ message: 'Error updating loan', error: error.message });
  }
});

// Approve loan
router.patch('/:id/approve', authMiddleware, checkPermission('hr.loan.approve'), async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (loan.status !== 'Pending') {
      return res.status(400).json({
        message: 'Loan can only be approved if it is in pending status'
      });
    }

    loan.status = 'Approved';
    loan.approvalDate = new Date();
    loan.approvedBy = req.user.id;
    loan.updatedBy = req.user.id;

    if (rejectionReason) {
      loan.rejectionReason = rejectionReason;
    }

    await loan.save();

    await loan.populate([
      { path: 'employee', select: 'employeeId firstName lastName email' },
      { path: 'approvedBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Loan approved successfully',
      loan
    });
  } catch (error) {
    console.error('Error approving loan:', error);
    res.status(500).json({ message: 'Error approving loan', error: error.message });
  }
});

// Reject loan
router.patch('/:id/reject', authMiddleware, checkPermission('hr.loan.approve'), async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (loan.status !== 'Pending') {
      return res.status(400).json({
        message: 'Loan can only be rejected if it is in pending status'
      });
    }

    loan.status = 'Rejected';
    loan.rejectionReason = rejectionReason;
    loan.updatedBy = req.user.id;

    await loan.save();

    await loan.populate([
      { path: 'employee', select: 'employeeId firstName lastName email' },
      { path: 'approvedBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Loan rejected successfully',
      loan
    });
  } catch (error) {
    console.error('Error rejecting loan:', error);
    res.status(500).json({ message: 'Error rejecting loan', error: error.message });
  }
});

// Disburse loan
router.patch('/:id/disburse', authMiddleware, checkPermission('hr.loan.disburse'), async (req, res) => {
  try {
    const { disbursementMethod, bankAccount } = req.body;

    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (loan.status !== 'Approved') {
      return res.status(400).json({
        message: 'Loan can only be disbursed if it is approved'
      });
    }

    loan.status = 'Disbursed';
    loan.disbursementDate = new Date();
    loan.disbursedBy = req.user.id;
    loan.disbursementMethod = disbursementMethod;
    loan.bankAccount = bankAccount;
    loan.updatedBy = req.user.id;

    await loan.save();

    await loan.populate([
      { path: 'employee', select: 'employeeId firstName lastName email' },
      { path: 'disbursedBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Loan disbursed successfully',
      loan
    });
  } catch (error) {
    console.error('Error disbursing loan:', error);
    res.status(500).json({ message: 'Error disbursing loan', error: error.message });
  }
});

// Process loan payment
router.patch('/:id/payment', authMiddleware, async (req, res) => {
  try {
    const { amount, paymentMethod } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid payment amount is required' });
    }

    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (!['Active', 'Disbursed'].includes(loan.status)) {
      return res.status(400).json({
        message: 'Payment can only be processed for active or disbursed loans'
      });
    }

    const paymentResult = loan.processPayment(amount, paymentMethod);
    loan.updatedBy = req.user.id;

    await loan.save();

    await loan.populate('employee', 'employeeId firstName lastName email');

    res.json({
      message: 'Payment processed successfully',
      paymentResult,
      loan
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ message: 'Error processing payment', error: error.message });
  }
});

/** Build list of { month, year } from start + count (consecutive calendar months). */
const buildConsecutivePauseMonths = (startMonth, startYear, monthCount) => {
  const result = [];
  let m = Number(startMonth);
  let y = Number(startYear);
  const count = Math.min(Math.max(1, Number(monthCount) || 1), 36);

  for (let i = 0; i < count; i++) {
    result.push({ month: m, year: y });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
};

// Pause loan deduction for one or more consecutive months
router.patch('/:id/pause-months', authMiddleware, async (req, res) => {
  try {
    const { startMonth, startYear, monthCount = 1, months: explicitMonths, reason } = req.body;

    let toPause = [];
    if (Array.isArray(explicitMonths) && explicitMonths.length > 0) {
      toPause = explicitMonths.map((entry) => ({
        month: Number(entry.month),
        year: Number(entry.year)
      }));
    } else if (startMonth && startYear) {
      toPause = buildConsecutivePauseMonths(startMonth, startYear, monthCount);
    } else {
      return res.status(400).json({
        message: 'Provide startMonth + startYear + monthCount, or a months array'
      });
    }

    const invalid = toPause.find((p) => !p.month || !p.year || p.month < 1 || p.month > 12);
    if (invalid) {
      return res.status(400).json({ message: 'Each entry needs a valid month (1–12) and year' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    if (!['Approved', 'Active', 'Disbursed'].includes(loan.status)) {
      return res.status(400).json({ message: 'Can only pause approved, active, or disbursed loans' });
    }

    const added = [];
    const skipped = [];

    for (const { month, year } of toPause) {
      const exists = loan.pausedMonths.some((p) => p.month === month && p.year === year);
      if (exists) {
        skipped.push({ month, year, reason: 'Already paused' });
        continue;
      }
      try {
        assertPauseAllowed(loan, month, year);
      } catch (pauseError) {
        skipped.push({ month, year, reason: pauseError.message });
        continue;
      }
      loan.pausedMonths.push({
        month,
        year,
        reason: reason || '',
        pausedBy: req.user.id,
        pausedAt: new Date()
      });
      added.push({ month, year });
    }

    if (added.length === 0) {
      return res.status(400).json({
        message: 'No months could be paused',
        skipped
      });
    }

    const scheduleResult = loan.reconcileScheduleWithPauses();
    loan.updatedBy = req.user.id;
    await loan.save();

    res.json({
      message: `Loan paused for ${added.length} month(s). Schedule extended — ${scheduleResult.totalInstallments} total installment(s).`,
      added,
      skipped,
      scheduleResult,
      loan
    });
  } catch (error) {
    console.error('Error pausing loan months:', error);
    res.status(500).json({ message: 'Error pausing loan months', error: error.message });
  }
});

// Pause loan deduction for a specific month
router.patch('/:id/pause-month', authMiddleware, async (req, res) => {
  try {
    const { month, year, reason } = req.body;

    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ message: 'Valid month (1–12) and year are required' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    if (!['Approved', 'Active', 'Disbursed'].includes(loan.status)) {
      return res.status(400).json({ message: 'Can only pause approved, active, or disbursed loans' });
    }

    // Prevent duplicate
    const alreadyPaused = loan.pausedMonths.some(
      (p) => p.month === Number(month) && p.year === Number(year)
    );
    if (alreadyPaused) {
      return res.status(400).json({ message: `Loan is already paused for ${month}/${year}` });
    }

    try {
      assertPauseAllowed(loan, Number(month), Number(year));
    } catch (pauseError) {
      return res.status(400).json({ message: pauseError.message });
    }

    loan.pausedMonths.push({
      month: Number(month),
      year: Number(year),
      reason: reason || '',
      pausedBy: req.user.id,
      pausedAt: new Date()
    });

    const scheduleResult = loan.reconcileScheduleWithPauses();
    loan.updatedBy = req.user.id;
    await loan.save();

    res.json({
      message: `Loan paused for ${month}/${year}. Schedule extended with ${scheduleResult.totalInstallments} total installment(s).`,
      scheduleResult,
      loan
    });
  } catch (error) {
    console.error('Error pausing loan month:', error);
    res.status(500).json({ message: 'Error pausing loan month', error: error.message });
  }
});

// Resume loan (remove pause for a specific month)
router.patch('/:id/resume-month', authMiddleware, async (req, res) => {
  try {
    const { month, year } = req.body;

    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    const before = loan.pausedMonths.length;
    loan.pausedMonths = loan.pausedMonths.filter(
      (p) => !(p.month === Number(month) && p.year === Number(year))
    );

    if (loan.pausedMonths.length === before) {
      return res.status(400).json({ message: `Loan was not paused for ${month}/${year}` });
    }

    const scheduleResult = loan.reconcileScheduleWithPauses();
    loan.updatedBy = req.user.id;
    await loan.save();

    res.json({
      message: `Loan resumed for ${month}/${year}. Schedule updated — ${scheduleResult.totalInstallments} installment(s) remaining.`,
      scheduleResult,
      loan
    });
  } catch (error) {
    console.error('Error resuming loan month:', error);
    res.status(500).json({ message: 'Error resuming loan month', error: error.message });
  }
});

// Adjust installment amount (permanent change to monthlyInstallment with reason log)
router.patch('/:id/adjust-installment', authMiddleware, async (req, res) => {
  try {
    const { newAmount, reason } = req.body;

    if (newAmount == null || Number(newAmount) < 0) {
      return res.status(400).json({ message: 'Valid new installment amount is required' });
    }

    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: 'Loan not found' });

    if (!['Approved', 'Active', 'Disbursed'].includes(loan.status)) {
      return res.status(400).json({ message: 'Can only adjust installment of approved, active, or disbursed loans' });
    }

    const oldAmount = loan.monthlyInstallment;
    let recalcResult;

    try {
      recalcResult = loan.recalculateScheduleFromNewEmi(Number(newAmount));
    } catch (recalcError) {
      return res.status(400).json({ message: recalcError.message });
    }

    loan.updatedBy = req.user.id;
    loan.notes.push({
      content: `EMI adjusted from Rs ${Math.round(oldAmount).toLocaleString()} to Rs ${Math.round(newAmount).toLocaleString()}. Remaining installments: ${recalcResult.remainingMonths} (total term ${recalcResult.newTerm} months).${reason ? ` Reason: ${reason}` : ''}`,
      addedBy: req.user.id,
      addedAt: new Date()
    });

    await loan.save();

    res.json({
      message: `EMI updated to Rs ${Number(newAmount).toLocaleString()}. Schedule recalculated with ${recalcResult.remainingMonths} remaining installment(s).`,
      previousAmount: oldAmount,
      newAmount: Number(newAmount),
      recalcResult,
      loan
    });
  } catch (error) {
    console.error('Error adjusting installment:', error);
    res.status(500).json({ message: 'Error adjusting installment', error: error.message });
  }
});

// Add note to loan
router.post('/:id/notes', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ message: 'Note content is required' });
    }

    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    loan.notes.push({
      content: content.trim(),
      addedBy: req.user.id
    });

    loan.updatedBy = req.user.id;
    await loan.save();

    await loan.populate([
      { path: 'employee', select: 'employeeId firstName lastName email' },
      { path: 'notes.addedBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Note added successfully',
      loan
    });
  } catch (error) {
    console.error('Error adding note:', error);
    res.status(500).json({ message: 'Error adding note', error: error.message });
  }
});

// Get loan schedule
router.get('/:id/schedule', authMiddleware, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id)
      .populate('employee', 'employeeId firstName lastName email');

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    res.json({
      loan: {
        _id: loan._id,
        employee: loan.employee,
        loanAmount: loan.loanAmount,
        monthlyInstallment: loan.monthlyInstallment,
        totalPayable: loan.totalPayable,
        totalPaid: loan.totalPaid,
        outstandingBalance: loan.outstandingBalance,
        progressPercentage: loan.progressPercentage
      },
      schedule: loan.loanSchedule
    });
  } catch (error) {
    console.error('Error fetching loan schedule:', error);
    res.status(500).json({ message: 'Error fetching loan schedule', error: error.message });
  }
});

// Delete loan (Pending for normal users; developer may delete at any status)
router.delete('/:id', authMiddleware, checkPermission('loan_management'), async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    const isDeveloper =
      req.user?.role === 'developer' ||
      (Array.isArray(req.user?.roles) && req.user.roles.includes('developer'));

    if (loan.status !== 'Pending' && !isDeveloper) {
      return res.status(400).json({
        message: 'Only pending loans can be deleted'
      });
    }

    await Loan.findByIdAndDelete(req.params.id);

    res.json({
      message: isDeveloper && loan.status !== 'Pending'
        ? `Loan deleted successfully (developer override, was ${loan.status})`
        : 'Loan deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting loan:', error);
    res.status(500).json({ message: 'Error deleting loan', error: error.message });
  }
});

module.exports = router; 