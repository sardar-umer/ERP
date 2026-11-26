const mongoose = require('mongoose');
const Loan = require('../models/hr/Loan');

/**
 * 🏦 Loan Payroll Integration Service
 * Handles automatic loan payment processing when payroll is approved/paid
 */

class LoanPayrollService {
  
  /**
   * Process loan payments from payroll deductions
   * Called when payroll is approved or marked as paid
   * @param {Object} payroll - Payroll document
   * @param {string} eventType - 'approved' or 'paid'
   */
  static async processLoanPayments(payroll, eventType = 'paid') {
    try {
      console.log(`🚀 Processing loan payments for payroll ${payroll._id} (Event: ${eventType})`);
      
      // Skip if no loan deductions or event is not payment-triggering
      if (!payroll.loanDeductions || payroll.loanDeductions <= 0 || eventType === 'approved') {
        console.log(`⏭️ No loan deductions or skipping for ${eventType}: ${payroll.loanDeductions || 0}`);
        return { success: true, message: 'No loan deductions to process', processedLoans: 0 };
      }
      
      console.log(`💰 Processing Rs ${payroll.loanDeductions} in loan deductions for employee ${payroll.employee}`);
      
      const {
        isLoanFullyPaid,
        getLoanRemainingBalance,
        markLoanCompletedIfPaid,
        effectiveLoanDeductionForPayroll,
        isBeforeDeductionStart,
        payrollAlreadyRecordedOnLoan
      } = require('../utils/loanPayrollDeduction');

      // Get all active loans for the employee (exclude fully paid)
      const allActive = await Loan.find({
        employee: payroll.employee,
        status: { $in: ['Active', 'Disbursed', 'Approved'] }
      });

      for (const loan of allActive) {
        if (isLoanFullyPaid(loan)) {
          await markLoanCompletedIfPaid(loan).catch(() => {});
        }
      }

      const activeLoans = allActive.filter((loan) => !isLoanFullyPaid(loan));

      if (activeLoans.length === 0) {
        console.log(`❌ No active (unpaid) loans found for employee ${payroll.employee}`);
        return { success: true, message: 'No active loans found', processedLoans: 0 };
      }
      
      console.log(`🔍 Found ${activeLoans.length} active loans for employee`);
      
      let processedLoans = 0;
      const loanUpdates = [];
      const skippedLoans = [];

      const month = payroll.month;
      const year = payroll.year;
      // Process each loan by distributing loan deductions by remaining EMI share
      // A loan whose Deduction Start Month is after this payroll month gets no share at all
      const shareWeights = activeLoans.map((loan) =>
        isBeforeDeductionStart(loan, month, year)
          ? 0
          : (effectiveLoanDeductionForPayroll(loan, month, year) || getLoanRemainingBalance(loan) || 0)
      );
      const totalInstallments = shareWeights.reduce((sum, w) => sum + w, 0);
      
      if (totalInstallments === 0) {
        console.log(`⚠️ Total monthly installments is 0, cannot process proportional payment`);
        return { success: true, message: 'No monthly installments found', processedLoans: 0 };
      }
      
      // Distribute loan deductions proportionally among active unpaid loans
      for (let i = 0; i < activeLoans.length; i++) {
        const loan = activeLoans[i];
        const weight = shareWeights[i];
        const loanShare = (weight / totalInstallments) * payroll.loanDeductions;
        
        // Never record the same month twice: skip when this payroll was already applied, or when the
        // import / a manual entry already marked this month's installment Paid. The share is dropped
        // (not moved to other loans) because that money is already on this loan.
        const alreadyRecorded = loanShare > 0 ? payrollAlreadyRecordedOnLoan(loan, payroll) : null;
        if (alreadyRecorded) {
          console.log(`⏭️ Skipping loan ${loan._id} for payroll ${payroll._id}: ${alreadyRecorded}`);
          skippedLoans.push({ loanId: loan._id, amount: Math.round(loanShare * 100) / 100, reason: alreadyRecorded });
          continue;
        }

        if (loanShare > 0) {
          console.log(`💰 Processing Rs ${loanShare.toFixed(2)} payment for ${loan.loanType} loan ${loan._id}`);
          
          try {
            const openRowIds = new Set(
              (loan.loanSchedule || [])
                .filter((inst) => ['Pending', 'Overdue', 'Partial'].includes(inst.status))
                .map((inst) => String(inst._id))
            );

            // Use the loan's processPayment method
            const paymentResult = loan.processPayment(loanShare, 'Salary Deduction');
            
            // processPayment() already marks the schedule rows and adds to totalPaid.
            // (Previously totalPaid was added a second time here and updateLoanSchedule()
            // marked the NEXT installment paid as well — one deduction closed two rows.)
            loan.outstandingBalance = paymentResult.newOutstandingBalance;
            for (const inst of loan.loanSchedule || []) {
              // Keep the first payroll that touched a row; later partial top-ups are tracked in appliedPayrolls
              if (openRowIds.has(String(inst._id)) && ['Paid', 'Partial'].includes(inst.status) && !inst.paymentReference) {
                inst.paymentReference = `Payroll-${payroll._id}`;
              }
            }
            loan.appliedPayrolls = [...(loan.appliedPayrolls || []), payroll._id];
            
            // Mark loan as Active if it was Disbursed
            if (loan.status === 'Disbursed') {
              loan.status = 'Active';
            }
            
            // Check if loan is completed
            if (loan.outstandingBalance <= 0) {
              loan.status = 'Completed';
              loan.completionDate = new Date();
              console.log(`🎉 Loan ${loan._id} completed!`);
            }
            
            loan.updatedBy = new mongoose.Types.ObjectId();
            loan.updatedAt = new Date();
            
            await loan.save();
            
            loanUpdates.push({
              loanId: loan._id,
              loanType: loan.loanType,
              paymentAmount: paymentResult.processedAmount,
              newBalance: loan.outstandingBalance,
              status: loan.status
            });
            
            processedLoans++;
            console.log(`✅ Updated loan ${loan._id}: Remaining balance: Rs ${loan.outstandingBalance}`);
            
          } catch (loanError) {
            console.error(`❌ Error processing payment for loan ${loan._id}:`, loanError.message);
          }
        }
      }
      
      console.log(`🎉 Loan payment processing completed!`);
      console.log(`   Processed loans: ${processedLoans}`);
      console.log(`   Total amount processed: Rs ${payroll.loanDeductions}`);
      
      return {
        success: true,
        message: `Successfully processed ${processedLoans} loans`,
        processedLoans,
        loanUpdates,
        skippedLoans,
        totalProcessed: payroll.loanDeductions
      };
      
    } catch (error) {
      console.error('❌ Error in processLoanPayments:', error);
      return {
        success: false,
        message: `Error processing loan payments: ${error.message}`,
        processedLoans: 0
      };
    }
  }
  
