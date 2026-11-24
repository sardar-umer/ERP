const express = require('express');
const router = express.Router();
const Attendance = require('../models/hr/Attendance');
const Employee = require('../models/hr/Employee');
const Department = require('../models/hr/Department');
const mongoose = require('mongoose');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { excludeApprovalNotGiven } = require('../utils/employeeApprovalScope');

console.log('🔧 AttendanceReports routes loaded successfully');

// Months array for display
const months = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
];

// ==================== ATTENDANCE REPORTS ROUTES ====================

// @route   GET /api/hr/reports/attendance/monthly
// @desc    Generate monthly attendance report
// @access  Private (HR and Admin)
router.get('/monthly', 
  authorize('admin', 'hr_manager', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { month, year, department, format = 'json' } = req.query;
    
    try {
      // Build base filter
      const baseFilter = {};
      if (department) {
        // Filter by employee's department
        const employeesInDepartment = await Employee.find({ department: new mongoose.Types.ObjectId(department) }).select('_id');
        const employeeIds = employeesInDepartment.map(emp => emp._id);
        baseFilter.employee = { $in: employeeIds };
      }

      // Get attendance data for the specified month/year using aggregation
      const attendanceData = await Attendance.aggregate([
        {
          $match: {
            ...baseFilter,
            ...(await excludeApprovalNotGiven()),
            $expr: {
              $and: [
                { $eq: [{ $month: '$date' }, parseInt(month)] },
                { $eq: [{ $year: '$date' }, parseInt(year)] }
              ]
            }
          }
        },
        {
          $lookup: {
            from: 'employees',
            localField: 'employee',
            foreignField: '_id',
            as: 'employeeData'
          }
        },
        {
          $lookup: {
            from: 'departments',
            localField: 'employeeData.department',
            foreignField: '_id',
            as: 'departmentData'
          }
        },
        {
          $unwind: {
            path: '$employeeData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$departmentData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            'employee': {
              firstName: '$employeeData.firstName',
              lastName: '$employeeData.lastName',
              employeeId: '$employeeData.employeeId'
            },
            'department': {
              name: '$departmentData.name'
            },
            'employeeIdNumeric': {
              $toInt: { $ifNull: ['$employeeData.employeeId', '0'] }
            }
          }
        },
        {
          $sort: { 'employeeIdNumeric': 1, 'date': 1 }
        },
        {
          $project: {
            employee: 1,
            department: 1,
            date: 1,
            status: 1,
            checkIn: 1,
            checkOut: 1,
            workHours: 1,
            overtimeHours: 1,
            breakTime: 1,
            notes: 1
          }
        }
      ]);

      // Check if data exists
      if (attendanceData.length === 0) {
        return res.json({
          success: false,
          message: `No attendance data found for ${months[parseInt(month) - 1]?.label || month}/${year}`,
          data: null
        });
      }

      // Calculate summary
      const summary = {
        totalRecords: attendanceData.length,
        totalWorkHours: attendanceData.reduce((sum, record) => sum + (record.workHours || 0), 0),
        totalOvertimeHours: attendanceData.reduce((sum, record) => sum + (record.overtimeHours || 0), 0),
        statusCounts: {
          Present: attendanceData.filter(r => r.status === 'Present').length,
          Absent: attendanceData.filter(r => r.status === 'Absent').length,
          Late: attendanceData.filter(r => r.status === 'Late').length,
          'Half Day': attendanceData.filter(r => r.status === 'Half Day').length,
          Leave: attendanceData.filter(r => ['Leave', 'Sick Leave', 'Personal Leave', 'Maternity Leave', 'Paternity Leave'].includes(r.status)).length
        }
      };

      // Transform data for frontend
      const transformedData = attendanceData.map(record => ({
        employeeName: `${record.employee?.firstName || ''} ${record.employee?.lastName || ''}`.trim(),
        employeeId: record.employee?.employeeId || 'N/A',
        department: record.department?.name || 'N/A',
        date: record.date,
        status: record.status || 'N/A',
        checkIn: record.checkIn?.time ? new Date(record.checkIn.time).toLocaleTimeString() : 'N/A',
        checkOut: record.checkOut?.time ? new Date(record.checkOut.time).toLocaleTimeString() : 'N/A',
        workHours: record.workHours || 0,
        overtimeHours: record.overtimeHours || 0,
        breakTime: record.breakTime || 0,
        notes: record.notes || ''
      }));

      const reportData = {
        summary,
        data: transformedData,
        filters: {
          month: parseInt(month),
          year: parseInt(year),
          department: department || 'All'
        },
        generatedAt: new Date(),
        reportType: 'monthly_attendance'
      };

      // Handle different formats
      if (format === 'csv') {
        const csvData = convertToCSV(reportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=monthly-attendance-${month}-${year}.csv`);
        return res.send(csvData);
      }

      res.json({
        success: true,
        data: reportData
      });

    } catch (error) {
      console.error('Error generating monthly attendance report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating monthly attendance report',
        error: error.message
      });
    }
  })
);

// @route   GET /api/hr/reports/attendance/department
// @desc    Generate department-wise attendance report
// @access  Private (HR and Admin)
router.get('/department', 
  authorize('admin', 'hr_manager', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { month, year, format = 'json' } = req.query;
    
    try {
      // Get attendance data grouped by department
      const attendanceData = await Attendance.aggregate([
        {
          $match: {
            ...(await excludeApprovalNotGiven()),
            $expr: {
              $and: [
                { $eq: [{ $month: '$date' }, parseInt(month)] },
                { $eq: [{ $year: '$date' }, parseInt(year)] }
              ]
            }
          }
        },
        {
          $lookup: {
            from: 'employees',
            localField: 'employee',
            foreignField: '_id',
            as: 'employeeData'
          }
        },
        {
          $lookup: {
            from: 'departments',
            localField: 'employeeData.department',
            foreignField: '_id',
            as: 'departmentData'
          }
        },
        {
          $unwind: {
            path: '$employeeData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$departmentData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$departmentData._id',
            departmentName: { $first: '$departmentData.name' },
            totalRecords: { $sum: 1 },
            totalWorkHours: { $sum: '$workHours' },
            totalOvertimeHours: { $sum: '$overtimeHours' },
            presentCount: { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } },
            absentCount: { $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] } },
            lateCount: { $sum: { $cond: [{ $eq: ['$status', 'Late'] }, 1, 0] } },
            leaveCount: { $sum: { $cond: [{ $in: ['$status', ['Leave', 'Sick Leave', 'Personal Leave', 'Maternity Leave', 'Paternity Leave']] }, 1, 0] } },
            averageWorkHours: { $avg: '$workHours' }
          }
        },
        {
          $sort: { totalWorkHours: -1 }
        }
      ]);

      // Check if data exists
      if (attendanceData.length === 0) {
        return res.json({
          success: false,
          message: `No attendance data found for ${months[parseInt(month) - 1]?.label || month}/${year}`,
          data: null
        });
      }

      // Calculate summary
      const summary = {
        totalDepartments: attendanceData.length,
        totalRecords: attendanceData.reduce((sum, dept) => sum + dept.totalRecords, 0),
        totalWorkHours: attendanceData.reduce((sum, dept) => sum + dept.totalWorkHours, 0),
        totalOvertimeHours: attendanceData.reduce((sum, dept) => sum + dept.totalOvertimeHours, 0)
      };

      const reportData = {
        summary,
        data: attendanceData,
        filters: {
          month: parseInt(month),
          year: parseInt(year)
        },
        generatedAt: new Date(),
        reportType: 'department_attendance'
      };

      // Handle different formats
      if (format === 'csv') {
        const csvData = convertToCSV(reportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=department-attendance-${month}-${year}.csv`);
        return res.send(csvData);
      }

      res.json({
        success: true,
        data: reportData
      });

    } catch (error) {
      console.error('Error generating department attendance report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating department attendance report',
        error: error.message
      });
    }
  })
);

