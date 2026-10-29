const Payroll = require('../models/hr/Payroll');
const {
  loadPayrollTaxSettings,
  loadTaxYearContextByEmployee,
  taxYearContextFor,
  calculateTaxForExistingPayroll
} = require('../utils/allowanceTaxCalculator');
const { resolveEmployeeIncomeTax } = require('../utils/allowanceHelpers');
const { isPayrollRecordLocked } = require('../utils/payrollLock');

/**
 * Monthly Tax Update Service
 * Uses Payroll Taxes page settings (medical % + allowance taxable/exempt)
 * and FY months from date of joining → June.
 */
class MonthlyTaxUpdateService {
  /**
   * Update taxes for payrolls in a specific month/year.
   * Default: Draft only. Pass options.statuses to include e.g. Approved by AVP.
   */
  static async updateMonthlyTaxes(month, year, forceUpdate = false, options = {}) {
    try {
      const statuses = Array.isArray(options.statuses) && options.statuses.length
        ? options.statuses
        : ['Draft'];

      console.log(`🔄 Starting Monthly Tax Update for ${month}/${year} (statuses: ${statuses.join(', ')})...`);

      const taxSettings = await loadPayrollTaxSettings();

      const payrolls = await Payroll.find({ month, year, status: { $in: statuses } }).populate(
        'employee',
        'firstName lastName employeeId department salary allowances hireDate appointmentDate taxExemption manualTax isActive'
      );

      if (payrolls.length === 0) {
        return {
          success: false,
          message: `No payrolls found for ${month}/${year} with status in [${statuses.join(', ')}]`,
          updatedCount: 0,
          errorCount: 0,
          totalCount: 0,
          skippedNonDraft: true,
          statuses
        };
      }

      console.log(`📊 Found ${payrolls.length} payrolls for ${month}/${year}`);
      // Months already paid this FY and their arrears, per employee
      const taxYearContextByEmployee = await loadTaxYearContextByEmployee({ payrollMonth: month, payrollYear: year });

      let updatedCount = 0;
      let unchangedCount = 0;
      let errorCount = 0;
      const results = [];

      for (const payroll of payrolls) {
        try {
          const empKey = String(payroll.employee?._id || payroll.employee);
          const result = await this.updatePayrollTax(
            payroll, forceUpdate, taxSettings, taxYearContextFor(taxYearContextByEmployee, empKey)
          );
          results.push(result);

          if (result.success && result.updated) updatedCount++;
          else if (result.success && !result.updated) unchangedCount++;
          else errorCount++;

          console.log(
            `📝 ${payroll.employee?.employeeId || 'Unknown'} - ${result.success ? (result.updated ? '✅ Updated' : '➖ Unchanged') : '❌ Failed'}: ${result.message}`
          );
        } catch (error) {
          console.error(`❌ Error updating payroll ${payroll._id}:`, error);
          errorCount++;
          results.push({
            payrollId: payroll._id,
            employeeId: payroll.employee?.employeeId || 'Unknown',
            success: false,
            message: `Error: ${error.message}`,
            oldTax: payroll.incomeTax,
            newTax: null
          });
        }
      }

      const summary = {
        success: true,
        message: `Monthly tax update completed for ${month}/${year}`,
        month,
        year,
        totalCount: payrolls.length,
        updatedCount,
        unchangedCount,
        errorCount,
        results
      };

      console.log(`🎯 Monthly Tax Update Summary for ${month}/${year}:`);
      console.log(`   Total Payrolls: ${summary.totalCount}`);
      console.log(`   Updated: ${summary.updatedCount}`);
      console.log(`   Unchanged: ${summary.unchangedCount}`);
      console.log(`   Failed: ${summary.errorCount}`);

      return { ...summary, statuses };
    } catch (error) {
      console.error('❌ Monthly Tax Update Service Error:', error);
      return {
        success: false,
        message: `Service error: ${error.message}`,
        updatedCount: 0,
        errorCount: 0,
        totalCount: 0
      };
    }
  }