  /**
   * Update loan schedule with payment information
   * @param {Object} loan - Loan document
   * @param {number} paymentAmount - Payment amount
   * @param {Object} payroll - Payroll document
   */
  static async updateLoanSchedule(loan, paymentAmount, payroll) {
    try {
      if (!loan.loanSchedule || loan.loanSchedule.length === 0) {
        console.log(`⚠️ No loan schedule found for loan ${loan._id}, generating...`);
        loan.generateLoanSchedule();
      }
      
      let remainingPayment = paymentAmount;
      
      // Find the next unpaid installment
      const nextInstallment = loan.loanSchedule.find(installment => 
        ['Pending', 'Overdue', 'Partial'].includes(installment.status)
      );
      
      if (!nextInstallment) {
        console.log(`⚠️ No pending installments found for loan ${loan._id}`);
        
        // Create new installment if all are paid but balance remains
        if (loan.outstandingBalance > 0) {
          const currentMonth = payroll.month;
          const currentYear = payroll.year;
          
          const newInstallment = {
            installmentNumber: loan.loanSchedule.length + 1,
            dueDate: new Date(currentYear, currentMonth - 1, 1), // First day of current month
            amount: Math.min(paymentAmount, loan.outstandingBalance),
            principal: Math.min(paymentAmount, loan.outstandingBalance),
            interest: 0, // This is a principal payment
            balance: Math.max(0, loan.outstandingBalance - paymentAmount),
            status: 'Paid',
            paymentDate: new Date(),
            paymentMethod: 'Salary Deduction',
            paymentReference: `Payroll-${payroll._id}`
          };
          
          loan.loanSchedule.push(newInstallment);
          console.log(`➕ Added new installment for principal payment`);
        }
        
        return;
      }
      
      // Update next installment
      const currentPaid = nextInstallment.paidAmount || 0;
      const newPaidAmount = Math.min(currentPaid + remainingPayment, nextInstallment.amount);
      
      nextInstallment.paidAmount = newPaidAmount;
      nextInstallment.paymentDate = new Date();
      nextInstallment.paymentMethod = 'Salary Deduction';
      nextInstallment.paymentReference = `Payroll-${payroll._id}`;
      
      if (newPaidAmount >= nextInstallment.amount) {
        nextInstallment.status = 'Paid';
        console.log(`✅ Installment ${nextInstallment.installmentNumber} completed`);
      } else {
        nextInstallment.status = 'Partial';
        console.log(`🔄 Installment ${nextInstallment.installmentNumber} partial payment: Rs ${newPaidAmount}/${nextInstallment.amount}`);
      }
      
      remainingPayment -= (newPaidAmount - currentPaid);
      
      // Handle case if there's remaining payment for next installment
      if (remainingPayment > 0) {
        await this.updateLoanSchedule(loan, remainingPayment, payroll);
      }
      
    } catch (error) {
      console.error(`❌ Error updating loan schedule for loan ${loan._id}:`, error);
    }
  }
  
