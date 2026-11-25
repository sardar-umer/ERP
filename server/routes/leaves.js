const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize, authMiddleware } = require('../middleware/auth');
const LeaveRequest = require('../models/hr/LeaveRequest');
const LeaveType = require('../models/hr/LeaveType');
const LeavePolicy = require('../models/hr/LeavePolicy');
const Employee = require('../models/hr/Employee');
const LeaveBalance = require('../models/hr/LeaveBalance');
const LeaveManagementService = require('../services/leaveManagementService');
const LeaveIntegrationService = require('../services/leaveIntegrationService');
const CarryForwardService = require('../services/carryForwardService');
const AnniversaryLeaveScheduler = require('../services/anniversaryLeaveScheduler');
const {
  notifyApprovalAssigned,
  notifyDocumentOutcome,
  getActiveUserIdsByRoles
} = require('../utils/approvalNotify');

const LEAVE_URL = '/hr/leaves';
const fmtLeaveDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * Leave notifications (fire-and-forget):
 *  - submitted → HR approvers (minus whoever entered it)
 *  - approved / rejected / cancelled → whoever entered it + the employee's own login, with remarks
 */
const notifyLeaveEvent = (leaveId, actor, event) => {
  (async () => {
    const leave = await LeaveRequest.findById(leaveId)
      .populate('employee', 'firstName lastName employeeId user')
      .populate('leaveType', 'name')
      .lean();
    if (!leave) return;
    const empName = [leave.employee?.firstName, leave.employee?.lastName].filter(Boolean).join(' ') || 'an employee';
    const typeName = leave.leaveType?.name || 'Leave';
    const days = leave.totalDays ? `${leave.totalDays} day${leave.totalDays === 1 ? '' : 's'}` : '';
    const range = `${fmtLeaveDate(leave.startDate)}${leave.endDate && String(leave.endDate) !== String(leave.startDate) ? ` – ${fmtLeaveDate(leave.endDate)}` : ''}`;
    const summary = [typeName, days && `(${days})`, range && `from ${range}`].filter(Boolean).join(' ');
    const base = {
      actor,
      docType: 'Leave request',
      url: LEAVE_URL,
      module: 'hr',
      entityId: leave._id,
      entityType: 'LeaveRequest'
    };

    if (event === 'submitted') {
      const hrIds = await getActiveUserIdsByRoles(['hr_manager']);
      await notifyApprovalAssigned({
        ...base,
        recipientIds: hrIds,
        external: false,
        url: '/hr/leaves/approval',
        title: `Leave request from ${empName}`,
        message: `${summary}.${leave.reason ? ` Reason: ${String(leave.reason).slice(0, 160)}` : ''} Awaiting approval.`
      });
      return;
    }

    const recipients = [leave.createdBy, leave.employee?.user];
    const remarks = event === 'approved' ? leave.approvalComments
      : event === 'rejected' ? leave.rejectionReason
        : leave.cancellationReason;
    await notifyDocumentOutcome({
      ...base,
      recipientIds: recipients,
      outcome: event,
      remarks,
      title: `Leave ${event} — ${empName}`,
      message: [`${summary}.`, remarks ? `Remarks: ${String(remarks).slice(0, 300)}` : '']
        .filter(Boolean).join(' ')
    });
  })().catch((err) => console.warn('[Leaves] notification failed:', err.message));
};
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'leave-documents');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'leave-doc-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and documents are allowed'));
    }
  }
});

// ==================== LEAVE TYPES ROUTES ====================

// @route   GET /api/leaves/types
// @desc    Get all leave types
// @access  Private
router.get('/types', 
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const leaveTypes = await LeaveType.find({ isActive: true })
      .sort({ name: 1 });

    res.json({
      success: true,
      data: leaveTypes
    });
  })
);

// @route   POST /api/leaves/types
// @desc    Create new leave type
// @access  Private (Admin, HR Manager)
router.post('/types',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  [
    body('name').notEmpty().withMessage('Leave type name is required'),
    body('code').notEmpty().withMessage('Leave type code is required'),
    body('daysPerYear').isNumeric().withMessage('Days per year must be a number'),
    body('daysPerYear').isInt({ min: 0, max: 365 }).withMessage('Days per year must be between 0 and 365')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const leaveType = new LeaveType({
      ...req.body,
      createdBy: req.user.id
    });

    await leaveType.save();

    res.status(201).json({
      success: true,
      message: 'Leave type created successfully',
      data: leaveType
    });
  })
);

// ==================== EMPLOYEE LEAVE BALANCES ====================

