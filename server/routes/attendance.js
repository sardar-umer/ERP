const express = require('express');
const router = express.Router();
const Attendance = require('../models/hr/Attendance');
const Employee = require('../models/hr/Employee');
const { authMiddleware } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const attendanceService = require('../services/attendanceService');
const zktecoService = require('../services/zktecoService');
const zkbioTimeService = require('../services/zkbioTimeService');
const { processZKTecoTimestamp, formatLocalDateTime } = require('../utils/timezoneHelper');
const mongoose = require('mongoose');
const { excludeApprovalNotGiven } = require('../utils/employeeApprovalScope');
const PayrollUpdateService = require('../services/payrollUpdateService');

// Get all attendance records with pagination and filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await attendanceService.getAttendanceRecords(req.query);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    errorHandler(error, req, res);
  }
});

// Get real-time attendance status
router.get('/realtime', authMiddleware, async (req, res) => {
  try {
    const result = await attendanceService.getRealTimeAttendance();
    res.json(result);
  } catch (error) {
    console.error('Error fetching real-time attendance:', error);
    errorHandler(error, req, res);
  }
});

// Get attendance statistics for all records
router.get('/statistics', authMiddleware, async (req, res) => {
  try {
    const filters = {
      department: req.query.department,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const result = await attendanceService.getAttendanceStatisticsAll(filters);
    res.json(result);
  } catch (error) {
    console.error('Error fetching attendance statistics:', error);
    errorHandler(error, req, res);
  }
});

// Attendance report endpoint
router.get('/report', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, department, employee } = req.query;
    
    // Build query
    const query = {
      isActive: true
    };

    // Date range filter
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Department filter
    if (department) {
      const employeesInDept = await Employee.find({ 
        placementDepartment: department,
        isDeleted: false 
      }).select('_id');
      query.employee = { $in: employeesInDept.map(emp => emp._id) };
    }

    // Employee filter
    if (employee) {
      query.employee = employee;
    }

    // Leave out "approval not given" employees
    Object.assign(query, await excludeApprovalNotGiven());

    // Fetch attendance data with employee details
    const attendanceData = await Attendance.find(query)
      .populate('employee', 'firstName lastName employeeId')
      .sort({ date: -1, 'employee.firstName': 1 });

    // Process the data for the report
    const processedData = attendanceData.map(record => {
      const checkInTime = record.checkIn?.time;
      const checkOutTime = record.checkOut?.time;
      
      // Calculate late minutes (assuming 7:00 AM as standard start time)
      let lateMinutes = 0;
      if (checkInTime) {
        const checkIn = new Date(checkInTime);
        const scheduledTime = new Date(checkIn);
        scheduledTime.setHours(7, 0, 0, 0);
        
        if (checkIn > scheduledTime) {
          lateMinutes = Math.floor((checkIn - scheduledTime) / (1000 * 60));
        }
      }

      // Calculate work hours
      let workHours = 0;
      if (checkInTime && checkOutTime) {
        const start = new Date(checkInTime);
        const end = new Date(checkOutTime);
        workHours = Math.round((end - start) / (1000 * 60 * 60) * 100) / 100;
      }

      return {
        _id: record._id,
        employee: record.employee,
        date: record.date,
        checkIn: record.checkIn,
        checkOut: record.checkOut,
        status: record.status,
        workHours: workHours,
        overtimeHours: record.overtimeHours || 0,
        lateMinutes: lateMinutes,
        notes: record.notes
      };
    });

    res.json({
      success: true,
      data: processedData,
      total: processedData.length
    });

  } catch (error) {
    console.error('Error generating attendance report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate attendance report',
      error: error.message
    });
  }
});

// Get single attendance record
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id)
      .populate('employee', 'firstName lastName employeeId')
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      data: attendance
    });
  } catch (error) {
    errorHandler(error, req, res);
  }
});

// Create new attendance record
router.post('/', authMiddleware, async (req, res) => {
  try {
    const attendanceData = {
      ...req.body,
      createdBy: req.user.id
    };

    const result = await attendanceService.createOrUpdateAttendance(attendanceData);
    
    res.status(201).json({
      success: true,
      message: 'Attendance record created successfully',
      data: result.data
    });
  } catch (error) {
    errorHandler(error, req, res);
  }
});

