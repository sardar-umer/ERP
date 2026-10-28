const express = require('express');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authorize } = require('../middleware/auth');
const Payroll = require('../models/hr/Payroll');
const PayrollMonthlyApproval = require('../models/hr/PayrollMonthlyApproval');
const Employee = require('../models/hr/Employee');
const User = require('../models/User');
const {
  populateMonthlyApproval,
  syncAuthorityStatus,
  getOrCreateMonthlyApproval,
  assertMonthlyPayrollAuthoritiesApproved,
  getRequiredPayrollAuthoritySlots,
  getNextPendingPayrollAuthoritySlot,
  matchUserToFinanceSlots,
  PAYROLL_AUTHORITY_SLOT_CONFIG,
  getApprovedAuthorityKeys
} = require('../utils/payrollMonthlyApproval');
const FinanceHelper = require('../utils/financeHelper');
const Payslip = require('../models/hr/Payslip');
const { calculateMonthlyTax, calculateTaxableIncome, calculateTaxableIncomeCorrected, calculateTaxWithSeparateArrears } = require('../utils/taxCalculator');
const {
  calculatePayrollTaxWithSettings,
  loadPayrollTaxSettings
} = require('../utils/allowanceTaxCalculator');
const { queryApproverCandidateUsers } = require('../utils/utilityBillApproverEligibility');
const { markEmployeeArrearsPaidForPeriod } = require('../utils/employeeArrearsUpdate');
const { applyBulkPayrollStatusForAuthoritySlot, PAYROLL_STATUS_BY_AUTHORITY_SLOT, applyComparisonReportStatusForAuthoritySlot, isPayrollFinalApprovedStatus } = require('../utils/payrollAuthorityPayrollStatus');
const { createAndEmitNotification } = require('../services/realtimeNotificationService');
const { MONTH_NAMES: PAYROLL_MONTH_NAMES } = require('../utils/financePayrollQueue');
const {
  savePayrollMonthlyComparisonReport,
  getPayrollMonthlyComparisonReport,
  clearLateEntryFlags
} = require('../utils/payrollMonthlyComparisonReport');
const FBRTaxSlab = require('../models/hr/FBRTaxSlab');
const Attendance = require('../models/hr/Attendance');
const AttendanceIntegrationService = require('../services/attendanceIntegrationService');
const incrementService = require('../services/incrementService');
const {
  vehicleFuelTotal,
  vehicleAllowanceAmount,
  fuelAllowanceAmount,
  buildAllowancesPayload,
  payrollAllowancesFromEmployee,
  additionalAllowancesTotal,
  getEmployeeEobiDeduction,
  getEmployeeSecurityDeduction,
  resolveEmployeeIncomeTax
} = require('../utils/allowanceHelpers');
const {
  applyPayrollProration,
  buildPayrollProrationRemarksSuffix,
  adjustAttendanceForJoiningProration
} = require('../utils/payrollPartialSalaryPay');

const router = express.Router();

/** Fields required for payroll proration (joining + partial monthly pay) and salary math. */
const PAYROLL_EMPLOYEE_SELECT =
  'firstName lastName employeeId salary allowances arrears eobi employeeSecurity manualTax hireDate appointmentDate partialSalaryPay placementDepartment placementProject placementDesignation department position providentFund cashSalary';

const isProvidentFundEnabledForEmployee = (employee) =>
  employee?.providentFund?.isActive === true;

const calculateProvidentFundForEmployee = (employee, basicSalary = 0) => {
  if (!isProvidentFundEnabledForEmployee(employee)) return 0;
  const pfPercentage = Number(employee?.providentFund?.percentage || 8.34);
  return Math.round((Number(basicSalary || 0) * pfPercentage) / 100);
};

const ARREARS_TYPES = [
  'salaryAdjustment',
  'bonusPayment',
  'overtimePayment',
  'allowanceAdjustment',
  'deductionReversal',
  'other'
];

const getCurrentMonthEmployeeArrears = (employee) => {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  let employeeArrears = 0;
  const arrearsDetails = [];

  if (employee?.arrears) {
    for (const arrearsType of ARREARS_TYPES) {
      const arrearsData = employee.arrears[arrearsType];
      if (
        arrearsData &&
        arrearsData.isActive &&
        arrearsData.month === currentMonth &&
        arrearsData.year === currentYear &&
        arrearsData.status !== 'Paid' &&
        arrearsData.status !== 'Cancelled'
      ) {
        employeeArrears += arrearsData.amount || 0;
        arrearsDetails.push({
          type: `Arrears - ${arrearsType.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}`,
          amount: arrearsData.amount || 0,
          description: arrearsData.description || '',
          status: arrearsData.status || 'Pending'
        });
      }
    }
  }

  return { employeeArrears, arrearsDetails, currentMonth, currentYear };
};

/** Shared current-payroll math for General Payroll overview and employee detail preview. */
const computeEmployeeCurrentPayrollFigures = (employee, gross, taxSettings = null, month = null, year = null) => {
  const payrollMonth = month || new Date().getMonth() + 1;
  const payrollYear = year || new Date().getFullYear();
  const prorationResult = applyPayrollProration(employee, payrollMonth, payrollYear, gross);

  if (prorationResult.skipPayroll) {
    return { skipPayroll: true, proration: prorationResult.proration };
  }

  const grossSalary = prorationResult.grossSalary;
  const effectiveAllowances = prorationResult.allowances;
  const proration = prorationResult.proration;
  const basic = grossSalary * 0.6666;
  const medical = grossSalary * 0.1;
  const houseRent = grossSalary * 0.2334;

  const additionalAllowances = additionalAllowancesTotal(effectiveAllowances);

  const { employeeArrears, arrearsDetails } = getCurrentMonthEmployeeArrears(employee);
  const mainSalary = grossSalary + additionalAllowances;
  const taxCalculation = calculatePayrollTaxWithSettings({
    grossSalary,
    allowances: effectiveAllowances,
    arrears: employeeArrears,
    employeeId: employee._id,
    settings: taxSettings,
    hireDate: employee.hireDate || employee.appointmentDate,
    payrollMonth: payrollMonth,
    payrollYear: payrollYear
  });
  // Tax is calculated on already-prorated gross/allowances — no second multiply needed.
  // Mid-year joiners in the current FY use remaining months for annualization; others stay ×12.
  let { tax: resolvedTax } = resolveEmployeeIncomeTax(employee, taxCalculation.totalTax);
  // EOBI / employee security: prorate only for joining-month proration.
  // Partial salary (custom days) affects salary only — keep these at full monthly amounts.
  let eobiDeduction = getEmployeeEobiDeduction(employee);
  let employeeSecurityDeduction = getEmployeeSecurityDeduction(employee);
  if (proration.factor < 1 && proration.type !== 'partial_salary') {
    eobiDeduction = Math.round(eobiDeduction * proration.factor);
    employeeSecurityDeduction = Math.round(employeeSecurityDeduction * proration.factor);
  }
  const totalEarnings = grossSalary + additionalAllowances + employeeArrears;
  const netSalary = Math.round(
    totalEarnings - resolvedTax - eobiDeduction - employeeSecurityDeduction
  );

  return {
    basic,
    medical,
    houseRent,
    grossSalary,
    additionalAllowances,
    employeeArrears,
    arrearsDetails,
    totalEarnings,
    mainSalary,
    taxCalculation,
    resolvedTax,
    eobiDeduction,
    employeeSecurityDeduction,
    netSalary,
    proration,
    effectiveAllowances,
    skipPayroll: false
  };
};

const resolveEmployeeGrossSalary = async (employee) => {
  try {
    const result = await incrementService.getEmployeeCurrentSalary(employee._id);
    if (result?.success && result.data?.currentSalary) {
      return Number(result.data.currentSalary) || employee.salary?.gross || 0;
    }
  } catch (error) {
    console.warn('Increment lookup failed, using master salary:', error.message);
  }
  return employee.salary?.gross || 0;
};

const resolvePayrollPreviewPeriod = (month, year) => ({
  month: Math.min(12, Math.max(1, parseInt(month, 10) || new Date().getMonth() + 1)),
  year: parseInt(year, 10) || new Date().getFullYear()
});

const buildEmployeeCurrentPayrollPayload = (employee, gross, figures, month, year, loanDeductions = 0) => {
  if (figures.skipPayroll) {
    return {
      skipPayroll: true,
      reason:
        figures.proration?.reason || 'Employee not yet joined in this payroll period',
      proration: figures.proration
    };
  }

  const { taxCalculation, eobiDeduction, employeeSecurityDeduction = 0, resolvedTax } = figures;
  const finalTax = Math.round(resolvedTax ?? taxCalculation.totalTax);
  const proratedGross = figures.grossSalary ?? gross;
  const workingDays = figures.proration?.workingDaysFromJoining || 26;
  const { month: previewMonth, year: previewYear } = resolvePayrollPreviewPeriod(month, year);
  const totalDeductions = Math.round(finalTax + eobiDeduction + employeeSecurityDeduction + loanDeductions);
  const netSalary = Math.round(figures.totalEarnings - totalDeductions);
  return {
    month: previewMonth,
    year: previewYear,
    basicSalary: Math.round(figures.basic),
    grossSalary: Math.round(proratedGross),
    additionalAllowances: Math.round(figures.additionalAllowances),
    arrears: Math.round(figures.employeeArrears),
    arrearsDetails: figures.arrearsDetails,
    totalEarnings: Math.round(figures.totalEarnings),
    medicalAllowance: Math.round(figures.medical),
    houseRentAllowance: Math.round(figures.houseRent),
    taxableIncome: Math.round(
      taxCalculation.annualTaxableIncome != null && taxCalculation.fyMonths
        ? taxCalculation.annualTaxableIncome / taxCalculation.fyMonths
        : taxCalculation.mainTaxableIncome
    ),
    monthlyTax: finalTax,
    netSalary: netSalary,
    allowances: payrollAllowancesFromEmployee(figures.effectiveAllowances || employee.allowances),
    overtimeHours: 0,
    overtimeAmount: 0,
    performanceBonus: 0,
    otherBonus: 0,
    incomeTax: finalTax,
    isManualTax: Boolean(employee?.manualTax?.isActive),
    eobi: eobiDeduction,
    employeeSecurity: employeeSecurityDeduction,
    healthInsurance: 0,
    providentFund: calculateProvidentFundForEmployee(employee, figures.basic),
    loanDeductions: loanDeductions,
    attendanceDeduction: 0,
    leaveDeduction: 0,
    otherDeductions: 0,
    totalDeductions: totalDeductions,
    totalWorkingDays: workingDays,
    presentDays: workingDays,
    absentDays: 0,
    leaveDays: 0,
    dailyRate: workingDays > 0 ? Math.round(proratedGross / workingDays) : 0,
    proration: figures.proration?.isProrated ? figures.proration : undefined,
    remarks: figures.proration?.isProrated
      ? `Monthly payroll preview${buildPayrollProrationRemarksSuffix(figures.proration)}`
      : undefined,
    leaveDeductions: {
      unpaidLeave: 0,
      sickLeave: 0,
      casualLeave: 0,
      annualLeave: 0,
      otherLeave: 0,
      totalLeaveDays: 0
    },
    taxCalculation: {
      mainTax: Math.round(taxCalculation.mainTax),
      arrearsTax: Math.round(taxCalculation.arrearsTax),
      totalTax: Math.round(taxCalculation.totalTax),
      mainTaxableIncome: Math.round(taxCalculation.mainTaxableIncome),
      arrearsTaxableIncome: Math.round(taxCalculation.arrearsTaxableIncome),
      annualTaxableIncome: Math.round(taxCalculation.annualTaxableIncome || 0),
      annualTax: Math.round(taxCalculation.annualTax || 0),
      fyMonths: taxCalculation.fyMonths || 12
    }
  };
};

/**
 * Generate payslip PDF
 * @param {Object} payslip - Payslip data
 * @param {Object} res - Express response object
 */
