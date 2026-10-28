const express = require('express');
const {
  vehicleFuelTotal,
  vehicleAllowanceAmount,
  fuelAllowanceAmount
} = require('../utils/allowanceHelpers');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const Employee = require('../models/hr/Employee');
const Payroll = require('../models/hr/Payroll');
const Department = require('../models/hr/Department');
const mongoose = require('mongoose');

const router = express.Router();

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

/**
 * Attendance deduction is excluded from monthly payroll CSV / Net Pay only:
 * - column hidden
 * - amount added back into Net Payable (net does not apply attendance deduction)
 * - Gross Salary / Total Earnings stay full (never reduced by attendance)
 */
const shouldExcludeAttendanceDeduction = () => true;

const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Adjust export totals so attendance deduction does not affect Net Pay (Gross unchanged). */
const applyAttendanceExclusion = (row, exclude) => {
  const attendanceDeduction = roundMoney(row.attendanceDeduction);
  if (!exclude || attendanceDeduction <= 0) {
    return {
      ...row,
      attendanceDeduction: exclude ? 0 : attendanceDeduction,
      deductions: roundMoney(row.deductions),
      totalDeductions: roundMoney(row.deductions ?? row.totalDeductions),
      netPay: roundMoney(row.netPay ?? row.netPayable),
      netPayable: roundMoney(row.netPayable ?? row.netPay)
    };
  }
  const deductions = Math.max(0, roundMoney((row.deductions ?? row.totalDeductions) - attendanceDeduction));
  // Net without attendance deduction applied; Gross stays as stored (full).
  const netPay = roundMoney((row.netPay ?? row.netPayable) + attendanceDeduction);
  return {
    ...row,
    attendanceDeduction: 0,
    deductions,
    totalDeductions: deductions,
    grossSalary: roundMoney(row.grossSalary || 0),
    totalEarnings: roundMoney(row.totalEarnings || 0),
    netPay,
    netPayable: netPay
  };
};

/**
 * One-month salary % cut: payroll stores earnings already scaled down.
 * For the export, restore earnings columns to full and show the cut amount
 * in "Salary Deduction" (included in Total Deductions). Net Pay is unchanged.
 */
const SALARY_CUT_EARNING_FIELDS = [
  'grossSalary',
  'basicSalary',
  'houseRent',
  'medical',
  'arrears',
  'conveyanceAllowance',
  'houseAllowance',
  'foodAllowance',
  'vehicleAllowance',
  'fuelAllowance',
  'vehicleFuelAllowance',
  'medicalAllowance',
  'mobileAllowance',
  'totalEarnings'
];

const applySalaryCutPresentation = (row, salaryPercentageCut) => {
  const pct = Number(salaryPercentageCut?.percentage);
  let factor = Number(salaryPercentageCut?.factor);
  if (!Number.isFinite(factor) || factor <= 0) {
    factor = Number.isFinite(pct) && pct > 0 && pct < 100 ? (100 - pct) / 100 : 0;
  }
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) {
    return { ...row, salaryDeduction: 0 };
  }

  const next = { ...row };
  for (const field of SALARY_CUT_EARNING_FIELDS) {
    next[field] = Math.round((Number(row[field]) || 0) / factor);
  }
  const salaryDeduction = Math.max(0, next.totalEarnings - Math.round(Number(row.totalEarnings) || 0));
  next.salaryDeduction = salaryDeduction;
  next.deductions = roundMoney((Number(row.deductions) || 0) + salaryDeduction);
  next.totalDeductions = next.deductions;
  next.salaryCutPercentage = pct;
  return next;
};

// ==================== PAYROLL REPORTS ROUTES ====================

