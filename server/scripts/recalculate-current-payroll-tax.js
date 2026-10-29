#!/usr/bin/env node
/**
 * Recalculate payroll income tax for a month using:
 * - Payroll Taxes page settings (medical % + allowance taxable/exempt)
 * - FY months from date of joining → June
 *
 * Usage:
 *   NODE_ENV=production node server/scripts/recalculate-current-payroll-tax.js
 *   NODE_ENV=production node server/scripts/recalculate-current-payroll-tax.js --month=9 --year=2026
 *   NODE_ENV=production node server/scripts/recalculate-current-payroll-tax.js --month=8 --year=2026 --include-approved --apply
 *
 * Default statuses: Draft
 * --include-approved also updates "Approved by AVP" (not Paid/Cancelled)
 * Without --apply it is a dry run: nothing is written, every payroll whose tax would change is listed
 * (uses the same calculation as --apply: salary cut keeps tax, prorated month not annualized, FY arrears kept)
 * --current uses the latest existing payroll period when the requested month has none
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { getMongooseClientOptions } = require('../config/database');

const apply = process.argv.includes('--apply');
const includeApproved = process.argv.includes('--include-approved');
const useCurrent = process.argv.includes('--current');
const monthArg = process.argv.find((a) => a.startsWith('--month='));
const yearArg = process.argv.find((a) => a.startsWith('--year='));

const statuses = includeApproved ? ['Draft', 'Approved by AVP'] : ['Draft'];

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LOCAL;
  await mongoose.connect(uri, getMongooseClientOptions(uri, /localhost|127/.test(uri || '')));

  require('../models/hr/Employee');
  require('../models/hr/Payroll');
  require('../models/hr/PayrollTaxSettings');

  const MonthlyTaxUpdateService = require('../services/monthlyTaxUpdateService');
  const { getRemainingFYMonths } = require('../utils/taxCalculator');
  const { loadPayrollTaxSettings } = require('../utils/allowanceTaxCalculator');
  const Payroll = mongoose.model('Payroll');

  const now = new Date();
  let month = monthArg ? Number(monthArg.split('=')[1]) : now.getMonth() + 1;
  let year = yearArg ? Number(yearArg.split('=')[1]) : now.getFullYear();

  let count = await Payroll.countDocuments({ month, year });
  if ((count === 0 || useCurrent) && count === 0) {
    const latest = await Payroll.aggregate([
      { $group: { _id: { m: '$month', y: '$year' }, c: { $sum: 1 } } },
      { $sort: { '_id.y': -1, '_id.m': -1 } },
      { $limit: 1 }
    ]);
    if (latest[0]) {
      console.log(
        JSON.stringify(
          {
            note: `No payrolls for ${month}/${year}; switching to latest period ${latest[0]._id.m}/${latest[0]._id.y}`,
            latestCount: latest[0].c
          },
          null,
          2
        )
      );
      month = latest[0]._id.m;
      year = latest[0]._id.y;
    }
  }

  const settings = await loadPayrollTaxSettings();
  const statusBreakdown = await Payroll.aggregate([
    { $match: { month, year } },
    { $group: { _id: '$status', c: { $sum: 1 } } }
  ]);

  console.log(
    JSON.stringify(
      {
        apply,
        includeApproved,
        month,
        year,
        statuses,
        statusBreakdown,
        salaryMedicalExemptPercent: settings.salaryMedicalExemptPercent,
        allowancePolicies: settings.allowancePolicies,
        sampleFY: {
          julJoin: getRemainingFYMonths(new Date('2026-07-01'), month, year),
          sepJoin: getRemainingFYMonths(new Date('2026-09-01'), month, year),
          octJoin: getRemainingFYMonths(new Date('2026-10-01'), month, year)
        }
      },
      null,
      2
    )
  );

  if (!apply) {
    const {
      loadTaxYearContextByEmployee,
      taxYearContextFor,
      calculateTaxForExistingPayroll
    } = require('../utils/allowanceTaxCalculator');
    const { resolveEmployeeIncomeTax } = require('../utils/allowanceHelpers');

    const payrolls = await Payroll.find({ month, year, status: { $in: statuses } }).populate(
      'employee',
      'firstName lastName employeeId hireDate appointmentDate taxExemption manualTax allowances'
    );
    const taxYearContextByEmployee = await loadTaxYearContextByEmployee({ payrollMonth: month, payrollYear: year });

    const changes = [];
    for (const p of payrolls) {
      const emp = p.employee;
      if (!emp) continue;
      const calc = await calculateTaxForExistingPayroll({
        payroll: p,
        employee: emp,
        settings,
        taxYearContext: taxYearContextFor(taxYearContextByEmployee, emp._id)
      });
      const { tax: newTax, isManual } = resolveEmployeeIncomeTax(emp, calc.totalTax);
      const oldTax = Number(p.incomeTax) || 0;
      if (oldTax === newTax) continue;
      changes.push({
        employeeId: emp.employeeId,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        status: p.status,
        oldTax,
        newTax,
        delta: newTax - oldTax,
        manualTax: isManual,
        fyMonths: getRemainingFYMonths(emp.hireDate || emp.appointmentDate, month, year),
        mainTaxable: calc.mainTaxableIncome,
        normalMonthlyTaxable: calc.normalMonthlyTaxable,
        priorFyArrears: calc.priorFyArrears,
        salaryCut: p.salaryPercentageCut?.percentage || 0,
        allowanceTaxable: calc.allowanceTaxable
      });
    }
    changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    console.log(
      JSON.stringify(
        {
          targetCount: payrolls.length,
          wouldChange: changes.length,
          changes
        },
        null,
        2
      )
    );
    console.log('DRY_OK');
  } else {
    // forceUpdate=false: only rewrite rows where stored tax ≠ computed tax
    const result = await MonthlyTaxUpdateService.updateMonthlyTaxes(month, year, false, {
      statuses
    });
    const changed = (result.results || []).filter((r) => r.updated);
    console.log(
      JSON.stringify(
        {
          updatedCount: result.updatedCount,
          unchangedCount: result.unchangedCount,
          errorCount: result.errorCount,
          totalCount: result.totalCount,
          statuses: result.statuses,
          changedSample: changed.slice(0, 40).map((r) => ({
            employeeId: r.employeeId,
            name: r.employeeName,
            oldTax: r.oldTax,
            newTax: r.newTax,
            delta: (r.newTax || 0) - (r.oldTax || 0)
          }))
        },
        null,
        2
      )
    );
    console.log('APPLY_OK');
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
