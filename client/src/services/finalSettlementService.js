import api from './api';
import { formatPKR } from '../utils/currency';
import {
  resolveSettlementRateDate,
  getSettlementDailyRate,
  getSettlementActualSalary,
  getSettlementShortfallDeduction,
  getCalendarDaysInMonth
} from '../utils/finalSettlementDays';

class FinalSettlementService {
  // Get all settlements with pagination and filters
  async getSettlements(params = {}) {
    try {
      const response = await api.get('/final-settlements', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching settlements:', error);
      throw error;
    }
  }

  // Get settlement statistics
  async getSettlementStats() {
    try {
      const response = await api.get('/final-settlements/stats/overview');
      return response.data;
    } catch (error) {
      console.error('Error fetching settlement stats:', error);
      throw error;
    }
  }

  // Get employee settlements
  async getEmployeeSettlements(employeeId) {
    try {
      const response = await api.get(`/final-settlements/employee/${employeeId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching employee settlements:', error);
      throw error;
    }
  }

  // Get settlement by ID
  async getSettlement(id) {
    try {
      const response = await api.get(`/final-settlements/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching settlement:', error);
      throw error;
    }
  }

  // Create new settlement
  async createSettlement(settlementData) {
    try {
      const response = await api.post('/final-settlements', settlementData);
      return response.data;
    } catch (error) {
      console.error('Error creating settlement:', error);
      throw error;
    }
  }

  // Update settlement
  async updateSettlement(id, settlementData) {
    try {
      const response = await api.put(`/final-settlements/${id}`, settlementData);
      return response.data;
    } catch (error) {
      console.error('Error updating settlement:', error);
      throw error;
    }
  }

  // Approve settlement
  async approveSettlement(id) {
    try {
      const response = await api.patch(`/final-settlements/${id}/approve`);
      return response.data;
    } catch (error) {
      console.error('Error approving settlement:', error);
      throw error;
    }
  }

  // Process settlement
  async processSettlement(id) {
    try {
      const response = await api.patch(`/final-settlements/${id}/process`);
      return response.data;
    } catch (error) {
      console.error('Error processing settlement:', error);
      throw error;
    }
  }

  // Mark settlement as paid
  async markAsPaid(id) {
    try {
      const response = await api.patch(`/final-settlements/${id}/paid`);
      return response.data;
    } catch (error) {
      console.error('Error marking settlement as paid:', error);
      throw error;
    }
  }

  // Cancel settlement
  async cancelSettlement(id) {
    try {
      const response = await api.patch(`/final-settlements/${id}/cancel`);
      return response.data;
    } catch (error) {
      console.error('Error cancelling settlement:', error);
      throw error;
    }
  }

  // Add comment to settlement
  async addComment(id, comment) {
    try {
      const response = await api.post(`/final-settlements/${id}/comments`, { comment });
      return response.data;
    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }

  // Delete settlement
  async deleteSettlement(id) {
    try {
      const response = await api.delete(`/final-settlements/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting settlement:', error);
      throw error;
    }
  }

  // Format settlement data for display
  formatSettlementData(settlement) {
    const rateDate = resolveSettlementRateDate({
      lastWorkingDate: settlement.lastWorkingDate,
      settlementDate: settlement.settlementDate
    });
    const dailyRate = getSettlementDailyRate(settlement.grossSalary || 0, rateDate);
    const actualSalary =
      Number(settlement.actualSalary) > 0
        ? Number(settlement.actualSalary)
        : getSettlementActualSalary(
          settlement.grossSalary || 0,
          settlement.noticePeriodServed,
          rateDate
        );
    const shortfallDays = Math.max(
      0,
      (Number(settlement.noticePeriod) || 0) - (Number(settlement.noticePeriodServed) || 0)
    );
    const shortfallDeduction = getSettlementShortfallDeduction(
      settlement.grossSalary || 0,
      settlement.noticePeriod,
      settlement.noticePeriodServed,
      rateDate
    );

    return {
      ...settlement,
      formattedGrossAmount: formatPKR(settlement.grossSettlementAmount),
      formattedNetAmount: formatPKR(settlement.netSettlementAmount),
      formattedBasicSalary: formatPKR(settlement.basicSalary),
      formattedGrossSalary: formatPKR(settlement.grossSalary),
      formattedDailyRate: formatPKR(Math.round(dailyRate)),
      formattedActualSalary: formatPKR(actualSalary),
      formattedShortfallDeduction: formatPKR(
        Number(settlement.deductions?.noticePeriodDeduction) > 0
          ? settlement.deductions.noticePeriodDeduction
          : shortfallDeduction
      ),
      noticePeriodShortfallDays: shortfallDays,
      calendarDaysInMonth: getCalendarDaysInMonth(rateDate),
      formattedNetSalary: formatPKR(settlement.netSalary),
      formattedTotalEarnings: formatPKR(settlement.earnings?.totalEarnings),
      formattedTotalDeductions: formatPKR(settlement.deductions?.totalDeductions),
      formattedLoanSettlement: formatPKR(settlement.totalLoanSettlement),
      formattedLeaveEncashment: formatPKR(settlement.leaveEncashmentAmount),
      statusColor: this.getStatusColor(settlement.status),
      settlementTypeColor: this.getSettlementTypeColor(settlement.settlementType),
      progressPercentage: settlement.settlementProgress || 0
    };
  }

  // Get status color for UI
  getStatusColor(status) {
    const colors = {
      pending: '#ff9800',
      approved: '#2196f3',
      processed: '#9c27b0',
      paid: '#4caf50',
      cancelled: '#f44336'
    };
    return colors[status] || '#757575';
  }

  // Get settlement type color for UI
  getSettlementTypeColor(type) {
    const colors = {
      resignation: '#ff5722',
      termination: '#f44336',
      retirement: '#4caf50',
      contract_end: '#2196f3',
      death: '#9c27b0',
      other: '#757575'
    };
    return colors[type] || '#757575';
  }

  // Get status label
  getStatusLabel(status) {
    const labels = {
      pending: 'Pending',
      approved: 'Approved',
      processed: 'Processed',
      paid: 'Paid',
      cancelled: 'Cancelled'
    };
    return labels[status] || status;
  }

  // Get settlement type label
  getSettlementTypeLabel(type) {
    const labels = {
      resignation: 'Resignation',
      termination: 'Termination',
      retirement: 'Retirement',
      contract_end: 'Contract End',
      death: 'Death',
      other: 'Other'
    };
    return labels[type] || type;
  }

  // Calculate settlement progress
  calculateProgress(settlement) {
    const statusOrder = ['pending', 'approved', 'processed', 'paid'];
    const currentIndex = statusOrder.indexOf(settlement.status);
    return ((currentIndex + 1) / statusOrder.length) * 100;
  }

  // Format earnings for display
  formatEarnings(earnings) {
    if (!earnings) return {};

    const totalFromParts =
      (Number(earnings.basicSalary) || 0) +
      (Number(earnings.houseRent) || 0) +
      (Number(earnings.medicalAllowance) || 0) +
      (Number(earnings.conveyanceAllowance) || 0) +
      (Number(earnings.foodAllowance) || 0) +
      (Number(earnings.mobileAllowance) || 0) +
      (Number(earnings.vehicleAllowance) || 0) +
      (Number(earnings.fuelAllowance) || 0) +
      (Number(earnings.specialAllowance) || 0) +
      (Number(earnings.otherAllowances) || 0) +
      (Number(earnings.otherEarnings) || 0) +
      (Number(earnings.overtime) || 0) +
      (Number(earnings.bonus) || 0) +
      (Number(earnings.gratuity) || 0) +
      (Number(earnings.leaveEncashment) || 0) +
      (Number(earnings.noticePay) || 0) +
      (Number(earnings.providentFund) || 0) +
      (Number(earnings.eobi) || 0);
    
    return {
      basicSalary: formatPKR(earnings.basicSalary || 0),
      houseRent: formatPKR(earnings.houseRent || 0),
      medicalAllowance: formatPKR(earnings.medicalAllowance || 0),
      conveyanceAllowance: formatPKR(earnings.conveyanceAllowance || 0),
      foodAllowance: formatPKR(earnings.foodAllowance || 0),
      mobileAllowance: formatPKR(earnings.mobileAllowance || 0),
      vehicleAllowance: formatPKR(earnings.vehicleAllowance || 0),
      fuelAllowance: formatPKR(earnings.fuelAllowance || 0),
      specialAllowance: formatPKR(earnings.specialAllowance || 0),
      otherAllowances: formatPKR(earnings.otherAllowances || 0),
      otherEarnings: formatPKR(earnings.otherEarnings || 0),
      overtime: formatPKR(earnings.overtime || 0),
      bonus: formatPKR(earnings.bonus || 0),
      gratuity: formatPKR(earnings.gratuity || 0),
      leaveEncashment: formatPKR(earnings.leaveEncashment || 0),
      noticePay: formatPKR(earnings.noticePay || 0),
      providentFund: formatPKR(earnings.providentFund || 0),
      eobi: formatPKR(earnings.eobi || 0),
      totalEarnings: formatPKR(Number(earnings.totalEarnings) > 0 ? earnings.totalEarnings : totalFromParts)
    };
  }

  // Format deductions for display
  formatDeductions(deductions) {
    if (!deductions) return {};

    const totalFromParts =
      (Number(deductions.incomeTax) || 0) +
      (Number(deductions.providentFund) || 0) +
      (Number(deductions.eobi) || 0) +
      (Number(deductions.loanDeductions) || 0) +
      (Number(deductions.noticePeriodDeduction) || 0) +
      (Number(deductions.security) || 0) +
      (Number(deductions.healthInsurance) || 0) +
      (Number(deductions.advanceDeductions) || 0) +
      (Number(deductions.pension) || 0) +
      (Number(deductions.otherDeductions) || 0);
    
    return {
      incomeTax: formatPKR(deductions.incomeTax || 0),
      providentFund: formatPKR(deductions.providentFund || 0),
      eobi: formatPKR(deductions.eobi || 0),
      loanDeductions: formatPKR(deductions.loanDeductions || 0),
      noticePeriodDeduction: formatPKR(deductions.noticePeriodDeduction || 0),
      security: formatPKR(deductions.security || 0),
      healthInsurance: formatPKR(deductions.healthInsurance || 0),
      advanceDeductions: formatPKR(deductions.advanceDeductions || 0),
      pension: formatPKR(deductions.pension || 0),
      otherDeductions: formatPKR(deductions.otherDeductions || 0),
      totalDeductions: formatPKR(Number(deductions.totalDeductions) > 0 ? deductions.totalDeductions : totalFromParts)
    };
  }

  // Format loan settlements for display
  formatLoanSettlements(loans) {
    if (!loans || !Array.isArray(loans)) return [];
    
    return loans.map(loan => ({
      ...loan,
      formattedOriginalAmount: formatPKR(loan.originalAmount || 0),
      formattedOutstandingBalance: formatPKR(loan.outstandingBalance || 0),
      formattedSettledAmount: formatPKR(loan.settledAmount || 0),
      settlementTypeColor: this.getLoanSettlementTypeColor(loan.settlementType)
    }));
  }

  // Get loan settlement type color
  getLoanSettlementTypeColor(type) {
    const colors = {
      full_settlement: '#4caf50',
      partial_settlement: '#ff9800',
      waived: '#9c27b0',
      pending: '#757575'
    };
    return colors[type] || '#757575';
  }

  // Validate settlement data
  validateSettlementData(data) {
    const errors = {};

    if (!data.employeeId) {
      errors.employeeId = 'Employee is required';
    }

    if (!data.settlementType) {
      errors.settlementType = 'Settlement type is required';
    }

    if (!data.reason) {
      errors.reason = 'Reason is required';
    }

    if (!data.lastWorkingDate) {
      errors.lastWorkingDate = 'Last working date is required';
    }

    if (!data.settlementDate) {
      errors.settlementDate = 'Settlement date is required';
    }

    if (data.noticePeriod < 0) {
      errors.noticePeriod = 'Notice period cannot be negative';
    }

    if (data.noticePeriodServed < 0) {
      errors.noticePeriodServed = 'Notice period served cannot be negative';
    }

    if (data.noticePeriodServed > data.noticePeriod) {
      errors.noticePeriodServed = 'Notice period served cannot exceed notice period';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }
}

export default new FinalSettlementService(); 