// Update attendance record
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    // Update fields
    Object.keys(req.body).forEach(key => {
      if (key !== '_id' && key !== 'createdBy') {
        attendance[key] = req.body[key];
      }
    });

    // 26-Day Attendance System: Calculate daily rate and deductions
    if (attendance.status === 'Absent' || attendance.status === 'Leave') {
      const Employee = require('../models/hr/Employee');
      const employee = await Employee.findById(attendance.employee);
      
      if (employee && employee.salary?.basic) {
        const grossSalary = employee.salary.basic;
        attendance.dailyRate = grossSalary / 26; // 26 working days per month
        attendance.attendanceDeduction = attendance.dailyRate; // 1 day deduction
        console.log(`💰 26-Day System: Employee ${employee.firstName} ${employee.lastName}`);
        console.log(`   Gross Salary: Rs. ${grossSalary.toLocaleString()}`);
        console.log(`   Daily Rate: Rs. ${attendance.dailyRate.toFixed(2)}`);
        console.log(`   Attendance Deduction: Rs. ${attendance.attendanceDeduction.toFixed(2)}`);
      }
    } else {
      // Reset deduction for present days
      attendance.attendanceDeduction = 0;
      attendance.dailyRate = 0;
    }
    
    // Note: absentDays and presentDays are payroll-level fields, not attendance-level
    // These will be calculated when generating payroll based on attendance records
    console.log('📝 Note: absentDays and presentDays are calculated at payroll level');
    console.log('📊 Individual attendance records track daily status only');

    attendance.updatedBy = req.user.id;
    await attendance.save();

    // 🔄 Auto-Update Payroll: Recalculate monthly payroll when attendance changes
    try {
      const attendanceDate = new Date(attendance.date);
      const month = attendanceDate.getMonth();
      const year = attendanceDate.getFullYear();
      
      console.log(`🔄 Auto-updating payroll for ${month + 1}/${year} after attendance change`);
      
      // Update payroll for this month to reflect new attendance counts
      await PayrollUpdateService.updatePayrollForMonth(
        attendance.employee.toString(),
        month,
        year
      );
      
      console.log(`✅ Payroll auto-updated successfully for ${month + 1}/${year}`);
      
    } catch (payrollError) {
      console.error(`⚠️ Warning: Failed to auto-update payroll:`, payrollError.message);
      // Don't fail the attendance update if payroll update fails
    }

    const updatedAttendance = await Attendance.findById(attendance._id)
      .populate('employee', 'firstName lastName employeeId')
      .populate('approvedBy', 'firstName lastName employeeId')
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Attendance record updated successfully',
      data: updatedAttendance
    });
  } catch (error) {
    console.error('❌ Error updating attendance:', error);
    errorHandler(error, req, res);
  }
});

// Delete attendance record
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found'
      });
    }

    attendance.isActive = false;
    attendance.updatedBy = req.user.id;
    await attendance.save();

    // 🔄 Auto-Update Payroll: Recalculate monthly payroll when attendance is deleted
    try {
      const attendanceDate = new Date(attendance.date);
      const month = attendanceDate.getMonth();
      const year = attendanceDate.getFullYear();
      
      console.log(`🔄 Auto-updating payroll for ${month + 1}/${year} after attendance deletion`);
      
      // Update payroll for this month to reflect new attendance counts
      await PayrollUpdateService.updatePayrollForMonth(
        attendance.employee.toString(),
        month,
        year
      );
      
      console.log(`✅ Payroll auto-updated successfully for ${month + 1}/${year}`);
      
    } catch (payrollError) {
      console.error(`⚠️ Warning: Failed to auto-update payroll:`, payrollError.message);
      // Don't fail the attendance deletion if payroll update fails
    }

    res.json({
      success: true,
      message: 'Attendance record deleted successfully'
    });
  } catch (error) {
    errorHandler(error, req, res);
  }
});

// Approval functionality removed - attendance is automatically approved based on biometric data

// Sync attendance from biometric devices
router.post('/sync-biometric', authMiddleware, async (req, res) => {
  try {
    const { integrationId, startDate, endDate } = req.body;
    
    if (!integrationId) {
      return res.status(400).json({
        success: false,
        message: 'Integration ID is required'
      });
    }

    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 1));
    const end = endDate ? new Date(endDate) : new Date();

    const result = await attendanceService.syncBiometricAttendance(integrationId, start, end);
    
    res.json({
      success: true,
      message: 'Biometric attendance sync completed successfully',
      data: result
    });
  } catch (error) {
    console.error('Error syncing biometric attendance:', error);
    errorHandler(error, req, res);
  }
});