// @route   GET /api/hr/reports/attendance/summary
// @desc    Generate attendance summary report
// @access  Private (HR and Admin)
router.get('/summary', 
  authorize('admin', 'hr_manager', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { month, year, format = 'json' } = req.query;
    
    try {
      // Get attendance summary data
      const summaryData = await Attendance.aggregate([
        {
          $match: {
            ...(await excludeApprovalNotGiven()),
            $expr: {
              $and: [
                { $eq: [{ $month: '$date' }, parseInt(month)] },
                { $eq: [{ $year: '$date' }, parseInt(year)] }
              ]
            }
          }
        },
        {
          $lookup: {
            from: 'employees',
            localField: 'employee',
            foreignField: '_id',
            as: 'employeeData'
          }
        },
        {
          $lookup: {
            from: 'departments',
            localField: 'employeeData.department',
            foreignField: '_id',
            as: 'departmentData'
          }
        },
        {
          $unwind: {
            path: '$employeeData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$departmentData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$employee',
            employeeName: { $first: { $concat: ['$employeeData.firstName', ' ', '$employeeData.lastName'] } },
            employeeId: { $first: '$employeeData.employeeId' },
            department: { $first: '$departmentData.name' },
            totalDays: { $sum: 1 },
            presentDays: { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } },
            absentDays: { $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] } },
            lateDays: { $sum: { $cond: [{ $eq: ['$status', 'Late'] }, 1, 0] } },
            leaveDays: { $sum: { $cond: [{ $in: ['$status', ['Leave', 'Sick Leave', 'Personal Leave', 'Maternity Leave', 'Paternity Leave']] }, 1, 0] } },
            totalWorkHours: { $sum: '$workHours' },
            totalOvertimeHours: { $sum: '$overtimeHours' },
            averageWorkHours: { $avg: '$workHours' }
          }
        },
        {
          $addFields: {
            attendancePercentage: {
              $multiply: [
                { $divide: ['$presentDays', '$totalDays'] },
                100
              ]
            }
          }
        },
        {
          $sort: { 'employeeId': 1 }
        }
      ]);

      // Check if data exists
      if (summaryData.length === 0) {
        return res.json({
          success: false,
          message: `No attendance data found for ${months[parseInt(month) - 1]?.label || month}/${year}`,
          data: null
        });
      }

      // Calculate overall summary
      const overallSummary = {
        totalEmployees: summaryData.length,
        totalDays: summaryData.reduce((sum, emp) => sum + emp.totalDays, 0),
        totalPresentDays: summaryData.reduce((sum, emp) => sum + emp.presentDays, 0),
        totalAbsentDays: summaryData.reduce((sum, emp) => sum + emp.absentDays, 0),
        totalLateDays: summaryData.reduce((sum, emp) => sum + emp.lateDays, 0),
        totalLeaveDays: summaryData.reduce((sum, emp) => sum + emp.leaveDays, 0),
        totalWorkHours: summaryData.reduce((sum, emp) => sum + emp.totalWorkHours, 0),
        totalOvertimeHours: summaryData.reduce((sum, emp) => sum + emp.totalOvertimeHours, 0),
        averageAttendancePercentage: summaryData.reduce((sum, emp) => sum + emp.attendancePercentage, 0) / summaryData.length
      };

      const reportData = {
        summary: overallSummary,
        data: summaryData,
        filters: {
          month: parseInt(month),
          year: parseInt(year)
        },
        generatedAt: new Date(),
        reportType: 'attendance_summary'
      };

      // Handle different formats
      if (format === 'csv') {
        const csvData = convertToCSV(reportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance-summary-${month}-${year}.csv`);
        return res.send(csvData);
      }

      res.json({
        success: true,
        data: reportData
      });

    } catch (error) {
      console.error('Error generating attendance summary report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating attendance summary report',
        error: error.message
      });
    }
  })
);

// Helper function to convert data to CSV
function convertToCSV(reportData) {
  if (!reportData.data || reportData.data.length === 0) {
    return 'No data available';
  }

  const headers = Object.keys(reportData.data[0]);
  const csvContent = [
    headers.join(','),
    ...reportData.data.map(row => 
      headers.map(header => {
        const value = row[header];
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value}"`;
        }
        return value;
      }).join(',')
    )
  ].join('\n');

  return csvContent;
}

module.exports = router;