// @route   GET /api/hr/reports/payroll/monthly
// @desc    Generate monthly payroll report
// @access  Private (HR and Admin)
router.get('/monthly', 
  authorize('super_admin', 'admin', 'hr_manager', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { month, year, department, project, format = 'json' } = req.query;

    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    if (!monthNum || monthNum < 1 || monthNum > 12 || !yearNum || yearNum < 2020 || yearNum > 2035) {
      return res.status(400).json({
        success: false,
        message: 'Valid month (1–12) and year are required to export payroll.'
      });
    }
    
    try {
      // Build base filter
      const baseFilter = {};
      if (department) {
        // Filter by employee's department (legacy) or placementDepartment (current)
        const deptOid = new mongoose.Types.ObjectId(department);
        const employeesInDepartment = await Employee.find({
          $or: [{ department: deptOid }, { placementDepartment: deptOid }]
        }).select('_id');
        const employeeIds = employeesInDepartment.map(emp => emp._id);
        baseFilter.employee = { $in: employeeIds };
      }
      
      if (project) {
        // Filter by employee's project
        const employeesInProject = await Employee.find({ placementProject: new mongoose.Types.ObjectId(project) }).select('_id');
        const employeeIds = employeesInProject.map(emp => emp._id);
        if (baseFilter.employee) {
          // If department filter is also applied, intersect the results
          const departmentEmployeeIds = baseFilter.employee.$in;
          const projectEmployeeIds = employeeIds;
          const intersectionIds = departmentEmployeeIds.filter(id => projectEmployeeIds.some(pid => pid.toString() === id.toString()));
          baseFilter.employee = { $in: intersectionIds };
        } else {
          baseFilter.employee = { $in: employeeIds };
        }
      }

      // Get payroll data directly from payrolls collection for the specified month/year
      // Build payroll filter
      let payrollFilter = { 
        month: monthNum, 
        year: yearNum 
      };
      
      // Apply department and project filters by finding employees first
      if (department || project) {
        let employeeFilter = { isDeleted: false };
        if (department) {
          const deptOid = new mongoose.Types.ObjectId(department);
          employeeFilter.$or = [
            { placementDepartment: deptOid },
            { department: deptOid }
          ];
        }
        if (project) {
          employeeFilter.placementProject = new mongoose.Types.ObjectId(project);
        }
        
        const employeesInFilter = await Employee.find(employeeFilter).select('_id');
        const employeeIds = employeesInFilter.map(emp => emp._id);
        payrollFilter.employee = { $in: employeeIds };
      }

      const excludeAttendance = shouldExcludeAttendanceDeduction();

      const payrollData = await Payroll.aggregate([
        {
          $match: payrollFilter
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
          $unwind: {
            path: '$employeeData',
            preserveNullAndEmptyArrays: true
          }
        },
        // Prefer placementDepartment (current org structure); fall back to legacy department
        {
          $addFields: {
            _departmentId: {
              $ifNull: ['$employeeData.placementDepartment', '$employeeData.department']
            }
          }
        },
        {
          $lookup: {
            from: 'departments',
            localField: '_departmentId',
            foreignField: '_id',
            as: 'departmentData'
          }
        },
        {
          $lookup: {
            from: 'banks',
            localField: 'employeeData.bankName',
            foreignField: '_id',
            as: 'bankData'
          }
        },
        {
          $lookup: {
            from: 'sections',
            localField: 'employeeData.placementSection',
            foreignField: '_id',
            as: 'sectionData'
          }
        },
        {
          $lookup: {
            from: 'designations',
            localField: 'employeeData.placementDesignation',
            foreignField: '_id',
            as: 'designationData'
          }
        },
        {
          $lookup: {
            from: 'locations',
            localField: 'employeeData.placementLocation',
            foreignField: '_id',
            as: 'locationData'
          }
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'employeeData.placementProject',
            foreignField: '_id',
            as: 'projectData'
          }
        },
        {
          $lookup: {
            from: 'placementcompanies',
            localField: 'employeeData.placementCompany',
            foreignField: '_id',
            as: 'companyData'
          }
        },
        // Guardian often lives on joining document for hires after Excel-era employees
        {
          $lookup: {
            from: 'joiningdocuments',
            localField: 'employeeData.approvalId',
            foreignField: 'approvalId',
            as: 'joiningByApproval'
          }
        },
        {
          $lookup: {
            from: 'joiningdocuments',
            let: { cnic: '$employeeData.idCard' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $ne: [{ $ifNull: ['$$cnic', ''] }, ''] },
                      { $eq: ['$cnic', '$$cnic'] }
                    ]
                  }
                }
              },
              { $project: { guardianName: 1 } },
              { $limit: 1 }
            ],
            as: 'joiningByCnic'
          }
        },
        {
          $unwind: {
            path: '$departmentData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$bankData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$sectionData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$designationData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$locationData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$projectData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $unwind: {
            path: '$companyData',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            'employeeIdNumeric': {
              $convert: {
                input: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: { $ifNull: ['$employeeData.employeeId', '0'] },
                        find: ' ',
                        replacement: ''
                      }
                    }
                  }
                },
                to: 'int',
                onError: 0,
                onNull: 0
              }
            },
            'project': '$projectData.name',
            'company': '$companyData.name',
            'section': '$sectionData.name',
            'designation': '$designationData.title',
            'location': '$locationData.name',
            'resolvedGuardianName': {
              $let: {
                vars: {
                  fromEmp: { $trim: { input: { $ifNull: ['$employeeData.guardianName', ''] } } },
                  fromApproval: {
                    $trim: {
                      input: {
                        $ifNull: [{ $arrayElemAt: ['$joiningByApproval.guardianName', 0] }, '']
                      }
                    }
                  },
                  fromCnic: {
                    $trim: {
                      input: {
                        $ifNull: [{ $arrayElemAt: ['$joiningByCnic.guardianName', 0] }, '']
                      }
                    }
                  }
                },
                in: {
                  $cond: [
                    { $gt: [{ $strLenCP: '$$fromEmp' }, 0] },
                    '$$fromEmp',
                    {
                      $cond: [
                        { $gt: [{ $strLenCP: '$$fromApproval' }, 0] },
                        '$$fromApproval',
                        '$$fromCnic'
                      ]
                    }
                  ]
                }
              }
            }
          }
        },
        {
          $sort: { 'employeeIdNumeric': 1 }
        },
        {
          $project: {
            // Employee fields
            'employeeData.employeeId': 1,
            'employeeData.firstName': 1,
            'employeeData.lastName': 1,
            'employeeData.guardianName': 1,
            'employeeData.idCard': 1,
            'employeeData.branchCode': 1,
            'employeeData.accountNumber': 1,
            'employeeData.hireDate': 1,
            'employeeData.dateOfBirth': 1,
            'employeeData.address': 1,
            'employeeData.qualification': 1,
            'employeeData.phone': 1,
            'employeeData.probationPeriod': 1,
            'employeeData.joiningDate': 1,
            'employeeData.appointmentDate': 1,
            'employeeData.confirmationDate': 1,
            resolvedGuardianName: 1,
            // Payroll fields (direct from payroll collection)
            grossSalary: 1,
            totalEarnings: 1,
            totalDeductions: 1,
            netSalary: 1,
            basicSalary: 1,
            // Direct allowance fields from payroll
            conveyanceAllowance: 1,
            houseRentAllowance: 1,
            foodAllowance: 1,
            mobileAllowance: 1,
            vehicleFuelAllowance: 1,
            medicalAllowance: 1,
            // Other payroll fields
            incomeTax: 1,
            eobi: 1,
            healthInsurance: 1,
            loanDeductions: 1,
            vehicleLoanDeduction: 1,
            companyLoanDeduction: 1,
            attendanceDeduction: 1,
            otherDeductions: 1,
            // Allowances object
            allowances: 1,
            salaryPercentageCut: 1,
            // Populated fields
            'departmentData.name': 1,
            'bankData.name': 1,
            'sectionData.name': 1,
            'designationData.title': 1,
            'locationData.name': 1,
            'projectData.name': 1,
            'companyData.name': 1,
            // Attendance / proration (for EOBI contribution report)
            presentDays: 1,
            totalWorkingDays: 1,
            absentDays: 1,
            proration: 1,
            // Calculated fields
            project: 1,
            company: 1,
            section: 1,
            designation: 1,
            location: 1,
            employeeIdNumeric: 1,
            arrears: 1
          }
        }
      ]);

      // Check if data exists
      if (payrollData.length === 0) {
        const msg = `No payroll data found for ${months[monthNum - 1]?.label || month}/${year}`;
        if (format === 'csv') {
          return res.status(404).json({ success: false, message: msg, data: null });
        }
        return res.json({
          success: false,
          message: msg,
          data: null
        });
      }

      // Transform data for frontend (using payroll data directly)
      const transformedData = payrollData.map((employee) => {
        const base = {
          // Basic employee info
          employeeId: employee.employeeData?.employeeId || 'N/A',
          employeeName: `${employee.employeeData?.firstName || ''} ${employee.employeeData?.lastName || ''}`.trim(),
          guardianName: (employee.resolvedGuardianName || employee.employeeData?.guardianName || '').trim() || 'N/A',
          idCard: employee.employeeData?.idCard || 'N/A',
          bankName: employee.bankData?.name || 'N/A',
          branchCode: employee.employeeData?.branchCode || 'N/A',
          accountNumber: employee.employeeData?.accountNumber || 'N/A',
          hireDate: employee.employeeData?.hireDate || null,
          project: employee.project || 'N/A',
          company: employee.company || 'N/A',
          department: employee.departmentData?.name || 'N/A',
          section: employee.section || 'N/A',
          designation: employee.designation || 'N/A',
          location: employee.location || 'N/A',
          dateOfBirth: employee.employeeData?.dateOfBirth || null,
          address: employee.employeeData?.address?.street || 'N/A',
          qualification: employee.employeeData?.qualification || 'N/A',
          phone: employee.employeeData?.phone || 'N/A',
          probationPeriod: employee.employeeData?.probationPeriod || null,
          joiningDate: employee.employeeData?.joiningDate || null,
          appointmentDate: employee.employeeData?.appointmentDate || null,
          confirmationDate: employee.employeeData?.confirmationDate || null,
          // Salary fields from payroll data (direct from payroll collection)
          grossSalary: employee.grossSalary || 0,
          basicSalary: employee.basicSalary || 0,
          houseRent: employee.houseRentAllowance || 0,
          medical: employee.medicalAllowance || 0,
          arrears: employee.arrears || 0,
          conveyanceAllowance: employee.allowances?.conveyance?.amount || 0,
          houseAllowance: employee.allowances?.houseRent?.amount || 0,
          foodAllowance: employee.allowances?.food?.amount || 0,
          vehicleAllowance: vehicleAllowanceAmount(employee.allowances),
          fuelAllowance: fuelAllowanceAmount(employee.allowances),
          vehicleFuelAllowance: vehicleFuelTotal(employee.allowances),
          medicalAllowance: employee.allowances?.medical?.amount || 0,
          mobileAllowance: employee.allowances?.mobile?.amount || 0,
          totalEarnings: employee.totalEarnings || 0,
          incomeTax: employee.incomeTax || 0,
          companyLoan: employee.loanDeductions || employee.companyLoanDeduction || 0,
          vehicleLoan: employee.vehicleLoanDeduction || 0,
          eobiDeduction: employee.eobi || 0,
          netPayable: employee.netSalary || 0,
          netPay: employee.netSalary || 0,
          deductions: employee.totalDeductions || 0,
          tax: employee.incomeTax || 0,
          eobi: employee.eobi || 0,
          healthInsurance: employee.healthInsurance || 0,
          vehicleLoanDeduction: employee.vehicleLoanDeduction || 0,
          companyLoanDeduction: employee.loanDeductions || employee.companyLoanDeduction || 0,
          attendanceDeduction: employee.attendanceDeduction || 0,
          otherDeductions: employee.otherDeductions || 0,
          presentDays: employee.presentDays ?? null,
          totalWorkingDays: employee.totalWorkingDays ?? null,
          proration: employee.proration || null
        };
        const withCut = applySalaryCutPresentation(base, employee.salaryPercentageCut);
        return applyAttendanceExclusion(withCut, excludeAttendance);
      });

      // Summary uses adjusted export figures (attendance excluded when applicable)
      const summary = {
        totalEmployees: transformedData.length,
        totalGrossSalary: transformedData.reduce((sum, emp) => sum + (emp.grossSalary || 0), 0),
        totalDeductions: transformedData.reduce((sum, emp) => sum + (emp.deductions || 0), 0),
        netPay: transformedData.reduce((sum, emp) => sum + (emp.netPay || 0), 0)
      };

      const reportData = {
        summary,
        data: transformedData,
        filters: {
          month: parseInt(month),
          year: parseInt(year),
          department: department || 'All',
          excludeAttendanceDeduction: excludeAttendance
        },
        generatedAt: new Date(),
        reportType: 'monthly_payroll'
      };

      // Handle different formats
      if (format === 'csv') {
        const csvData = convertToCSV(reportData, { excludeAttendanceDeduction: excludeAttendance });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=monthly-payroll-${month}-${year}.csv`);
        return res.send(csvData);
      }

      res.json({
        success: true,
        data: reportData
      });

    } catch (error) {
      console.error('Error generating monthly payroll report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating monthly payroll report',
        error: error.message
      });
    }
  })
);

// @route   GET /api/hr/reports/payroll/department
// @desc    Generate department-wise payroll report
// @access  Private (HR and Admin)
router.get('/department', 
  authorize('admin', 'hr_manager', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { month, year, format = 'json' } = req.query;
    
    try {
      // Get payroll data grouped by department
      const payrollData = await Payroll.aggregate([
        {
          $match: {
            month: parseInt(month),
            year: parseInt(year)
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
            totalEmployees: { $sum: 1 },
            totalGrossSalary: { $sum: '$grossSalary' },
            totalDeductions: { $sum: '$totalDeductions' },
            totalNetPay: { $sum: '$netSalary' },
            averageSalary: { $avg: '$grossSalary' }
          }
        },
        {
          $sort: { totalGrossSalary: -1 }
        }
      ]);

      // Check if data exists
      if (payrollData.length === 0) {
        return res.json({
          success: false,
          message: `No payroll data found for ${months[parseInt(month) - 1]?.label || month}/${year}`,
          data: null
        });
      }

      // Calculate overall summary
      const summary = {
        totalDepartments: payrollData.length,
        totalEmployees: payrollData.reduce((sum, dept) => sum + dept.totalEmployees, 0),
        totalGrossSalary: payrollData.reduce((sum, dept) => sum + dept.totalGrossSalary, 0),
        totalDeductions: payrollData.reduce((sum, dept) => sum + dept.totalDeductions, 0),
        totalNetPay: payrollData.reduce((sum, dept) => sum + dept.totalNetPay, 0)
      };

      // Transform data for frontend
      const transformedData = payrollData.map(dept => ({
        departmentName: dept.departmentName || 'N/A',
        totalEmployees: dept.totalEmployees,
        totalGrossSalary: dept.totalGrossSalary,
        totalDeductions: dept.totalDeductions,
        totalNetPay: dept.totalNetPay,
        averageSalary: Math.round(dept.averageSalary || 0)
      }));

      const reportData = {
        summary,
        data: transformedData,
        filters: {
          month: parseInt(month),
          year: parseInt(year)
        },
        generatedAt: new Date(),
        reportType: 'department_payroll'
      };

      // Handle different formats
      if (format === 'csv') {
        const csvData = convertToCSV(reportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=department-payroll-${month}-${year}.csv`);
        return res.send(csvData);
      }

      res.json({
        success: true,
        data: reportData
      });

    } catch (error) {
      console.error('Error generating department payroll report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating department payroll report',
        error: error.message
      });
    }
  })
);