// @route   GET /api/leaves/employees/balances
// @desc    Get all employees with their current leave balances (OPTIMIZED)
// @access  Private (Admin, HR Manager)
router.get('/employees/balances',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
      
      console.log(`🚀 Loading employee balances for year ${year}...`);
      const startTime = Date.now();
      
      // Get all active employees with basic info
      const employees = await Employee.find({ 
        isActive: true, 
        isDeleted: false 
      })
      .select('firstName lastName employeeId joiningDate hireDate leaveBalance leaveConfig')
      .lean();

      console.log(`📊 Found ${employees.length} active employees`);

      // If no employees found, return empty array
      if (employees.length === 0) {
        return res.json({
          success: true,
          data: []
        });
      }

      // Get all leave balances for the year in one query
      const employeeIds = employees.map(emp => emp._id);
      const leaveBalances = await LeaveBalance.find({
        employee: { $in: employeeIds },
        year: year
      }).lean();

      console.log(`📈 Found ${leaveBalances.length} leave balance records`);

      // Create a map for quick lookup
      const balanceMap = new Map();
      leaveBalances.forEach(balance => {
        balanceMap.set(balance.employee.toString(), balance);
      });

      // Get approved leave requests for the year to calculate used days
      const approvedLeaves = await LeaveRequest.find({
        employee: { $in: employeeIds },
        status: 'approved',
        isActive: true,
        $or: [
          { leaveYear: year },
          { 
            startDate: { 
              $gte: new Date(year, 0, 1), 
              $lt: new Date(year + 1, 0, 1) 
            } 
          }
        ]
      })
      .populate('leaveType', 'code')
      .lean();

      console.log(`📝 Found ${approvedLeaves.length} approved leave requests`);

      // Create a map for leave usage by employee and type
      const usageMap = new Map();
      approvedLeaves.forEach(leave => {
        const empId = leave.employee.toString();
        if (!usageMap.has(empId)) {
          usageMap.set(empId, { annual: 0, sick: 0, casual: 0, medical: 0 });
        }
        
        const code = (leave.leaveType?.code || leave.leaveType?.name || '').toUpperCase();
        const name = (leave.leaveType?.name || '').toUpperCase();
        let balanceType = 'casual';

        if (code.includes('ANNUAL') || code === 'AL' || code.startsWith('AL_') || name.includes('ANNUAL')) {
          balanceType = 'annual';
        } else if (code.includes('SICK') || code === 'SL' || code.startsWith('SL_') || code.includes('MEDICAL') || code === 'ML' || name.includes('SICK') || name.includes('MEDICAL')) {
          balanceType = 'sick';
        } else {
          balanceType = 'casual';
        }
        
        usageMap.get(empId)[balanceType] += leave.totalDays || 0;
      });

      // Process employees and calculate balances
      const employeesWithBalances = employees.map(employee => {
        const empId = employee._id.toString();
        const balance = balanceMap.get(empId);
        const usage = usageMap.get(empId) || { annual: 0, sick: 0, casual: 0, medical: 0 };
        
        // Calculate work year
        const currentWorkYear = LeaveIntegrationService.calculateWorkYear(employee.hireDate || employee.joiningDate);
        
        // Get leave config or use defaults
        const config = employee.leaveConfig || {};
        const annualLimit = config.annualLimit || 20;
        const sickLimit = config.sickLimit || 10;
        const casualLimit = config.casualLimit || 10;
        
        // Prefer saved balance from LeaveBalance collection or Employee model, fall back to calculation
        const annualAllocated = balance?.annual?.allocated ?? (typeof employee.leaveBalance?.annual === 'object' ? employee.leaveBalance?.annual?.allocated : null) ?? annualLimit;
        const casualAllocated = balance?.casual?.allocated ?? (typeof employee.leaveBalance?.casual === 'object' ? employee.leaveBalance?.casual?.allocated : null) ?? casualLimit;
        const sickAllocated = balance?.sick?.allocated ?? (typeof employee.leaveBalance?.sick === 'object' ? employee.leaveBalance?.sick?.allocated : null) ?? sickLimit;

        const annualCarriedForward = balance?.annual?.carriedForward ?? (typeof employee.leaveBalance?.annual === 'object' ? employee.leaveBalance?.annual?.carriedForward : 0) ?? 0;
        const casualCarriedForward = balance?.casual?.carriedForward ?? (typeof employee.leaveBalance?.casual === 'object' ? employee.leaveBalance?.casual?.carriedForward : 0) ?? 0;
        const sickCarriedForward = balance?.sick?.carriedForward ?? (typeof employee.leaveBalance?.sick === 'object' ? employee.leaveBalance?.sick?.carriedForward : 0) ?? 0;

        const annualUsed = balance?.annual?.used ?? usage.annual;
        const casualUsed = balance?.casual?.used ?? usage.casual;
        const sickUsed = balance?.sick?.used ?? usage.sick;
        const medicalUsed = balance?.medical?.used ?? usage.medical;

        const annualRemaining = Math.max(0, (annualAllocated + annualCarriedForward) - annualUsed);
        const casualRemaining = Math.max(0, (casualAllocated + casualCarriedForward) - casualUsed);
        const sickRemaining = Math.max(0, (sickAllocated + sickCarriedForward) - sickUsed);
        const medicalRemaining = Math.max(0, sickAllocated - medicalUsed);
        
        return {
          ...employee,
          leaveBalance: {
            annual: { 
              allocated: annualAllocated, 
              used: annualUsed, 
              remaining: annualRemaining, 
              carriedForward: annualCarriedForward, 
              advance: balance?.annual?.advance || 0 
            },
            casual: { 
              allocated: casualAllocated, 
              used: casualUsed, 
              remaining: casualRemaining, 
              carriedForward: casualCarriedForward, 
              advance: balance?.casual?.advance || 0 
            },
            sick: { 
              allocated: sickAllocated, 
              used: sickUsed, 
              remaining: sickRemaining, 
              carriedForward: sickCarriedForward, 
              advance: balance?.sick?.advance || 0 
            },
            medical: { 
              allocated: sickAllocated, 
              used: medicalUsed, 
              remaining: medicalRemaining, 
              carriedForward: 0, 
              advance: 0 
            }
          }
        };
      });

      const endTime = Date.now();
      console.log(`✅ Employee balances loaded in ${endTime - startTime}ms`);

      res.json({
        success: true,
        data: employeesWithBalances
      });
    } catch (error) {
      console.error('Error getting employee leave balances:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting employee leave balances'
      });
    }
  })
);