  /**
   * Get loan summary for employee (used for reporting)
   * @param {string} employeeId - Employee ObjectId
   * @returns {Object} Loan summary
   */
  static async getLoanSummary(employeeId) {
    try {
      const loans = await Loan.find({ employee: employeeId });
      
      const {
        effectiveLoanDeductionForPayroll,
        getLoanRemainingBalance,
        isLoanFullyPaid
      } = require('../utils/loanPayrollDeduction');

      const activeLoans = loans.filter(
        (loan) =>
          ['Active', 'Disbursed', 'Approved'].includes(loan.status) && !isLoanFullyPaid(loan)
      );

      const totalOutstanding = activeLoans.reduce(
        (sum, loan) => sum + getLoanRemainingBalance(loan),
        0
      );

      const now = new Date();
      const totalMonthlyDeduction = activeLoans.reduce(
        (sum, loan) =>
          sum + effectiveLoanDeductionForPayroll(loan, now.getMonth() + 1, now.getFullYear()),
        0
      );
      
      const totalPaid = loans.reduce((sum, loan) => 
        sum + (loan.totalPaid || 0), 0
      );
      
      return {
        totalLoans: loans.length,
        activeLoans: activeLoans.length,
        totalOutstanding,
        totalMonthlyDeduction,
        totalPaid,
        loans: activeLoans.map((loan) => ({
          id: loan._id,
          loanType: loan.loanType,
          loanAmount: loan.loanAmount,
          monthlyInstallment: loan.monthlyInstallment,
          outstandingBalance: getLoanRemainingBalance(loan),
          totalPaid: loan.totalPaid,
          status: loan.status,
          progressPercentage: loan.progressPercentage
        }))
      };
      
    } catch (error) {
      console.error('❌ Error getting loan summary:', error);
      return {
        totalLoans: 0,
        activeLoans: 0,
        totalOutstanding: 0,
        totalMonthlyDeduction: 0,
        totalPaid: 0,
        loans: []
      };
    }
  }
}

module.exports = LoanPayrollService;
