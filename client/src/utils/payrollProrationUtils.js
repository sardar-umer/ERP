export const isPayrollProrated = (payroll = {}) => {
  if (payroll?.proration?.isProrated) return true;
  return /prorated|partial pay/i.test(payroll?.remarks || '');
};

export const getPayrollProrationTooltip = (payroll = {}) => {
  if (payroll?.proration?.reason) return payroll.proration.reason;
  const remarks = payroll?.remarks || '';
  const partialMatch = remarks.match(/\(Partial pay[^)]+\)/i);
  if (partialMatch) return partialMatch[0].replace(/^\(|\)$/g, '');
  const match = remarks.match(/\(Prorated[^)]+\)/i);
  if (match) return match[0].replace(/^\(|\)$/g, '');
  if (remarks) return remarks;
  return 'Salary adjusted for partial month';
};

export const getPayrollProrationLabel = (payroll = {}) => {
  const proration = payroll?.proration;
  if (proration?.isProrated && proration.type === 'partial_salary' && proration.payableAmount) {
    return `Partial pay: salary ${Number(proration.payableAmount).toLocaleString('en-PK')} only`;
  }
  if (proration?.isProrated && proration.payableDays && proration.daysInMonth) {
    if (proration.type === 'partial_salary') {
      return `Partial pay ${proration.payableDays}/${proration.daysInMonth} (salary only)`;
    }
    return `Prorated ${proration.payableDays}/${proration.daysInMonth}`;
  }
  const partialMatch = (payroll?.remarks || '').match(/Partial pay\s+(\d+\/\d+)/i);
  if (partialMatch) return `Partial pay ${partialMatch[1]}`;
  const match = (payroll?.remarks || '').match(/Prorated\s+(\d+\/\d+)/i);
  if (match) return `Prorated ${match[1]}`;
  return 'Partial pay';
};

export const getPayrollProrationBadgeColor = (payroll = {}) => {
  if (payroll?.proration?.type === 'partial_salary') return 'info';
  return 'warning';
};
