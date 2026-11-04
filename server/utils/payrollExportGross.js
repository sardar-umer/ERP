/**
 * Gross salary exactly as the monthly payroll PDF / Excel export shows it ("Total Earn" column):
 * the payroll's Total Earnings, restored to the full amount when a one-month % salary cut was applied
 * (the export shows the cut under Salary Deduction instead). Rounded per employee like the export.
 * Keep in step with applySalaryCutPresentation in routes/payrollReports.js.
 */
const payrollExportGross = (row) => {
  const earnings = Number(row?.totalEarnings) || 0;
  const pct = Number(row?.salaryPercentageCut?.percentage);
  let factor = Number(row?.salaryPercentageCut?.factor);
  if (!Number.isFinite(factor) || factor <= 0) {
    factor = Number.isFinite(pct) && pct > 0 && pct < 100 ? (100 - pct) / 100 : 0;
  }
  if (Number.isFinite(factor) && factor > 0 && factor < 1) return Math.round(earnings / factor);
  return Math.round(earnings);
};

module.exports = { payrollExportGross };