// ==================== LEAVE REQUESTS ROUTES ====================

// @route   GET /api/leaves/requests
// @desc    Get leave requests with filters (HR only)
// @access  Private (Admin, HR Manager)
router.get('/requests',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const filters = {
      ...req.query,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 100
    };

    const result = await LeaveManagementService.getLeaveRequests(filters);

    res.json({
      success: true,
      data: result.leaveRequests,
      pagination: result.pagination
    });
  })
);

// @route   GET /api/leaves/requests/:id
// @desc    Get leave request by ID
// @access  Private
router.get('/requests/:id',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const leaveRequest = await LeaveRequest.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId email phone')
      .populate('leaveType', 'name code color description')
      .populate('approvedBy', 'firstName lastName')
      .populate('rejectedBy', 'firstName lastName')
      .populate('createdBy', 'firstName lastName');

    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    res.json({
      success: true,
      data: leaveRequest
    });
  })
);

// @route   POST /api/leaves/requests
// @desc    Add leave request (HR only)
// @access  Private (Admin, HR Manager)
router.post('/requests',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  upload.single('medicalCertificate'),
  [
    body('employee').isMongoId().withMessage('Valid employee ID is required'),
    body('leaveType').isMongoId().withMessage('Valid leave type ID is required'),
    body('startDate').isISO8601().withMessage('Valid start date is required'),
    body('endDate').isISO8601().withMessage('Valid end date is required'),
    body('reason').notEmpty().withMessage('Reason is required'),
    body('reason').isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const leaveData = {
      ...req.body,
      employee: req.body.employee,
      startDate: new Date(req.body.startDate),
      endDate: new Date(req.body.endDate)
    };

    // Handle medical certificate upload
    if (req.file) {
      leaveData.medicalCertificate = {
        fileName: req.file.originalname,
        filePath: req.file.path,
        uploadedDate: new Date()
      };
    }

    const leaveRequest = await LeaveManagementService.applyForLeave(leaveData, req.user.id);

    notifyLeaveEvent(leaveRequest._id, req.user, 'submitted');

    res.status(201).json({
      success: true,
      message: 'Leave request added successfully',
      data: leaveRequest
    });
  })
);

// @route   PUT /api/leaves/requests/:id/approve
// @desc    Approve leave request
// @access  Private (Admin, HR Manager)
router.put('/requests/:id/approve',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  [
    body('comments').optional().isLength({ max: 500 }).withMessage('Comments cannot exceed 500 characters')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const leaveRequest = await LeaveManagementService.approveLeaveRequest(
      req.params.id,
      req.user.id,
      req.body.comments || ''
    );

    notifyLeaveEvent(leaveRequest._id || req.params.id, req.user, 'approved');

    res.json({
      success: true,
      message: 'Leave request approved successfully',
      data: leaveRequest
    });
  })
);

// @route   PUT /api/leaves/requests/:id/reject
// @desc    Reject leave request
// @access  Private (Admin, HR Manager)
router.put('/requests/:id/reject',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  [
    body('reason').notEmpty().withMessage('Rejection reason is required'),
    body('reason').isLength({ max: 500 }).withMessage('Rejection reason cannot exceed 500 characters')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const leaveRequest = await LeaveManagementService.rejectLeaveRequest(
      req.params.id,
      req.user.id,
      req.body.reason
    );

    notifyLeaveEvent(leaveRequest._id || req.params.id, req.user, 'rejected');

    res.json({
      success: true,
      message: 'Leave request rejected',
      data: leaveRequest
    });
  })
);

// @route   PUT /api/leaves/requests/:id/cancel
// @desc    Cancel leave request
// @access  Private
router.put('/requests/:id/cancel',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  [
    body('reason').notEmpty().withMessage('Cancellation reason is required'),
    body('reason').isLength({ max: 500 }).withMessage('Cancellation reason cannot exceed 500 characters')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const leaveRequest = await LeaveRequest.findById(req.params.id);
    if (!leaveRequest) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    if (!leaveRequest.canBeCancelled()) {
      return res.status(400).json({
        success: false,
        message: 'Leave request cannot be cancelled'
      });
    }

    leaveRequest.status = 'cancelled';
    leaveRequest.cancelledBy = req.user.id;
    leaveRequest.cancelledDate = new Date();
    leaveRequest.cancellationReason = req.body.reason;
    leaveRequest.updatedBy = req.user.id;

    await leaveRequest.save();
    notifyLeaveEvent(leaveRequest._id, req.user, 'cancelled');

    res.json({
      success: true,
      message: 'Leave request cancelled successfully',
      data: leaveRequest
    });
  })
);

// ==================== LEAVE CALENDAR ROUTES ====================

// @route   GET /api/leaves/calendar
// @desc    Get leave calendar data (HR only)
// @access  Private (Admin, HR Manager)
router.get('/calendar',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : new Date().getMonth() + 1;

    const calendarData = await LeaveManagementService.getLeaveCalendar(year, month);

    res.json({
      success: true,
      data: calendarData
    });
  })
);

// ==================== LEAVE POLICY ROUTES ====================

// @route   GET /api/leaves/policy
// @desc    Get active leave policy (HR only)
// @access  Private (Admin, HR Manager)
router.get('/policy',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const policy = await LeavePolicy.getActivePolicy();

    res.json({
      success: true,
      data: policy
    });
  })
);