// @route   GET /api/hr/reports/payroll/salary
// @desc    Generate salary analysis report
// @access  Private (HR and Admin)
router.get('/salary', 
  authorize('admin', 'hr_manager', 'finance_manager'), 
  asyncHandler(async (req, res) => {
    const { month, year, format = 'json' } = req.query;
    
    try {
      // Get salary distribution data
      const salaryData = await Payroll.aggregate([
        {
          $match: {
            month: parseInt(month),
            year: parseInt(year)
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
          $project: {
            employeeName: { $concat: ['$employeeData.firstName', ' ', '$employeeData.lastName'] },
            department: '$departmentData.name',
            grossSalary: 1,
            basicSalary: 1,
            allowances: 1,
            overtime: 1,
            deductions: 1,
            netSalary: 1
          }
        },
        {
          $sort: { 'employeeData.employeeId': 1 }
        }
      ]);

      // Check if data exists
      if (salaryData.length === 0) {
        return res.json({
          success: false,
          message: `No payroll data found for ${months[parseInt(month) - 1]?.label || month}/${year}`,
          data: null
        });
      }

      // Calculate salary statistics
      const salaries = salaryData.map(emp => emp.grossSalary).filter(salary => salary > 0);
      const summary = {
        totalEmployees: salaryData.length,
        averageSalary: salaries.length > 0 ? Math.round(salaries.reduce((sum, salary) => sum + salary, 0) / salaries.length) : 0,
        medianSalary: salaries.length > 0 ? Math.round(salaries.sort((a, b) => a - b)[Math.floor(salaries.length / 2)]) : 0,
        minSalary: salaries.length > 0 ? Math.min(...salaries) : 0,
        maxSalary: salaries.length > 0 ? Math.max(...salaries) : 0,
        totalGrossSalary: salaries.reduce((sum, salary) => sum + salary, 0)
      };

      // Create salary ranges
      const salaryRanges = [
        { range: '0-50,000', min: 0, max: 50000, count: 0 },
        { range: '50,001-100,000', min: 50001, max: 100000, count: 0 },
        { range: '100,001-150,000', min: 100001, max: 150000, count: 0 },
        { range: '150,001-200,000', min: 150001, max: 200000, count: 0 },
        { range: '200,001+', min: 200001, max: Infinity, count: 0 }
      ];

      salaries.forEach(salary => {
        const range = salaryRanges.find(r => salary >= r.min && salary <= r.max);
        if (range) range.count++;
      });

      const reportData = {
        summary,
        salaryRanges,
        data: salaryData,
        filters: {
          month: parseInt(month),
          year: parseInt(year)
        },
        generatedAt: new Date(),
        reportType: 'salary_analysis'
      };

      // Handle different formats
      if (format === 'csv') {
        const csvData = convertToCSV(reportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=salary-analysis-${month}-${year}.csv`);
        return res.send(csvData);
      }

      res.json({
        success: true,
        data: reportData
      });

    } catch (error) {
      console.error('Error generating salary analysis report:', error);
      res.status(500).json({
        success: false,
        message: 'Error generating salary analysis report',
        error: error.message
      });
    }
  })
);

// ==================== UTILITY FUNCTIONS ====================

// Convert data to CSV format matching Excel structure
function convertToCSV(reportData, options = {}) {
  if (!reportData.data || !Array.isArray(reportData.data)) {
    return 'No data available';
  }

  const excludeAttendanceDeduction = options.excludeAttendanceDeduction === true
    || reportData?.filters?.excludeAttendanceDeduction === true;

  // Function to convert JavaScript date to Excel serial date
  function dateToExcelSerial(date) {
    if (!date) return 'N/A';
    
    let jsDate;
    
    // Handle different date formats
    if (typeof date === 'string') {
      // If it's in DD/MM/YYYY format, parse it correctly
      if (date.includes('/')) {
        const parts = date.split('/');
        if (parts.length === 3) {
          // Assume DD/MM/YYYY format
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1; // JavaScript months are 0-indexed
          const year = parseInt(parts[2]);
          jsDate = new Date(year, month, day);
        } else {
          jsDate = new Date(date);
        }
      } else {
        jsDate = new Date(date);
      }
    } else {
      jsDate = new Date(date);
    }
    
    if (isNaN(jsDate.getTime())) return 'N/A';
    
    // Excel serial date calculation: days since December 30, 1899
    // Excel's epoch is December 30, 1899 (serial date 1)
    const excelEpoch = new Date(1899, 11, 30); // December 30, 1899
    const timeDiff = jsDate.getTime() - excelEpoch.getTime();
    const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    
    // Add 1 to match Excel's serial date system
    return daysDiff + 1;
  }

  // Excel structure headers (updated to use actual system data)
  const excelHeaders = [
    'Sr No',
    'ID',
    'Name',
    'Guardian Name',
    'CNIC',
    'Bank',
    'Branch Code',
    'Account No',
    'DOJ',
    'Project',
    'Company',
    'Department',
    'Section',
    'Designation',
    'Location',
    'DOB',
    'Address',
    'Qualification',
    'Contact No',
    'Probation Period',
    'Date of Appointment',
    'Confirmation Date',
    'Arrears',
    'Gross Salary',
    'Basic Salary',
    'House Rent',
    'Medical',
    'Conveyance Allowance',
    'House Allowance',
    'Food Allowance',
    'Vehicle Allowance',
    'Fuel Allowance',
    'Medical Allowance',
    'Mobile Allowance',
    'Total Earnings',
    'Total Deductions',
    'Salary Deduction',
    'Income Tax',
    'EOBI Ded',
    'Health Insurance',
    'Vehicle Loan Deduction',
    'Company Loan Deduction',
    ...(excludeAttendanceDeduction ? [] : ['Attendance Deduction']),
    'Other Deductions',
    'Net Payable'
  ];

  const csvRows = [];

  // Add headers
  csvRows.push(excelHeaders.join(','));

  // Add data rows
  reportData.data.forEach((row, index) => {
    const values = [
      index + 1, // Sr No
      row.employeeId || 'N/A', // ID
      row.employeeName || 'N/A', // Name
      row.guardianName || 'N/A', // Guardian Name
      row.idCard ? `'${row.idCard}` : 'N/A', // CNIC
      row.bankName || 'N/A', // Bank
      row.branchCode || 'N/A', // Branch Code
      row.accountNumber ? `'${row.accountNumber}` : 'N/A', // Account No
      row.hireDate ? new Date(row.hireDate).toLocaleDateString('en-GB') : 'N/A', // DOJ - DD/MM/YYYY format
      row.project || 'N/A', // Project
      row.company || 'N/A', // Company
      row.department || 'N/A', // Department
      row.section || 'N/A', // Section
      row.designation || 'N/A', // Designation
      row.location || 'N/A', // Location
      row.dateOfBirth ? new Date(row.dateOfBirth).toLocaleDateString('en-GB') : 'N/A', // DOB - DD/MM/YYYY format
      row.address || 'N/A', // Address
      row.qualification || 'N/A', // Qualification
      row.phone || 'N/A', // Contact No
      row.probationPeriod ? `${row.probationPeriod} months` : 'N/A', // Probation Period
      row.appointmentDate ? new Date(row.appointmentDate).toLocaleDateString('en-GB') : 'N/A', // Date of Appointment
      row.confirmationDate ? new Date(row.confirmationDate).toLocaleDateString('en-GB') : 'N/A', // Confirmation Date
      Math.round(row.arrears || 0), // Arrears
      Math.round(row.grossSalary || 0), // Gross Salary (from actual payroll)
      Math.round(row.basicSalary || 0), // Basic Salary
      Math.round(row.houseRent || 0), // House Rent
      Math.round(row.medical || 0), // Medical
      Math.round(row.conveyanceAllowance || 0), // Conveyance Allowance
      Math.round(row.houseAllowance || 0), // House Allowance
      Math.round(row.foodAllowance || 0), // Food Allowance
      Math.round(row.vehicleAllowance || 0), // Vehicle Allowance
      Math.round(row.fuelAllowance || 0), // Fuel Allowance
      Math.round(row.medicalAllowance || 0), // Medical Allowance
      Math.round(row.mobileAllowance || 0), // Mobile Allowance
      Math.round(row.totalEarnings || 0), // Total Earnings (full, before salary cut)
      Math.round(row.deductions || 0), // Total Deductions (includes salary cut)
      Math.round(row.salaryDeduction || 0), // Salary Deduction (one-month % cut)
      Math.round(row.tax || 0), // Income Tax (from actual payroll)
      Math.round(row.eobi || 0), // EOBI Ded (from actual payroll)
      Math.round(row.healthInsurance || 0), // Health Insurance (from actual payroll)
      Math.round(row.vehicleLoanDeduction || 0), // Vehicle Loan Deduction (from actual payroll)
      Math.round(row.companyLoanDeduction || 0), // Company Loan Deduction (from actual payroll)
      ...(excludeAttendanceDeduction ? [] : [Math.round(row.attendanceDeduction || 0)]),
      Math.round(row.otherDeductions || 0), // Other Deductions (from actual payroll)
      Math.round(row.netPay || 0) // Net Payable (attendance excluded when applicable)
    ];

    // Escape commas and quotes in CSV
    const escapedValues = values.map(value => {
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });

    csvRows.push(escapedValues.join(','));
  });

  return csvRows.join('\n');
}

module.exports = router;
