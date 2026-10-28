const Payroll = require('../models/hr/Payroll');
const Employee = require('../models/hr/Employee');
const LeaveRequest = require('../models/hr/LeaveRequest');
const LeaveBalance = require('../models/hr/LeaveBalance');
const Attendance = require('../models/hr/Attendance');
const LeaveIntegrationService = require('./leaveIntegrationService');
const {
  vehicleAllowanceAmount,
  fuelAllowanceAmount,
  payrollAllowancesFromEmployee,
  mergePayrollAllowances
} = require('../utils/allowanceHelpers');

/**
 * Payroll Service - Implements Two-Tier Allowance System
 * 
 * Tier 1: Employee Master Level (Permanent Defaults)
 * - Employee allowances are the baseline for all new payrolls
 * - These are copied when creating new payrolls
 * 
 * Tier 2: Monthly Payroll Level (Monthly Overrides)
 * - Monthly payrolls can override employee master allowances
 * - Changes only affect that specific month
 * - Employee master allowances remain unchanged
 */

class PayrollService {
  /**
   * Create new payroll with employee master allowances as defaults
   * @param {Object} payrollData - Payroll data from frontend
   * @param {string} employeeId - Employee ID
   * @returns {Object} Created payroll
   */
  static async createPayrollWithDefaults(payrollData, employeeId) {
    try {
      // Get employee master data
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        throw new Error('Employee not found');
      }

      // Get employee master allowances (Tier 1 - Defaults)
      const employeeAllowances = employee.allowances || {};

      // Prepare payroll allowances (Tier 2 - Monthly Overrides)
      // If frontend doesn't specify allowances, use employee master defaults
      const payrollAllowances = mergePayrollAllowances(payrollData.allowances, employeeAllowances);

      // Create payroll with the prepared allowances
      const payroll = new Payroll({
        ...payrollData,
        allowances: payrollAllowances
      });

      await payroll.save();
      return payroll;
    } catch (error) {
      throw new Error(`Error creating payroll: ${error.message}`);
    }
  }

  /**
   * Update existing payroll allowances (monthly override)
   * @param {string} payrollId - Payroll ID
   * @param {Object} allowanceUpdates - New allowance values
   * @returns {Object} Updated payroll
   */
  static async updatePayrollAllowances(payrollId, allowanceUpdates) {
    try {
      const payroll = await Payroll.findById(payrollId);
      if (!payroll) {
        throw new Error('Payroll not found');
      }

      const { assertPayrollEditable } = require('../utils/payrollLock');
      assertPayrollEditable(payroll);

      // Update only the specified allowances (monthly override)
      if (allowanceUpdates.conveyance !== undefined) {
        payroll.allowances.conveyance = allowanceUpdates.conveyance;
      }
      if (allowanceUpdates.food !== undefined) {
        payroll.allowances.food = allowanceUpdates.food;
      }
      if (allowanceUpdates.mobile !== undefined) {
        payroll.allowances.mobile = allowanceUpdates.mobile;
      }
      if (allowanceUpdates.vehicle !== undefined) {
        payroll.allowances.vehicle = allowanceUpdates.vehicle;
      }
      if (allowanceUpdates.fuel !== undefined) {
        payroll.allowances.fuel = allowanceUpdates.fuel;
      }
      if (allowanceUpdates.medical !== undefined) {
        payroll.allowances.medical = allowanceUpdates.medical;
      }
      if (allowanceUpdates.special !== undefined) {
        payroll.allowances.special = allowanceUpdates.special;
      }
      if (allowanceUpdates.other !== undefined) {
        payroll.allowances.other = allowanceUpdates.other;
      }

      // Save and recalculate totals
      await payroll.save();
      return payroll;
    } catch (error) {
      throw new Error(`Error updating payroll allowances: ${error.message}`);
    }
  }

  /**
   * Get payroll with allowance comparison (Employee Master vs Monthly Override)
   * @param {string} payrollId - Payroll ID
   * @returns {Object} Payroll with allowance comparison
   */
  static async getPayrollWithAllowanceComparison(payrollId) {
    try {
      const payroll = await Payroll.findById(payrollId).populate('employee');
      if (!payroll) {
        throw new Error('Payroll not found');
      }

      const employee = payroll.employee;
      const employeeAllowances = employee.allowances || {};

      // Create comparison object
      const allowanceComparison = {
        conveyance: {
          employeeMaster: {
            isActive: employeeAllowances.conveyance?.isActive || false,
            amount: employeeAllowances.conveyance?.amount || 0
          },
          monthlyOverride: {
            isActive: payroll.allowances.conveyance.isActive,
            amount: payroll.allowances.conveyance.amount
          },
          isOverridden: payroll.allowances.conveyance.isActive !== (employeeAllowances.conveyance?.isActive || false) ||
                       payroll.allowances.conveyance.amount !== (employeeAllowances.conveyance?.amount || 0)
        },
        food: {
          employeeMaster: {
            isActive: employeeAllowances.food?.isActive || false,
            amount: employeeAllowances.food?.amount || 0
          },
          monthlyOverride: {
            isActive: payroll.allowances.food.isActive,
            amount: payroll.allowances.food.amount
          },
          isOverridden: payroll.allowances.food.isActive !== (employeeAllowances.food?.isActive || false) ||
                       payroll.allowances.food.amount !== (employeeAllowances.food?.amount || 0)
        },
        mobile: {
          employeeMaster: {
            isActive: employeeAllowances.mobile?.isActive || false,
            amount: employeeAllowances.mobile?.amount || 0
          },
          monthlyOverride: {
            isActive: payroll.allowances.mobile?.isActive || false,
            amount: payroll.allowances.mobile?.amount || 0
          },
          isOverridden: (payroll.allowances.mobile?.isActive || false) !== (employeeAllowances.mobile?.isActive || false) ||
                       (payroll.allowances.mobile?.amount || 0) !== (employeeAllowances.mobile?.amount || 0)
        },
        vehicle: {
          employeeMaster: {
            isActive: employeeAllowances.vehicle?.isActive || employeeAllowances.vehicleFuel?.isActive || false,
            amount: vehicleAllowanceAmount(employeeAllowances)
          },
          monthlyOverride: {
            isActive: payroll.allowances.vehicle?.isActive || false,
            amount: payroll.allowances.vehicle?.amount || 0
          },
          isOverridden:
            (payroll.allowances.vehicle?.isActive || false) !== (employeeAllowances.vehicle?.isActive || employeeAllowances.vehicleFuel?.isActive || false) ||
            (payroll.allowances.vehicle?.amount || 0) !== vehicleAllowanceAmount(employeeAllowances)
        },
        fuel: {
          employeeMaster: {
            isActive: employeeAllowances.fuel?.isActive || false,
            amount: fuelAllowanceAmount(employeeAllowances)
          },
          monthlyOverride: {
            isActive: payroll.allowances.fuel?.isActive || false,
            amount: payroll.allowances.fuel?.amount || 0
          },
          isOverridden:
            (payroll.allowances.fuel?.isActive || false) !== (employeeAllowances.fuel?.isActive || false) ||
            (payroll.allowances.fuel?.amount || 0) !== fuelAllowanceAmount(employeeAllowances)
        },
        medical: {
          employeeMaster: {
            isActive: employeeAllowances.medical?.isActive || false,
            amount: employeeAllowances.medical?.amount || 0
          },
          monthlyOverride: {
            isActive: payroll.allowances.medical.isActive,
            amount: payroll.allowances.medical.amount
          },
          isOverridden: payroll.allowances.medical.isActive !== (employeeAllowances.medical?.isActive || false) ||
                       payroll.allowances.medical.amount !== (employeeAllowances.medical?.amount || 0)
        },
        special: {
          employeeMaster: {
            isActive: employeeAllowances.special?.isActive || false,
            amount: employeeAllowances.special?.amount || 0
          },
          monthlyOverride: {
            isActive: payroll.allowances.special.isActive,
            amount: payroll.allowances.special.amount
          },
          isOverridden: payroll.allowances.special.isActive !== (employeeAllowances.special?.isActive || false) ||
                       payroll.allowances.special.amount !== (employeeAllowances.special?.amount || 0)
        },
        other: {
          employeeMaster: {
            isActive: employeeAllowances.other?.isActive || false,
            amount: employeeAllowances.other?.amount || 0
          },
          monthlyOverride: {
            isActive: payroll.allowances.other.isActive,
            amount: payroll.allowances.other.amount
          },
          isOverridden: payroll.allowances.other.isActive !== (employeeAllowances.other?.isActive || false) ||
                       payroll.allowances.other.amount !== (employeeAllowances.other?.amount || 0)
        }
      };

      return {
        payroll,
        allowanceComparison,
        summary: {
          totalEmployeeMasterAllowances: Object.values(employeeAllowances).reduce((sum, allowance) => {
            return sum + (allowance?.isActive ? allowance.amount : 0);
          }, 0),
          totalMonthlyOverrideAllowances: Object.values(payroll.allowances).reduce((sum, allowance) => {
            return sum + (allowance.isActive ? allowance.amount : 0);
          }, 0),
          overriddenAllowances: Object.values(allowanceComparison).filter(comp => comp.isOverridden).length
        }
      };
    } catch (error) {
      throw new Error(`Error getting payroll with allowance comparison: ${error.message}`);
    }
  }

  /**
   * Reset monthly payroll allowances to employee master defaults
   * @param {string} payrollId - Payroll ID
   * @returns {Object} Updated payroll
   */
  static async resetToEmployeeDefaults(payrollId) {
    try {
      const payroll = await Payroll.findById(payrollId).populate('employee');
      if (!payroll) {
        throw new Error('Payroll not found');
      }

      const { assertPayrollEditable } = require('../utils/payrollLock');
      assertPayrollEditable(payroll);

      const employee = payroll.employee;
      const employeeAllowances = employee.allowances || {};

      // Reset all allowances to employee master defaults
      payroll.allowances = payrollAllowancesFromEmployee(employeeAllowances);

      await payroll.save();
      return payroll;
    } catch (error) {
      throw new Error(`Error resetting to employee defaults: ${error.message}`);
    }
  }

  /**
   * Calculate leave deductions for payroll
   * @param {string} employeeId - Employee ID
   * @param {number} month - Month (1-12)
   * @param {number} year - Year
   * @returns {Object} Leave deduction details
   */
  static async calculateLeaveDeductions(employeeId, month, year) {
    try {
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        throw new Error('Employee not found');
      }

      // Calculate daily rate
      const dailyRate = employee.salary?.basic ? employee.salary.basic / 26 : 0; // 26 working days per month

      // Get approved leave requests for the month
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      const leaveRequests = await LeaveRequest.find({
        employee: employeeId,
        status: 'approved',
        isActive: true,
        $or: [
          {
            startDate: { $lte: endDate },
            endDate: { $gte: startDate }
          }
        ]
      }).populate('leaveType');

      let totalLeaveDays = 0;
      let unpaidLeaveDays = 0;
      let unpaidLeaveDeduction = 0;

      // Calculate leave days and unpaid leave deductions
      for (const leaveRequest of leaveRequests) {
        const leaveStart = new Date(leaveRequest.startDate);
        const leaveEnd = new Date(leaveRequest.endDate);
        
        // Calculate actual leave days in this month
        const monthStart = new Date(Math.max(leaveStart.getTime(), startDate.getTime()));
        const monthEnd = new Date(Math.min(leaveEnd.getTime(), endDate.getTime()));
        
        if (monthStart <= monthEnd) {
          const daysInMonth = Math.ceil((monthEnd - monthStart) / (1000 * 60 * 60 * 24)) + 1;
          totalLeaveDays += daysInMonth;
          
          // Check if leave is unpaid
          if (!leaveRequest.leaveType.isPaid) {
            unpaidLeaveDays += daysInMonth;
          }
        }
      }

      // Calculate unpaid leave deduction
      if (unpaidLeaveDays > 0) {
        unpaidLeaveDeduction = unpaidLeaveDays * dailyRate;
      }

      // Get advance leave deduction from leave integration service (DISABLED FOR NOW - SET TO 0)
      let advanceLeaveDeduction = 0;
      let advanceLeaveDetails = null;
      
      /*
      try {
        advanceLeaveDetails = await LeaveIntegrationService.calculateAdvanceLeaveDeduction(
          employeeId,
          year,
          month,
          dailyRate
        );
        advanceLeaveDeduction = advanceLeaveDetails.totalDeduction || 0;
      } catch (error) {
        console.error('Error calculating advance leave deduction:', error);
        // Continue without advance deduction if there's an error
      }
      */

      // Total leave deduction = unpaid leaves + advance leaves
      const totalLeaveDeduction = unpaidLeaveDeduction + advanceLeaveDeduction;

      return {
        totalLeaveDays,
        unpaidLeaveDays,
        unpaidLeaveDeduction,
        advanceLeaveDeduction,
        advanceLeaveDetails: advanceLeaveDetails ? {
          totalAdvanceLeaves: advanceLeaveDetails.totalAdvanceLeaves,
          annualAdvance: advanceLeaveDetails.annualAdvance,
          sickAdvance: advanceLeaveDetails.sickAdvance,
          casualAdvance: advanceLeaveDetails.casualAdvance,
          breakdown: advanceLeaveDetails.breakdown
        } : null,
        leaveDeduction: totalLeaveDeduction,
        dailyRate,
        leaveRequests: leaveRequests.map(req => ({
          id: req._id,
          type: req.leaveType.name,
          startDate: req.startDate,
          endDate: req.endDate,
          days: req.totalDays,
          isPaid: req.leaveType.isPaid
        }))
      };
    } catch (error) {
      throw new Error(`Error calculating leave deductions: ${error.message}`);
    }
  }

  /**
   * Update payroll with leave deductions
   * @param {string} payrollId - Payroll ID
   * @returns {Object} Updated payroll
   */
  static async updatePayrollWithLeaveDeductions(payrollId) {
    try {
      const payroll = await Payroll.findById(payrollId);
      if (!payroll) {
        throw new Error('Payroll not found');
      }

      const { assertPayrollEditable } = require('../utils/payrollLock');
      assertPayrollEditable(payroll);

      // Calculate leave deductions
      const leaveDeductions = await this.calculateLeaveDeductions(
        payroll.employee,
        payroll.month,
        payroll.year
      );

      // Update payroll with leave deductions
      payroll.leaveDays = leaveDeductions.totalLeaveDays;
      payroll.unpaidLeaveDays = leaveDeductions.unpaidLeaveDays;
      payroll.leaveDeduction = leaveDeductions.leaveDeduction;
      
      // Update advance leave details
      if (leaveDeductions.advanceLeaveDetails) {
        payroll.advanceLeaveDetails = {
          totalAdvanceLeaves: leaveDeductions.advanceLeaveDetails.totalAdvanceLeaves,
          annualAdvance: leaveDeductions.advanceLeaveDetails.annualAdvance,
          sickAdvance: leaveDeductions.advanceLeaveDetails.sickAdvance,
          casualAdvance: leaveDeductions.advanceLeaveDetails.casualAdvance,
          advanceDeduction: leaveDeductions.advanceLeaveDeduction || 0,
          unpaidDeduction: leaveDeductions.unpaidLeaveDeduction || 0,
          dailyRate: leaveDeductions.dailyRate || 0
        };
      }

      // Recalculate total deductions (excluding Provident Fund)
      payroll.totalDeductions = 
        payroll.incomeTax + 
        payroll.eobi + 
        payroll.healthInsurance + 
        payroll.loanDeductions + 
        payroll.leaveDeduction + 
        payroll.otherDeductions;
      
      // Recalculate net salary (excluding Provident Fund)
      payroll.netSalary = payroll.totalEarnings - payroll.totalDeductions;

      await payroll.save();
      return payroll;
    } catch (error) {
      throw new Error(`Error updating payroll with leave deductions: ${error.message}`);
    }
  }

  /**
   * Generate payroll with leave integration
   * @param {string} employeeId - Employee ID
   * @param {number} month - Month (1-12)
   * @param {number} year - Year
   * @param {Object} attendanceData - Attendance data
   * @returns {Object} Generated payroll
   */
  static async generatePayrollWithLeaveIntegration(employeeId, month, year, attendanceData = {}) {
    try {
      // Generate base payroll
      const payroll = await Payroll.generatePayroll(employeeId, month, year, attendanceData);
      
      // Calculate and apply leave deductions
      const leaveDeductions = await this.calculateLeaveDeductions(employeeId, month, year);
      
      // Update payroll with leave data
      payroll.leaveDays = leaveDeductions.totalLeaveDays;
      payroll.unpaidLeaveDays = leaveDeductions.unpaidLeaveDays;
      payroll.leaveDeduction = leaveDeductions.leaveDeduction;
      
      // Update advance leave details
      if (leaveDeductions.advanceLeaveDetails) {
        payroll.advanceLeaveDetails = {
          totalAdvanceLeaves: leaveDeductions.advanceLeaveDetails.totalAdvanceLeaves,
          annualAdvance: leaveDeductions.advanceLeaveDetails.annualAdvance,
          sickAdvance: leaveDeductions.advanceLeaveDetails.sickAdvance,
          casualAdvance: leaveDeductions.advanceLeaveDetails.casualAdvance,
          advanceDeduction: leaveDeductions.advanceLeaveDeduction || 0,
          unpaidDeduction: leaveDeductions.unpaidLeaveDeduction || 0,
          dailyRate: leaveDeductions.dailyRate || 0
        };
      }
      
      // Recalculate total deductions (excluding Provident Fund)
      payroll.totalDeductions = 
        payroll.incomeTax + 
        payroll.eobi + 
        payroll.healthInsurance + 
        payroll.loanDeductions + 
        payroll.leaveDeduction + 
        payroll.otherDeductions;
      
      // Recalculate net salary (excluding Provident Fund)
      payroll.netSalary = payroll.totalEarnings - payroll.totalDeductions;

      await payroll.save();
      return payroll;
    } catch (error) {
      throw new Error(`Error generating payroll with leave integration: ${error.message}`);
    }
  }
}

module.exports = PayrollService;