// Sync ZKTeco attendance specifically
router.post('/sync-zkteco', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 1));
    const end = endDate ? new Date(endDate) : new Date();

    const result = await attendanceService.syncZKTecoAttendance(start, end);
    
    res.json({
      success: true,
      message: 'ZKTeco attendance sync completed successfully',
      data: result
    });
  } catch (error) {
    console.error('Error syncing ZKTeco attendance:', error);
    errorHandler(error, req, res);
  }
});

// Start automatic sync for biometric integration
router.post('/auto-sync/start/:integrationId', authMiddleware, async (req, res) => {
  try {
    const { integrationId } = req.params;
    
    const result = await attendanceService.startAutoSync(integrationId);
    
    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('Error starting auto-sync:', error);
    errorHandler(error, req, res);
  }
});

// Stop automatic sync for biometric integration
router.post('/auto-sync/stop/:integrationId', authMiddleware, async (req, res) => {
  try {
    const { integrationId } = req.params;
    
    const result = await attendanceService.stopAutoSync(integrationId);
    
    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('Error stopping auto-sync:', error);
    errorHandler(error, req, res);
  }
});

// Get attendance by employee and date range
router.get('/employee/:employeeId', authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    const attendance = await Attendance.findByEmployeeAndDateRange(employeeId, start, end);

    res.json({
      success: true,
      data: attendance,
      period: { startDate: start, endDate: end }
    });
  } catch (error) {
    errorHandler(error, req, res);
  }
});

// Get attendance history for a specific employee
router.get('/employee/:employeeId/history', authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { limit = 30 } = req.query;

    const result = await attendanceService.getEmployeeAttendanceHistory(employeeId, limit);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching employee attendance history:', error);
    errorHandler(error, req, res);
  }
});

// Get employee attendance detail
router.get('/employee/:employeeId/detail', authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.params;

    console.log(`🔍 Looking for employee with ID: ${employeeId}`);

    // Find employee by either MongoDB _id or employeeId field
    let employee;
    
    if (mongoose.Types.ObjectId.isValid(employeeId)) {
      // If valid ObjectId, search by _id
      console.log('🔍 Searching by MongoDB _id...');
      employee = await Employee.findById(employeeId)
        .populate('department', 'name')
        .populate('position', 'name')
        .lean();
    } else {
      // Otherwise, search by employeeId field
      console.log('🔍 Searching by employeeId field...');
      employee = await Employee.findOne({ employeeId: employeeId })
        .populate('department', 'name')
        .populate('position', 'name')
        .lean();
    }

    if (!employee) {
      console.log(`❌ Employee not found with ID: ${employeeId}`);
      
      // Try to find what employees exist (for debugging)
      const count = await Employee.countDocuments();
      console.log(`📊 Total employees in database: ${count}`);
      
      // Try to find similar employeeIds
      const similarEmployees = await Employee.find({
        employeeId: new RegExp(employeeId, 'i')
      }).limit(5).select('employeeId firstName lastName');
      
      if (similarEmployees.length > 0) {
        console.log('🔍 Similar employees found:', similarEmployees.map(e => ({
          id: e.employeeId,
          name: `${e.firstName} ${e.lastName}`
        })));
      }
      
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
        debug: {
          searchedId: employeeId,
          totalEmployees: count,
          suggestions: similarEmployees.map(e => e.employeeId)
        }
      });
    }

    console.log(`✅ Employee found: ${employee.firstName} ${employee.lastName} (${employee.employeeId})`);

    // Get attendance records for this employee (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const attendanceRecords = await Attendance.find({
      employee: employee._id,
      isActive: true,
      date: { $gte: thirtyDaysAgo }
    })
      .sort({ date: -1, updatedAt: -1 })
      .lean();

    // Calculate attendance statistics
    const totalDays = 30;
    const presentDays = attendanceRecords.filter(record => 
      record.status === 'Present' || record.checkIn?.time
    ).length;
    const absentDays = totalDays - presentDays;
    const lateDays = attendanceRecords.filter(record => 
      record.status === 'Late'
    ).length;

    // Get today's attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: today, $lt: tomorrow },
      isActive: true
    }).lean();

    // Format the response
    const formattedEmployee = {
      _id: employee._id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeId: employee.employeeId,
      department: employee.department?.name || 'N/A',
      position: employee.position?.name || 'N/A',
      email: employee.email,
      phone: employee.phone
    };

    const formattedAttendanceRecords = attendanceRecords.map(record => ({
      ...record,
      checkInTime: record.checkIn?.time ? 
        formatLocalDateTime(record.checkIn.time) : null,
      checkOutTime: record.checkOut?.time ? 
        formatLocalDateTime(record.checkOut.time) : null,
      attendanceDate: formatLocalDateTime(record.date),
      lastUpdated: formatLocalDateTime(record.updatedAt)
    }));

    res.json({
      success: true,
      data: {
        employee: formattedEmployee,
        attendanceRecords: formattedAttendanceRecords,
        statistics: {
          totalDays,
          presentDays,
          absentDays,
          lateDays,
          attendanceRate: Math.round((presentDays / totalDays) * 100)
        },
        todayAttendance: todayAttendance ? {
          ...todayAttendance,
          checkInTime: todayAttendance.checkIn?.time ? 
            formatLocalDateTime(todayAttendance.checkIn.time) : null,
          checkOutTime: todayAttendance.checkOut?.time ? 
            formatLocalDateTime(todayAttendance.checkOut.time) : null,
          attendanceDate: formatLocalDateTime(todayAttendance.date)
        } : null
      }
    });

  } catch (error) {
    console.error('Error fetching employee attendance detail:', error);
    errorHandler(error, req, res);
  }
});