// ==================== ADMIN ROUTES ====================

// @route   POST /api/leaves/initialize
// @desc    Initialize default leave types and policy
// @access  Private (Admin)
router.post('/initialize',
  authMiddleware,
  authorize('super_admin', 'admin'),
  asyncHandler(async (req, res) => {
    await LeaveManagementService.initializeDefaultLeaveTypes();
    await LeaveManagementService.initializeDefaultLeavePolicy();

    res.json({
      success: true,
      message: 'Leave management system initialized successfully'
    });
  })
);

// @route   POST /api/leaves/carry-forward
// @desc    Process leave carry forward for a year
// @access  Private (Admin)
router.post('/carry-forward',
  authMiddleware,
  authorize('super_admin', 'admin'),
  [
    body('year').isInt({ min: 2020, max: 2030 }).withMessage('Valid year is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    await LeaveManagementService.processLeaveCarryForward(req.body.year);

    res.json({
      success: true,
      message: `Leave carry forward processed for year ${req.body.year}`
    });
  })
);

// ==================== STATISTICS ROUTES ====================

// @route   GET /api/leaves/statistics
// @desc    Get leave statistics (OPTIMIZED)
// @access  Private (Admin, HR Manager)
router.get('/statistics',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
      
      console.log(`📊 Loading leave statistics for year ${year}...`);
      const startTime = Date.now();

      // Use aggregation pipeline for better performance
      const stats = await LeaveRequest.aggregate([
        {
          $match: {
            startDate: {
              $gte: new Date(year, 0, 1),
              $lt: new Date(year + 1, 0, 1)
            },
            isActive: true
          }
        },
        {
          $lookup: {
            from: 'leavetypes',
            localField: 'leaveType',
            foreignField: '_id',
            as: 'leaveTypeInfo'
          }
        },
        {
          $unwind: {
            path: '$leaveTypeInfo',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: {
              status: '$status',
              leaveType: '$leaveTypeInfo.name'
            },
            count: { $sum: 1 },
            totalDays: { $sum: '$totalDays' }
          }
        },
        {
          $group: {
            _id: '$_id.status',
            leaveTypes: {
              $push: {
                name: '$_id.leaveType',
                count: '$count',
                totalDays: '$totalDays'
              }
            },
            totalRequests: { $sum: '$count' },
            totalDays: { $sum: '$totalDays' }
          }
        }
      ]);

      const endTime = Date.now();
      console.log(`✅ Leave statistics loaded in ${endTime - startTime}ms`);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting leave statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting leave statistics'
      });
    }
  })
);

// @route   GET /api/leaves/reports/department-stats
// @desc    Get department-wise leave statistics
// @access  Private (Admin, HR Manager)
router.get('/reports/department-stats',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : null;

    let dateFilter = {
      startDate: {
        $gte: new Date(year, 0, 1),
        $lt: new Date(year + 1, 0, 1)
      },
      isActive: true
    };

    if (month) {
      dateFilter.startDate = {
        $gte: new Date(year, month - 1, 1),
        $lt: new Date(year, month, 0)
      };
    }

    const stats = await LeaveRequest.aggregate([
      { $match: dateFilter },
      {
        $lookup: {
          from: 'employees',
          localField: 'employee',
          foreignField: '_id',
          as: 'employeeInfo'
        }
      },
      { $unwind: '$employeeInfo' },
      {
        $lookup: {
          from: 'departments',
          localField: 'employeeInfo.department',
          foreignField: '_id',
          as: 'departmentInfo'
        }
      },
      { $unwind: '$departmentInfo' },
      {
        $group: {
          _id: '$departmentInfo.name',
          totalRequests: { $sum: 1 },
          totalDays: { $sum: '$totalDays' },
          approvedRequests: {
            $sum: { $cond: [{ $in: ['$status', ['Approved', 'approved']] }, 1, 0] }
          },
          approvedDays: {
            $sum: { $cond: [{ $in: ['$status', ['Approved', 'approved']] }, '$totalDays', 0] }
          },
          pendingRequests: {
            $sum: { $cond: [{ $in: ['$status', ['Pending', 'pending']] }, 1, 0] }
          },
          rejectedRequests: {
            $sum: { $cond: [{ $in: ['$status', ['Rejected', 'rejected']] }, 1, 0] }
          }
        }
      },
      { $sort: { totalRequests: -1 } }
    ]);

    res.json({
      success: true,
      data: stats
    });
  })
);

