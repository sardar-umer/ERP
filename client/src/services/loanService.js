import api from './api';

const LOAN_API_BASE = '/loans';

export const loanService = {
  // Get all loans with filters and pagination
  getLoans: async (params = {}) => {
    try {
      const response = await api.get(LOAN_API_BASE, { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Get loan by ID
  getLoanById: async (id) => {
    try {
      const response = await api.get(`${LOAN_API_BASE}/${id}`);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Create new loan application
  createLoan: async (loanData) => {
    try {
      const response = await api.post(LOAN_API_BASE, loanData);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Update loan application
  updateLoan: async (id, loanData) => {
    try {
      const response = await api.put(`${LOAN_API_BASE}/${id}`, loanData);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Approve loan
  approveLoan: async (id, data = {}) => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/approve`, data);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Reject loan
  rejectLoan: async (id, rejectionReason) => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/reject`, { rejectionReason });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Disburse loan
  disburseLoan: async (id, disbursementData) => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/disburse`, disbursementData);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Process loan payment
  processPayment: async (id, paymentData) => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/payment`, paymentData);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Add note to loan
  addNote: async (id, content) => {
    try {
      const response = await api.post(`${LOAN_API_BASE}/${id}/notes`, { content });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Get loan statistics
  getLoanStatistics: async () => {
    try {
      const response = await api.get(`${LOAN_API_BASE}/stats/overview`);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Get employee loans
  getEmployeeLoans: async (employeeId) => {
    try {
      const response = await api.get(`${LOAN_API_BASE}/employee/${employeeId}`);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Get loan schedule
  getLoanSchedule: async (id) => {
    try {
      const response = await api.get(`${LOAN_API_BASE}/${id}/schedule`);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Pause loan deduction for a specific month
  pauseMonth: async (id, month, year, reason = '') => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/pause-month`, { month, year, reason });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Pause loan deduction for multiple consecutive months
  pauseMonths: async (id, { startMonth, startYear, monthCount = 1, reason = '' }) => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/pause-months`, {
        startMonth,
        startYear,
        monthCount,
        reason
      });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Resume loan (remove pause for a specific month)
  resumeMonth: async (id, month, year) => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/resume-month`, { month, year });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Permanently adjust monthly installment
  adjustInstallment: async (id, newAmount, reason = '') => {
    try {
      const response = await api.patch(`${LOAN_API_BASE}/${id}/adjust-installment`, { newAmount, reason });
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Delete loan (Pending for normal users; developer may delete at any status)
  deleteLoan: async (id) => {
    try {
      const response = await api.delete(`${LOAN_API_BASE}/${id}`);
      return response.data;
    } catch (error) {
      throw error.response?.data || error.message;
    }
  },

  // Calculate loan EMI
  calculateEMI: (principal, rate, time) => {
    const p = Number(principal) || 0;
    const t = Number(time) || 0;
    if (p <= 0 || t <= 0) return 0;
    const monthlyRate = (Number(rate) || 0) / 100 / 12;
    if (monthlyRate === 0) {
      return p / t;
    }
    return p * (monthlyRate * Math.pow(1 + monthlyRate, t)) / (Math.pow(1 + monthlyRate, t) - 1);
  },

  // Calculate total payable
  calculateTotalPayable: (emi, time) => {
    return emi * time;
  },

  /**
   * Preview schedule totals with fixed EMI and balancing last installment.
   * Returns { regularEmi, lastInstallment, totalPayable, totalInterest, months }
   */
  previewInstallmentPlan: (principal, annualRate, months, monthlyEmi) => {
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const p0 = Math.max(0, Number(principal) || 0);
    const n = Math.max(0, parseInt(months, 10) || 0);
    const emi = Math.max(0, Number(monthlyEmi) || 0);
    const monthlyRate = (Number(annualRate) || 0) / 100 / 12;

    if (p0 <= 0 || n <= 0 || emi <= 0) {
      return {
        regularEmi: emi,
        lastInstallment: 0,
        totalPayable: 0,
        totalInterest: 0,
        months: n,
        valid: false,
        error: 'Enter loan amount, months, and a valid monthly EMI'
      };
    }

    let balance = p0;
    let totalPayable = 0;
    let lastInstallment = emi;

    for (let i = 0; i < n; i++) {
      const interest = round2(balance * monthlyRate);
      const isLast = i === n - 1;
      let principalPart = round2(emi - interest);
      let amount = emi;

      if (isLast || principalPart >= balance) {
        principalPart = round2(balance);
        amount = round2(principalPart + interest);
        balance = 0;
      } else {
        if (principalPart <= 0) {
          return {
            regularEmi: emi,
            lastInstallment: 0,
            totalPayable: 0,
            totalInterest: 0,
            months: n,
            valid: false,
            error: 'Monthly EMI is too low to cover interest — increase EMI'
          };
        }
        balance = round2(Math.max(0, balance - principalPart));
      }

      totalPayable = round2(totalPayable + amount);
      lastInstallment = amount;

      if (balance <= 0 && !isLast) {
        // EMI clears principal early — last months would be unused; still mark last as this amount
        break;
      }
    }

    if (balance > 0.01) {
      return {
        regularEmi: emi,
        lastInstallment: round2(lastInstallment + balance),
        totalPayable: round2(totalPayable + balance),
        totalInterest: round2(totalPayable + balance - p0),
        months: n,
        valid: false,
        error: 'Monthly EMI is too low to clear the loan in the selected months — increase EMI or months'
      };
    }

    return {
      regularEmi: round2(emi),
      lastInstallment: round2(lastInstallment),
      totalPayable: round2(totalPayable),
      totalInterest: round2(Math.max(0, totalPayable - p0)),
      months: n,
      valid: true,
      error: ''
    };
  },

  // Format currency
  formatCurrency: (amount) => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '₨0';
    }

    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  },

  // Get loan status color
  getStatusColor: (status) => {
    const statusColors = {
      'Pending': '#ff9800',
      'Approved': '#2196f3',
      'Rejected': '#f44336',
      'Disbursed': '#4caf50',
      'Active': '#9c27b0',
      'Completed': '#4caf50',
      'Defaulted': '#f44336'
    };
    return statusColors[status] || '#757575';
  },

  // Get loan type options
  getLoanTypeOptions: () => [
    { value: 'Personal', label: 'Personal Loan' },
    { value: 'Housing', label: 'Housing Loan' },
    { value: 'Vehicle', label: 'Vehicle Loan' },
    { value: 'Education', label: 'Education Loan' },
    { value: 'Medical', label: 'Medical Loan' },
    { value: 'Emergency', label: 'Emergency Loan' },
    { value: 'Other', label: 'Other' }
  ],

  // Get disbursement method options
  getDisbursementMethodOptions: () => [
    { value: 'Bank Transfer', label: 'Bank Transfer' },
    { value: 'Cash', label: 'Cash' },
    { value: 'Check', label: 'Check' },
    { value: 'Direct Deposit', label: 'Direct Deposit' }
  ],

  // Get payment method options
  getPaymentMethodOptions: () => [
    { value: 'Salary Deduction', label: 'Salary Deduction' },
    { value: 'Direct Payment', label: 'Direct Payment' },
    { value: 'Bank Transfer', label: 'Bank Transfer' },
    { value: 'Cash', label: 'Cash' }
  ],

  // Validate loan data
  validateLoanData: (data) => {
    const errors = {};

    if (!data.employee) {
      errors.employee = 'Employee is required';
    }

    if (!data.loanType) {
      errors.loanType = 'Loan type is required';
    }

    if (!data.loanAmount || data.loanAmount < 1000) {
      errors.loanAmount = 'Loan amount must be at least 1,000 PKR';
    }

    if (!data.interestRate || data.interestRate < 0) {
      errors.interestRate = 'Interest rate must be a positive number';
    }

    if (!data.loanTerm || data.loanTerm < 1 || data.loanTerm > 120) {
      errors.loanTerm = 'Loan term must be between 1 and 120 months';
    }

    if (!data.purpose || data.purpose.trim() === '') {
      errors.purpose = 'Loan purpose is required';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }
};

export default loanService; 