// Get attendance by department and date
router.get('/department/:department', authMiddleware, async (req, res) => {
  try {
    const { department } = req.params;
    const { date } = req.query;

    const attendanceDate = date ? new Date(date) : new Date();
    const attendance = await Attendance.findByDepartmentAndDate(department, attendanceDate);

    res.json({
      success: true,
      data: attendance,
      date: attendanceDate
    });
  } catch (error) {
    errorHandler(error, req, res);
  }
});

// Process and save all biometric data to attendance database
router.post('/process-biometric-data', authMiddleware, async (req, res) => {
  try {
    
    // Connect to ZKTeco device and get data
    await zktecoService.connect('splaza.nayatel.net', 4370);
    const rawData = await zktecoService.getAttendanceData();
    await zktecoService.disconnect();
    
    if (!rawData.success || !rawData.data || rawData.data.length === 0) {
      return res.json({
        success: true,
        message: 'No attendance data found on biometric device',
        data: {
          processed: 0,
          created: 0,
          updated: 0,
          errors: 0
        }
      });
    }

    // Filter out invalid records first
    const validRecords = rawData.data.filter(record => {
      const employeeId = record.uid || record.userId || record.deviceUserId;
      const timestamp = record.timestamp || record.recordTime;
      
      if (!employeeId || !timestamp || timestamp === undefined) {
        return false;
      }
      
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return false;
      }
      
      return true;
    });

    // Process each record
    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails = [];

    for (const record of validRecords) {
      try {
        const employeeId = record.uid || record.userId || record.deviceUserId;
        const timestamp = new Date(record.timestamp || record.recordTime);
        
        // Find employee by employeeId
        const employee = await Employee.findOne({ employeeId: employeeId.toString() });
        
        if (!employee) {
          errorDetails.push({
            employeeId,
            timestamp: record.timestamp || record.recordTime,
            error: 'Employee not found in database'
          });
          errors++;
          continue;
        }

        // Get date (without time) for grouping
        const attendanceDate = new Date(timestamp);
        attendanceDate.setHours(0, 0, 0, 0);

        // Find existing attendance record for this employee and date
        let attendance = await Attendance.findOne({
          employee: employee._id,
          date: {
            $gte: attendanceDate,
            $lt: new Date(attendanceDate.getTime() + 24 * 60 * 60 * 1000)
          },
          isActive: true
        });

        const isCheckIn = record.state === 1 || record.state === '1' || record.state === 'IN';
        
        if (!attendance) {
          // Create new attendance record
          attendance = new Attendance({
            employee: employee._id,
            date: attendanceDate,
            status: 'Present',
            isActive: true,
            createdBy: req.user.id
          });

          // Set check-in or check-out
          if (isCheckIn) {
            attendance.checkIn = {
              time: timestamp,
              location: 'Biometric Device',
              method: 'Biometric'
            };
          } else {
            attendance.checkOut = {
              time: timestamp,
              location: 'Biometric Device',
              method: 'Biometric'
            };
          }

          await attendance.save();
          created++;
        } else {
          // Update existing attendance record
          let needsUpdate = false;

          if (isCheckIn) {
            if (!attendance.checkIn || !attendance.checkIn.time || timestamp < attendance.checkIn.time) {
              attendance.checkIn = {
                time: timestamp,
                location: 'Biometric Device',
                method: 'Biometric'
              };
              needsUpdate = true;
            }
          } else {
            if (!attendance.checkOut || !attendance.checkOut.time || timestamp > attendance.checkOut.time) {
              attendance.checkOut = {
                time: timestamp,
                location: 'Biometric Device',
                method: 'Biometric'
              };
              needsUpdate = true;
            }
          }

          if (needsUpdate) {
            attendance.updatedBy = req.user.id;
            await attendance.save();
            updated++;
          }
        }

        processed++;
      } catch (error) {
        console.error(`❌ Error processing record for employee ${record.uid || record.userId || record.deviceUserId}:`, error.message);
        errorDetails.push({
          employeeId: record.uid || record.userId || record.deviceUserId,
          timestamp: record.timestamp || record.recordTime,
          error: error.message
        });
        errors++;
      }
    }

    res.json({
      success: true,
      message: 'Biometric data processing completed successfully',
      data: {
        totalRawRecords: rawData.data.length,
        validRecords: validRecords.length,
        processed,
        created,
        updated,
        errors,
        errorDetails: errorDetails.slice(0, 10), // Limit error details in response
        summary: `Processed ${processed} records, created ${created} new attendance records, updated ${updated} existing records`
      }
    });

  } catch (error) {
    console.error('Error processing biometric data:', error);
    errorHandler(error, req, res);
  }
});