async function generatePayslipPDF(payslip, res) {
  try {
    // Create PDF document - A4 size optimized for single page
    const doc = new PDFDocument({
      size: 'A4',
      margin: 20
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${payslip.payslipNumber}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Optimized helper functions
    const formatCurrency = (amount) => `Rs ${(amount || 0).toLocaleString()}`;
    const formatDate = (date) => date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const numberToWords = (num) => {
      if (num === 0) return 'Zero';
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      if (num < 10) return ones[num];
      if (num < 20) return teens[num - 10];
      if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
      if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' and ' + numberToWords(num % 100) : '');
      if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numberToWords(num % 1000) : '');
      if (num < 10000000) return numberToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + numberToWords(num % 100000) : '');
      return numberToWords(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + numberToWords(num % 10000000) : '');
    };

    // Start building the professional single-page PDF
    const pageWidth = doc.page.width - 40;
    const pageHeight = doc.page.height - 40;

    // Professional Header with Logo - Clean and minimal with proper spacing
    // Add SGC Logo
    const logoPath = path.join(__dirname, '../../client/public/images/sgc-logo.png');
    try {
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 30, 20, { width: 60, height: 60 });
      }
    } catch (error) {
      console.log('⚠️ Could not load SGC logo:', error.message);
    }

    doc.fontSize(20)
      .font('Helvetica-Bold')
      .fillColor('#2c3e50')
      .text('SARDAR GROUP OF COMPANIES', 100, 25, { align: 'left' });

    doc.fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#34495e')
      .text('PAY SLIP', 100, 50, { align: 'left' });

    doc.fontSize(12)
      .font('Helvetica')
      .fillColor('#7f8c8d')
      .text(`For the month of ${formatDate(new Date(payslip.year, payslip.month - 1))}`, 100, 70, { align: 'left' });

    // Right side - Payslip details in properly positioned box (moved further right to avoid overlap)
    const boxX = pageWidth - 130; // Moved further right to avoid overlap with company name
    const boxY = 20;
    const boxWidth = 120; // Increased width for better text spacing
    const boxHeight = 60;

    doc.rect(boxX, boxY, boxWidth, boxHeight)
      .fillColor('#f8f9fa')
      .fill()
      .stroke('#dee2e6');

    doc.fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Payslip No:', boxX + 8, boxY + 15)
      .text('Issue Date:', boxX + 8, boxY + 30);

    doc.fontSize(9)
      .font('Helvetica')
      .fillColor('#6c757d')
      .text(payslip.payslipNumber, boxX + 65, boxY + 15)
      .text(formatDate(new Date()), boxX + 65, boxY + 30);

    // Employee Information - Clean layout with proper spacing
    let currentY = 100;

    // Employee info with properly sized background (increased height)
    const empBoxHeight = 65;
    doc.rect(30, currentY, pageWidth - 30, empBoxHeight)
      .fillColor('#f8f9fa')
      .fill()
      .stroke('#dee2e6');

    doc.fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#2c3e50')
      .text('Employee Information', 40, currentY + 10);

    currentY += 30;

    // Employee details in two columns with proper alignment
    doc.fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Name:', 40, currentY)
      .text('Employee ID:', 300, currentY);

    doc.fontSize(10)
      .font('Helvetica')
      .fillColor('#2c3e50')
      .text(payslip.employeeName, 80, currentY)
      .text(payslip.employeeId, 380, currentY);

    currentY += 15;

    doc.fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Department:', 40, currentY)
      .text('Designation:', 300, currentY);

    doc.fontSize(10)
      .font('Helvetica')
      .fillColor('#2c3e50')
      .text(payslip.department, 110, currentY)
      .text(payslip.designation, 380, currentY);

    // Earnings and Deductions Table - Professional single-page layout
    currentY += 35;

    // Table header with properly sized background
    const tableHeaderHeight = 25;
    doc.rect(30, currentY, pageWidth - 30, tableHeaderHeight)
      .fillColor('#e9ecef')
      .fill()
      .stroke('#dee2e6');

    doc.fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#2c3e50')
      .text('Earnings & Deductions', 40, currentY + 8);

    currentY += 35;

    // Table headers with proper alignment (better column spacing)
    doc.fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Earnings', 40, currentY)
      .text('Amount', 170, currentY)
      .text('Deductions', 290, currentY)
      .text('Amount', 430, currentY);

    // Draw properly positioned table lines (adjusted to match column positions)
    const tableHeight = 100;
    doc.moveTo(30, currentY - 5).lineTo(pageWidth - 10, currentY - 5).stroke('#dee2e6');
    doc.moveTo(30, currentY - 5).lineTo(30, currentY + tableHeight).stroke('#dee2e6');
    doc.moveTo(160, currentY - 5).lineTo(160, currentY + tableHeight).stroke('#dee2e6');
    doc.moveTo(280, currentY - 5).lineTo(280, currentY + tableHeight).stroke('#dee2e6');
    doc.moveTo(420, currentY - 5).lineTo(420, currentY + tableHeight).stroke('#dee2e6');
    doc.moveTo(pageWidth - 10, currentY - 5).lineTo(pageWidth - 10, currentY + tableHeight).stroke('#dee2e6');

    currentY += 15;

    // Optimized earnings and deductions rendering
    doc.fontSize(9).font('Helvetica').fillColor('#2c3e50');

    // Dynamic earnings array - only include items with values > 0
    const earnings = [];

    // Add basic salary components
    if (payslip.earnings.basicSalary > 0) {
      earnings.push(['Basic Salary', payslip.earnings.basicSalary]);
    }
    if (payslip.earnings.houseRent > 0) {
      earnings.push(['House Rent Allowance', payslip.earnings.houseRent]);
    }
    if (payslip.earnings.medicalAllowance > 0) {
      earnings.push(['Medical Allowance', payslip.earnings.medicalAllowance]);
    }
    if (payslip.earnings.conveyanceAllowance > 0) {
      earnings.push(['Conveyance Allowance', payslip.earnings.conveyanceAllowance]);
    }
    if (payslip.earnings.vehicleAllowance > 0) {
      earnings.push(['Vehicle Allowance', payslip.earnings.vehicleAllowance]);
    }
    if (payslip.earnings.fuelAllowance > 0) {
      earnings.push(['Fuel Allowance', payslip.earnings.fuelAllowance]);
    }
    if (!payslip.earnings.vehicleAllowance && !payslip.earnings.fuelAllowance && payslip.earnings.vehicleFuelAllowance > 0) {
      earnings.push(['Vehicle & Fuel Allowance', payslip.earnings.vehicleFuelAllowance]);
    }
    if (payslip.earnings.foodAllowance > 0) {
      earnings.push(['Food Allowance', payslip.earnings.foodAllowance]);
    }
    if (payslip.earnings.mobileAllowance > 0) {
      earnings.push(['Mobile Allowance', payslip.earnings.mobileAllowance]);
    }
    if (payslip.earnings.specialAllowance > 0) {
      earnings.push(['Special Allowance', payslip.earnings.specialAllowance]);
    }
    if (payslip.earnings.otherAllowances > 0) {
      earnings.push(['Other Allowances', payslip.earnings.otherAllowances]);
    }
    if (payslip.earnings.overtime > 0) {
      earnings.push(['Overtime', payslip.earnings.overtime]);
    }
    if (payslip.earnings.bonus > 0) {
      earnings.push(['Bonus', payslip.earnings.bonus]);
    }
    if (payslip.earnings.incentives > 0) {
      earnings.push(['Incentives', payslip.earnings.incentives]);
    }
    if (payslip.earnings.arrears > 0) {
      earnings.push(['Arrears', payslip.earnings.arrears]);
    }
    if (payslip.earnings.otherEarnings > 0) {
      earnings.push(['Other Earnings', payslip.earnings.otherEarnings]);
    }

    // Dynamic deductions array - only include items with values > 0
    const deductions = [];

    if (payslip.deductions.eobi > 0) {
      deductions.push(['EOBI', payslip.deductions.eobi]);
    }
    if (payslip.deductions.incomeTax > 0) {
      deductions.push(['Income Tax', payslip.deductions.incomeTax]);
    }
    if (payslip.deductions.absentDeduction > 0) {
      deductions.push(['Attendance Deduction', payslip.deductions.absentDeduction]);
    }
    if (payslip.deductions.loanDeduction > 0) {
      deductions.push(['Loan Deduction', payslip.deductions.loanDeduction]);
    }
    if (payslip.deductions.advanceDeduction > 0) {
      deductions.push(['Advance Deduction', payslip.deductions.advanceDeduction]);
    }
    if (payslip.deductions.lateDeduction > 0) {
      deductions.push(['Late Deduction', payslip.deductions.lateDeduction]);
    }
    if (payslip.deductions.otherDeductions > 0) {
      deductions.push(['Other Deductions', payslip.deductions.otherDeductions]);
    }

    let earningsY = currentY;
    earnings.forEach(([label, amount]) => {
      doc.text(label, 40, earningsY).text(formatCurrency(amount), 170, earningsY);
      earningsY += 12;
    });

    let deductionsY = currentY;
    deductions.forEach(([label, amount]) => {
      doc.text(label, 290, deductionsY).text(formatCurrency(amount), 430, deductionsY);
      deductionsY += 12;
    });

    // Summary section - Professional and clean with proper spacing
    currentY += 110;

    // Summary background - properly sized
    const summaryHeight = 65;
    doc.rect(30, currentY, pageWidth - 30, summaryHeight)
      .fillColor('#f8f9fa')
      .fill()
      .stroke('#dee2e6');

    // Total Earnings (replaced Gross Salary)
    doc.fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Total Earnings:', 40, currentY + 10)
      .text(formatCurrency(payslip.totalEarnings), 200, currentY + 10);

    // Total Deductions
    doc.text('Total Deductions:', 40, currentY + 25)
      .text(formatCurrency(payslip.totalDeductions), 200, currentY + 25);

    // Net Salary
    doc.text('Net Salary:', 40, currentY + 40)
      .text(formatCurrency(payslip.netSalary), 200, currentY + 40);

    // Attendance section - Professional and clean
    currentY += 70;

    // Attendance background - properly sized
    const attendanceHeight = 50;
    doc.rect(30, currentY, pageWidth - 30, attendanceHeight)
      .fillColor('#f8f9fa')
      .fill()
      .stroke('#dee2e6');

    // Attendance header
    doc.fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Attendance Summary', 40, currentY + 8);

    // Attendance details in two columns
    doc.fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Total Working Days:', 40, currentY + 25)
      .text('Present Days:', 200, currentY + 25)
      .text('Absent Days:', 360, currentY + 25);

    doc.fontSize(10)
      .font('Helvetica')
      .fillColor('#2c3e50')
      .text(payslip.totalDays || 0, 150, currentY + 25)
      .text(payslip.presentDays || 0, 280, currentY + 25)
      .text(payslip.absentDays || 0, 440, currentY + 25);

    // Amount in words - properly positioned
    currentY += 70;
    doc.fontSize(10)
      .font('Helvetica')
      .fillColor('#6c757d')
      .text(`Amount in words: ${numberToWords(Math.round(payslip.netSalary))} Only`, 40, currentY);

    // Notes section - only if exists, properly positioned
    if (payslip.remarks) {
      currentY += 20;
      doc.fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#495057')
        .text('Notes:', 40, currentY)
        .font('Helvetica')
        .fillColor('#6c757d')
        .text(payslip.remarks, 40, currentY + 12);
    }

    // Footer with signatures - compact and professional with proper positioning (added 10px margin bottom)
    const footerY = doc.page.height - 85;

    // Signature section with properly sized background
    const footerHeight = 60;
    doc.rect(30, footerY, pageWidth - 30, footerHeight)
      .fillColor('#f8f9fa')
      .fill()
      .stroke('#dee2e6');

    // Signature labels with proper spacing
    doc.fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#495057')
      .text('Prepared By', 40, footerY + 8)
      .text('Received By', 200, footerY + 8)
      .text('Approved By', 360, footerY + 8);

    // Signature lines with proper positioning
    doc.moveTo(40, footerY + 20).lineTo(150, footerY + 20).stroke('#6c757d');
    doc.moveTo(200, footerY + 20).lineTo(310, footerY + 20).stroke('#6c757d');
    doc.moveTo(360, footerY + 20).lineTo(470, footerY + 20).stroke('#6c757d');

    // System information - minimal with proper spacing
    doc.fontSize(8)
      .font('Helvetica')
      .fillColor('#6c757d')
      .text('Human Capital Management System', 40, footerY + 30)
      .text(`Generated by: ${payslip.createdBy?.firstName || 'SYSTEM'}`, 40, footerY + 40)
      .text(formatDate(new Date()), 40, footerY + 50);

    // Finalize PDF
    doc.end();

  } catch (error) {
    console.error('❌ Error generating payslip PDF:', error);

    // Check if headers have already been sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate payslip PDF',
        error: error.message
      });
    } else {
      console.error('❌ Headers already sent, cannot send error response');
    }
  }
}

/**
 * Calculate working days in a month (excluding Sundays)
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @returns {number} Number of working days
 */
const calculateWorkingDaysInMonth = (year, month) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(year, month, day).getDay();
    if (dayOfWeek !== 0) { // 0 = Sunday
      workingDays++;
    }
  }

  return workingDays;
};

// @route   GET /api/payroll
// @desc    Get all payrolls with filters
// @access  Private (HR and Admin)
router.get('/',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 10,
      status,
      employeeId,
      startDate,
      endDate,
      payPeriodType
    } = req.query;

    const matchStage = {};

    if (status) matchStage.status = status;
    if (employeeId) matchStage.employee = employeeId;

    if (startDate && endDate) {
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);

      // Match by month and year instead of payPeriod
      matchStage.$or = [
        {
          year: { $gte: startDateObj.getFullYear(), $lte: endDateObj.getFullYear() },
          month: { $gte: startDateObj.getMonth() + 1, $lte: endDateObj.getMonth() + 1 }
        }
      ];
    }

    let query = Payroll.find(matchStage)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId placementProject',
        populate: {
          path: 'placementProject',
          select: 'name'
        }
      })
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort({ year: -1, month: -1, createdAt: -1 });

    // Handle limit=0 case (get all records)
    if (limit > 0) {
      query = query.limit(limit * 1).skip((page - 1) * limit);
    }

    const payrolls = await query.exec();

    const total = await Payroll.countDocuments(matchStage);

    res.json({
      success: true,
      data: payrolls,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit
      }
    });
  })
);

// @route   GET /api/payroll/monthly
// @desc    Get payrolls grouped by month (optimized for monthly view)
// @access  Private (HR and Admin)
router.get('/monthly',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { status, employeeId, startDate, endDate, limit } = req.query;

    const matchStage = {};

    if (status) matchStage.status = status;
    if (employeeId) matchStage.employee = employeeId;

    // Apply date range filter if provided
    if (startDate && endDate) {
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);

      // Build date range query
      const startYear = startDateObj.getFullYear();
      const endYear = endDateObj.getFullYear();
      const startMonth = startDateObj.getMonth() + 1;
      const endMonth = endDateObj.getMonth() + 1;

      if (startYear === endYear) {
        // Same year - filter by month range
        matchStage.year = startYear;
        matchStage.month = { $gte: startMonth, $lte: endMonth };
      } else {
        // Different years - use $or for year/month combinations
        matchStage.$or = [
          { year: startYear, month: { $gte: startMonth } },
          { year: { $gt: startYear, $lt: endYear } },
          { year: endYear, month: { $lte: endMonth } }
        ];
      }
    }

    // Select only essential fields for list view to improve performance
    const query = Payroll.find(matchStage)
      .select('month year basicSalary grossSalary netSalary status employee createdAt remarks isCashSalary proration')
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId placementProject placementDepartment cashSalary',
        populate: [
          {
            path: 'placementProject',
            select: 'name'
          },
          {
            path: 'placementDepartment',
            select: 'name code'
          }
        ]
      })
      .sort({ year: -1, month: -1, createdAt: -1 })
      .lean(); // Use lean() for better performance since we don't need Mongoose documents

    // Apply limit if provided (default to 5000 to prevent timeout)
    // limit=0 means no limit (get all records)
    if (limit !== undefined && limit !== null) {
      const maxLimit = parseInt(limit);
      if (maxLimit > 0) {
        query.limit(maxLimit);
      }
      // If limit is 0, don't apply any limit (get all records)
    } else {
      // Default limit of 5000 to prevent timeout
      query.limit(5000);
    }

    const payrolls = await query.exec();

    res.json({
      success: true,
      data: payrolls,
      count: payrolls.length
    });
  })
);

// @route   GET /api/payroll/hr-authority-candidates
// @desc    Active users for payroll approval authority pickers (GM HR, AVP)
// @access  Private (HR and Admin)
router.get('/hr-authority-candidates',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const allUsers = req.query.allUsers !== 'false' && req.query.allUsers !== false;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || (allUsers ? 500 : 150), 1), 500);

    if (allUsers) {
      const users = await queryApproverCandidateUsers({ search, limit, allUsers: true });
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.json({ success: true, data: users });
    }

    const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const andClauses = [
      { isActive: true },
      {
        $or: [
          { department: { $regex: /hr|human\s*resource/i } },
          { role: { $in: ['hr_manager', 'admin', 'super_admin'] } }
        ]
      }
    ];
    if (search) {
      const rx = new RegExp(escapeRx(search), 'i');
      andClauses.push({
        $or: [
          { firstName: rx },
          { lastName: rx },
          { email: rx },
          { employeeId: rx },
          { department: rx }
        ]
      });
    }

    let users = await User.find({ $and: andClauses })
      .select('firstName lastName email employeeId department role digitalSignature')
      .sort({ firstName: 1, lastName: 1 })
      .limit(limit)
      .lean();

    if (users.length < 2) {
      const broadClauses = [{ isActive: true }];
      if (search) {
        const rx = new RegExp(escapeRx(search), 'i');
        broadClauses.push({
          $or: [
            { firstName: rx },
            { lastName: rx },
            { email: rx },
            { employeeId: rx },
            { department: rx }
          ]
        });
      }
      users = await User.find(broadClauses.length > 1 ? { $and: broadClauses } : broadClauses[0])
        .select('firstName lastName email employeeId department role digitalSignature')
        .sort({ firstName: 1, lastName: 1 })
        .limit(limit)
        .lean();
    }

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ success: true, data: users });
  })
);

// @route   GET /api/payroll/monthly-approval/:month/:year
// @desc    Get monthly payroll approval authority configuration for a period
// @access  Private (HR and Admin)
router.get('/monthly-approval/:month/:year',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ success: false, message: 'Invalid month or year' });
    }

    const doc = await getOrCreateMonthlyApproval(month, year);
    const populated = await populateMonthlyApproval(PayrollMonthlyApproval.findById(doc._id));

    res.json({
      success: true,
      data: populated
    });
  })
);

// @route   PUT /api/payroll/monthly-approval/:month/:year/authorities
// @desc    Configure approval authorities for a monthly payroll period
// @access  Private (HR and Admin)
router.put('/monthly-approval/:month/:year/authorities',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ success: false, message: 'Invalid month or year' });
    }

    const fa = req.body?.financeApprovalAuthorities || {};
    const authorities = {
      accountsOfficerUser: req.user.id,
      accountsManagerUser: fa.accountsManagerUser || fa.avpUser || null,
      financeControllerUser: fa.financeControllerUser || fa.gmHrUser || null
    };
    const ids = Object.values(authorities).map((id) => String(id || '')).filter(Boolean);
    if (ids.length < PAYROLL_AUTHORITY_SLOT_CONFIG.length) {
      return res.status(400).json({
        success: false,
        message: 'Select GM HR and AVP. You are assigned as Deputy Manager Payroll HR.'
      });
    }
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({
        success: false,
        message: 'Each approval authority must be a different user'
      });
    }

    const doc = await getOrCreateMonthlyApproval(month, year);
    doc.financeApprovalAuthorities = authorities;
    const keepKeys = PAYROLL_AUTHORITY_SLOT_CONFIG
      .filter((slot) => String(authorities?.[slot.key] || '').trim())
      .map((slot) => slot.key);
    doc.financeAuthorityApprovals = (Array.isArray(doc.financeAuthorityApprovals) ? doc.financeAuthorityApprovals : [])
      .filter((approval) => keepKeys.includes(String(approval?.authorityKey || '').trim()));
    doc.financeAuthoritiesAssignedBy = req.user.id;
    doc.financeAuthoritiesAssignedAt = new Date();
    syncAuthorityStatus(doc);
    await doc.save();

    const populated = await populateMonthlyApproval(PayrollMonthlyApproval.findById(doc._id));
    res.json({
      success: true,
      message: 'Monthly payroll approval authorities saved',
      data: populated
    });
  })
);