// @route   GET /api/leaves/reports/employee-stats
// @desc    Get employee-wise leave statistics
// @access  Private (Admin, HR Manager)
router.get('/reports/employee-stats',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : null;
    const department = req.query.department || null;
    const limit = parseInt(req.query.limit) || 2000;

    let dateFilter = {
      startDate: {
        $gte: new Date(year, 0, 1),
        $lt: new Date(year + 1, 0, 1)
      },
      isActive: true
    };

    if (month) {
      dateFilter.startDate = {
        $gte: new Date(year, month - 1, 1),
        $lt: new Date(year, month, 0)
      };
    }

    let matchStage = { $match: dateFilter };

    if (department) {
      matchStage = {
        $match: {
          ...dateFilter,
          'employeeInfo.department': new mongoose.Types.ObjectId(department)
        }
      };
    }

    const stats = await LeaveRequest.aggregate([
      {
        $lookup: {
          from: 'employees',
          localField: 'employee',
          foreignField: '_id',
          as: 'employeeInfo'
        }
      },
      { $unwind: '$employeeInfo' },
      {
        $lookup: {
          from: 'departments',
          localField: 'employeeInfo.department',
          foreignField: '_id',
          as: 'departmentInfo'
        }
      },
      { $unwind: '$departmentInfo' },
      matchStage,
      {
        $group: {
          _id: '$employee',
          employeeName: { $first: { $concat: ['$employeeInfo.firstName', ' ', '$employeeInfo.lastName'] } },
          employeeId: { $first: '$employeeInfo.employeeId' },
          department: { $first: '$departmentInfo.name' },
          totalRequests: { $sum: 1 },
          totalDays: { $sum: '$totalDays' },
          approvedRequests: {
            $sum: { $cond: [{ $in: ['$status', ['Approved', 'approved']] }, 1, 0] }
          },
          approvedDays: {
            $sum: { $cond: [{ $in: ['$status', ['Approved', 'approved']] }, '$totalDays', 0] }
          },
          pendingRequests: {
            $sum: { $cond: [{ $in: ['$status', ['Pending', 'pending']] }, 1, 0] }
          },
          rejectedRequests: {
            $sum: { $cond: [{ $in: ['$status', ['Rejected', 'rejected']] }, 1, 0] }
          }
        }
      },
      { $sort: { totalDays: -1 } },
      { $limit: limit }
    ]);

    res.json({
      success: true,
      data: stats
    });
  })
);

// @route   GET /api/leaves/reports/monthly-trends
// @desc    Get monthly leave trends
// @access  Private (Admin, HR Manager)
router.get('/reports/monthly-trends',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

    const trends = await LeaveRequest.aggregate([
      {
        $match: {
          startDate: {
            $gte: new Date(year, 0, 1),
            $lt: new Date(year + 1, 0, 1)
          },
          isActive: true
        }
      },
      {
        $group: {
          _id: {
            month: { $month: '$startDate' },
            status: '$status'
          },
          count: { $sum: 1 },
          totalDays: { $sum: '$totalDays' }
        }
      },
      {
        $group: {
          _id: '$_id.month',
          data: {
            $push: {
              status: '$_id.status',
              count: '$count',
              totalDays: '$totalDays'
            }
          },
          totalRequests: { $sum: '$count' },
          totalDays: { $sum: '$totalDays' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Format the data for frontend consumption
    const formattedTrends = trends.map(trend => ({
      month: trend._id,
      monthName: new Date(year, trend._id - 1).toLocaleString('default', { month: 'long' }),
      totalRequests: trend.totalRequests,
      totalDays: trend.totalDays,
      breakdown: trend.data
    }));

    res.json({
      success: true,
      data: formattedTrends
    });
  })
);

// @route   GET /api/leaves/reports/leave-types
// @desc    Get leave types for filtering
// @access  Private (Admin, HR Manager)
router.get('/reports/leave-types',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const leaveTypes = await LeaveType.find({ isActive: true })
      .select('name description maxDays')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: leaveTypes
    });
  })
);

// ==================== EMPLOYEE LEAVE INTEGRATION ROUTES ====================

// @route   GET /api/leaves/employee/:employeeId/summary
// @desc    Get employee leave summary with balance and history
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/employee/:employeeId/summary',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const workYear = req.query.workYear ? parseInt(req.query.workYear) : null;
    const year = req.query.year ? parseInt(req.query.year) : null;

    const summary = await LeaveIntegrationService.getEmployeeLeaveSummary(employeeId, workYear, year);

    res.json({
      success: true,
      data: summary
    });
  })
);

// @route   GET /api/leaves/employee/:employeeId/work-years
// @desc    Get available work years for an employee
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/employee/:employeeId/work-years',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;

    const workYears = await LeaveIntegrationService.getAvailableWorkYears(employeeId);

    res.json({
      success: true,
      data: workYears
    });
  })
);

// @route   GET /api/leaves/employee/:employeeId/balance
// @desc    Get employee leave balance for a year
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/employee/:employeeId/balance',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

    const balance = await LeaveBalance.getOrCreateBalance(employeeId, year);

    res.json({
      success: true,
      data: balance.getSummary()
    });
  })
);

// @route   PUT /api/leaves/employee/:employeeId/config
// @desc    Update employee leave configuration
// @access  Private (Admin, HR Manager, Super Admin)
router.put('/employee/:employeeId/config',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  [
    body('annualLimit').optional().isInt({ min: 0, max: 365 }).withMessage('Annual limit must be between 0 and 365'),
    body('sickLimit').optional().isInt({ min: 0, max: 365 }).withMessage('Sick limit must be between 0 and 365'),
    body('casualLimit').optional().isInt({ min: 0, max: 365 }).withMessage('Casual limit must be between 0 and 365'),
    body('useGlobalDefaults').optional().isBoolean().withMessage('useGlobalDefaults must be a boolean')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { employeeId } = req.params;
    const config = req.body;

    const employee = await LeaveIntegrationService.updateEmployeeLeaveConfig(employeeId, config);

    res.json({
      success: true,
      message: 'Leave configuration updated successfully',
      data: {
        employeeId: employee.employeeId,
        leaveConfig: employee.leaveConfig
      }
    });
  })
);

// @route   POST /api/leaves/employee/:employeeId/initialize
// @desc    Initialize leave balance for an employee
// @access  Private (Admin, HR Manager, Super Admin)
router.post('/employee/:employeeId/initialize',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;

    const balance = await LeaveIntegrationService.initializeEmployeeLeaveBalance(employeeId);

    res.json({
      success: true,
      message: 'Leave balance initialized successfully',
      data: balance.getSummary()
    });
  })
);