// Bulk create attendance records
router.post('/bulk', authMiddleware, async (req, res) => {
  try {
    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Records array is required and must not be empty'
      });
    }

    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: 0,
      errorDetails: []
    };

    for (const record of records) {
      try {
        const result = await attendanceService.createOrUpdateAttendance({
          ...record,
          createdBy: req.user.id
        });

        results.processed++;
        if (result.action === 'created') {
          results.created++;
        } else {
          results.updated++;
        }
      } catch (error) {
        results.errors++;
        results.errorDetails.push({
          record,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: 'Bulk attendance creation completed',
      data: results
    });
  } catch (error) {
    errorHandler(error, req, res);
  }
});

// Get latest attendance record
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    // Find the most recent attendance record based on updatedAt timestamp
    const latestAttendance = await Attendance.findOne({ isActive: true })
      .populate('employee', 'firstName lastName employeeId')
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (!latestAttendance) {
      return res.status(404).json({
        success: false,
        message: 'No attendance records found'
      });
    }

    // Format the response with Pakistan timezone
    const formattedAttendance = {
      ...latestAttendance,
      checkInTime: latestAttendance.checkIn?.time ? 
        formatLocalDateTime(latestAttendance.checkIn.time) : null,
      checkOutTime: latestAttendance.checkOut?.time ? 
        formatLocalDateTime(latestAttendance.checkOut.time) : null,
      attendanceDate: formatLocalDateTime(latestAttendance.date),
      lastUpdated: formatLocalDateTime(latestAttendance.updatedAt)
    };

    res.json({
      success: true,
      message: 'Latest attendance record retrieved successfully',
      data: formattedAttendance
    });

  } catch (error) {
    console.error('Error fetching latest attendance:', error);
    errorHandler(error, req, res);
  }
});