// @route   PATCH /api/payroll/monthly-approval/:month/:year/authority-approve
// @desc    Record current user's approval for monthly payroll period
// @access  Private (HR and Admin)
router.patch('/monthly-approval/:month/:year/authority-approve',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ success: false, message: 'Invalid month or year' });
    }

    const doc = await PayrollMonthlyApproval.findOne({ month, year });
    if (!doc) {
      return res.status(400).json({
        success: false,
        message: 'Configure approval authorities for this month before approving'
      });
    }

    const slots = getRequiredPayrollAuthoritySlots(doc);
    if (!slots.length) {
      return res.status(400).json({
        success: false,
        message: 'Approval authorities are not configured for this month'
      });
    }

    const matchedSlots = matchUserToFinanceSlots(slots, req.user);
    if (!matchedSlots.length) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned as an approval authority for this monthly payroll'
      });
    }

    const nextPendingSlot = getNextPendingPayrollAuthoritySlot(doc);
    const approvals = Array.isArray(doc.financeAuthorityApprovals) ? [...doc.financeAuthorityApprovals] : [];
    const approvedKeys = getApprovedAuthorityKeys(doc);
    const pendingMatchedSlots = matchedSlots.filter((slot) => !approvedKeys.has(slot.key));
    if (!pendingMatchedSlots.length) {
      return res.status(400).json({
        success: false,
        message: 'You have already recorded your approval for this month'
      });
    }

    const canActSlots = pendingMatchedSlots.filter(
      (slot) => nextPendingSlot && slot.key === nextPendingSlot.key
    );
    if (!canActSlots.length) {
      return res.status(403).json({
        success: false,
        message: `Waiting for ${nextPendingSlot?.label || 'prior authority'} to approve first.`
      });
    }

    const now = new Date();
    canActSlots.forEach((slot) => {
      approvals.push({
        authorityKey: slot.key,
        authorityLabel: slot.label,
        approver: req.user.id,
        decision: 'approved',
        approvedAt: now,
        comments: req.body?.comments || ''
      });
    });
    doc.financeAuthorityApprovals = approvals;
    syncAuthorityStatus(doc);
    await doc.save();

    const actedSlot = canActSlots[0];
    const bulkResult = actedSlot
      ? await applyBulkPayrollStatusForAuthoritySlot(month, year, actedSlot.key, req.user.id)
      : { matched: 0, modified: 0, payrollIds: [] };

    const comparisonResult = actedSlot
      ? await applyComparisonReportStatusForAuthoritySlot(month, year, actedSlot.key, req.user.id)
      : { matched: 0, modified: 0 };

    const remaining = slots.filter((slot) => !getApprovedAuthorityKeys(doc).has(slot.key)).length;

    if (actedSlot?.key === 'accountsManagerUser' && bulkResult.payrollIds?.length) {
      const finalizedPayrolls = await Payroll.find({ _id: { $in: bulkResult.payrollIds } });
      for (const payroll of finalizedPayrolls) {
        try {
          await FinanceHelper.recordPayrollAccrual(payroll, req.user.id);
        } catch (finError) {
          console.error(`[authority-approve] Finance accrual failed for payroll ${payroll._id}:`, finError.message);
        }
      }
    }

    if (actedSlot?.key === 'accountsManagerUser' && remaining === 0) {
      const financeUsers = await User.find({ role: { $in: ['finance_manager', 'admin', 'super_admin'] }, isActive: true })
        .select('_id')
        .lean();
      const recipientIds = financeUsers.map((u) => u._id);
      if (recipientIds.length) {
        await createAndEmitNotification({
          recipientIds,
          actorId: req.user.id,
          title: 'Monthly payroll ready for Finance',
          message: `${PAYROLL_MONTH_NAMES[month]} ${year} payroll and comparison report are AVP-approved. Process salary payment and bank letter.`,
          type: 'info',
          category: 'approval',
          priority: 'high',
          actionUrl: `/finance/payroll-queue?month=${month}&year=${year}`,
          metadata: {
            module: 'finance',
            entityType: 'PayrollMonthlyApproval',
            month,
            year
          }
        });
      }
    }

    const populated = await populateMonthlyApproval(PayrollMonthlyApproval.findById(doc._id));
    const payrollUpdateNote = bulkResult.modified > 0
      ? ` ${bulkResult.modified} payroll(s) updated to "${PAYROLL_STATUS_BY_AUTHORITY_SLOT[actedSlot?.key] || 'new status'}".`
      : '';
    const comparisonUpdateNote = comparisonResult.modified > 0
      ? ' Monthly comparison report approval updated.'
      : '';
    res.json({
      success: true,
      message: remaining === 0
        ? `All approval authorities have approved.${payrollUpdateNote}${comparisonUpdateNote}`
        : `Your approval was recorded.${payrollUpdateNote}${comparisonUpdateNote} ${remaining} approval(s) remaining.`,
      data: populated,
      payrollsUpdated: bulkResult.modified,
      comparisonReportUpdated: comparisonResult.modified > 0
    });
  })
);

// @route   GET /api/payroll/stats
// @desc    Get payroll statistics
// @access  Private (HR and Admin)
router.get('/stats',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { startDate, endDate, status } = req.query;

    const stats = await Payroll.getPayrollStats({
      startDate,
      endDate,
      status
    });

    res.json({
      success: true,
      data: stats
    });
  })
);

// @route   GET /api/payroll/monthly-comparison/:month/:year
// @desc    Get monthly payroll comparison report (cached if available)
// @access  Private (HR and Admin)
router.get('/monthly-comparison/:month/:year',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ success: false, message: 'Invalid month or year' });
    }
    const regenerate = req.query.regenerate === 'true' || req.query.force === 'true';
    const result = await getPayrollMonthlyComparisonReport(month, year, { regenerate });
    const approvalDoc = await populateMonthlyApproval(
      PayrollMonthlyApproval.findOne({ month, year })
    );
    res.json({
      success: true,
      data: {
        ...result,
        monthlyApproval: approvalDoc || null
      }
    });
  })
);

// @route   POST /api/payroll/monthly-comparison/:month/:year/generate
// @desc    Build and save monthly payroll comparison report
// @access  Private (HR and Admin)
router.post('/monthly-comparison/:month/:year/generate',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const month = parseInt(req.params.month, 10);
    const year = parseInt(req.params.year, 10);
    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ success: false, message: 'Invalid month or year' });
    }
    const payrollCount = await Payroll.countDocuments({ month, year });
    if (!payrollCount) {
      return res.status(404).json({
        success: false,
        message: 'No payroll records found for this month. Generate payroll first.'
      });
    }
    const saved = await savePayrollMonthlyComparisonReport(month, year, req.user.id, { force: true });
    // Clear late-entry/late-termination flags so they don't bleed into next month's report
    await clearLateEntryFlags(month, year);
    const approvalDoc = await populateMonthlyApproval(
      PayrollMonthlyApproval.findOne({ month, year })
    );
    res.json({
      success: true,
      message: `Comparison report generated for ${month}/${year}`,
      data: {
        report: saved.report,
        generatedAt: saved.savedAt,
        status: saved.status,
        fromCache: false,
        monthlyApproval: approvalDoc || null
      }
    });
  })
);

// @route   GET /api/payroll/current-overview
// @desc    Get current payroll overview for all active employees
// @access  Private (HR and Admin)
router.get('/current-overview',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      // Get all active employees with salary information
      const activeEmployees = await Employee.find({
        employmentStatus: { $in: ['Active', 'Reinstated'] },
        'salary.gross': { $exists: true, $gt: 0 }
      })
        .select(PAYROLL_EMPLOYEE_SELECT)
        .populate('placementDepartment', 'name code')
        .populate('placementProject', 'name')
        .populate('department', 'name');

      if (activeEmployees.length === 0) {
        return res.json({
          success: true,
          data: {
            totalEmployees: 0,
            totalBasicSalary: 0,
            totalGrossSalary: 0,
            totalNetSalary: 0,
            totalMedicalAllowance: 0,
            totalTaxableIncome: 0,
            totalTax: 0,
            employees: []
          }
        });
      }

      let totalBasicSalary = 0;
      let totalGrossSalary = 0;
      let totalMedicalAllowance = 0;
      let totalTaxableIncome = 0;
      let totalTax = 0;
      let totalNetSalary = 0;

      const employeeDetails = [];

      // Get all latest increments for active employees in one query
      const employeeIds = activeEmployees.map(emp => emp._id);
      const EmployeeIncrement = require('../models/hr/EmployeeIncrement');
      const latestIncrements = await EmployeeIncrement.aggregate([
        {
          $match: {
            employee: { $in: employeeIds },
            status: 'implemented'
          }
        },
        {
          $sort: { effectiveDate: -1 }
        },
        {
          $group: {
            _id: '$employee',
            latestIncrement: { $first: '$$ROOT' }
          }
        }
      ]);

      // Create a map for quick lookup
      const incrementMap = new Map();
      latestIncrements.forEach(inc => {
        incrementMap.set(inc._id.toString(), inc.latestIncrement.newSalary);
      });

      const taxSettings = await loadPayrollTaxSettings();

      const { month: overviewMonth, year: overviewYear } = resolvePayrollPreviewPeriod(
        req.query.month,
        req.query.year
      );

      // Fetch active loans for all active employees for current month preview
      const LoanModel = require('../models/hr/Loan');
      const {
        effectiveLoanDeductionForPayroll,
        activeLoanStatusFilter
      } = require('../utils/loanPayrollDeduction');
      const activeLoans = await LoanModel.find({
        employee: { $in: employeeIds },
        ...activeLoanStatusFilter()
      });

      const loanDeductionsMap = new Map();
      activeLoans.forEach((loan) => {
        const empIdStr = loan.employee.toString();
        const amount = effectiveLoanDeductionForPayroll(loan, overviewMonth, overviewYear);
        if (amount <= 0) return;
        const currentLoanDeduction = loanDeductionsMap.get(empIdStr) || 0;
        loanDeductionsMap.set(empIdStr, currentLoanDeduction + amount);
      });

      for (const employee of activeEmployees) {
        const gross = incrementMap.get(employee._id.toString()) || employee.salary.gross;
        const figures = computeEmployeeCurrentPayrollFigures(
          employee,
          gross,
          taxSettings,
          overviewMonth,
          overviewYear
        );
        if (figures.skipPayroll) continue;

        const { taxCalculation, resolvedTax } = figures;
        const monthlyTax = Math.round(resolvedTax ?? taxCalculation.totalTax);
        const taxableIncome =
          taxCalculation.annualTaxableIncome != null && taxCalculation.fyMonths
            ? taxCalculation.annualTaxableIncome / taxCalculation.fyMonths
            : taxCalculation.mainTaxableIncome;
        const empLoanDeduction = Math.round(loanDeductionsMap.get(employee._id.toString()) || 0);
        const netSalary = Math.round(
          figures.totalEarnings - monthlyTax - figures.eobiDeduction - (figures.employeeSecurityDeduction || 0) - empLoanDeduction
        );

        totalBasicSalary += figures.basic;
        totalGrossSalary += figures.totalEarnings;
        totalMedicalAllowance += figures.medical;
        totalTaxableIncome += taxableIncome;
        totalTax += monthlyTax;
        totalNetSalary += netSalary;

        employeeDetails.push({
          _id: employee._id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          employeeId: employee.employeeId,
          basicSalary: Math.round(figures.basic),
          grossSalary: Math.round(figures.grossSalary ?? gross),
          additionalAllowances: Math.round(figures.additionalAllowances),
          proration: figures.proration?.isProrated ? figures.proration : undefined,
          arrears: Math.round(figures.employeeArrears),
          totalEarnings: Math.round(figures.totalEarnings),
          medicalAllowance: Math.round(figures.medical),
          taxableIncome: Math.round(taxableIncome),
          monthlyTax: monthlyTax,
          eobi: Math.round(figures.eobiDeduction),
          employeeSecurity: Math.round(figures.employeeSecurityDeduction || 0),
          loanDeductions: empLoanDeduction,
          netSalary: netSalary,
          isManualTax: Boolean(employee?.manualTax?.isActive),
          department: employee.department,
          placementDepartment: employee.placementDepartment,
          placementProject: employee.placementProject,
          position: employee.position,
          isCashSalary: Boolean(employee.cashSalary)
        });
      }

      // Sort employees by Employee ID
      employeeDetails.sort((a, b) => {
        const idA = parseInt(a.employeeId) || 0;
        const idB = parseInt(b.employeeId) || 0;
        return idA - idB;
      });

      res.json({
        success: true,
        data: {
          month: overviewMonth,
          year: overviewYear,
          totalEmployees: activeEmployees.length,
          totalBasicSalary: Math.round(totalBasicSalary),
          totalGrossSalary: Math.round(totalGrossSalary),
          totalMedicalAllowance: Math.round(totalMedicalAllowance),
          totalTaxableIncome: Math.round(totalTaxableIncome),
          totalTax: Math.round(totalTax),
          totalNetSalary: Math.round(totalNetSalary),
          employees: employeeDetails
        }
      });
    } catch (error) {
      console.error('Error in current-overview:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch current payroll overview',
        error: error.message
      });
    }
  })
);

const fetchEmployeePayrollDetailPayload = async (employeeId, req) => {
  const employee = await Employee.findById(employeeId)
    .populate('department', 'name code')
    .populate('placementDepartment', 'name code')
    .populate('placementDesignation', 'title level')
    .populate('position', 'title level')
    .select(PAYROLL_EMPLOYEE_SELECT);

  if (!employee) {
    return { notFound: true };
  }

  const { month: previewMonth, year: previewYear } = resolvePayrollPreviewPeriod(
    req.query.month,
    req.query.year
  );

  const gross = await resolveEmployeeGrossSalary(employee);
  const taxSettings = await loadPayrollTaxSettings();
  const figures = computeEmployeeCurrentPayrollFigures(
    employee,
    gross,
    taxSettings,
    previewMonth,
    previewYear
  );

  const LoanModel = require('../models/hr/Loan');
  const {
    effectiveLoanDeductionForPayroll: effectiveLoanDeductionPreview,
    activeLoanStatusFilter: activeLoanFilterPreview
  } = require('../utils/loanPayrollDeduction');
  const activeLoans = await LoanModel.find({
    employee: employeeId,
    ...activeLoanFilterPreview()
  });
  const loanDeductions = activeLoans.reduce(
    (total, loan) => total + effectiveLoanDeductionPreview(loan, previewMonth, previewYear),
    0
  );

  const existingPayrolls = await Payroll.find({ employee: employeeId })
    .sort({ year: -1, month: -1 })
    .limit(12);

  return {
    employee: {
      _id: employee._id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeId: employee.employeeId,
      department: employee.department,
      placementDepartment: employee.placementDepartment,
      placementDesignation: employee.placementDesignation,
      position: employee.position
    },
    currentPayroll: buildEmployeeCurrentPayrollPayload(
      employee,
      gross,
      figures,
      previewMonth,
      previewYear,
      Math.round(loanDeductions)
    ),
    existingPayrolls
  };
};

// @route   GET /api/payroll/employee/:employeeId
// @desc    Get payroll details for a specific employee
// @access  Private (HR and Admin)
router.get('/employee/:employeeId',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.employeeId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid employee ID format'
        });
      }

      const payload = await fetchEmployeePayrollDetailPayload(req.params.employeeId, req);
      if (payload.notFound) {
        return res.status(404).json({
          success: false,
          message: 'Employee not found'
        });
      }

      res.json({ success: true, data: payload });
    } catch (error) {
      console.error('Error in employee payroll details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch employee payroll details',
        error: error.message
      });
    }
  })
);

// @route   GET /api/payroll/view/employee/:employeeId
// @desc    Get payroll details for viewing (same as employee/:employeeId but for view route)
// @access  Private (HR and Admin)
router.get('/view/employee/:employeeId',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.employeeId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid employee ID format'
        });
      }

      const payload = await fetchEmployeePayrollDetailPayload(req.params.employeeId, req);
      if (payload.notFound) {
        return res.status(404).json({
          success: false,
          message: 'Employee not found'
        });
      }

      res.json({ success: true, data: payload });
    } catch (error) {
      console.error('Error in employee payroll details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch employee payroll details',
        error: error.message
      });
    }
  })
);