// @route   POST /api/leaves/employee/:employeeId/sync
// @desc    Sync leave balance from approved leave requests
// @access  Private (Admin, HR Manager, Super Admin)
router.post('/employee/:employeeId/sync',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const year = req.body.year || new Date().getFullYear();

    const balance = await LeaveIntegrationService.syncLeaveBalance(employeeId, year);

    res.json({
      success: true,
      message: 'Leave balance synced successfully',
      data: balance.getSummary()
    });
  })
);

// @route   GET /api/leaves/employee/:employeeId/advance-deduction
// @desc    Calculate advance leave deduction for payroll
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/employee/:employeeId/advance-deduction',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : new Date().getMonth() + 1;
    const dailyRate = req.query.dailyRate ? parseFloat(req.query.dailyRate) : 0;

    const deduction = await LeaveIntegrationService.calculateAdvanceLeaveDeduction(
      employeeId,
      year,
      month,
      dailyRate
    );

    res.json({
      success: true,
      data: deduction
    });
  })
);

// @route   GET /api/leaves/employee/:employeeId/monthly-stats
// @desc    Get monthly leave statistics for payroll period
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/employee/:employeeId/monthly-stats',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : new Date().getMonth() + 1;

    const stats = await LeaveIntegrationService.getMonthlyLeaveStats(employeeId, year, month);

    res.json({
      success: true,
      data: stats
    });
  })
);

// @route   GET /api/leaves/global-config
// @desc    Get global leave configuration defaults
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/global-config',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    // Return the standard company defaults (20, 10, 10)
    const config = {
      annualLimit: 20,
      sickLimit: 10,
      casualLimit: 10
    };

    res.json({
      success: true,
      data: config
    });
  })
);

// ==================== ANNIVERSARY LEAVE MANAGEMENT ENDPOINTS ====================

// @route   GET /api/leaves/anniversary/info/:employeeId
// @desc    Get employee anniversary information
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/anniversary/info/:employeeId',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;

    const anniversaryInfo = await LeaveIntegrationService.getEmployeeAnniversaryInfo(employeeId);

    res.json({
      success: true,
      data: anniversaryInfo
    });
  })
);

// @route   GET /api/leaves/anniversary/balance/:employeeId/:workYear
// @desc    Get leave balance for specific work year
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/anniversary/balance/:employeeId/:workYear',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { employeeId, workYear } = req.params;

    const balance = await LeaveIntegrationService.getWorkYearBalance(employeeId, parseInt(workYear));

    res.json({
      success: true,
      data: balance
    });
  })
);

// @route   POST /api/leaves/anniversary/process-renewals
// @desc    Process anniversary renewals for all employees
// @access  Private (Super Admin)
router.post('/anniversary/process-renewals',
  authMiddleware,
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    const results = await LeaveIntegrationService.processAnniversaryRenewals();

    res.json({
      success: true,
      data: results,
      message: `Processed ${results.processed} employees, renewed ${results.renewed}`
    });
  })
);

// @route   POST /api/leaves/anniversary/expire-old-leaves
// @desc    Expire old annual leaves (older than 2 years)
// @access  Private (Super Admin)
router.post('/anniversary/expire-old-leaves',
  authMiddleware,
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    const expiredCount = await LeaveIntegrationService.expireOldAnnualLeaves();

    res.json({
      success: true,
      data: { expiredCount },
      message: `Expired ${expiredCount} annual leave balances`
    });
  })
);

// @route   GET /api/leaves/anniversary/upcoming
// @desc    Get employees with upcoming anniversaries (next 30 days)
// @access  Private (Admin, HR Manager, Super Admin)
router.get('/anniversary/upcoming',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const upcomingAnniversaries = await AnniversaryLeaveScheduler.getUpcomingAnniversaries();

    res.json({
      success: true,
      data: upcomingAnniversaries
    });
  })
);

// @route   GET /api/leaves/anniversary/scheduler/status
// @desc    Get anniversary scheduler status
// @access  Private (Super Admin)
router.get('/anniversary/scheduler/status',
  authMiddleware,
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    const status = AnniversaryLeaveScheduler.getStatus();

    res.json({
      success: true,
      data: status
    });
  })
);

// @route   POST /api/leaves/anniversary/scheduler/start
// @desc    Start anniversary scheduler
// @access  Private (Super Admin)
router.post('/anniversary/scheduler/start',
  authMiddleware,
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    AnniversaryLeaveScheduler.start();

    res.json({
      success: true,
      message: 'Anniversary scheduler started successfully'
    });
  })
);

// @route   POST /api/leaves/anniversary/scheduler/stop
// @desc    Stop anniversary scheduler
// @access  Private (Super Admin)
router.post('/anniversary/scheduler/stop',
  authMiddleware,
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    AnniversaryLeaveScheduler.stop();

    res.json({
      success: true,
      message: 'Anniversary scheduler stopped successfully'
    });
  })
);

// @route   POST /api/leaves/anniversary/scheduler/run-manual
// @desc    Run anniversary tasks manually
// @access  Private (Super Admin)
router.post('/anniversary/scheduler/run-manual',
  authMiddleware,
  authorize('super_admin'),
  asyncHandler(async (req, res) => {
    const results = await AnniversaryLeaveScheduler.runManually();

    res.json({
      success: true,
      data: results,
      message: 'Anniversary tasks completed successfully'
    });
  })
);