// Fetch ZKTeco attendance on-demand
router.post('/fetch-zkteco', authMiddleware, async (req, res) => {
  try {
    
    // Get the ZKTeco integration configuration
    const BiometricIntegration = require('../models/hr/BiometricIntegration');
    const zktecoIntegration = await BiometricIntegration.findOne({
      systemName: 'ZKTeco',
      isActive: true
    });

    if (!zktecoIntegration) {
      return res.status(404).json({
        success: false,
        message: 'ZKTeco integration not found or inactive'
      });
    }

    // Use the existing zktecoService to fetch attendance
    const fetchResult = await zktecoService.fetchAttendanceFromDevice(
      zktecoIntegration,
      req.query.startDate,
      req.query.endDate
    );

    // Update the last sync time to now (since we're fetching on-demand)
    await BiometricIntegration.findByIdAndUpdate(
      zktecoIntegration._id,
      {
        $set: {
          'syncConfig.lastSyncAt': new Date(),
          'syncConfig.syncStatus': 'completed'
        }
      }
    );

    res.json({
      success: true,
      message: 'ZKTeco attendance fetched successfully',
      data: {
        recordsProcessed: fetchResult.recordsProcessed || 0,
        recordsCreated: fetchResult.recordsCreated || 0,
        recordsUpdated: fetchResult.recordsUpdated || 0,
        lastSyncAt: new Date(),
        deviceInfo: {
          systemName: zktecoIntegration.systemName,
          location: zktecoIntegration.location || 'Office',
          lastSync: new Date()
        }
      }
    });

  } catch (error) {
    console.error('Error fetching ZKTeco attendance:', error);
    errorHandler(error, req, res);
  }
});

// Manual sync attendance from ZKTeco device
router.post('/sync-from-device', authMiddleware, async (req, res) => {
  try {
    // Check if user has admin permissions
    if (req.user.role !== 'admin' && req.user.role !== 'hr_manager') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions. Only admins and HR managers can trigger manual syncs.'
      });
    }

    // Import the sync script functionality
    const zktecoService = require('../services/zktecoService');
    const { processZKTecoTimestamp, formatLocalDateTime } = require('../utils/timezoneHelper');

    // Connect to ZKTeco device
    await zktecoService.connect('splaza.nayatel.net', 4370);

    // Get attendance data from device
    const attendanceData = await zktecoService.getAttendanceData();
    
    if (!attendanceData.success || !attendanceData.data) {
      throw new Error('Failed to get attendance data from device');
    }

    // Get today's date range in Pakistan timezone
    const today = new Date();
    const pakistanOffset = 5 * 60 * 60 * 1000; // UTC+5 for Pakistan
    const todayStart = new Date(today.getTime() - pakistanOffset);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Filter records for today
    const todayRecords = attendanceData.data.filter(record => {
      const recordDate = new Date(record.recordTime);
      return recordDate >= todayStart && recordDate < todayEnd;
    });

    if (todayRecords.length === 0) {
      await zktecoService.disconnect();
      return res.json({
        success: true,
        message: 'No attendance records found for today on the device',
        data: {
          totalRecords: attendanceData.data.length,
          todayRecords: 0,
          created: 0,
          updated: 0,
          errors: 0
        }
      });
    }

    // Process records and save to database
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const record of todayRecords) {
      try {
        const employeeId = record.deviceUserId || record.userId;
        const rawTimestamp = record.recordTime;
        const timestamp = processZKTecoTimestamp(rawTimestamp);
        
        if (!timestamp) {
          console.warn(`⚠️ Invalid timestamp for employee ${employeeId}: ${rawTimestamp}`);
          continue;
        }

        // Find employee
        const employee = await Employee.findOne({ employeeId: employeeId.toString() });
        if (!employee) {
          console.warn(`⚠️ Employee not found: ${employeeId}`);
          errors++;
          continue;
        }

        // Get attendance date
        const attendanceDate = new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate());

        // Find existing attendance record
        let attendance = await Attendance.findOne({
          employee: employee._id,
          date: {
            $gte: attendanceDate,
            $lt: new Date(attendanceDate.getTime() + 24 * 60 * 60 * 1000)
          },
          isActive: true
        });

        if (!attendance) {
          // Create new attendance record
          attendance = new Attendance({
            employee: employee._id,
            date: attendanceDate,
            status: 'Present',
            isActive: true
          });
          created++;
        } else {
          updated++;
        }

        // Update check-in/check-out times
        if (record.state === 1 || record.state === '1' || record.state === 'IN') {
          attendance.checkIn = {
            time: timestamp,
            location: 'Biometric Device',
            method: 'Biometric'
          };
        } else {
          attendance.checkOut = {
            time: timestamp,
            location: 'Biometric Device',
            method: 'Biometric'
          };
        }

        await attendance.save();

      } catch (error) {
        console.error(`❌ Error processing record for employee ${record.deviceUserId || record.userId}:`, error.message);
        errors++;
      }
    }

    // Disconnect from device
    await zktecoService.disconnect();

    res.json({
      success: true,
      message: 'Manual attendance sync completed successfully',
      data: {
        totalRecords: attendanceData.data.length,
        todayRecords: todayRecords.length,
        created,
        updated,
        errors
      }
    });

  } catch (error) {
    console.error('❌ Error during manual attendance sync:', error);
    errorHandler(error, req, res);
  }
});

