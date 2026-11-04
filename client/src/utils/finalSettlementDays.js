/**
 * Final settlement day-rate helpers — use calendar month length, not fixed 30.
 */

const parseSettlementDate = (dateInput) => {
  if (!dateInput) return new Date();
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
};

/** Days in the calendar month of the given date (28–31). */
export const getCalendarDaysInMonth = (dateInput) => {
  const d = parseSettlementDate(dateInput);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};

/**
 * Prefer last working date, then settlement date, then today —
 * the month that drives daily rate for final settlement.
 */
export const resolveSettlementRateDate = ({ lastWorkingDate, settlementDate } = {}) =>
  lastWorkingDate || settlementDate || new Date();

export const getSettlementDailyRate = (grossSalary, dateInput) => {
  const days = getCalendarDaysInMonth(dateInput);
  const safeDays = days > 0 ? days : 30;
  return (Number(grossSalary) || 0) / safeDays;
};

export const getSettlementDailyRateRounded = (grossSalary, dateInput) =>
  Math.round(getSettlementDailyRate(grossSalary, dateInput));

/** Actual salary for days served — always from GROSS daily rate. */
export const getSettlementActualSalary = (grossSalary, servedDays, dateInput) => {
  const rate = getSettlementDailyRate(grossSalary, dateInput);
  return Math.round(rate * Math.max(0, Number(servedDays) || 0));
};

/** Notice shortfall deduction — always from GROSS daily rate × shortfall days. */
export const getSettlementShortfallDeduction = (grossSalary, noticePeriod, servedDays, dateInput) => {
  const shortfall = Math.max(0, (Number(noticePeriod) || 0) - (Number(servedDays) || 0));
  const rate = getSettlementDailyRate(grossSalary, dateInput);
  return Math.round(rate * shortfall);
};

/** Prorate a monthly component by served days in the settlement month. */
export const prorateSettlementAmount = (amount, servedDays, dateInput) => {
  const baseAmount = Number(amount) || 0;
  if (baseAmount === 0) return 0;
  const days = getCalendarDaysInMonth(dateInput);
  const served = Number(servedDays) || 0;
  if (!served || served <= 0) return Math.round(baseAmount);
  return Math.round((baseAmount / (days > 0 ? days : 30)) * served);
};
/**
 * Prorated amount kept to 2 decimals (Sidat adds the exact prorated amounts and rounds only the total:
 * 78,524.19 + 6,290.32 + 2,180.65 + 14,677.42 = 101,672.58 → 101,673).
 */
export const prorateSettlementAmountExact = (amount, servedDays, dateInput) => {
  const baseAmount = Number(amount) || 0;
  if (baseAmount === 0) return 0;
  const days = getCalendarDaysInMonth(dateInput);
  const served = Number(servedDays) || 0;
  if (!served || served <= 0) return Math.round(baseAmount * 100) / 100;
  return Math.round(((baseAmount / (days > 0 ? days : 30)) * served) * 100) / 100;
};