  /**
   * Update tax for a single payroll using Payroll Taxes settings.
   * Skips Paid / Cancelled / Rejected.
   */
  static async updatePayrollTax(payroll, forceUpdate = false, taxSettings = null, taxYearContext = null) {
    try {
      const oldTax = Number(payroll.incomeTax) || 0;
      const employee = payroll.employee;

      if (!employee) {
        return {
          payrollId: payroll._id,
          employeeId: 'Unknown',
          success: false,
          message: 'Employee not populated',
          oldTax,
          newTax: null,
          updated: false
        };
      }

      if (isPayrollRecordLocked(payroll)) {
        return {
          payrollId: payroll._id,
          employeeId: employee.employeeId || 'Unknown',
          success: true,
          message: `Skipped locked payroll (status: ${payroll.status})`,
          oldTax,
          newTax: oldTax,
          updated: false
        };
      }

      const settings = taxSettings || (await loadPayrollTaxSettings());
      // Salary cut doesn't cut tax, prorated month isn't annualized, FY arrears kept
      const taxCalculation = await calculateTaxForExistingPayroll({
        payroll,
        employee,
        settings,
        taxYearContext
      });

      const { tax: newTax, isManual } = resolveEmployeeIncomeTax(employee, taxCalculation.totalTax);

      // Manual tax on the employee is the amount to deduct (Sidat uses it too) — set it, never
      // overwrite it with the calculated figure
      if (isManual && oldTax === newTax) {
        return {
          payrollId: payroll._id,
          employeeId: employee.employeeId || 'Unknown',
          success: true,
          message: 'Manual tax already applied',
          oldTax,
          newTax,
          updated: false,
          fyAware: taxCalculation
        };
      }

      if (!forceUpdate && oldTax === newTax) {
        return {
          payrollId: payroll._id,
          employeeId: employee.employeeId || 'Unknown',
          success: true,
          message: 'Tax already matches settings-based calculation',
          oldTax,
          newTax,
          updated: false
        };
      }

      payroll.incomeTax = newTax;
      if (payroll.taxCalculation) {
        payroll.taxCalculation.mainTax = taxCalculation.mainTax;
        payroll.taxCalculation.arrearsTax = taxCalculation.arrearsTax;
        payroll.taxCalculation.totalTax = taxCalculation.totalTax;
        payroll.taxCalculation.mainTaxableIncome = taxCalculation.mainTaxableIncome;
        payroll.taxCalculation.arrearsTaxableIncome = taxCalculation.arrearsTaxableIncome;
        payroll.taxCalculation.annualTaxableIncome = taxCalculation.annualTaxableIncome || 0;
        payroll.taxCalculation.annualTax = taxCalculation.annualTax || 0;
        payroll.taxCalculation.fyMonths = taxCalculation.fyMonths || 12;
        payroll.taxCalculation.priorFyArrears = taxCalculation.priorFyArrears || 0;
        payroll.taxCalculation.normalMonthlyTaxable = taxCalculation.normalMonthlyTaxable || 0;
        payroll.taxCalculation.finalMonthTrueUp = Boolean(taxCalculation.finalMonthTrueUp);
        payroll.taxCalculation.taxRefundDue = taxCalculation.taxRefundDue || 0;
      }

      payroll.totalDeductions =
        (payroll.incomeTax || 0) +
        (payroll.healthInsurance || 0) +
        (payroll.vehicleLoanDeduction || 0) +
        (payroll.companyLoanDeduction || 0) +
        (payroll.loanDeductions || 0) +
        (payroll.advanceSalary || 0) +
        (payroll.eobi || 0) +
        (payroll.employeeSecurity || 0) +
        (payroll.attendanceDeduction || 0) +
        (payroll.otherDeductions || 0);

      payroll.netSalary = (payroll.totalEarnings || 0) - (payroll.totalDeductions || 0);

      await payroll.save();

      return {
        payrollId: payroll._id,
        employeeId: employee.employeeId || 'Unknown',
        employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        success: true,
        message: `Tax ${oldTax} → ${newTax}`,
        oldTax,
        newTax,
        updated: true,
        mainTaxableIncome: taxCalculation.mainTaxableIncome,
        salaryMedicalExempt: taxCalculation.salaryMedicalExempt,
        allowanceTaxable: taxCalculation.allowanceTaxable
      };
    } catch (error) {
      console.error(`❌ Error updating tax for payroll ${payroll._id}:`, error);
      return {
        payrollId: payroll._id,
        employeeId: payroll.employee?.employeeId || 'Unknown',
        success: false,
        message: `Calculation error: ${error.message}`,
        oldTax: payroll.incomeTax,
        newTax: null,
        updated: false
      };
    }
  }

  static async updateCurrentMonthTaxes(forceUpdate = true) {
    const now = new Date();
    return await this.updateMonthlyTaxes(now.getMonth() + 1, now.getFullYear(), forceUpdate);
  }

  static async updatePreviousMonthTaxes(forceUpdate = true) {
    const now = new Date();
    let previousMonth = now.getMonth();
    let previousYear = now.getFullYear();
    if (previousMonth === 0) {
      previousMonth = 12;
      previousYear--;
    }
    return await this.updateMonthlyTaxes(previousMonth, previousYear, forceUpdate);
  }

  static async getMonthlyTaxSummary(month, year) {
    try {
      const payrolls = await Payroll.find({ month, year })
        .select('incomeTax totalEarnings employee status')
        .populate('employee', 'employeeId firstName lastName');

      if (payrolls.length === 0) {
        return {
          month,
          year,
          totalPayrolls: 0,
          totalTax: 0,
          averageTax: 0,
          payrolls: []
        };
      }

      const totalTax = payrolls.reduce((sum, p) => sum + (p.incomeTax || 0), 0);
      const averageTax = totalTax / payrolls.length;

      return {
        month,
        year,
        totalPayrolls: payrolls.length,
        totalTax,
        averageTax: Math.round(averageTax),
        payrolls: payrolls.map((p) => ({
          employeeId: p.employee?.employeeId,
          employeeName: `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
          totalEarnings: p.totalEarnings,
          incomeTax: p.incomeTax,
          status: p.status
        }))
      };
    } catch (error) {
      console.error('❌ Error getting monthly tax summary:', error);
      throw error;
    }
  }
}

module.exports = MonthlyTaxUpdateService;