// ===== ZKBio Time Integration Endpoints =====

// Sync attendance from ZKBio Time system
router.post('/sync-zkbio-time', authMiddleware, async (req, res) => {
  try {
    // Check if user has admin permissions
    if (req.user.role !== 'admin' && req.user.role !== 'hr_manager') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions. Only admins and HR managers can trigger ZKBio Time syncs.'
      });
    }

    const { startDate, endDate } = req.body;
    
    // Set default date range (last 7 days if not specified)
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date();
    if (!startDate) {
      start.setDate(start.getDate() - 7); // Default to last 7 days
    }

    console.log(`🔄 Starting ZKBio Time sync from ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`);

    // Use the ZKBio Time service to sync attendance
    const result = await zkbioTimeService.syncAttendanceToDatabase(start, end);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'ZKBio Time attendance sync completed successfully',
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'ZKBio Time sync failed',
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Error during ZKBio Time sync:', error);
    errorHandler(error, req, res);
  }
});

// Get employees from ZKBio Time system
router.get('/zkbio-time/employees', authMiddleware, async (req, res) => {
  try {
    // Check if user has admin permissions
    if (req.user.role !== 'admin' && req.user.role !== 'hr_manager') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions. Only admins and HR managers can access ZKBio Time data.'
      });
    }

    const result = await zkbioTimeService.getEmployees();
    
    res.json({
      success: result.success,
      message: result.success ? 'Employees retrieved successfully' : 'Failed to retrieve employees',
      data: result.data,
      count: result.count,
      source: 'ZKBio Time System'
    });

  } catch (error) {
    console.error('❌ Error fetching ZKBio Time employees:', error);
    errorHandler(error, req, res);
  }
});

// Get attendance records from ZKBio Time system
router.get('/zkbio-time/attendance', authMiddleware, async (req, res) => {
  try {
    // Check if user has admin permissions
    if (req.user.role !== 'admin' && req.user.role !== 'hr_manager') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions. Only admins and HR managers can access ZKBio Time data.'
      });
    }

    const { startDate, endDate } = req.query;
    
    // Set default date range (last 7 days if not specified)
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date();
    if (!startDate) {
      start.setDate(start.getDate() - 7); // Default to last 7 days
    }

    const result = await zkbioTimeService.getAttendanceRecords(start, end);
    
    res.json({
      success: result.success,
      message: result.success ? 'Attendance records retrieved successfully' : 'Failed to retrieve attendance records',
      data: result.data,
      count: result.count,
      dateRange: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      },
      source: 'ZKBio Time System'
    });

  } catch (error) {
    console.error('❌ Error fetching ZKBio Time attendance:', error);
    errorHandler(error, req, res);
  }
});

// Get real-time attendance from ZKBio Time system
router.get('/zkbio-time/realtime', authMiddleware, async (req, res) => {
  try {
    // Check if user has admin permissions
    if (req.user.role !== 'admin' && req.user.role !== 'hr_manager') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions. Only admins and HR managers can access ZKBio Time real-time data.'
      });
    }

    const result = await zkbioTimeService.getRealTimeAttendance();
    
    res.json({
      success: result.success,
      message: result.success ? 'Real-time attendance retrieved successfully' : 'Failed to retrieve real-time attendance',
      data: result.data,
      count: result.count,
      timestamp: result.timestamp,
      source: 'ZKBio Time System'
    });

  } catch (error) {
    console.error('❌ Error fetching ZKBio Time real-time attendance:', error);
    errorHandler(error, req, res);
  }
});

// Test ZKBio Time connection
router.get('/zkbio-time/test-connection', authMiddleware, async (req, res) => {
  try {
    // Check if user has admin permissions
    if (req.user.role !== 'admin' && req.user.role !== 'hr_manager') {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions. Only admins and HR managers can test ZKBio Time connection.'
      });
    }

    const result = await zkbioTimeService.testConnection();
    
    res.json({
      success: result.success,
      message: result.message,
      data: {
        server: result.server || 'ZKBio Time',
        status: result.status,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Error testing ZKBio Time connection:', error);
    errorHandler(error, req, res);
  }
});

module.exports = router; 