// @route   POST /api/payroll/bulk-approve
// @desc    Approve all draft payrolls for a month/year (optional department/project filters)
// @access  Private (HR and Admin)
router.post(
  '/bulk-approve',
  authorize('super_admin', 'admin', 'hr_manager'),
  [
    body('month').isInt({ min: 1, max: 12 }).withMessage('Month must be between 1 and 12'),
    body('year').isInt({ min: 2020 }).withMessage('Year must be 2020 or later'),
    body('department').optional().isMongoId().withMessage('Invalid department'),
    body('project').optional().isMongoId().withMessage('Invalid project')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const month = parseInt(req.body.month, 10);
    const year = parseInt(req.body.year, 10);
    const { department, project } = req.body;

    const payrollQuery = { month, year, status: 'Draft' };

    if (department || project) {
      const employeeFilter = { isDeleted: { $ne: true } };
      if (department) {
        employeeFilter.$or = [
          { department: new mongoose.Types.ObjectId(department) },
          { placementDepartment: new mongoose.Types.ObjectId(department) }
        ];
      }
      if (project) {
        employeeFilter.placementProject = new mongoose.Types.ObjectId(project);
      }
      const employeeIds = await Employee.find(employeeFilter).distinct('_id');
      if (!employeeIds.length) {
        return res.json({
          success: true,
          message: 'No employees match the selected filters for this period.',
          data: { approved: 0, skipped: 0, errors: [], month, year }
        });
      }
      payrollQuery.employee = { $in: employeeIds };
    }

    const draftPayrolls = await Payroll.find(payrollQuery).sort({ employee: 1 });

    if (!draftPayrolls.length) {
      return res.json({
        success: true,
        message: `No draft payrolls to approve for ${month}/${year}.`,
        data: { approved: 0, skipped: 0, errors: [], month, year }
      });
    }

    await assertMonthlyPayrollAuthoritiesApproved(month, year);

    let approved = 0;
    const approveErrors = [];

    for (const payroll of draftPayrolls) {
      try {
        await payroll.approve(req.user.id);
        try {
          await FinanceHelper.recordPayrollAccrual(payroll, req.user.id);
        } catch (finError) {
          console.error(`[bulk-approve] Finance accrual failed for payroll ${payroll._id}:`, finError.message);
        }
        approved += 1;
      } catch (err) {
        approveErrors.push({
          payrollId: payroll._id,
          message: err.message || 'Approval failed'
        });
      }
    }

    const monthNames = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    res.json({
      success: true,
      message:
        approved > 0
          ? `Approved ${approved} payroll(s) for ${monthNames[month] || month} ${year}.`
          : `No payrolls were approved for ${monthNames[month] || month} ${year}.`,
      data: {
        month,
        year,
        approved,
        skipped: draftPayrolls.length - approved - approveErrors.length,
        failed: approveErrors.length,
        errors: approveErrors
      }
    });
  })
);

// @route   GET /api/payroll/:id
// @desc    Get payroll by ID
// @access  Private (HR and Admin)
router.get('/:id',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payroll ID format'
      });
    }

    const payroll = await Payroll.findById(req.params.id)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId department position salary placementProject providentFund',
        populate: {
          path: 'placementProject',
          select: 'name'
        }
      })
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName');

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    // 🔧 CALCULATE ATTENDANCE DEDUCTION FOR DISPLAY
    // This ensures the attendance deduction is always calculated correctly when viewing
    payroll.calculateAttendanceDeduction();
    const pfEnabled = payroll.providentFundEnabled === true || isProvidentFundEnabledForEmployee(payroll.employee);
    payroll.providentFundEnabled = pfEnabled;
    payroll.providentFund = pfEnabled ? (payroll.providentFund || 0) : 0;

    console.log(`📊 Payroll ${payroll._id} fetched with calculated attendance deduction: Rs. ${payroll.attendanceDeduction?.toFixed(2) || 0}`);

    res.json({
      success: true,
      data: payroll
    });
  })
);

