/**
 * Gross salary exactly as the monthly payroll PDF / Excel export shows it ("Total Earn" column):
 * Total Earnings, restored to full when a one-month % salary cut was applied. Rounded per employee.
 * Same rule as server/utils/payrollExportGross.js.
 */
export const payrollExportGross = (row) => {
  const earnings = Number(row?.totalEarnings) || 0;
  const pct = Number(row?.salaryPercentageCut?.percentage);
  let factor = Number(row?.salaryPercentageCut?.factor);
  if (!Number.isFinite(factor) || factor <= 0) {
    factor = Number.isFinite(pct) && pct > 0 && pct < 100 ? (100 - pct) / 100 : 0;
  }
  if (Number.isFinite(factor) && factor > 0 && factor < 1) return Math.round(earnings / factor);
  return Math.round(earnings);
};