// Configure multer for excel file upload
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// @route   POST /api/leaves/import
// @desc    Import leaves from Excel file (Leave.xlsx) year-wise relative to joiningDate
// @access  Private (super_admin, admin, hr_manager)
router.post('/import',
  authMiddleware,
  authorize('super_admin', 'admin', 'hr_manager'),
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an Excel file (.xlsx / .xls)' });
    }

    const xlsx = require('xlsx');
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    let rawData = [];
    workbook.SheetNames.forEach(sheetName => {
      const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
      if (sheetData && sheetData.length > 0) {
        rawData = rawData.concat(sheetData);
      }
    });
    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ success: false, message: 'Excel file is empty' });
    }

    // 1. Pre-fetch all active Employees and LeaveTypes
    const [employeesList, leaveTypesList] = await Promise.all([
      Employee.find({ isDeleted: { $ne: true } }).select('_id employeeId biometricId firstName lastName department joiningDate hireDate createdAt leaveConfig leaveBalance'),
      LeaveType.find({ isActive: true })
    ]);

    // Build lookup maps
    const empByIdMap = new Map();
    const empByNameMap = new Map();

    employeesList.forEach(emp => {
      if (emp.employeeId) empByIdMap.set(String(emp.employeeId).trim(), emp);
      if (emp.biometricId) empByIdMap.set(String(emp.biometricId).trim(), emp);
      const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim().toLowerCase();
      if (fullName) empByNameMap.set(fullName, emp);
      if (emp.firstName) empByNameMap.set(String(emp.firstName).trim().toLowerCase(), emp);
    });

    const leaveTypeMap = new Map();
    leaveTypesList.forEach(lt => {
      leaveTypeMap.set(lt.name.trim().toLowerCase(), lt);
      if (lt.code) leaveTypeMap.set(lt.code.trim().toLowerCase(), lt);
    });

    // Helper to get or create leave type dynamically
    const getOrCreateLeaveType = async (typeName) => {
      const key = String(typeName || 'Casual Leave').trim().toLowerCase();
      if (leaveTypeMap.has(key)) return leaveTypeMap.get(key);

      const code = key.substring(0, 10).toUpperCase().replace(/\s+/g, '_');
      const newType = await LeaveType.create({
        name: typeName,
        code: code,
        description: `Auto-created during Excel import: ${typeName}`,
        daysPerYear: 10,
        defaultDaysPerYear: 10,
        isPaid: true,
        requiresApproval: false,
        isActive: true
      });
      leaveTypeMap.set(key, newType);
      return newType;
    };

    // Pre-fetch all existing LeaveRequests for duplicate checking in 1 query
    const existingLeaveRequests = await LeaveRequest.find({}, 'employee startDate leaveType').lean();
    const existingSet = new Set(
      existingLeaveRequests.map(r => `${r.employee.toString()}_${new Date(r.startDate).toISOString().slice(0,10)}_${r.leaveType.toString()}`)
    );

    // Pre-fetch all existing LeaveBalances into an in-memory Map
    const existingBalances = await LeaveBalance.find({});
    const balanceMap = new Map();
    existingBalances.forEach(b => {
      balanceMap.set(`${b.employee.toString()}_${b.year}`, b);
      balanceMap.set(`${b.employee.toString()}_wy_${b.workYear}`, b);
    });

    const leaveRequestsToInsert = [];
    const balancesToSave = new Map();

    let importedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each row in memory
    for (let index = 0; index < rawData.length; index++) {
      const row = rawData[index];
      const rowNum = index + 2;

      try {
        const empIdInput = row['Employee ID'] !== undefined ? String(row['Employee ID']).trim() : null;
        const firstNameInput = row['First Name'] ? String(row['First Name']).trim() : '';
        const payCodeInput = row['Pay Code'] || 'Casual Leave';
        const startTimeRaw = row['Start Time'] || row['Start'];
        const endTimeRaw = row['End Time'] || row['End'];
        const reasonInput = row['Apply Reason'] || 'Imported Leave Record';

        if (!startTimeRaw || !endTimeRaw) {
          skippedCount++;
          continue;
        }

        // Match Employee
        let employee = null;
        if (empIdInput && empByIdMap.has(empIdInput)) {
          employee = empByIdMap.get(empIdInput);
        } else if (firstNameInput && empByNameMap.has(firstNameInput.toLowerCase())) {
          employee = empByNameMap.get(firstNameInput.toLowerCase());
        }

        if (!employee) {
          skippedCount++;
          if (errors.length < 20) {
            errors.push(`Row ${rowNum}: Employee ID "${empIdInput}" / Name "${firstNameInput}" not found in system.`);
          }
          continue;
        }

        // Parse dates
        const startDate = new Date(startTimeRaw);
        const endDate = new Date(endTimeRaw);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          errorCount++;
          if (errors.length < 20) errors.push(`Row ${rowNum}: Invalid date format.`);
          continue;
        }

        // Calculate total days
        let totalDays = Number(row['No of Days '] || row['No of Days'] || row['Days']);
        if (!totalDays || isNaN(totalDays)) {
          const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
          totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
        }
        if (totalDays <= 0) totalDays = 1;

        // Calculate Work Year based on employee's Date of Joining (joiningDate || hireDate)
        const joinDateObj = new Date(employee.joiningDate || employee.hireDate || employee.createdAt || '2023-01-01');
        const startYear = Math.max(2020, startDate.getFullYear());

        // Determine workYear index
        let workYearIndex = startYear - joinDateObj.getFullYear();
        const anniversaryThisYear = new Date(startYear, joinDateObj.getMonth(), joinDateObj.getDate());
        if (startDate < anniversaryThisYear) {
          workYearIndex -= 1;
        }
        workYearIndex = Math.max(0, workYearIndex);

        // Get Leave Type
        const leaveType = await getOrCreateLeaveType(payCodeInput);

        // Fast duplicate check via Set
        const dateKey = startDate.toISOString().slice(0,10);
        const dupKey = `${employee._id.toString()}_${dateKey}_${leaveType._id.toString()}`;
        if (existingSet.has(dupKey)) {
          skippedCount++;
          continue;
        }
        existingSet.add(dupKey);

        // Stage LeaveRequest for bulk insert
        leaveRequestsToInsert.push({
          employee: employee._id,
          leaveType: leaveType._id,
          startDate: startDate,
          endDate: endDate,
          totalDays: totalDays,
          reason: reasonInput,
          status: 'approved',
          appliedDate: row['Apply Time'] ? new Date(row['Apply Time']) : startDate,
          approvedDate: new Date(),
          approvedBy: req.user._id,
          createdBy: req.user._id,
          workYear: workYearIndex,
          leaveYear: startYear,
          approvalComments: 'Imported from Excel Leave File'
        });

        // Stage LeaveBalance update in memory map
        const balKey = `${employee._id.toString()}_${startYear}`;
        let balance = balancesToSave.get(balKey) || balanceMap.get(balKey) || balanceMap.get(`${employee._id.toString()}_wy_${workYearIndex}`);

        if (!balance) {
          const allocation = LeaveBalance.calculateAnniversaryAllocation(workYearIndex, employee.leaveConfig);
          balance = new LeaveBalance({
            employee: employee._id,
            year: startYear,
            workYear: workYearIndex,
            annual: { allocated: allocation.annual, used: 0, remaining: allocation.annual },
            sick: { allocated: allocation.sick, used: 0, remaining: allocation.sick },
            casual: { allocated: allocation.casual, used: 0, remaining: allocation.casual }
          });
          balanceMap.set(balKey, balance);
        }

        const codeKey = (leaveType.code || leaveType.name || '').toUpperCase();
        const nameKey = (leaveType.name || '').toUpperCase();

        if (codeKey.includes('ANNUAL') || codeKey === 'AL' || codeKey.startsWith('AL_') || nameKey.includes('ANNUAL')) {
          balance.annual.used = (balance.annual.used || 0) + totalDays;
          balance.annual.remaining = Math.max(0, (balance.annual.allocated || 20) - balance.annual.used);
        } else if (codeKey.includes('SICK') || codeKey === 'SL' || codeKey.startsWith('SL_') || codeKey.includes('MEDICAL') || codeKey === 'ML' || nameKey.includes('SICK') || nameKey.includes('MEDICAL')) {
          balance.sick.used = (balance.sick.used || 0) + totalDays;
          balance.sick.remaining = Math.max(0, (balance.sick.allocated || 10) - balance.sick.used);
        } else {
          balance.casual.used = (balance.casual.used || 0) + totalDays;
          balance.casual.remaining = Math.max(0, (balance.casual.allocated || 10) - balance.casual.used);
        }
        balancesToSave.set(balKey, balance);

        importedCount++;
      } catch (rowErr) {
        errorCount++;
        if (errors.length < 20) {
          errors.push(`Row ${rowNum}: ${rowErr.message}`);
        }
      }
    }

    // Bulk insert LeaveRequests in batches of 1000
    if (leaveRequestsToInsert.length > 0) {
      const BATCH_SIZE = 1000;
      for (let i = 0; i < leaveRequestsToInsert.length; i += BATCH_SIZE) {
        const batch = leaveRequestsToInsert.slice(i, i + BATCH_SIZE);
        await LeaveRequest.insertMany(batch, { ordered: false });
      }
    }

    // Bulk save updated LeaveBalances with duplicate key safety
    const updatedEmployeeIds = new Set();
    for (const balDoc of balancesToSave.values()) {
      updatedEmployeeIds.add(balDoc.employee.toString());
      try {
        await balDoc.save();
      } catch (saveErr) {
        if (saveErr.code === 11000) {
          // If duplicate key error, find existing and update fields
          const existing = await LeaveBalance.findOne({
            employee: balDoc.employee,
            year: balDoc.year,
            workYear: balDoc.workYear
          });
          if (existing) {
            existing.annual.used = (existing.annual.used || 0) + balDoc.annual.used;
            existing.sick.used = (existing.sick.used || 0) + balDoc.sick.used;
            existing.casual.used = (existing.casual.used || 0) + balDoc.casual.used;
            await existing.save();
          }
        }
      }
    }

    // Recalculate carry forward for all affected employees to enforce 40-day caps
    for (const empIdStr of updatedEmployeeIds) {
      try {
        await CarryForwardService.recalculateCarryForward(empIdStr);
      } catch (cfErr) {
        console.error(`Error recalculating carry forward for ${empIdStr}:`, cfErr);
      }
    }

    return res.json({
      success: true,
      message: `Excel Leave import completed successfully!`,
      summary: {
        totalRows: rawData.length,
        importedCount,
        skippedCount,
        errorCount,
        errors
      }
    });
  })
);

module.exports = router;