// @route   POST /api/payroll
// @desc    Generate payrolls for all active employees for a full month
// @access  Private (HR and Admin)
router.post('/', [
  authorize('super_admin', 'admin', 'hr_manager'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Month must be between 1 and 12'),
  body('year').isInt({ min: 2020 }).withMessage('Year must be 2020 or later'),
  body('forceRegenerate').optional().isBoolean().withMessage('Force regenerate must be a boolean')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { month, year, forceRegenerate = false } = req.body;

  try {
    console.log(`🚀 Starting payroll generation for ${month}/${year}...`);

    // Get all active employees with salary information
    const activeEmployees = await Employee.find({
      employmentStatus: { $in: ['Active', 'Reinstated'] },
      'salary.gross': { $exists: true, $gt: 0 }
    }).select(PAYROLL_EMPLOYEE_SELECT);

    if (activeEmployees.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active employees found with salary information'
      });
    }

    console.log(`📊 Found ${activeEmployees.length} active employees for payroll generation`);

    // 🔧 CHECK ZKBIO TIME SERVER STATUS ONCE BEFORE PROCESSING ALL EMPLOYEES
    console.log('🔍 Checking ZKBio Time server status before bulk payroll generation...');
    const serverStatus = await AttendanceIntegrationService.checkZKBioServerStatus();
    const zkbioServerOnline = serverStatus.isOnline;

    if (zkbioServerOnline) {
      console.log('✅ ZKBio Time server is online - will fetch actual attendance records');
    } else {
      console.log('⚠️ ZKBio Time server is offline - will use fallback calculations (full attendance)');
      console.log(`   Server status: ${serverStatus.message}`);
    }

    const createdPayrolls = [];
    const errors = [];
    const skippedEmployees = [];
    let totalGrossSalary = 0;
    let totalNetSalary = 0;
    let totalTax = 0;

    // 🚀 OPTIMIZED BULK PROCESSING - Process employees in parallel batches
    const BATCH_SIZE = 20; // Process 20 employees simultaneously for optimal performance
    const batches = [];

    // Split employees into batches
    for (let i = 0; i < activeEmployees.length; i += BATCH_SIZE) {
      batches.push(activeEmployees.slice(i, i + BATCH_SIZE));
    }

    console.log(`🚀 Processing ${activeEmployees.length} employees in ${batches.length} batches of ${BATCH_SIZE}`);

    // 🔧 PRE-CALCULATE COMMON VALUES (Performance optimization)
    const workingDays = AttendanceIntegrationService.calculateWorkingDaysInMonth(year, month - 1);

    // 🔧 BULK ATTENDANCE INTEGRATION (Major performance boost)
    console.log('🔧 Fetching bulk attendance data for all employees...');
    const employeeDataForAttendance = activeEmployees.map(emp => ({
      employeeId: emp.employeeId,
      grossSalary: emp.salary.gross
    }));

    const bulkAttendanceData = await AttendanceIntegrationService.getBulkAttendanceIntegration(
      employeeDataForAttendance,
      month,
      year,
      zkbioServerOnline
    );

    console.log(`✅ Bulk attendance data fetched for ${activeEmployees.length} employees`);

    const taxSettings = await loadPayrollTaxSettings();

    // One-month salary % cuts (imported) — EOBI stays full when applied
    const PayrollMonthSalaryCut = require('../models/hr/PayrollMonthSalaryCut');
    const { applySalaryPercentageCutToPayrollData } = require('../utils/payrollSalaryPercentageCut');
    const monthCuts = await PayrollMonthSalaryCut.find({
      month: Number(month),
      year: Number(year)
    }).select('employee percentage').lean();
    const salaryCutByEmployee = new Map(
      monthCuts.map((c) => [String(c.employee), Number(c.percentage)])
    );
    if (salaryCutByEmployee.size > 0) {
      console.log(`📉 Applying one-month salary % cut for ${salaryCutByEmployee.size} employee(s) in ${month}/${year} (EOBI full)`);
    }

    // Process each batch in parallel
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`📊 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} employees)`);

      // Process all employees in current batch in parallel
      const batchPromises = batch.map(async (employee) => {
        try {
          // Get current salary (with latest increment applied)
          const currentSalaryResult = await incrementService.getEmployeeCurrentSalary(employee._id);
          const monthlyGross = currentSalaryResult.success
            ? currentSalaryResult.data.currentSalary
            : employee.salary.gross;

          const prorationResult = applyPayrollProration(employee, month, year, monthlyGross);
          if (prorationResult.skipPayroll) {
            return {
              success: false,
              skip: true,
              employee: {
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`
              },
              reason: prorationResult.proration?.reason
                || 'Employee not yet joined in this payroll period'
            };
          }

          const grossSalary = prorationResult.grossSalary;
          const proration = prorationResult.proration;
          const effectiveAllowances = prorationResult.allowances;

          // 🔧 SALARY BREAKDOWN CALCULATION (66.66% basic, 10% medical, 23.34% house rent)
          const basicSalary = Math.round(grossSalary * 0.6666);
          const medicalAllowance = Math.round(grossSalary * 0.10);
          const houseRentAllowance = Math.round(grossSalary * 0.2334);

          // Calculate additional allowances from employee master data (prorated in join month)
          const additionalAllowances = additionalAllowancesTotal(effectiveAllowances);

          // Get current month arrears from employee record
          let employeeArrears = 0;
          if (employee.arrears) {
            const arrearsTypes = ['salaryAdjustment', 'bonusPayment', 'overtimePayment', 'allowanceAdjustment', 'deductionReversal', 'other'];

            for (const arrearsType of arrearsTypes) {
              const arrearsData = employee.arrears[arrearsType];
              if (arrearsData && arrearsData.isActive &&
                arrearsData.month === month &&
                arrearsData.year === year &&
                arrearsData.status !== 'Paid' &&
                arrearsData.status !== 'Cancelled') {
                employeeArrears += arrearsData.amount || 0;
              }
            }
          }

          // 🔧 TOTAL EARNINGS = Gross Salary + All Allowances + Overtime + Bonuses + Arrears
          const totalEarnings = grossSalary + additionalAllowances + employeeArrears;

          // Taxable = (gross − medical%) + taxable allowances + arrears
          // Then FBR on DOJ-based FY annualization (not separate arrears tax)
          const taxCalculation = calculatePayrollTaxWithSettings({
            grossSalary,
            allowances: effectiveAllowances,
            arrears: employeeArrears,
            employeeId: employee._id,
            settings: taxSettings,
            hireDate: employee.hireDate || employee.appointmentDate,
            payrollMonth: month,
            payrollYear: year
          });
          // Tax is calculated on already-prorated gross/allowances — do NOT multiply by factor again.
          // Mid-year joiners in the current FY use remaining months; others stay ×12 / ÷12.
          let { tax: monthlyTax } = resolveEmployeeIncomeTax(employee, taxCalculation.totalTax);

          // 🔧 AUTO-CALCULATE OTHER DEDUCTIONS
          const providentFundEnabled = isProvidentFundEnabledForEmployee(employee);
          const providentFund = calculateProvidentFundForEmployee(employee, basicSalary);
          // EOBI / employee security: prorate only for joining-month proration.
          // Partial salary (custom days) affects salary only — keep full monthly amounts.
          let eobi = getEmployeeEobiDeduction(employee);
          let employeeSecurity = getEmployeeSecurityDeduction(employee);
          if (proration.factor < 1 && proration.type !== 'partial_salary') {
            eobi = Math.round(eobi * proration.factor);
            employeeSecurity = Math.round(employeeSecurity * proration.factor);
          }

          // 🔧 CALCULATE LOAN DEDUCTIONS FROM ACTIVE LOANS (pauses + stop when fully paid)
          const loanModel = require('../models/hr/Loan');
          const {
            effectiveLoanDeductionForPayroll,
            activeLoanStatusFilter,
            markLoanCompletedIfPaid
          } = require('../utils/loanPayrollDeduction');
          const activeLoans = await loanModel.find({
            employee: employee._id,
            ...activeLoanStatusFilter()
          });

          let loanDeductions = 0;
          for (const loan of activeLoans) {
            const amount = effectiveLoanDeductionForPayroll(loan, month, year);
            if (amount <= 0) {
              await markLoanCompletedIfPaid(loan).catch(() => {});
              continue;
            }
            loanDeductions += amount;
          }

          // 🔧 CALCULATE SALARY ADVANCE FOR THIS MONTH
          const salaryAdvanceModel = require('../models/hr/SalaryAdvance');
          const unadjustedAdvances = await salaryAdvanceModel.find({
            employee: employee._id,
            payrollMonth: Number(month),
            payrollYear: Number(year),
            status: 'Unadjusted'
          });
          const advanceSalary = unadjustedAdvances.reduce((sum, adv) => sum + (adv.amount || 0), 0);

          // 🔧 USE PRE-FETCHED BULK ATTENDANCE DATA (Major performance boost)
          const rawAttendanceData = bulkAttendanceData[employee.employeeId] || {
            presentDays: workingDays,
            absentDays: 0,
            leaveDays: 0,
            totalWorkingDays: workingDays,
            dailyRate: grossSalary / workingDays,
            attendanceDeduction: 0
          };
          const attendanceData = adjustAttendanceForJoiningProration(
            rawAttendanceData,
            proration,
            grossSalary
          );

          const {
            presentDays,
            absentDays,
            leaveDays,
            totalWorkingDays,
            dailyRate,
            attendanceDeduction
          } = attendanceData;

          // 🔧 TOTAL DEDUCTIONS (Provident Fund excluded as requested)
          const totalDeductions = monthlyTax + eobi + employeeSecurity + attendanceDeduction + loanDeductions + advanceSalary;

          // Define healthInsurance and otherDeductions
          const healthInsurance = 0;
          const otherDeductions = 0;

          // Net = Total Earnings − all deductions (Provident Fund is display-only, not deducted)
          const netSalary = totalEarnings - monthlyTax - eobi - employeeSecurity - healthInsurance - loanDeductions - advanceSalary - attendanceDeduction - otherDeductions;

          if (netSalary < 0) {
            return {
              success: false,
              error: `Calculated net salary is negative (Rs. ${Math.round(netSalary)})`,
              employee: {
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`
              }
            };
          }

          // Create payroll data
          const payrollData = {
            employee: employee._id,
            employee,
            month,
            year,
            status: 'Draft',
            isManual: true,
            basicSalary: basicSalary || 0,
            houseRentAllowance,
            medicalAllowance,
            allowances: payrollAllowancesFromEmployee(effectiveAllowances),
            overtimeHours: 0,
            overtimeRate: 0,
            overtimeAmount: 0,
            performanceBonus: 0,
            otherBonus: 0,
            arrears: employeeArrears,
            providentFund,
            providentFundEnabled,
            incomeTax: monthlyTax,
            healthInsurance: 0,
            loanDeductions: loanDeductions,
            advanceSalary: advanceSalary,
            otherDeductions: 0,
            eobi,
            employeeSecurity,
            totalWorkingDays,
            presentDays,
            absentDays,
            leaveDays,
            dailyRate,
            attendanceDeduction,
            grossSalary,
            totalEarnings,
            totalDeductions,
            netSalary,
            // Tax calculation breakdown
            taxCalculation: {
              mainTax: Math.round(taxCalculation.mainTax),
              arrearsTax: Math.round(taxCalculation.arrearsTax),
              totalTax: Math.round(taxCalculation.totalTax),
              mainTaxableIncome: Math.round(taxCalculation.mainTaxableIncome),
              arrearsTaxableIncome: Math.round(taxCalculation.arrearsTaxableIncome),
              annualTaxableIncome: Math.round(taxCalculation.annualTaxableIncome || 0),
              annualTax: Math.round(taxCalculation.annualTax || 0),
              fyMonths: taxCalculation.fyMonths || 12,
              usesAllowanceTaxPolicy: taxCalculation.usesAllowanceTaxPolicy
            },
            currency: 'PKR',
            remarks: `Monthly payroll generated for ${month}/${year}${buildPayrollProrationRemarksSuffix(proration)}`,
            proration: proration?.isProrated ? proration : undefined,
            isCashSalary: Boolean(employee.cashSalary),
            createdBy: req.user.id,
            status: 'Draft'
          };

          const cutPct = salaryCutByEmployee.get(String(employee._id));
          if (cutPct > 0) {
            applySalaryPercentageCutToPayrollData(payrollData, cutPct);
          }

          // Validate each record before batching so one bad row never breaks the whole bulk run.
          const validationError = new Payroll(payrollData).validateSync();
          if (validationError) {
            return {
              success: false,
              error: validationError.message,
              employee: {
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`
              }
            };
          }

          return {
            success: true,
            payrollData,
            employee: {
              _id: employee._id,
              firstName: employee.firstName,
              lastName: employee.lastName,
              employeeId: employee.employeeId,
              department: employee.department,
              position: employee.position
            },
            totals: {
              totalEarnings: payrollData.totalEarnings,
              netSalary: payrollData.netSalary,
              monthlyTax: payrollData.incomeTax
            }
          };
        } catch (error) {
          console.error(`❌ Error processing payroll for ${employee.firstName} ${employee.lastName}:`, error.message);
          return {
            success: false,
            error: error.message,
            employee: {
              employeeId: employee.employeeId,
              name: `${employee.firstName} ${employee.lastName}`
            }
          };
        }
      });

      // Wait for all employees in current batch to complete
      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          const { payrollData, employee, totals } = result.value;

          // Check for existing payroll and handle duplicates
          const existingPayroll = await Payroll.findOne({
            employee: employee._id,
            month,
            year
          });

          if (existingPayroll) {
            const { isPayrollRecordLocked } = require('../utils/payrollLock');
            if (isPayrollRecordLocked(existingPayroll)) {
              skippedEmployees.push({
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`,
                reason: `Payroll for ${month}/${year} is locked (status: ${existingPayroll.status})`
              });
              continue;
            }
            if (forceRegenerate) {
              // Delete existing Draft payroll if forceRegenerate is true
              await Payroll.findByIdAndDelete(existingPayroll._id);
              console.log(`🔄 Regenerated payroll for ${employee.firstName} ${employee.lastName} (${employee.employeeId})`);
            } else {
              // Skip this employee if payroll already exists
              console.log(`⏭️  Skipping ${employee.firstName} ${employee.lastName} (${employee.employeeId}) - payroll already exists for ${month}/${year}`);
              skippedEmployees.push({
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`,
                reason: `Payroll already exists for ${month}/${year}`
              });
              continue;
            }
          }

          // Add to batch for bulk insert
          createdPayrolls.push(payrollData);

          // Accumulate totals
          totalGrossSalary += totals.totalEarnings;
          totalNetSalary += totals.netSalary;
          totalTax += totals.monthlyTax;
        } else if (result.status === 'fulfilled' && !result.value.success && result.value.skip) {
          skippedEmployees.push({
            employeeId: result.value.employee.employeeId,
            name: result.value.employee.name,
            reason: result.value.reason || 'Not eligible for this payroll period'
          });
        } else if (result.status === 'fulfilled' && !result.value.success) {
          // Handle individual employee errors
          errors.push({
            employeeId: result.value.employee.employeeId,
            name: result.value.employee.name,
            error: result.value.error
          });
        } else {
          // Handle promise rejection
          errors.push({
            employeeId: 'Unknown',
            name: 'Unknown Employee',
            error: result.reason?.message || 'Unknown error'
          });
        }
      }

      console.log(`✅ Batch ${batchIndex + 1}/${batches.length} completed`);
    }

    if (createdPayrolls.length === 0) {
      console.log('ℹ️ No new payroll records to create (all employees skipped or errored)');
      return res.status(200).json({
        success: true,
        message: `No new payrolls created for ${month}/${year}`,
        data: {
          payrolls: [],
          summary: {
            totalEmployees: activeEmployees.length,
            payrollsCreated: 0,
            skippedEmployees: skippedEmployees.length,
            errors: errors.length,
            arrearsUpdated: 0,
            totalGrossSalary,
            totalNetSalary,
            totalTax
          },
          skippedEmployees,
          errors,
          serverStatus: {
            zkbioServerOnline,
            message: serverStatus.message,
            server: serverStatus.server || 'ZKBio Time'
          }
        }
      });
    }

    // 🚀 BULK DATABASE INSERT (Major performance boost)
    console.log(`💾 Performing bulk insert of ${createdPayrolls.length} payroll records...`);
    const insertedPayrolls = await Payroll.insertMany(createdPayrolls, { ordered: false });
    console.log(`✅ Bulk insert completed: ${insertedPayrolls.length} payroll records created`);

    // 🔧 UPDATE ARREARS STATUS TO 'PAID' FOR ALL CREATED PAYROLLS
    console.log('💰 Updating arrears status to "Paid" for created payrolls...');
    let arrearsUpdatedCount = 0;

    for (const payroll of insertedPayrolls) {
      try {
        const updated = await markEmployeeArrearsPaidForPeriod(payroll.employee, month, year);
        if (updated) {
          arrearsUpdatedCount++;
        }
      } catch (error) {
        console.error(`❌ Error updating arrears for employee ${payroll.employee}:`, error.message);
      }
    }

    console.log(`💰 Arrears status update completed: ${arrearsUpdatedCount} employees updated`);

    // 🚀 BULK POPULATE FOR RESPONSE (Performance optimization)
    console.log('🔧 Populating employee details for response...');
    const populatedPayrolls = await Payroll.find({
      _id: { $in: insertedPayrolls.map(p => p._id) }
    }).populate('employee', 'firstName lastName employeeId department position');

    console.log(`✅ Employee details populated for ${populatedPayrolls.length} payroll records`);


    // 🎯 FINAL SUMMARY AND RESPONSE
    console.log(`\n🎉 OPTIMIZED BULK PAYROLL GENERATION COMPLETED!`);
    console.log(`📊 Summary:`);
    console.log(`   Total Employees Processed: ${activeEmployees.length}`);
    console.log(`   Payrolls Created: ${populatedPayrolls.length}`);
    console.log(`   Skipped (Duplicates): ${skippedEmployees.length}`);
    console.log(`   Errors: ${errors.length}`);
    console.log(`   Arrears Updated to 'Paid': ${arrearsUpdatedCount} employees`);
    console.log(`   Total Gross Salary: Rs. ${totalGrossSalary.toLocaleString()}`);
    console.log(`   Total Net Salary: Rs. ${totalNetSalary.toLocaleString()}`);
    console.log(`   Total Tax Collected: Rs. ${totalTax.toLocaleString()}`);

    try {
      await savePayrollMonthlyComparisonReport(month, year, req.user.id);
      console.log(`📋 Monthly comparison report saved for ${month}/${year}`);
      // Clear late-entry/late-termination flags so they don't bleed into next month's report
      await clearLateEntryFlags(month, year);
    } catch (comparisonErr) {
      console.error('⚠️ Failed to save monthly comparison report:', comparisonErr.message);
    }

    res.status(201).json({
      success: true,
      message: `Successfully generated ${populatedPayrolls.length} payrolls for ${month}/${year}`,
      data: {
        payrolls: populatedPayrolls,
        summary: {
          totalEmployees: activeEmployees.length,
          payrollsCreated: populatedPayrolls.length,
          skippedEmployees: skippedEmployees.length,
          errors: errors.length,
          arrearsUpdated: arrearsUpdatedCount,
          totalGrossSalary,
          totalNetSalary,
          totalTax
        },
        skippedEmployees,
        errors,
        serverStatus: {
          zkbioServerOnline,
          message: serverStatus.message,
          server: serverStatus.server || 'ZKBio Time'
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in payroll generation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate payrolls',
      error: error.message
    });
  }
}));

// @route   POST /api/payroll/manual
// @desc    Create a draft payroll for a specific employee manually
// @access  Private (HR and Admin)
router.post('/manual', [
  authorize('super_admin', 'admin', 'hr_manager'),
  body('employee').isMongoId().withMessage('Employee is required'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Month is required'),
  body('year').isInt({ min: 2020 }).withMessage('Year is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  const { employee, month, year, basicSalary, grossSalary } = req.body;
  
  // check if a MANUAL payroll already exists
  const existing = await Payroll.findOne({ employee, month, year, isManual: true });
  if (existing) {
    return res.status(400).json({ success: false, message: 'A manual payroll already exists for this employee for this month and year' });
  }

  const payroll = new Payroll({
    employee,
    month,
    year,
    status: 'Draft',
    isManual: true,
    basicSalary: basicSalary || 0,
    grossSalary: grossSalary || 0,
    totalWorkingDays: 26,
    presentDays: 26,
    absentDays: 0,
    leaveDays: 0,
    allowances: {},
    overtimeHours: 0,
    overtimeRate: 0,
    overtimeAmount: 0,
    performanceBonus: 0,
    otherBonus: 0,
    arrears: 0,
    incomeTax: 0,
    providentFund: 0,
    healthInsurance: 0,
    eobi: 0,
    employeeSecurity: 0,
    otherDeductions: 0,
    totalDeductions: 0,
    totalEarnings: 0,
    netSalary: 0
  });

  await payroll.save();
  res.status(201).json({ success: true, data: payroll });
}));

// @route   PUT /api/payroll/:id
// @desc    Update payroll with proper calculation logic including attendance deductions
// @access  Private (HR and Admin)
// @fixes  Attendance deduction calculation and inclusion in total deductions
// @formula Total Deductions = Income Tax + EOBI + Health Insurance + Attendance Deduction + Other Deductions
router.put('/:id', [
  authorize('super_admin', 'admin', 'hr_manager'),
  body('payPeriod.startDate').optional().notEmpty().withMessage('Start date is required'),
  body('payPeriod.endDate').optional().notEmpty().withMessage('End date is required'),
  body('payPeriod.type').optional().isIn(['weekly', 'bi-weekly', 'monthly']).withMessage('Valid pay period type is required'),
  body('basicSalary').optional().isNumeric().withMessage('Valid basic salary is required')
], asyncHandler(async (req, res) => {
  console.log('🔧 PUT /api/payroll/:id - Request received');
  console.log('   Payroll ID:', req.params.id);
  console.log('   Request Body:', JSON.stringify(req.body, null, 2));
  console.log('   User:', req.user ? req.user.email : 'No user');

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payroll ID format'
    });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const payroll = await Payroll.findById(req.params.id);
  if (!payroll) {
    return res.status(404).json({
      success: false,
      message: 'Payroll not found'
    });
  }

  // Don't allow updates once payroll leaves Draft (fully locked)
  const { isPayrollRecordLocked, payrollLockMessage } = require('../utils/payrollLock');
  if (isPayrollRecordLocked(payroll)) {
    return res.status(400).json({
      success: false,
      message: payrollLockMessage(payroll)
    });
  }

  const updateData = { ...req.body };

  // Convert dates if provided - extract month and year from payPeriod if provided
  if (req.body.payPeriod && req.body.payPeriod.startDate) {
    const startDate = new Date(req.body.payPeriod.startDate);
    updateData.month = startDate.getMonth() + 1;
    updateData.year = startDate.getFullYear();
  }

  // Convert numeric fields
  if (req.body.basicSalary) {
    updateData.basicSalary = parseFloat(req.body.basicSalary);
  }

  // Map allowance fields if provided
  if (req.body.allowances) {
    updateData.houseRentAllowance = parseFloat(req.body.houseRentAllowance) || 0;
    updateData.medicalAllowance = parseFloat(req.body.medicalAllowance) || 0;
    updateData.conveyanceAllowance = parseFloat(req.body.allowances.conveyance?.amount) || parseFloat(req.body.allowances.transport) || 0;
    updateData.specialAllowance = parseFloat(req.body.allowances.meal) || 0;
    updateData.otherAllowance = parseFloat(req.body.allowances.other) || 0;

    // Update the new allowances structure with frontend allowances
    updateData.allowances = buildAllowancesPayload(req.body.allowances);
  }

  // Map overtime fields if provided
  if (req.body.overtime) {
    updateData.overtimeHours = parseFloat(req.body.overtime.hours) || 0;
    updateData.overtimeRate = parseFloat(req.body.overtime.rate) || 0;
    updateData.overtimeAmount = parseFloat(req.body.overtime.amount) || 0;
  }

  // Map bonus fields if provided
  if (req.body.bonuses) {
    updateData.performanceBonus = parseFloat(req.body.bonuses.performance) || 0;
    updateData.otherBonus = parseFloat(req.body.bonuses.other) || 0;
  }

  // Map deduction fields if provided
  if (req.body.deductions) {
    updateData.providentFund = parseFloat(req.body.deductions.providentFund) || 0;
    updateData.incomeTax = parseFloat(req.body.deductions.tax) || 0;
    updateData.healthInsurance = parseFloat(req.body.deductions.insurance) || 0;
    updateData.eobi = parseFloat(req.body.deductions.eobi) || 0;
    updateData.employeeSecurity = parseFloat(req.body.deductions.employeeSecurity) || 0;
    updateData.otherDeductions = parseFloat(req.body.deductions.other) || 0;
  }

  // Map attendance fields if provided
  if (req.body.attendance) {
    updateData.totalWorkingDays = parseInt(req.body.attendance.totalDays) || payroll.totalWorkingDays;
    updateData.presentDays = parseInt(req.body.attendance.presentDays) || payroll.presentDays;

    // 🔧 AUTOMATIC ABSENT DAYS CALCULATION
    // If present days are provided, automatically calculate absent days
    if (req.body.attendance.presentDays !== undefined) {
      const totalWorkingDays = updateData.totalWorkingDays;
      const presentDays = updateData.presentDays;
      const leaveDays = parseInt(req.body.attendance.leaveDays) || payroll.leaveDays || 0;

      // Calculate absent days automatically: Total Working Days - Present Days - Leave Days
      updateData.absentDays = Math.max(0, totalWorkingDays - presentDays - leaveDays);

      console.log(`🧮 Automatic Absent Days Calculation:`);
      console.log(`   Total Working Days: ${totalWorkingDays}`);
      console.log(`   Present Days: ${presentDays}`);
      console.log(`   Leave Days: ${leaveDays}`);
      console.log(`   Calculated Absent Days: ${updateData.absentDays}`);
    } else {
      // If present days not provided, use the value from request or existing
      updateData.absentDays = parseInt(req.body.attendance.absentDays) || payroll.absentDays;
    }

    updateData.leaveDays = parseInt(req.body.attendance.leaveDays) || payroll.leaveDays;

    // Force recalculation of daily rate and attendance deduction
    updateData.dailyRate = undefined;
    updateData.attendanceDeduction = undefined;

    console.log(`📊 Final Attendance Update: ${updateData.presentDays} present, ${updateData.absentDays} absent, ${updateData.totalWorkingDays} total working days`);

    // Log attendance deduction calculation for debugging
    if (updateData.absentDays > 0 || updateData.leaveDays > 0) {
      const dailyRate = updateData.grossSalary / updateData.totalWorkingDays;
      const attendanceDeduction = (updateData.absentDays + updateData.leaveDays) * dailyRate;
      console.log(`💰 Attendance Deduction Preview: ${Math.round(attendanceDeduction)} (Daily Rate: ${dailyRate.toFixed(2)} × (${updateData.absentDays} + ${updateData.leaveDays}))`);
    }
  }

  const payrollEmployee = await Employee.findById(payroll.employee).select('providentFund eobi employeeSecurity manualTax');
  if (!req.body.deductions) {
    updateData.eobi = getEmployeeEobiDeduction(payrollEmployee);
    updateData.employeeSecurity = getEmployeeSecurityDeduction(payrollEmployee);
  }
  const pfEnabledForEmployee = isProvidentFundEnabledForEmployee(payrollEmployee);
  updateData.providentFundEnabled = pfEnabledForEmployee;
  if (!pfEnabledForEmployee) {
    updateData.providentFund = 0;
  } else if ((updateData.providentFund === undefined || updateData.providentFund === null) && (updateData.basicSalary || payroll.basicSalary) > 0) {
    const basicSalary = updateData.basicSalary || payroll.basicSalary;
    updateData.providentFund = calculateProvidentFundForEmployee(payrollEmployee, basicSalary);
  }

  // Recalculate totals
  updateData.grossSalary = (updateData.basicSalary || payroll.basicSalary) +
    (updateData.houseRentAllowance || payroll.houseRentAllowance) +
    (updateData.medicalAllowance || payroll.medicalAllowance);

  // 🔧 CRITICAL FIX: Update allowances structure on payroll object FIRST
  if (req.body.allowances) {
    console.log('🔧 Updating payroll.allowances with frontend data');
    payroll.allowances = buildAllowancesPayload(req.body.allowances);
    console.log('✅ Updated payroll.allowances:', JSON.stringify(payroll.allowances, null, 2));
  }

  // Note: Overtime, bonuses, and additional allowances are NOT part of gross salary (base)
  // They are added to calculate Total Earnings

  // Calculate Total Earnings (Gross Salary Base + Additional Allowances + Overtime + Bonuses + Arrears)
  // Now use the updated payroll.allowances (which contains the frontend data)
  const additionalAllowances = additionalAllowancesTotal(payroll.allowances);

  console.log('💰 Additional Allowances Calculation:');
  console.log('   Conveyance:', payroll.allowances?.conveyance?.isActive ? payroll.allowances.conveyance.amount : 0);
  console.log('   Food:', payroll.allowances?.food?.isActive ? payroll.allowances.food.amount : 0);
  console.log('   Mobile:', payroll.allowances?.mobile?.isActive ? payroll.allowances.mobile.amount : 0);
  console.log('   Vehicle:', payroll.allowances?.vehicle?.isActive ? payroll.allowances.vehicle.amount : 0);
  console.log('   Fuel:', payroll.allowances?.fuel?.isActive ? payroll.allowances.fuel.amount : 0);
  console.log('   Special:', payroll.allowances?.special?.isActive ? payroll.allowances.special.amount : 0);
  console.log('   Other:', payroll.allowances?.other?.isActive ? payroll.allowances.other.amount : 0);
  console.log('   Total Additional Allowances:', additionalAllowances);

  // Get current arrears amount from payroll
  const currentArrears = updateData.arrears !== undefined ? updateData.arrears : (payroll.arrears || 0);

  // Total Earnings = Gross Salary (Base) + Additional Allowances + Overtime + Bonuses + Arrears
  const totalEarnings = updateData.grossSalary + additionalAllowances +
    (updateData.overtimeAmount || payroll.overtimeAmount) +
    (updateData.performanceBonus || payroll.performanceBonus) +
    (updateData.otherBonus || payroll.otherBonus) +
    currentArrears;

  // Store total earnings for reference
  updateData.totalEarnings = totalEarnings;

  // 🔧 CRITICAL FIX: Update payroll.totalEarnings with calculated value
  payroll.totalEarnings = totalEarnings;

  console.log('💰 Total Earnings Calculation:');
  console.log('   Gross Salary (Base):', updateData.grossSalary);
  console.log('   Additional Allowances:', additionalAllowances);
  console.log('   Overtime Amount:', updateData.overtimeAmount || payroll.overtimeAmount);
  console.log('   Performance Bonus:', updateData.performanceBonus || payroll.performanceBonus);
  console.log('   Other Bonus:', updateData.otherBonus || payroll.otherBonus);
  console.log('   Arrears:', currentArrears);
  console.log('   Total Earnings:', totalEarnings);

  // 🔧 NEW SEPARATE TAX CALCULATION
  // Main salary: Gross Salary + Additional Allowances (taxed at 90%)
  // Arrears: taxed at 100% (full amount)
  const grossForTax =
    updateData.grossSalary ||
    payroll.grossSalary ||
    (payroll.basicSalary || 0) +
    (payroll.houseRentAllowance || 0) +
    (payroll.medicalAllowance || 0);
  const taxSettings = await loadPayrollTaxSettings();
  const employeeForTax = await Employee.findById(payroll.employee)
    .select('manualTax eobi hireDate appointmentDate')
    .lean();
  const taxCalculation = calculatePayrollTaxWithSettings({
    grossSalary: grossForTax,
    allowances: payroll.allowances,
    arrears: currentArrears,
    employeeId: payroll.employee,
    settings: taxSettings,
    hireDate: employeeForTax?.hireDate || employeeForTax?.appointmentDate,
    payrollMonth: payroll.month,
    payrollYear: payroll.year
  });

  const { tax: resolvedPayrollTax } = resolveEmployeeIncomeTax(employeeForTax, taxCalculation.totalTax);

  // Auto-calculate tax when allowances change (always recalculate for accuracy)
  try {
    if (payroll.isManual && req.body.deductions && req.body.deductions.tax !== undefined) {
      updateData.incomeTax = parseFloat(req.body.deductions.tax) || 0;
    } else {
      updateData.incomeTax = resolvedPayrollTax;
    }

    // 🔧 CRITICAL FIX: Update payroll.incomeTax with calculated value
    payroll.incomeTax = updateData.incomeTax;

    console.log(`💰 Tax Calculation for Employee Update: Main Salary: ${mainSalary}, Arrears: ${currentArrears}, Main Tax: ${taxCalculation.mainTax}, Arrears Tax: ${taxCalculation.arrearsTax}, Total Tax: ${updateData.incomeTax}`);

  } catch (error) {
    console.error('Error calculating tax:', error);
    // Fallback to old calculation
    const medicalAllowanceForTax = Math.round(totalEarnings * 0.10);
    const taxableIncome = totalEarnings - medicalAllowanceForTax;
    updateData.incomeTax = calculateMonthlyTax(taxableIncome);
    payroll.incomeTax = updateData.incomeTax;
  }

  // Calculate attendance deduction for updateData as well
  let attendanceDeduction = 0;
  if (updateData.absentDays > 0 || updateData.leaveDays > 0) {
    const dailyRate = updateData.grossSalary / (updateData.totalWorkingDays || payroll.totalWorkingDays);
    attendanceDeduction = (updateData.absentDays + updateData.leaveDays) * dailyRate;
  }

  // 🔧 UPDATE TOTAL DEDUCTIONS WITH CORRECT FORMULA
  // Total Deductions = Income Tax + EOBI + Employee Security + Health Insurance + Attendance Deduction + Other Deductions
  // Note: Provident Fund is NOT included in total deductions (as per business requirement)
  updateData.totalDeductions = (updateData.incomeTax || payroll.incomeTax || 0) +
    (updateData.eobi || payroll.eobi || 0) +
    (updateData.employeeSecurity !== undefined ? updateData.employeeSecurity : (payroll.employeeSecurity || 0)) +
    (updateData.healthInsurance || payroll.healthInsurance || 0) +
    Math.round(attendanceDeduction) +
    (updateData.otherDeductions || payroll.otherDeductions || 0);

  updateData.netSalary = updateData.grossSalary - updateData.totalDeductions;

  // 🔧 CRITICAL FIX: Update payroll.totalDeductions and payroll.netSalary with calculated values
  payroll.totalDeductions = updateData.totalDeductions;
  payroll.netSalary = updateData.netSalary;

  // Store the original total earnings to preserve it during updates
  const originalTotalEarnings = payroll.totalEarnings;
  console.log(`🔒 Preserving Total Earnings: ${originalTotalEarnings?.toLocaleString() || 0}`);

  // Update fields directly on the payroll object (this will trigger pre-save middleware)
  if (req.body.basicSalary !== undefined) {
    payroll.basicSalary = parseFloat(req.body.basicSalary);
  }

  if (req.body.medicalAllowance !== undefined) {
    payroll.medicalAllowance = parseFloat(req.body.medicalAllowance);
  }

  if (req.body.houseRentAllowance !== undefined) {
    payroll.houseRentAllowance = parseFloat(req.body.houseRentAllowance);
  }

  if (req.body.grossSalary !== undefined) {
    payroll.grossSalary = parseFloat(req.body.grossSalary);
  }

  if (req.body.overtimeHours !== undefined) {
    payroll.overtimeHours = parseFloat(req.body.overtimeHours);
  }

  if (req.body.overtimeRate !== undefined) {
    payroll.overtimeRate = parseFloat(req.body.overtimeRate);
  }

  if (req.body.performanceBonus !== undefined) {
    payroll.performanceBonus = parseFloat(req.body.performanceBonus);
  }

  if (req.body.otherBonus !== undefined) {
    payroll.otherBonus = parseFloat(req.body.otherBonus);
  }

  if (req.body.arrears !== undefined) {
    payroll.arrears = parseFloat(req.body.arrears);
  }

  if (req.body.providentFund !== undefined) {
    payroll.providentFund = parseFloat(req.body.providentFund);
  }

  if (req.body.healthInsurance !== undefined) {
    payroll.healthInsurance = parseFloat(req.body.healthInsurance);
  }

  if (req.body.loanDeductions !== undefined) {
    payroll.loanDeductions = parseFloat(req.body.loanDeductions);
  }

  if (req.body.otherDeductions !== undefined) {
    payroll.otherDeductions = parseFloat(req.body.otherDeductions);
  }

  // Handle attendance fields (support both direct and nested structures)
  if (req.body.totalWorkingDays !== undefined) {
    payroll.totalWorkingDays = parseInt(req.body.totalWorkingDays);
  }

  if (req.body.presentDays !== undefined) {
    payroll.presentDays = parseInt(req.body.presentDays);
    // Auto-calculate absent days
    payroll.absentDays = Math.max(0, payroll.totalWorkingDays - payroll.presentDays - payroll.leaveDays);
  }

  if (req.body.leaveDays !== undefined) {
    payroll.leaveDays = parseInt(req.body.leaveDays);
    // Recalculate absent days if present days are set
    if (req.body.presentDays !== undefined) {
      payroll.absentDays = Math.max(0, payroll.totalWorkingDays - payroll.presentDays - payroll.leaveDays);
    }
  }

  // Also handle nested attendance structure (req.body.attendance.*)
  if (req.body.attendance) {
    if (req.body.attendance.totalDays !== undefined) {
      payroll.totalWorkingDays = parseInt(req.body.attendance.totalDays);
    }

    if (req.body.attendance.presentDays !== undefined) {
      payroll.presentDays = parseInt(req.body.attendance.presentDays);
      // Auto-calculate absent days
      payroll.absentDays = Math.max(0, payroll.totalWorkingDays - payroll.presentDays - payroll.leaveDays);
    }

    if (req.body.attendance.leaveDays !== undefined) {
      payroll.leaveDays = parseInt(req.body.attendance.leaveDays);
      // Recalculate absent days if present days are set
      if (req.body.attendance.presentDays !== undefined) {
        payroll.absentDays = Math.max(0, payroll.totalWorkingDays - payroll.presentDays - payroll.leaveDays);
      }
    }

    console.log(`📊 Attendance Update Applied: ${payroll.presentDays} present, ${payroll.absentDays} absent, ${payroll.totalWorkingDays} total working days`);

    // Log attendance deduction preview for direct updates
    if (payroll.absentDays > 0 || payroll.leaveDays > 0) {
      const dailyRate = payroll.grossSalary / payroll.totalWorkingDays;
      const attendanceDeduction = (payroll.absentDays + payroll.leaveDays) * dailyRate;
      console.log(`💰 Direct Update Attendance Deduction Preview: ${Math.round(attendanceDeduction)} (Daily Rate: ${dailyRate.toFixed(2)} × (${payroll.absentDays} + ${payroll.leaveDays}))`);
    }

  }

  if (req.body.remarks !== undefined) {
    payroll.remarks = req.body.remarks;
  }

  // 🔧 HANDLE LEAVE DEDUCTIONS - Same pattern as attendance updates
  if (req.body.leaveDeductions) {
    console.log(`📊 Leave Deductions Update:`, req.body.leaveDeductions);

    // Map leave deduction fields directly to payroll object
    payroll.leaveDeductions = {
      unpaidLeave: parseInt(req.body.leaveDeductions.unpaidLeave) || 0,
      sickLeave: parseInt(req.body.leaveDeductions.sickLeave) || 0,
      casualLeave: parseInt(req.body.leaveDeductions.casualLeave) || 0,
      annualLeave: parseInt(req.body.leaveDeductions.annualLeave) || 0,
      otherLeave: parseInt(req.body.leaveDeductions.otherLeave) || 0,
      totalLeaveDays: 0, // Will be calculated
      leaveDeductionAmount: 0 // Will be calculated
    };

    // Calculate total leave days
    payroll.leaveDeductions.totalLeaveDays =
      payroll.leaveDeductions.unpaidLeave +
      payroll.leaveDeductions.sickLeave +
      payroll.leaveDeductions.casualLeave +
      payroll.leaveDeductions.annualLeave +
      payroll.leaveDeductions.otherLeave;

    // 🔧 UPDATE LEAVE DAYS FIELD - This will trigger present days recalculation
    payroll.leaveDays = payroll.leaveDeductions.totalLeaveDays;

    // 🔧 AUTO-RECALCULATE PRESENT DAYS when leave days change
    if (payroll.totalWorkingDays && payroll.leaveDays !== undefined) {
      const newPresentDays = Math.max(0, payroll.totalWorkingDays - (payroll.absentDays || 0) - payroll.leaveDays);
      console.log(`🧮 Auto-recalculating present days: ${payroll.totalWorkingDays} - ${payroll.absentDays || 0} - ${payroll.leaveDays} = ${newPresentDays}`);
      payroll.presentDays = newPresentDays;
    }

    console.log(`📊 Leave Deductions Summary:`);
    console.log(`   Unpaid Leave: ${payroll.leaveDeductions.unpaidLeave}`);
    console.log(`   Sick Leave: ${payroll.leaveDeductions.sickLeave}`);
    console.log(`   Casual Leave: ${payroll.leaveDeductions.casualLeave}`);
    console.log(`   Annual Leave: ${payroll.leaveDeductions.annualLeave}`);
    console.log(`   Other Leave: ${payroll.leaveDeductions.otherLeave}`);
    console.log(`   Total Leave Days: ${payroll.leaveDeductions.totalLeaveDays}`);
    console.log(`   Updated Leave Days Field: ${payroll.leaveDays}`);
    console.log(`   Updated Present Days: ${payroll.presentDays}`);
  }

  // Force recalculation by clearing calculated fields
  payroll.dailyRate = undefined;
  payroll.attendanceDeduction = undefined;
  payroll.leaveDeductionAmount = undefined;

  // 🔧 CALCULATE ATTENDANCE DEDUCTION BEFORE SAVE
  // This ensures attendance deduction is included in total deductions
  // Formula: (Absent Days + Leave Days) × Daily Rate
  // Daily Rate = Gross Salary ÷ Total Working Days
  if (payroll.absentDays > 0 || payroll.leaveDays > 0) {
    // Calculate daily rate based on gross salary and total working days
    const dailyRate = payroll.grossSalary / payroll.totalWorkingDays;
    payroll.dailyRate = dailyRate;

    // Calculate attendance deduction: (absent days + leave days) * daily rate
    const attendanceDeduction = (payroll.absentDays + payroll.leaveDays) * dailyRate;
    payroll.attendanceDeduction = Math.round(attendanceDeduction);

    console.log(`💰 Attendance Deduction Calculation:`);
    console.log(`   Daily Rate: Rs. ${dailyRate.toFixed(2)}`);
    console.log(`   Absent Days: ${payroll.absentDays}`);
    console.log(`   Leave Days: ${payroll.leaveDays}`);
    console.log(`   Attendance Deduction: Rs. ${payroll.attendanceDeduction}`);
  } else {
    payroll.attendanceDeduction = 0;
    payroll.dailyRate = payroll.grossSalary / payroll.totalWorkingDays;
  }

  // 🔧 UPDATE TOTAL DEDUCTIONS WITH CORRECT FORMULA
  // Total Deductions = Income Tax + EOBI + Employee Security + Health Insurance + Loan Deductions + Attendance Deduction + Other Deductions
  // Note: Provident Fund is NOT included in total deductions (as per business requirement)
  payroll.totalDeductions = (payroll.incomeTax || 0) +
    (payroll.eobi || 0) +
    (payroll.employeeSecurity || 0) +
    (payroll.healthInsurance || 0) +
    (payroll.loanDeductions || 0) +
    (payroll.attendanceDeduction || 0) +
    (payroll.leaveDeduction || 0) +
    (payroll.otherDeductions || 0);

  // 🔧 RECALCULATE NET SALARY WITH UPDATED TOTAL DEDUCTIONS
  payroll.netSalary = payroll.totalEarnings - payroll.totalDeductions;

  console.log(`📊 Final Calculations:`);
  console.log(`   Total Earnings: Rs. ${payroll.totalEarnings?.toLocaleString() || 0}`);
  console.log(`   Total Deductions Breakdown:`);
  console.log(`     Income Tax: Rs. ${(payroll.incomeTax || 0).toLocaleString()}`);
  console.log(`     EOBI: Rs. ${(payroll.eobi || 0).toLocaleString()}`);
  console.log(`     Health Insurance: Rs. ${(payroll.healthInsurance || 0).toLocaleString()}`);
  console.log(`     Loan Deductions: Rs. ${(payroll.loanDeductions || 0).toLocaleString()}`);
  console.log(`     Attendance Deduction: Rs. ${(payroll.attendanceDeduction || 0).toLocaleString()}`);
  console.log(`     Leave Deduction: Rs. ${(payroll.leaveDeduction || 0).toLocaleString()}`);
  console.log(`     Other Deductions: Rs. ${(payroll.otherDeductions || 0).toLocaleString()}`);
  console.log(`     Total Deductions: Rs. ${payroll.totalDeductions?.toLocaleString() || 0}`);
  console.log(`   Net Salary: Rs. ${payroll.netSalary?.toLocaleString() || 0}`);

  // Save to trigger pre-save middleware for any additional recalculations
  await payroll.save();

  // 🔒 CRITICAL: Restore the original total earnings after save
  // This prevents the pre-save middleware from changing it
  if (Math.abs(payroll.totalEarnings - originalTotalEarnings) > 1) {
    console.log(`🔒 Restoring Total Earnings: ${payroll.totalEarnings?.toLocaleString()} → ${originalTotalEarnings?.toLocaleString()}`);
    payroll.totalEarnings = originalTotalEarnings;
    await payroll.save(); // Save again to persist the restored total earnings
  }

  const updatedPayroll = await Payroll.findById(payroll._id)
    .populate('employee', 'firstName lastName employeeId department position')
    .populate('createdBy', 'firstName lastName')
    .populate('approvedBy', 'firstName lastName');

  console.log('✅ PUT /api/payroll/:id - Request completed successfully');
  console.log('   Updated Total Earnings:', updatedPayroll.totalEarnings);
  console.log('   Updated Vehicle:', updatedPayroll.allowances?.vehicle?.isActive ?
    `Rs. ${updatedPayroll.allowances.vehicle.amount} (Active)` : 'Inactive');
  console.log('   Updated Fuel:', updatedPayroll.allowances?.fuel?.isActive ?
    `Rs. ${updatedPayroll.allowances.fuel.amount} (Active)` : 'Inactive');

  res.json({
    success: true,
    message: 'Payroll updated successfully',
    data: updatedPayroll
  });
}));

// @route   PATCH /api/payroll/:id/attendance
// @desc    Update payroll attendance fields - REMOVED - Use custom update logic instead
// @access  Private (HR and Admin)
// This route has been removed to prevent calculation issues
// Please implement your own update logic to prevent total earnings calculation problems
router.patch('/:id/attendance', asyncHandler(async (req, res) => {
  res.status(400).json({
    success: false,
    message: 'This attendance update route has been removed. Please implement your own update logic to prevent total earnings calculation issues.'
  });
}));

// @route   PATCH /api/payroll/:id/approve
// @desc    Approve payroll
// @access  Private (HR and Admin)
router.patch('/:id/approve',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payroll ID format'
      });
    }

    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status !== 'Draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft payrolls can be approved'
      });
    }

    await assertMonthlyPayrollAuthoritiesApproved(payroll.month, payroll.year);

    await payroll.approve(req.user.id);

    // Record accrual in Finance/GL
    try {
      await FinanceHelper.recordPayrollAccrual(payroll, req.user.id);
    } catch (finError) {
      console.error('❌ Error recording payroll accrual in finance:', finError);
    }

    const updatedPayroll = await Payroll.findById(payroll._id)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId department position placementProject',
        populate: {
          path: 'placementProject',
          select: 'name'
        }
      })
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Payroll approved successfully',
      data: updatedPayroll
    });
  })
);

// @route   PATCH /api/payroll/:id/mark-paid
// @desc    Mark payroll as paid
// @access  Private (HR and Admin)
router.patch('/:id/mark-paid', [
  authorize('super_admin', 'admin', 'hr_manager'),
  body('paymentMethod').optional().isIn(['bank_transfer', 'check', 'cash']).withMessage('Valid payment method is required')
], asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payroll ID format'
    });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const payroll = await Payroll.findById(req.params.id);
  if (!payroll) {
    return res.status(404).json({
      success: false,
      message: 'Payroll not found'
    });
  }

  if (!isPayrollFinalApprovedStatus(payroll.status)) {
    return res.status(400).json({
      success: false,
      message: 'Only AVP-approved payrolls can be marked as paid'
    });
  }

  await payroll.markAsPaid(req.body.paymentMethod);

  // Record payment in Finance/GL
  try {
    await FinanceHelper.recordPayrollPayment(payroll, req.body.paymentMethod, req.user.id);
  } catch (finError) {
    console.error('❌ Error recording payroll payment in finance:', finError);
  }

  const updatedPayroll = await Payroll.findById(payroll._id)
    .populate('employee', 'firstName lastName employeeId department position')
    .populate('createdBy', 'firstName lastName')
    .populate('approvedBy', 'firstName lastName');

  res.json({
    success: true,
    message: 'Payroll marked as paid successfully',
    data: updatedPayroll
  });
}));

// @route   PATCH /api/payroll/:id/mark-unpaid
// @desc    Mark payroll as unpaid (revert to draft)
// @access  Private (HR and Admin)
router.patch('/:id/mark-unpaid',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payroll ID format'
      });
    }

    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    if (payroll.status !== 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Only paid payrolls can be marked as unpaid'
      });
    }

    await payroll.markAsUnpaid();

    const updatedPayroll = await Payroll.findById(payroll._id)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeId department position placementProject',
        populate: {
          path: 'placementProject',
          select: 'name'
        }
      })
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName');

    res.json({
      success: true,
      message: 'Payroll marked as unpaid successfully',
      data: updatedPayroll
    });
  })
);

// @route   DELETE /api/payroll/:id
// @desc    Delete payroll
// @access  Private (HR and Admin)
router.delete('/:id',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payroll ID format'
      });
    }

    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    const { isPayrollRecordLocked, payrollLockMessage } = require('../utils/payrollLock');
    if (isPayrollRecordLocked(payroll)) {
      return res.status(400).json({
        success: false,
        message: payrollLockMessage(payroll)
      });
    }

    await Payroll.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Payroll deleted successfully'
    });
  })
);

// @route   GET /api/payroll/demo-attendance-integration
// @desc    Demonstrate attendance integration with payroll calculations
// @access  Private (HR and Admin)
router.get('/demo-attendance-integration',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const { demonstrateAttendanceIntegration } = require('../utils/attendanceIntegrationDemo');

      // Run the demonstration
      const demo = demonstrateAttendanceIntegration();

      res.json({
        success: true,
        message: 'Attendance integration demonstration',
        data: demo
      });

    } catch (error) {
      console.error('❌ Error in attendance integration demo:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to run attendance integration demo',
        error: error.message
      });
    }
  })
);

// @route   GET /api/payroll/:id/download
// @desc    Download payroll as PDF
// @access  Private (HR and Admin)
router.get('/:id/download',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const payroll = await Payroll.findById(req.params.id)
      .populate({
        path: 'employee',
        select: 'employeeId firstName lastName email phone department position placementProject',
        populate: {
          path: 'placementProject',
          select: 'name'
        }
      })
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName');

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }

    // Create PDF document
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${payroll.employee?.employeeId}-${payroll.month}-${payroll.year}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Helper function to format currency
    const formatCurrency = (amount) => {
      return new Intl.NumberFormat('en-PK', {
        style: 'currency',
        currency: 'PKR',
        minimumFractionDigits: 0
      }).format(amount || 0);
    };

    // Helper function to format date
    const formatDate = (date) => {
      return new Date(date).toLocaleDateString('en-PK', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    // Helper function to convert number to words
    const numberToWords = (num) => {
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

      if (num === 0) return 'Zero';
      if (num < 10) return ones[num];
      if (num < 20) return teens[num - 10];
      if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + ones[num % 10] : '');
      if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 !== 0 ? ' ' + numberToWords(num % 100) : '');
      if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 !== 0 ? ' ' + numberToWords(num % 1000) : '');
      if (num < 10000000) return numberToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 !== 0 ? ' ' + numberToWords(num % 100000) : '');
      return numberToWords(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 !== 0 ? ' ' + numberToWords(num % 10000000) : '');
    };

    // Header
    doc.fontSize(20)
      .font('Helvetica-Bold')
      .text('PAYROLL STATEMENT', { align: 'center' })
      .moveDown(0.5);

    doc.fontSize(12)
      .font('Helvetica')
      .text(`Period: ${payroll.month}/${payroll.year}`, { align: 'center' })
      .moveDown(2);

    // Employee Information
    const employeeY = doc.y;
    doc.fontSize(12)
      .font('Helvetica-Bold')
      .text('Employee Information:', 50, employeeY)
      .moveDown(0.5);

    doc.fontSize(10)
      .font('Helvetica')
      .text('Employee ID:', 50, employeeY + 30)
      .text('Name:', 50, employeeY + 50)
      .text('Department:', 50, employeeY + 70)
      .text('Position:', 50, employeeY + 90)
      .text('Pay Period:', 50, employeeY + 110)
      .text('Generated Date:', 50, employeeY + 130);

    doc.fontSize(10)
      .font('Helvetica-Bold')
      .text(payroll.employee?.employeeId || 'N/A', 200, employeeY + 30)
      .text(`${payroll.employee?.firstName || ''} ${payroll.employee?.lastName || ''}`, 200, employeeY + 50)
      .text(payroll.employee?.department || 'N/A', 200, employeeY + 70)
      .text(payroll.employee?.position || 'N/A', 200, employeeY + 90)
      .text(`${payroll.month}/${payroll.year}`, 200, employeeY + 110)
      .text(formatDate(payroll.createdAt), 200, employeeY + 130);

    doc.moveDown(3);

    // Earnings and Deductions Table
    doc.fontSize(12)
      .font('Helvetica-Bold')
      .text('Earnings and Deductions', { align: 'center' })
      .moveDown(0.5);

    // Table headers
    const tableY = doc.y;
    doc.fontSize(10)
      .font('Helvetica-Bold')
      .text('Earnings', 50, tableY)
      .text('Amount', 200, tableY)
      .text('Deductions', 350, tableY)
      .text('Amount', 500, tableY);

    // Draw table lines
    doc.moveTo(50, tableY - 5)
      .lineTo(550, tableY - 5)
      .stroke();

    doc.moveTo(50, tableY + 15)
      .lineTo(550, tableY + 15)
      .stroke();

    // Earnings rows
    let currentTableY = tableY + 25;
    doc.fontSize(10)
      .font('Helvetica')
      .text('Basic Salary', 50, currentTableY)
      .text(formatCurrency(payroll.basicSalary), 200, currentTableY);

    currentTableY += 25;
    doc.text('House Rent Allowance', 50, currentTableY)
      .text(formatCurrency(payroll.houseRentAllowance), 200, currentTableY);

    currentTableY += 25;
    doc.text('Medical Allowance', 50, currentTableY)
      .text(formatCurrency(payroll.medicalAllowance), 200, currentTableY);

    currentTableY += 25;
    doc.text('Conveyance Allowance', 50, currentTableY)
      .text(formatCurrency(payroll.conveyanceAllowance), 200, currentTableY);

    currentTableY += 25;
    doc.text('Special Allowance', 50, currentTableY)
      .text(formatCurrency(payroll.specialAllowance), 200, currentTableY);

    currentTableY += 25;
    doc.text('Other Allowance', 50, currentTableY)
      .text(formatCurrency(payroll.otherAllowance), 200, currentTableY);

    currentTableY += 25;
    doc.text('Overtime Amount', 50, currentTableY)
      .text(formatCurrency(payroll.overtimeAmount), 200, currentTableY);

    currentTableY += 25;
    doc.text('Performance Bonus', 50, currentTableY)
      .text(formatCurrency(payroll.performanceBonus), 200, currentTableY);

    currentTableY += 25;
    doc.text('Other Bonus', 50, currentTableY)
      .text(formatCurrency(payroll.otherBonus), 200, currentTableY);

    // Deductions rows
    currentTableY = tableY + 25;
    doc.text('Provident Fund', 350, currentTableY)
      .text(formatCurrency(payroll.providentFund), 500, currentTableY);

    currentTableY += 25;
    doc.text('Income Tax', 350, currentTableY)
      .text(formatCurrency(payroll.incomeTax), 500, currentTableY);

    currentTableY += 25;
    doc.text('Health Insurance', 350, currentTableY)
      .text(formatCurrency(payroll.healthInsurance), 500, currentTableY);

    currentTableY += 25;
    doc.text('EOBI', 350, currentTableY)
      .text(formatCurrency(payroll.eobi), 500, currentTableY);

    if (payroll.employeeSecurity > 0) {
      currentTableY += 25;
      doc.text('Employee Security', 350, currentTableY)
        .text(formatCurrency(payroll.employeeSecurity), 500, currentTableY);
    }

    currentTableY += 25;
    doc.text('Other Deductions', 350, currentTableY)
      .text(formatCurrency(payroll.otherDeductions), 500, currentTableY);

    // Summary rows
    currentTableY += 30;
    doc.fontSize(10)
      .font('Helvetica-Bold')
      .text('Gross Salary', 50, currentTableY)
      .text(formatCurrency(payroll.grossSalary), 200, currentTableY);

    currentTableY += 25;
    doc.text('Total Deductions', 350, currentTableY)
      .text(formatCurrency(payroll.totalDeductions), 500, currentTableY);

    currentTableY += 25;
    doc.fontSize(12)
      .font('Helvetica-Bold')
      .text('Net Salary', 50, currentTableY)
      .text(formatCurrency(payroll.netSalary), 200, currentTableY);

    // Amount in words
    currentTableY += 30;
    doc.fontSize(10)
      .font('Helvetica')
      .text(`[${numberToWords(Math.round(payroll.netSalary))} Only]`, 50, currentTableY);

    doc.moveDown(3);

    // Notes
    if (payroll.remarks) {
      doc.fontSize(10)
        .font('Helvetica')
        .fillColor('#000')
        .text('Notes:', { underline: true })
        .moveDown(0.5)
        .text(payroll.remarks);
    }

    // Footer with signatures and system info
    const footerY = doc.page.height - 100;

    // Signature labels
    doc.fontSize(10)
      .font('Helvetica-Bold')
      .text('Prepared By', 50, footerY)
      .text('Received By', 200, footerY)
      .text('Approved By', 350, footerY);

    // System information
    doc.fontSize(8)
      .font('Helvetica')
      .fillColor('#666')
      .text('Human Resource Management', 50, footerY + 30)
      .text(`Generated by: ${payroll.createdBy?.firstName || 'SYSTEM'}`, 50, footerY + 45)
      .text(formatDate(new Date()), 50, footerY + 60);

    // Finalize PDF
    doc.end();
  })
);

// @route   DELETE /api/payroll/month/:year/:month
// @desc    Delete all payrolls and approval for a specific month
// @access  Private (HR and Admin)
router.delete('/month/:year/:month',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { year, month } = req.params;

    // Non-Draft payrolls are locked — month cannot be deleted once any leave Draft
    const lockedCount = await Payroll.countDocuments({
      month,
      year,
      status: { $ne: 'Draft' }
    });
    if (lockedCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete month because it contains ${lockedCount} locked (non-Draft) payroll(s)`
      });
    }

    // Delete all Draft payrolls for this month
    await Payroll.deleteMany({ month, year, status: 'Draft' });

    // Delete the approval document
    await PayrollMonthlyApproval.deleteMany({ month, year });

    res.json({
      success: true,
      message: 'Monthly payroll deleted successfully'
    });
  })
);

// @route   DELETE /api/payroll/delete-all
// @desc    Delete all payroll records
// @access  Private (Admin only)
router.delete('/delete-all',
  authorize('super_admin', 'admin'),
  asyncHandler(async (req, res) => {
    // Get count before deletion
    const totalPayrolls = await Payroll.countDocuments({});
    const lockedCount = await Payroll.countDocuments({ status: { $ne: 'Draft' } });
    const draftCount = totalPayrolls - lockedCount;

    if (draftCount === 0) {
      return res.status(404).json({
        success: false,
        message: lockedCount > 0
          ? `No Draft payrolls to delete (${lockedCount} locked non-Draft record(s) preserved)`
          : 'No payroll records found to delete'
      });
    }

    // Only delete Draft payrolls — locked months stay forever
    const result = await Payroll.deleteMany({ status: 'Draft' });

    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} Draft payroll record(s)` +
        (lockedCount > 0 ? `; ${lockedCount} locked non-Draft record(s) preserved` : ''),
      data: {
        deletedCount: result.deletedCount,
        lockedPreserved: lockedCount,
        totalPayrolls: totalPayrolls
      }
    });
  })
);

// @route   POST /api/payroll/:id/calculate-tax
// @desc    Calculate and update tax for a specific payroll
// @access  Private (HR and Admin)
router.post('/:id/calculate-tax',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payroll ID'
      });
    }

    try {
      const tax = await Payroll.calculateTaxForPayroll(req.params.id);

      res.json({
        success: true,
        message: 'Tax calculated and updated successfully',
        data: { tax }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  })
);

// @route   POST /api/payroll/calculate-tax-month
// @desc    Calculate and update tax for all payrolls in a specific month/year
// @access  Private (HR and Admin)
router.post('/calculate-tax-month',
  authorize('super_admin', 'admin', 'hr_manager'),
  [
    body('month').isInt({ min: 1, max: 12 }).withMessage('Month must be between 1 and 12'),
    body('year').isInt({ min: 2020 }).withMessage('Year must be 2020 or later')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    try {
      const { month, year } = req.body;
      const results = await Payroll.calculateTaxForMonth(month, year);

      res.json({
        success: true,
        message: `Tax calculated for ${results.length} payrolls in ${month}/${year}`,
        data: { results }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  })
);

// @route   POST /api/payroll/monthly-tax-update
// @desc    Update taxes for all payrolls in a specific month/year
// @access  Private (HR and Admin)
router.post('/monthly-tax-update',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { month, year, forceUpdate = false } = req.body;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Month and year are required'
      });
    }

    if (month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: 'Month must be between 1 and 12'
      });
    }

    if (year < 2020 || year > 2030) {
      return res.status(400).json({
        success: false,
        message: 'Year must be between 2020 and 2030'
      });
    }

    try {
      const MonthlyTaxUpdateService = require('../services/monthlyTaxUpdateService');
      const result = await MonthlyTaxUpdateService.updateMonthlyTaxes(month, year, forceUpdate);

      res.json({
        success: true,
        message: `Monthly tax update completed for ${month}/${year}`,
        data: result
      });

    } catch (error) {
      console.error('Error in monthly tax update route:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update monthly taxes',
        error: error.message
      });
    }
  })
);

// @route   POST /api/payroll/current-month-tax-update
// @desc    Update taxes for all payrolls in the current month
// @access  Private (HR and Admin)
router.post('/current-month-tax-update',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const MonthlyTaxUpdateService = require('../services/monthlyTaxUpdateService');
      const result = await MonthlyTaxUpdateService.updateCurrentMonthTaxes();

      res.json({
        success: true,
        message: 'Current month tax update completed',
        data: result
      });

    } catch (error) {
      console.error('Error in current month tax update route:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update current month taxes',
        error: error.message
      });
    }
  })
);

// @route   POST /api/payroll/previous-month-tax-update
// @desc    Update taxes for all payrolls in the previous month
// @access  Private (HR and Admin)
router.post('/previous-month-tax-update',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const MonthlyTaxUpdateService = require('../services/monthlyTaxUpdateService');
      const result = await MonthlyTaxUpdateService.updatePreviousMonthTaxes();

      res.json({
        success: true,
        message: 'Previous month tax update completed',
        data: result
      });

    } catch (error) {
      console.error('Error in previous month tax update route:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update previous month taxes',
        error: error.message
      });
    }
  })
);

// @route   GET /api/payroll/monthly-tax-summary/:month/:year
// @desc    Get tax summary for a specific month/year
// @access  Private (HR and Admin)
router.get('/monthly-tax-summary/:month/:year',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    const { month, year } = req.params;

    if (month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: 'Month must be between 1 and 12'
      });
    }

    if (year < 2020 || year > 2030) {
      return res.status(400).json({
        success: false,
        message: 'Year must be between 2020 and 2030'
      });
    }

    try {
      const MonthlyTaxUpdateService = require('../services/monthlyTaxUpdateService');
      const summary = await MonthlyTaxUpdateService.getMonthlyTaxSummary(parseInt(month), parseInt(year));

      res.json({
        success: true,
        message: `Tax summary for ${month}/${year}`,
        data: summary
      });

    } catch (error) {
      console.error('Error getting monthly tax summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get monthly tax summary',
        error: error.message
      });
    }
  })
);

// @route   GET /api/payroll/demo-attendance-integration
// @desc    Demonstrate attendance integration with payroll calculations
// @access  Private (HR and Admin)
router.get('/demo-attendance-integration',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const { demonstrateAttendanceIntegration } = require('../utils/attendanceIntegrationDemo');

      // Run the demonstration
      const demo = demonstrateAttendanceIntegration();

      res.json({
        success: true,
        message: 'Attendance integration demonstration',
        data: demo
      });

    } catch (error) {
      console.error('❌ Error in attendance integration demo:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to run attendance integration demo',
        error: error.message
      });
    }
  })
);

// @route   POST /api/payroll/preview-payslip
// @desc    Generate and download payslip PDF from preview payload (no database record)
// @access  Private (HR and Admin)
router.post('/preview-payslip',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const payslipData = {
        ...req.body,
        createdBy: {
          firstName: req.user?.firstName || req.user?.name || 'System'
        }
      };

      if (!payslipData.payslipNumber || !payslipData.employeeId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payslip preview data'
        });
      }

      await generatePayslipPDF(payslipData, res);
    } catch (error) {
      console.error('Error generating preview payslip PDF:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to generate payslip PDF',
          error: error.message
        });
      }
    }
  })
);

// @route   POST /api/payroll/:id/generate-payslip
// @desc    Generate and download payslip PDF from existing payroll data (no database record)
// @access  Private (HR and Admin)
router.post('/:id/generate-payslip',
  authorize('super_admin', 'admin', 'hr_manager'),
  asyncHandler(async (req, res) => {
    try {
      const payrollId = req.params.id;
      console.log(`🔧 Generating payslip PDF for payroll ID: ${payrollId}`);

      // Validate payroll ID
      if (!mongoose.Types.ObjectId.isValid(payrollId)) {
        console.log(`❌ Invalid payroll ID: ${payrollId}`);
        return res.status(400).json({
          success: false,
          message: 'Invalid payroll ID format'
        });
      }

      // Get the payroll data with optimized population
      const payroll = await Payroll.findById(payrollId)
        .populate({
          path: 'employee',
          select: 'firstName lastName employeeId department position placementDesignation providentFund',
          populate: [
            { path: 'department', select: 'name' },
            { path: 'placementDesignation', select: 'title' }
          ]
        });

      if (!payroll) {
        return res.status(404).json({
          success: false,
          message: 'Payroll not found'
        });
      }

      // Extract department and position names efficiently
      const departmentName = payroll.employee?.department?.name || 'Not Specified';
      const positionName = payroll.employee?.placementDesignation?.title || payroll.employee?.position || 'Not Specified';

      // Debug logging for designation
      console.log(`📋 Payslip Designation Debug:`);
      console.log(`   Employee: ${payroll.employee?.firstName} ${payroll.employee?.lastName}`);
      console.log(`   Placement Designation Object:`, payroll.employee?.placementDesignation);
      console.log(`   Placement Designation Title: ${payroll.employee?.placementDesignation?.title}`);
      console.log(`   Position Field: ${payroll.employee?.position}`);
      console.log(`   Final Designation: ${positionName}`);

      // Validate employee data
      if (!payroll.employee?.employeeId) {
        return res.status(400).json({
          success: false,
          message: 'Employee data not found for this payroll'
        });
      }

      // Generate payslip number for PDF (no database record)
      const payslipNumber = `PS${payroll.year}${payroll.month.toString().padStart(2, '0')}${payroll.employee.employeeId}`;

      const pfEnabled = payroll.providentFundEnabled === true || isProvidentFundEnabledForEmployee(payroll.employee);
      const calculatedPf = calculateProvidentFundForEmployee(payroll.employee, payroll.basicSalary || 0);
      const providentFundForPayslip = pfEnabled ? (payroll.providentFund || calculatedPf || 0) : 0;

      // Create payslip data object for PDF generation (no database save)
      const payslipData = {
        payslipNumber: payslipNumber,
        employeeName: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
        employeeId: payroll.employee.employeeId,
        department: departmentName,
        designation: positionName,
        month: payroll.month,
        year: payroll.year,

        // Salary structure from payroll
        basicSalary: payroll.basicSalary || 0,
        houseRent: payroll.houseRentAllowance || 0,
        medicalAllowance: payroll.medicalAllowance || 0,
        conveyanceAllowance: payroll.allowances?.conveyance?.amount || 0,
        vehicleAllowance: vehicleAllowanceAmount(payroll.allowances),
        fuelAllowance: fuelAllowanceAmount(payroll.allowances),
        vehicleFuelAllowance: vehicleFuelTotal(payroll.allowances),
        foodAllowance: payroll.allowances?.food?.amount || 0,
        mobileAllowance: payroll.allowances?.mobile?.amount || 0,
        specialAllowance: payroll.allowances?.special?.amount || 0,
        otherAllowances: payroll.allowances?.other?.amount || 0,

        // Earnings from payroll
        earnings: {
          basicSalary: payroll.basicSalary || 0,
          houseRent: payroll.houseRentAllowance || 0,
          medicalAllowance: payroll.medicalAllowance || 0,
          conveyanceAllowance: payroll.allowances?.conveyance?.amount || 0,
          vehicleAllowance: vehicleAllowanceAmount(payroll.allowances),
          fuelAllowance: fuelAllowanceAmount(payroll.allowances),
          vehicleFuelAllowance: vehicleFuelTotal(payroll.allowances),
          foodAllowance: payroll.allowances?.food?.amount || 0,
          mobileAllowance: payroll.allowances?.mobile?.amount || 0,
          specialAllowance: payroll.allowances?.special?.amount || 0,
          otherAllowances: payroll.allowances?.other?.amount || 0,
          overtime: payroll.overtimeAmount || 0,
          bonus: payroll.performanceBonus || 0,
          incentives: payroll.otherBonus || 0,
          arrears: payroll.arrears || 0,
          otherEarnings: 0
        },

        // Deductions from payroll
        deductions: {
          providentFund: providentFundForPayslip,
          eobi: payroll.eobi || 0,
          employeeSecurity: payroll.employeeSecurity || 0,
          incomeTax: payroll.incomeTax || 0,
          loanDeduction: payroll.loanDeductions || 0,
          advanceDeduction: 0,
          lateDeduction: 0,
          absentDeduction: payroll.attendanceDeduction || 0,
          otherDeductions: payroll.otherDeductions || 0
        },

        // Attendance from payroll
        totalDays: payroll.totalWorkingDays || 0,
        presentDays: payroll.presentDays || 0,
        absentDays: payroll.absentDays || 0,
        lateDays: 0, // Not tracked in payroll
        overtimeHours: payroll.overtimeHours || 0,

        // Calculations from payroll
        grossSalary: payroll.grossSalary || 0,
        totalEarnings: payroll.totalEarnings || 0,
        totalDeductions: payroll.totalDeductions || 0,
        netSalary: payroll.netSalary || 0,

        // Notes
        remarks: payroll.remarks || `Monthly payslip for ${payroll.month}/${payroll.year}`,

        // User info for PDF
        createdBy: {
          firstName: req.user.firstName || 'System'
        }
      };

      // Generate PDF and return it (no database record created)
      await generatePayslipPDF(payslipData, res);

    } catch (error) {
      console.error('❌ Error generating payslip from payroll:', error);

      // Check if headers have already been sent (PDF generation might have started)
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to generate payslip from payroll',
          error: error.message
        });
      } else {
        console.error('❌ Headers already sent, cannot send error response');
      }
    }
  })
);

// @route   POST /api/payroll/import-salary-percentage-cut
// @desc    Import employee IDs and apply a one-month salary % cut (EOBI stays full)
// @access  Private (hr_manager, hr_admin, super_admin, finance_manager)
const multer = require('multer');
const salaryCutUpload = multer({ storage: multer.memoryStorage() });

router.post(
  '/import-salary-percentage-cut',
  authorize('hr_manager', 'hr_admin', 'super_admin', 'finance_manager'),
  salaryCutUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select an Excel file (.xlsx, .xls).'
      });
    }

    const month = Number(req.body.month);
    const year = Number(req.body.year);
    const percentage = Number(req.body.percentage);

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: 'Valid month (1–12) is required.' });
    }
    if (!Number.isInteger(year) || year < 2020) {
      return res.status(400).json({ success: false, message: 'Valid year is required.' });
    }
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) {
      return res.status(400).json({
        success: false,
        message: 'Percentage must be greater than 0 and less than 100.'
      });
    }

    const xlsx = require('xlsx');
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = xlsx.utils.sheet_to_json(sheet, { defval: null });

    if (!rawData?.length) {
      return res.status(400).json({ success: false, message: 'Excel file appears to be empty.' });
    }

    const findValue = (rowObj, candidates) => {
      const keys = Object.keys(rowObj);
      for (const cand of candidates) {
        const matchKey = keys.find((k) => k.trim().toLowerCase() === cand.trim().toLowerCase());
        if (matchKey && rowObj[matchKey] != null) return rowObj[matchKey];
      }
      for (const cand of candidates) {
        const matchKey = keys.find((k) => k.trim().toLowerCase().includes(cand.trim().toLowerCase()));
        if (matchKey && rowObj[matchKey] != null) return rowObj[matchKey];
      }
      return null;
    };

    const idCandidates = [
      'EMP ID Tovus',
      'Employee ID',
      'EMP ID',
      'Emp ID',
      'EmployeeNo',
      'Code',
      'EmpCode',
      'ID'
    ];

    const PayrollMonthSalaryCut = require('../models/hr/PayrollMonthSalaryCut');
    const { applySalaryPercentageCutToPayrollData } = require('../utils/payrollSalaryPercentageCut');
    const { isPayrollRecordLocked } = require('../utils/payrollLock');

    const normalizeEmpIdVariants = (raw) => {
      const strId = String(raw ?? '').trim().replace(/\.0+$/, '');
      if (!strId) return [];
      const variants = new Set([strId]);
      const digitsOnly = strId.replace(/\D/g, '');
      if (digitsOnly) {
        variants.add(digitsOnly);
        variants.add(digitsOnly.padStart(5, '0'));
        const asInt = String(parseInt(digitsOnly, 10));
        if (asInt !== 'NaN') variants.add(asInt);
      }
      // Excel sometimes yields "1234.0"
      if (/^\d+\.0+$/.test(strId)) {
        const n = String(parseInt(strId, 10));
        if (n !== 'NaN') {
          variants.add(n);
          variants.add(n.padStart(5, '0'));
        }
      }
      return [...variants];
    };

    const findEmployeeForCut = async (strId) => {
      const variants = normalizeEmpIdVariants(strId);
      if (!variants.length) return null;
      const baseQuery = {
        $or: variants.map((id) => ({ employeeId: id }))
      };
      // Prefer active (non-deleted) employees when IDs were reused after soft-delete
      const active = await Employee.findOne({
        ...baseQuery,
        isDeleted: { $ne: true }
      }).select('_id employeeId firstName lastName');
      if (active) return active;
      return Employee.findOne(baseQuery).select('_id employeeId firstName lastName');
    };

    const persistCutOnPayrollDoc = async (doc) => {
      applySalaryPercentageCutToPayrollData(doc, percentage);
      doc.updatedBy = req.user.id;
      if (typeof doc.markModified === 'function') {
        doc.markModified('allowances');
        doc.markModified('taxCalculation');
        doc.markModified('salaryPercentageCut');
        doc.markModified('remarks');
      }
      await doc.save();
    };

    let savedCount = 0;
    let payrollUpdatedCount = 0;
    let payrollSkippedLocked = 0;
    let payrollSkippedAlreadyCut = 0;
    let notFoundCount = 0;
    const unmatchedList = [];
    const updatedDetails = [];
    const seenEmployeeIds = new Set();

    for (const row of rawData) {
      const rawId = findValue(row, idCandidates);
      if (rawId == null) continue;

      const strId = String(rawId).trim();
      if (!strId || seenEmployeeIds.has(strId)) continue;
      seenEmployeeIds.add(strId);

      const emp = await findEmployeeForCut(strId);

      if (!emp) {
        notFoundCount += 1;
        unmatchedList.push(strId);
        continue;
      }

      await PayrollMonthSalaryCut.findOneAndUpdate(
        { employee: emp._id, month, year },
        {
          $set: {
            percentage,
            updatedBy: req.user.id
          },
          $setOnInsert: {
            createdBy: req.user.id
          }
        },
        { upsert: true, new: true }
      );
      savedCount += 1;

      // Unique index is (employee, month, year, isManual) — update every Draft for the period
      const periodPayrolls = await Payroll.find({
        employee: emp._id,
        month,
        year
      });

      let payrollNote = 'No payroll yet — cut will apply on Bulk Create / regenerate';
      if (periodPayrolls.length) {
        const notes = [];
        for (const draftPayroll of periodPayrolls) {
          if (isPayrollRecordLocked(draftPayroll)) {
            payrollSkippedLocked += 1;
            notes.push(`Locked (${draftPayroll.status})`);
            continue;
          }
          if (
            draftPayroll.salaryPercentageCut &&
            Number(draftPayroll.salaryPercentageCut.percentage) === percentage
          ) {
            payrollSkippedAlreadyCut += 1;
            notes.push('Already has this cut');
            continue;
          }
          const replaced = Boolean(draftPayroll.salaryPercentageCut?.percentage);
          await persistCutOnPayrollDoc(draftPayroll);
          payrollUpdatedCount += 1;
          notes.push(replaced ? `Draft updated (replaced prior cut → ${percentage}%)` : 'Draft payroll updated');
        }
        payrollNote = notes.join('; ') || payrollNote;
      }

      updatedDetails.push({
        employeeId: emp.employeeId,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        percentage,
        payrollNote
      });
    }

    res.json({
      success: true,
      message:
        `Salary cut ${percentage}% saved for ${savedCount} employee(s) for ${month}/${year}. ` +
        `Draft payrolls updated: ${payrollUpdatedCount}. EOBI remains full.`,
      data: {
        month,
        year,
        percentage,
        savedCount,
        payrollUpdatedCount,
        payrollSkippedLocked,
        payrollSkippedAlreadyCut,
        notFoundCount,
        unmatchedList,
        updatedDetails,
        totalProcessed: rawData.length
      }
    });
  })
);

module.exports = router;

