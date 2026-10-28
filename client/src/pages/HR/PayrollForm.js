import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stepper,
  Step,
  StepLabel,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  Divider,
  Alert,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,

} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Save as SaveIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Calculate as CalculateIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormik } from 'formik';
import * as Yup from 'yup';

import { formatPKR } from '../../utils/currency';
import { allowancesForForm, vehicleAllowanceAmount, fuelAllowanceAmount } from '../../utils/allowanceHelpers';
import api from '../../services/authService';
import { loanService } from '../../services/loanService';

const steps = ['Basic Information', 'Salary & Allowances', 'Deductions & Overtime', 'Review & Calculate'];

const PayrollForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [activeStep, setActiveStep] = useState(0);

  // Months array for dropdown
  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];

  // Helper function to get start and end dates for a month
  const getMonthDates = (monthValue, year = new Date().getFullYear()) => {
    // monthValue is 1-indexed (01, 02, ..., 12)
    const month = parseInt(monthValue);

    // Create dates using UTC to avoid timezone issues
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0)); // Last day of the month

    console.log('🐛 DEBUG: getMonthDates function:');
    console.log('🐛 DEBUG: Input monthValue:', monthValue, 'year:', year);
    console.log('🐛 DEBUG: Calculated month (0-indexed):', month - 1);
    console.log('🐛 DEBUG: UTC startDate:', startDate.toISOString());
    console.log('🐛 DEBUG: UTC endDate:', endDate.toISOString());

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    };
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeLoans, setEmployeeLoans] = useState([]);

  // Add tax calculation display
  const [taxInfo, setTaxInfo] = useState(null);

  const validationSchema = Yup.object({
    employee: Yup.string().required('Employee is required'),
    payPeriod: Yup.object({
      month: Yup.string().required('Month is required'),
      year: Yup.number().required('Year is required').min(2020, 'Year must be 2020 or later').max(2030, 'Year must be 2030 or earlier'),
      type: Yup.string().required('Pay period type is required')
    }),
    basicSalary: Yup.number().min(0, 'Basic salary must be positive').required('Basic salary is required'),
    allowances: Yup.object({
      conveyance: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Conveyance allowance must be positive')
      }),
      food: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Food allowance must be positive')
      }),
      mobile: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Mobile allowance must be positive')
      }),
      vehicle: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Vehicle allowance must be positive')
      }),
      fuel: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Fuel allowance must be positive')
      }),
      medical: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Medical allowance must be positive')
      }),
      special: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Special allowance must be positive')
      }),
      other: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Other allowance must be positive')
      })
    }),
    overtime: Yup.object({
      hours: Yup.number().min(0, 'Overtime hours must be positive'),
      rate: Yup.number().min(0, 'Overtime rate must be positive')
    }),
    bonuses: Yup.object({
      performance: Yup.number().min(0, 'Performance bonus must be positive'),
      attendance: Yup.number().min(0, 'Attendance bonus must be positive'),
      other: Yup.number().min(0, 'Other bonus must be positive'),
      arrears: Yup.number().min(0, 'Arrears must be positive')
    }),
    deductions: Yup.object({
      tax: Yup.number().min(0, 'Tax must be positive'),
      insurance: Yup.number().min(0, 'Insurance must be positive'),
      pension: Yup.number().min(0, 'Pension must be positive'),
      eobi: Yup.number().min(0, 'EOBI must be positive'),
      providentFund: Yup.number().min(0, 'Provident Fund must be positive'),
      employeeSecurity: Yup.number().min(0, 'Employee security must be positive'),
      vehicleLoan: Yup.number().min(0, 'Vehicle loan must be positive'),
      companyLoan: Yup.number().min(0, 'Company loan must be positive'),
      other: Yup.number().min(0, 'Other deduction must be positive')
    }),
    attendance: Yup.object({
      totalDays: Yup.number().min(0, 'Total days must be positive'),
      presentDays: Yup.number().min(0, 'Present days must be positive'),
      // Note: absentDays is calculated automatically based on totalDays, presentDays, and leaveDays
      lateDays: Yup.number().min(0, 'Late days must be positive'),
      halfDays: Yup.number().min(0, 'Half days must be positive')
    }),
    notes: Yup.string()
  });

  const formik = useFormik({
    initialValues: {
      isManual: false,
      employee: '',
      payPeriod: {
        month: (new Date().getMonth() + 1).toString().padStart(2, '0'), // Current month as default
        year: new Date().getFullYear(), // Current year as default
        type: 'monthly'
      },
      basicSalary: 0,
      allowances: {
        conveyance: {
          isActive: false,
          amount: 0
        },
        food: {
          isActive: false,
          amount: 0
        },
        mobile: {
          isActive: false,
          amount: 0
        },
        vehicle: {
          isActive: false,
          amount: 0
        },
        fuel: {
          isActive: false,
          amount: 0
        },
        medical: {
          isActive: false,
          amount: 0
        },
        special: {
          isActive: false,
          amount: 0
        },
        other: {
          isActive: false,
          amount: 0
        }
      },
      overtime: {
        hours: 0,
        rate: 0,
        amount: 0
      },
      bonuses: {
        performance: 0,
        attendance: 0,
        other: 0,
        arrears: 0
      },
      deductions: {
        tax: 0,
        insurance: 0,
        pension: 0,
        eobi: 0,
        providentFund: 0,
        employeeSecurity: 0,
        vehicleLoan: 0,
        companyLoan: 0,
        other: 0
      },
      attendance: {
        totalDays: 0,
        presentDays: 0,
        absentDays: 0,
        lateDays: 0,
        halfDays: 0
      },
      leaveDeductions: {
        unpaidLeave: 0,
        sickLeave: 0,
        casualLeave: 0,
        annualLeave: 0,
        otherLeave: 0,
        totalLeaveDays: 0,
        leaveDeductionAmount: 0
      },
      notes: '',
      grossSalaryBase: 0, // Added for auto-calculation
      houseRentAllowance: 0, // Added for auto-calculation
      medicalAllowance: 0, // Added for auto-calculation
      autoCalculateSalary: true // Added for auto-calculation
    },
    validationSchema,
    onSubmit: async (values) => {
      try {
        console.log('Form submitted with values:', values);
        setLoading(true);
        setError(null);

        // Calculate start and end dates from selected month and year
        console.log('🐛 DEBUG: values.payPeriod.month:', values.payPeriod.month);
        console.log('🐛 DEBUG: values.payPeriod.year:', values.payPeriod.year);
        const { startDate, endDate } = getMonthDates(values.payPeriod.month, values.payPeriod.year);
        console.log('🐛 DEBUG: Calculated startDate:', startDate, 'endDate:', endDate);



        // Map allowances to backend format
        const mappedAllowances = {
          conveyance: {
            isActive: values.allowances?.conveyance?.isActive || false,
            amount: values.allowances?.conveyance?.isActive ? (values.allowances.conveyance.amount || 0) : 0
          },
          food: {
            isActive: values.allowances?.food?.isActive || false,
            amount: values.allowances?.food?.isActive ? (values.allowances.food.amount || 0) : 0
          },
          mobile: {
            isActive: values.allowances?.mobile?.isActive || false,
            amount: values.allowances?.mobile?.isActive ? (values.allowances.mobile.amount || 0) : 0
          },
          vehicle: {
            isActive: values.allowances?.vehicle?.isActive || false,
            amount: values.allowances?.vehicle?.isActive ? (values.allowances.vehicle.amount || 0) : 0
          },
          fuel: {
            isActive: values.allowances?.fuel?.isActive || false,
            amount: values.allowances?.fuel?.isActive ? (values.allowances.fuel.amount || 0) : 0
          },
          medical: {
            isActive: values.allowances?.medical?.isActive || false,
            amount: values.allowances?.medical?.isActive ? (values.allowances.medical.amount || 0) : 0
          },
          special: {
            isActive: values.allowances?.special?.isActive || false,
            amount: values.allowances?.special?.isActive ? (values.allowances.special.amount || 0) : 0
          },
          other: {
            isActive: values.allowances?.other?.isActive || false,
            amount: values.allowances?.other?.isActive ? (values.allowances.other.amount || 0) : 0
          }
        };

        // Create the payload with calculated dates and mapped allowances
        const payrollData = {
          ...values,
          allowances: mappedAllowances,
          deductions: {
            ...values.deductions,
            incomeTax: values.deductions.incomeTax || 0,
            eobi: 370 // Fixed EOBI amount for Pakistan
          },
          payPeriod: {
            ...values.payPeriod,
            startDate,
            endDate
          }
        };

        let currentId = id;
        if (!currentId) {
          console.log('🚀 CREATING NEW MANUAL PAYROLL');
          const createRes = await api.post('/payroll/manual', {
            employee: payrollData.employee,
            month: payrollData.payPeriod.month,
            year: payrollData.payPeriod.year,
            basicSalary: payrollData.basicSalary,
            grossSalary: payrollData.grossSalaryBase
          });
          currentId = createRes.data.data._id;
          console.log('✅ Created draft payroll with ID:', currentId);
        }

        let savedPayroll;
        console.log('🔄 UPDATING PAYROLL:', currentId);
        console.log('📤 COMPLETE PAYLOAD BEING SENT TO BACKEND:');
        console.log('   Payroll ID:', currentId);
        console.log('   Employee ID:', payrollData.employee);
        console.log('   Pay Period:', payrollData.payPeriod);
        console.log('   Basic Salary:', payrollData.basicSalary);
        console.log('   Allowances:', JSON.stringify(payrollData.allowances, null, 2));
        console.log('   Overtime:', JSON.stringify(payrollData.overtime, null, 2));
        console.log('   Bonuses:', JSON.stringify(payrollData.bonuses, null, 2));
        console.log('   Deductions:', JSON.stringify(payrollData.deductions, null, 2));
        console.log('   Attendance:', JSON.stringify(payrollData.attendance, null, 2));
        console.log('   Leave Deductions:', JSON.stringify(payrollData.leaveDeductions, null, 2));
        console.log('   Notes:', payrollData.notes);
        console.log('📊 SUMMARY OF KEY CHANGES:');
        console.log('   Vehicle Allowance:', payrollData.allowances?.vehicle?.isActive ?
          `Active (Rs. ${payrollData.allowances.vehicle.amount})` : 'Inactive');
        console.log('   Fuel Allowance:', payrollData.allowances?.fuel?.isActive ?
          `Active (Rs. ${payrollData.allowances.fuel.amount})` : 'Inactive');
        console.log('   Medical Allowance:', payrollData.allowances?.medical?.isActive ? 
          `Active (Rs. ${payrollData.allowances.medical.amount})` : 'Inactive');
        console.log('   Total Allowances:', Object.values(payrollData.allowances || {}).reduce((sum, allowance) => 
          sum + (allowance.isActive ? allowance.amount : 0), 0));
        console.log('🚀 SENDING PUT REQUEST TO:', `/api/payroll/${currentId}`);
        savedPayroll = await api.put(`/payroll/${currentId}`, payrollData);

        // Process loan payment if there's a loan deduction
        if (values.deductions.loan > 0 && employeeLoans.length > 0) {
          const activeLoan = employeeLoans.find(loan =>
            ['Active', 'Disbursed'].includes(loan.status) && loan.outstandingBalance > 0
          );

          if (activeLoan) {
            try {
              await loanService.processPayment(activeLoan._id, {
                amount: values.deductions.loan,
                paymentMethod: 'Salary Deduction'
              });
              console.log('Loan payment processed successfully');

              // Refresh loan information to get updated outstanding balance
              await fetchEmployeeLoans(values.employee);
            } catch (loanError) {
              console.error('Error processing loan payment:', loanError);
              // Don't fail the payroll save if loan payment fails
              setError('Payroll saved but loan payment failed: ' + (loanError.response?.data?.message || loanError.message));
            }
          }
        }

        console.log('✅ PAYROLL SAVED SUCCESSFULLY!');
        console.log('📥 RESPONSE FROM BACKEND:');
        console.log('   Success:', savedPayroll.data.success);
        console.log('   Message:', savedPayroll.data.message);
        console.log('   Updated Payroll Data:', JSON.stringify(savedPayroll.data.data, null, 2));
        console.log('📊 UPDATED VALUES FROM BACKEND:');
        if (savedPayroll.data.data) {
          const updatedPayroll = savedPayroll.data.data;
          console.log('   Total Earnings:', updatedPayroll.totalEarnings);
          console.log('   Vehicle Allowance:', updatedPayroll.allowances?.vehicle?.isActive ?
            `Active (Rs. ${updatedPayroll.allowances.vehicle.amount})` : 'Inactive');
          console.log('   Fuel Allowance:', updatedPayroll.allowances?.fuel?.isActive ?
            `Active (Rs. ${updatedPayroll.allowances.fuel.amount})` : 'Inactive');
          console.log('   Medical Allowance:', updatedPayroll.allowances?.medical?.isActive ?
            `Active (Rs. ${updatedPayroll.allowances.medical.amount})` : 'Inactive');
          console.log('   Income Tax:', updatedPayroll.incomeTax);
          console.log('   Total Deductions:', updatedPayroll.totalDeductions);
          console.log('   Net Salary:', updatedPayroll.netSalary);
          console.log('   Updated At:', updatedPayroll.updatedAt);
        }
        console.log('🎉 NAVIGATING BACK TO PAYROLL LIST...');
        navigate('/hr/payroll');
      } catch (error) {
        console.error('Error saving payroll:', error);
        console.error('Error response:', error.response);
        console.log('🐛 DEBUG: Full error details:', error.response?.data);
        setError(error.response?.data?.message || 'Failed to save payroll');
      } finally {
        setLoading(false);
      }
    }
  });

  useEffect(() => {
    fetchEmployees();
    if (id) {
      fetchPayroll();
    } else {
      setLoading(false);
    }
  }, [id, navigate]); // eslint-disable-next-line react-hooks/exhaustive-deps

  // Update loan deduction when employee loans change
  useEffect(() => {
    if (employeeLoans.length > 0 && selectedEmployee) {
      const activeLoan = employeeLoans.find(loan =>
        ['Active', 'Disbursed'].includes(loan.status) && loan.outstandingBalance > 0
      );

      if (activeLoan) {
        // Recalculate loan deduction based on updated outstanding balance
        if (activeLoan.salaryDeduction?.enabled) {
          let loanDeduction = 0;

          if (activeLoan.salaryDeduction.deductionType === 'Fixed Amount') {
            loanDeduction = parseFloat(activeLoan.salaryDeduction.fixedAmount) || 0;
          } else if (activeLoan.salaryDeduction.deductionType === 'Percentage') {
            const percentage = parseFloat(activeLoan.salaryDeduction.percentage) || 0;
            loanDeduction = (formik.values.basicSalary * percentage) / 100;
          }

          // Ensure deduction doesn't exceed outstanding balance
          loanDeduction = Math.min(loanDeduction, activeLoan.outstandingBalance);
          formik.setFieldValue('deductions.loan', loanDeduction);
        }
      } else {
        // No active loan or loan is fully paid
        formik.setFieldValue('deductions.loan', 0);
      }
    }
  }, [employeeLoans, selectedEmployee]); // eslint-disable-next-line react-hooks/exhaustive-deps

  // 🔧 AUTOMATIC ABSENT DAYS CALCULATION
  // Recalculate absent days whenever present days, total days, or leave days change
  useEffect(() => {
    const totalDays = formik.values.attendance?.totalDays || 26;
    const presentDays = formik.values.attendance?.presentDays || 0;
    const leaveDays = formik.values.leaveDeductions?.totalLeaveDays || 0;

    // Calculate absent days: Total Days - Present Days - Leave Days
    const calculatedAbsentDays = Math.max(0, totalDays - presentDays - leaveDays);

    // Update the absent days field with calculated value
    formik.setFieldValue('attendance.absentDays', calculatedAbsentDays);

    console.log(`🧮 Frontend: Auto-calculated absent days: ${totalDays} - ${presentDays} - ${leaveDays} = ${calculatedAbsentDays}`);
  }, [
    formik.values.attendance?.totalDays,
    formik.values.attendance?.presentDays,
    formik.values.leaveDeductions?.totalLeaveDays
  ]); // eslint-disable-next-line react-hooks/exhaustive-deps

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/hr/employees?limit=1000');
      setEmployees(response.data.data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchEmployeeLoans = async (employeeId) => {
    try {
      const loans = await loanService.getEmployeeLoans(employeeId);
      setEmployeeLoans(loans);
      return loans;
    } catch (error) {
      console.error('Error fetching employee loans:', error);
      setEmployeeLoans([]);
      return [];
    }
  };

  const fetchPayroll = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/payroll/${id}`);
      const payroll = response.data.data;

      // Extract month and year from payroll data
      const monthValue = payroll.month.toString().padStart(2, '0');

      formik.setValues({
        employee: payroll.employee._id,
        isManual: Boolean(payroll.isManual),
        payPeriod: {
          month: monthValue,
          year: payroll.year,
          type: 'monthly'
        },
        basicSalary: payroll.basicSalary,
        allowances: {
          conveyance: {
            isActive: payroll.allowances?.conveyance?.isActive || false,
            amount: payroll.allowances?.conveyance?.amount || payroll.conveyanceAllowance || 0
          },
          food: {
            isActive: payroll.allowances?.food?.isActive || false,
            amount: payroll.allowances?.food?.amount || 0
          },
          mobile: {
            isActive: payroll.allowances?.mobile?.isActive || false,
            amount: payroll.allowances?.mobile?.amount || 0
          },
          vehicle: {
            isActive: payroll.allowances?.vehicle?.isActive || false,
            amount: payroll.allowances?.vehicle?.amount || 0
          },
          fuel: {
            isActive: payroll.allowances?.fuel?.isActive || false,
            amount: payroll.allowances?.fuel?.amount || 0
          },
          medical: {
            isActive: payroll.allowances?.medical?.isActive || false,
            amount: payroll.allowances?.medical?.amount || payroll.medicalAllowance || 0
          },
          special: {
            isActive: payroll.allowances?.special?.isActive || false,
            amount: payroll.allowances?.special?.amount || payroll.specialAllowance || 0
          },
          other: {
            isActive: payroll.allowances?.other?.isActive || false,
            amount: payroll.allowances?.other?.amount || payroll.otherAllowance || 0
          }
        },
        overtime: {
          hours: payroll.overtimeHours || 0,
          rate: payroll.overtimeRate || 0,
          amount: payroll.overtimeAmount || 0
        },
        bonuses: {
          performance: payroll.performanceBonus || 0,
          attendance: 0,
          other: payroll.otherBonus || 0
        },
        deductions: {
          tax: payroll.incomeTax || 0,
          insurance: payroll.healthInsurance || 0,
          pension: payroll.providentFund || 0,
          eobi: payroll.eobi || 0,
          loan: 0,
          other: payroll.otherDeductions || 0
        },
        attendance: {
          totalDays: payroll.totalWorkingDays || 26,
          presentDays: payroll.presentDays || 26,
          absentDays: payroll.absentDays || 0,
          lateDays: 0,
          halfDays: 0
        },
        leaveDeductions: {
          unpaidLeave: 0,
          sickLeave: 0,
          casualLeave: 0,
          annualLeave: 0,
          otherLeave: payroll.leaveDays || 0,
          totalLeaveDays: payroll.leaveDays || 0,
          leaveDeductionAmount: 0
        },
        notes: payroll.remarks || '',
        grossSalaryBase: payroll.grossSalaryBase || 0, // Set grossSalaryBase
        houseRentAllowance: payroll.houseRentAllowance || 0, // Set houseRentAllowance
        medicalAllowance: payroll.medicalAllowance || 0, // Set medicalAllowance
        autoCalculateSalary: true // Ensure auto-calculation is true on load
      });

      setSelectedEmployee(payroll.employee);
    } catch (error) {
      console.error('Error fetching payroll:', error);
      setError('Failed to load payroll details');
    } finally {
      setLoading(false);
    }
  };

  const handleEmployeeChange = async (employeeId) => {
    const employee = employees.find(emp => emp._id === employeeId);
    setSelectedEmployee(employee);
    formik.setFieldValue('employee', employeeId);
    if (employee) {
      // Auto-calculate salary components from gross salary
      const grossSalary = employee.salary?.gross || 0;
      const basicSalary = Math.round(grossSalary * 0.6666); // 66.66% of gross
      const medicalAllowance = Math.round(grossSalary * 0.1); // 10% of gross
      const houseRentAllowance = Math.round(grossSalary * 0.2334); // 23.34% of gross (remaining)

      // Set calculated values
      formik.setFieldValue('basicSalary', basicSalary);
      formik.setFieldValue('grossSalaryBase', grossSalary); // Set grossSalaryBase
      formik.setFieldValue('houseRentAllowance', houseRentAllowance); // Set houseRentAllowance
      formik.setFieldValue('medicalAllowance', medicalAllowance); // Set medicalAllowance

      // Set allowances from employee record (only if they are active)
      formik.setFieldValue('allowances.conveyance.isActive', employee.allowances?.conveyance?.isActive || false);
      formik.setFieldValue('allowances.conveyance.amount', employee.allowances?.conveyance?.isActive ? employee.allowances.conveyance.amount : 0);

      formik.setFieldValue('allowances.food.isActive', employee.allowances?.food?.isActive || false);
      formik.setFieldValue('allowances.food.amount', employee.allowances?.food?.isActive ? employee.allowances.food.amount : 0);
      formik.setFieldValue('allowances.mobile.isActive', employee.allowances?.mobile?.isActive || false);
      formik.setFieldValue('allowances.mobile.amount', employee.allowances?.mobile?.isActive ? employee.allowances.mobile.amount : 0);

      const empAllowances = allowancesForForm(employee.allowances || {});
      formik.setFieldValue('allowances.vehicle.isActive', empAllowances.vehicle?.isActive || false);
      formik.setFieldValue('allowances.vehicle.amount', empAllowances.vehicle?.isActive ? empAllowances.vehicle.amount : 0);
      formik.setFieldValue('allowances.fuel.isActive', empAllowances.fuel?.isActive || false);
      formik.setFieldValue('allowances.fuel.amount', empAllowances.fuel?.isActive ? empAllowances.fuel.amount : 0);

      formik.setFieldValue('allowances.medical.isActive', employee.allowances?.medical?.isActive || false);
      formik.setFieldValue('allowances.medical.amount', employee.allowances?.medical?.isActive ? employee.allowances.medical.amount : medicalAllowance);

      formik.setFieldValue('allowances.special.isActive', employee.allowances?.special?.isActive || false);
      formik.setFieldValue('allowances.special.amount', employee.allowances?.special?.isActive ? employee.allowances.special.amount : 0);

      formik.setFieldValue('allowances.other.isActive', employee.allowances?.other?.isActive || false);
      formik.setFieldValue('allowances.other.amount', employee.allowances?.other?.isActive ? employee.allowances.other.amount : 0);

      // Set EOBI if employee has it active
      if (employee.eobi?.isActive) {
        formik.setFieldValue('deductions.eobi', employee.eobi?.amount || 407);
      } else {
        formik.setFieldValue('deductions.eobi', 0);
      }

      // Set Provident Fund if employee has it active (8.34% of basic salary)
      if (employee.providentFund?.isActive) {
        const providentFundAmount = Math.round((basicSalary * 8.34) / 100);
        formik.setFieldValue('deductions.providentFund', providentFundAmount);
      } else {
        formik.setFieldValue('deductions.providentFund', 0);
      }

      // Set Employee Security if employee has it active
      if (employee.employeeSecurity?.isActive && employee.employeeSecurity?.amount > 0) {
        formik.setFieldValue('deductions.employeeSecurity', Number(employee.employeeSecurity.amount));
      } else {
        formik.setFieldValue('deductions.employeeSecurity', 0);
      }

      // Fetch and set loan information
      const loans = await fetchEmployeeLoans(employeeId);
      const activeLoan = loans.find(loan =>
        ['Active', 'Disbursed'].includes(loan.status) && loan.outstandingBalance > 0
      );

      if (activeLoan) {
        // Set loan deduction based on salary deduction settings
        if (activeLoan.salaryDeduction?.enabled) {
          let loanDeduction = 0;

          if (activeLoan.salaryDeduction.deductionType === 'Fixed Amount') {
            loanDeduction = parseFloat(activeLoan.salaryDeduction.fixedAmount) || 0;
          } else if (activeLoan.salaryDeduction.deductionType === 'Percentage') {
            const percentage = parseFloat(activeLoan.salaryDeduction.percentage) || 0;
            loanDeduction = (basicSalary * percentage) / 100;
          }

          // Ensure deduction doesn't exceed outstanding balance
          loanDeduction = Math.min(loanDeduction, activeLoan.outstandingBalance);
          formik.setFieldValue('deductions.loan', loanDeduction);
        }
      } else {
        formik.setFieldValue('deductions.loan', 0);
      }
    }
  };

  const handleNext = () => {
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const calculateTotals = () => {
    const values = formik.values;

    // Ensure we have valid basic salary before calculating
    if (!values.basicSalary || values.basicSalary <= 0) {
      return {
        totalAllowances: 0,
        overtimeAmount: 0,
        totalBonuses: 0,
        totalDeductions: 0,
        grossPay: 0,
        totalEarnings: 0,
        netPay: 0,
        leaveDeductionAmount: 0,
        totalLeaveDays: 0,
        dailyRate: 0,
        autoCalculatedTax: 0
      };
    }

    // Calculate total allowances with safe defaults
    const totalAllowances =
      (values.allowances?.conveyance?.isActive ? (values.allowances.conveyance.amount || 0) : 0) +
      (values.allowances?.food?.isActive ? (values.allowances.food.amount || 0) : 0) +
      (values.allowances?.mobile?.isActive ? (values.allowances.mobile.amount || 0) : 0) +
      vehicleAllowanceAmount(values.allowances) +
      fuelAllowanceAmount(values.allowances) +
      (values.allowances?.medical?.isActive ? (values.allowances.medical.amount || 0) : 0) +
      (values.allowances?.special?.isActive ? (values.allowances.special.amount || 0) : 0) +
      (values.allowances?.other?.isActive ? (values.allowances.other.amount || 0) : 0);

    // Calculate overtime amount with safe defaults
    const overtimeAmount = (values.overtime?.hours || 0) * (values.overtime?.rate || 0);

    // Calculate total bonuses with safe defaults
    const totalBonuses =
      (values.bonuses?.performance || 0) +
      (values.bonuses?.attendance || 0) +
      (values.bonuses?.other || 0);

    // Calculate leave deductions with safe defaults
    const workingDaysPerMonth = 26; // Standard working days per month (excluding Sundays)
    const dailyRate = values.basicSalary / workingDaysPerMonth;

    // Ensure leaveDeductions exists with default values
    const leaveDeductions = values.leaveDeductions || {
      unpaidLeave: 0,
      sickLeave: 0,
      casualLeave: 0,
      annualLeave: 0,
      otherLeave: 0
    };

    const leaveDeductionAmount = (leaveDeductions.unpaidLeave + leaveDeductions.otherLeave) * dailyRate;
    const totalLeaveDays = leaveDeductions.unpaidLeave + leaveDeductions.sickLeave +
      leaveDeductions.casualLeave + leaveDeductions.annualLeave +
      leaveDeductions.otherLeave;

    // Use tax from form state (which can be user-edited)
    const currentTax = Number(values.deductions?.incomeTax) || 0;

    // Calculate total deductions (excluding Provident Fund for now - Coming Soon)
    const totalDeductions =
      currentTax + // Use current tax (either auto-calculated or manually edited)
      (values.deductions?.insurance || 0) +
      (values.deductions?.pension || 0) +
      (values.deductions?.eobi || 0) +
      (values.deductions?.employeeSecurity || 0) +
      // (values.deductions?.providentFund || 0) + // Excluded - Coming Soon
      (values.deductions?.loan || 0) +
      (values.deductions?.other || 0) +
      leaveDeductionAmount;

    // Calculate additional allowances (excluding medical, which is part of gross base)
    const additionalAllowances = 
      (values.allowances?.conveyance?.isActive ? (values.allowances.conveyance.amount || 0) : 0) +
      (values.allowances?.food?.isActive ? (values.allowances.food.amount || 0) : 0) +
      (values.allowances?.mobile?.isActive ? (values.allowances.mobile.amount || 0) : 0) +
      vehicleAllowanceAmount(values.allowances) +
      fuelAllowanceAmount(values.allowances) +
      (values.allowances?.special?.isActive ? (values.allowances.special.amount || 0) : 0) +
      (values.allowances?.other?.isActive ? (values.allowances.other.amount || 0) : 0);

    // Calculate Gross Salary dynamically from its components
    const currentGrossBase = (Number(values.basicSalary) || 0) + (Number(values.houseRentAllowance) || 0) + (Number(values.medicalAllowance) || 0);

    // grossPay is the total sum of everything
    const grossPay = currentGrossBase + additionalAllowances + overtimeAmount + totalBonuses;

    // Calculate Total Earnings
    const totalEarnings = grossPay;

    // Calculate net pay (after all deductions including tax)
    const netPay = totalEarnings - totalDeductions;

    const totals = {
      totalAllowances: totalAllowances || 0,
      overtimeAmount: overtimeAmount || 0,
      totalBonuses: totalBonuses || 0,
      totalDeductions: totalDeductions || 0,
      grossPay: grossPay || 0,
      totalEarnings: totalEarnings || 0,
      netPay: netPay || 0,
      leaveDeductionAmount: leaveDeductionAmount || 0,
      totalLeaveDays: totalLeaveDays || 0,
      dailyRate: dailyRate || 0,
      autoCalculatedTax: currentTax || 0
    };

    return totals;
  };

  const formatCurrency = formatPKR;

  // Format employee ID to 5 digits with leading zeros
  const formatEmployeeId = (employeeId) => {
    if (!employeeId) return '';
    return employeeId.toString().padStart(5, '0');
  };

  // Add tax calculation display
  const calculateTaxInfo = async (basicSalary, allowances) => {
    if (!basicSalary) return null;

    // Calculate Total Earnings (same as September employees)
    const grossSalaryBase = formik.values.grossSalaryBase || 0;
    const additionalAllowances =
      (allowances?.conveyance?.isActive ? allowances.conveyance.amount : 0) +
      (allowances?.food?.isActive ? allowances.food.amount : 0) +
      (allowances?.mobile?.isActive ? allowances.mobile.amount : 0) +
      vehicleAllowanceAmount(allowances) +
      fuelAllowanceAmount(allowances) +
      (allowances?.special?.isActive ? allowances.special.amount : 0) +
      (allowances?.other?.isActive ? allowances.other.amount : 0);

    const totalEarnings = grossSalaryBase + additionalAllowances;

    // Medical allowance is 10% of total earnings (tax-exempt)
    const medicalAllowanceForTax = Math.round(totalEarnings * 0.10);

    // Taxable Income = Total Earnings - Medical Allowance
    const taxableIncome = totalEarnings - medicalAllowanceForTax;

    const annualTaxableIncome = taxableIncome * 12;

    try {
      // Use the new database-driven tax calculation
      const response = await api.post('/hr/fbr-tax-slabs/calculate', {
        annualIncome: annualTaxableIncome
      });

      const result = response.data.data;

      return {
        monthlyTax: result.monthlyTax,
        annualTaxableIncome: Math.round(annualTaxableIncome),
        taxSlab: result.taxInfo.slab,
        taxRate: result.taxInfo.rate,
        taxableIncome: Math.round(taxableIncome),
        totalEarnings: totalEarnings,
        medicalAllowanceForTax: medicalAllowanceForTax
      };
    } catch (error) {
      console.error('Error calculating tax:', error);
      return null;
    }
  };

  // Update tax info when salary changes
  useEffect(() => {
    const updateTaxInfo = async () => {
      if (formik.values.basicSalary || formik.values.grossSalaryBase) {
        const taxInfo = await calculateTaxInfo(
          formik.values.basicSalary,
          formik.values.allowances
        );
        setTaxInfo(taxInfo);

        // Auto-update income tax field
        if (taxInfo) {
          formik.setFieldValue('deductions.incomeTax', taxInfo.monthlyTax);
        }
      }
    };

    updateTaxInfo();
  }, [formik.values.basicSalary, formik.values.grossSalaryBase, formik.values.allowances]);

  // Helper function to safely render populated object properties
  const safeRenderText = (value) => {
    if (typeof value === 'object' && value !== null) {
      return value.name || value.title || value.code || 'N/A';
    }
    return value || 'N/A';
  };

  const handleGrossSalaryChange = (e) => {
    const value = e.target.value;
    formik.setFieldValue('grossSalaryBase', value);
    
    // Auto-calculate components if manual override is not checked
    if (formik.values.autoCalculateSalary !== false) {
      const grossSalary = parseFloat(value) || 0;
      const basicSalary = Math.round(grossSalary * 0.6666);
      const medicalAllowance = Math.round(grossSalary * 0.1);
      const houseRentAllowance = Math.round(grossSalary * 0.2334);
      
      formik.setFieldValue('basicSalary', basicSalary);
      formik.setFieldValue('medicalAllowance', medicalAllowance);
      formik.setFieldValue('houseRentAllowance', houseRentAllowance);
    }
  };

  const isManualMode = !id || formik.values.isManual;

  const renderStepContent = (step) => {
    const totals = calculateTotals();

    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Employee</InputLabel>
                <Select
                  name="employee"
                  value={formik.values.employee}
                  onChange={(e) => {
                    handleEmployeeChange(e.target.value);
                    formik.setFieldValue('employee', e.target.value);
                    formik.setFieldTouched('employee', true);
                  }}
                  label="Employee"
                  error={formik.touched.employee && Boolean(formik.errors.employee)}
                >
                  {employees.map((employee) => (
                    <MenuItem key={employee._id} value={employee._id}>
                      {employee.firstName} {employee.lastName} - {formatEmployeeId(employee.employeeId)}
                    </MenuItem>
                  ))}
                </Select>
                {formik.touched.employee && formik.errors.employee && (
                  <Typography color="error" variant="caption">
                    {formik.errors.employee}
                  </Typography>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Pay Period Type</InputLabel>
                <Select
                  name="payPeriod.type"
                  value={formik.values.payPeriod.type}
                  onChange={formik.handleChange}
                  label="Pay Period Type"
                >
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="bi-weekly">Bi-weekly</MenuItem>
                  <MenuItem value="monthly">Monthly</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Month</InputLabel>
                <Select
                  name="payPeriod.month"
                  value={formik.values.payPeriod.month}
                  onChange={formik.handleChange}
                  label="Month"
                  error={formik.touched.payPeriod?.month && Boolean(formik.errors.payPeriod?.month)}
                >
                  {months.map((month) => (
                    <MenuItem key={month.value} value={month.value}>
                      {month.label}
                    </MenuItem>
                  ))}
                </Select>
                {formik.touched.payPeriod?.month && formik.errors.payPeriod?.month && (
                  <Typography color="error" variant="caption">
                    {formik.errors.payPeriod?.month}
                  </Typography>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                name="payPeriod.year"
                label="Year"
                value={formik.values.payPeriod.year}
                onChange={formik.handleChange}
                error={formik.touched.payPeriod?.year && Boolean(formik.errors.payPeriod?.year)}
                helperText={formik.touched.payPeriod?.year && formik.errors.payPeriod?.year}
                inputProps={{ min: 2020, max: 2030 }}
              />
            </Grid>
            {selectedEmployee && (
              <Grid item xs={12}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Employee Information
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Name: {selectedEmployee.firstName} {selectedEmployee.lastName}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Employee ID: {formatEmployeeId(selectedEmployee.employeeId)}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Company: {safeRenderText(selectedEmployee.placementCompany?.name)}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Department: {safeRenderText(selectedEmployee.placementDepartment?.name)}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <Typography variant="body2" color="textSecondary">
                          Designation: {safeRenderText(selectedEmployee.placementDesignation?.title)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            )}
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            {/* Salary Structure Section */}
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom color="primary">
                    💰 Salary Structure (Auto-Calculated)
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                    Based on employee's gross salary, automatically distributed as per company policy
                  </Typography>

                  <Grid container spacing={2}>
                    {/* Gross Salary (Base) - Read Only */}
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        type="number"
                        name="grossSalaryBase"
                        label="Gross Salary (Base)"
                        value={formik.values.grossSalaryBase || ''}
                        onChange={handleGrossSalaryChange}
                        InputProps={{
                          readOnly: !isManualMode,
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                        }}
                        helperText="Basic + Medical + House Rent (Auto-calculated)"
                        sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                      />
                    </Grid>

                    {/* Basic Salary (66.66%) - Read Only */}
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        type="number"
                        name="basicSalary"
                        label="Basic Salary (66.66%)"
                        value={formik.values.basicSalary || ''}
                        onChange={formik.handleChange}
                        InputProps={{
                          readOnly: !isManualMode,
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                        }}
                        helperText="66.66% of Gross Salary (Auto-calculated)"
                        sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                      />
                    </Grid>

                    {/* House Rent Allowance (23.34%) - Read Only */}
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        type="number"
                        name="houseRentAllowance"
                        label="House Rent Allowance (23.34%)"
                        value={formik.values.houseRentAllowance || ''}
                        onChange={formik.handleChange}
                        InputProps={{
                          readOnly: !isManualMode,
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                        }}
                        helperText="23.34% of Gross Salary (Auto-calculated)"
                        sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                      />
                    </Grid>

                    {/* Medical Allowance (10%) - Read Only */}
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        type="number"
                        name="medicalAllowance"
                        label="Medical Allowance (10%)"
                        value={formik.values.medicalAllowance || ''}
                        onChange={formik.handleChange}
                        InputProps={{
                          readOnly: !isManualMode,
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                        }}
                        helperText="10% of Gross Salary (Auto-calculated)"
                        sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                      />
                    </Grid>
                  </Grid>

                  {/* Manual Override Option */}
                  <Box sx={{ mt: 2, p: 2, bgcolor: '#fff3e0', borderRadius: 1, border: '1px solid #ffb74d' }}>
                    <Typography variant="body2" color="warning.dark" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>⚠️</span>
                      <strong>Manual Override:</strong> If you need to adjust individual components, uncheck the auto-calculation below
                    </Typography>
                    <Box sx={{ mt: 1 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={formik.values.autoCalculateSalary || true}
                          onChange={(e) => formik.setFieldValue('autoCalculateSalary', e.target.checked)}
                          style={{ margin: 0 }}
                        />
                        <Typography variant="body2">Auto-calculate salary structure</Typography>
                      </label>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Additional Allowances Section */}
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Additional Allowances</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                    These allowances are added to Gross Salary (Base) to calculate Total Earnings
                  </Typography>
                  <Grid container spacing={2}>
                    {/* Conveyance Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.conveyance?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.conveyance.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Conveyance Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.conveyance?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.conveyance.amount"
                            label="Amount"
                            value={formik.values.allowances?.conveyance?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                            helperText="Enter exact amount (no rounding)"
                          />
                        )}
                      </Box>
                    </Grid>

                    {/* Food Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.food?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.food.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Food Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.food?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.food.amount"
                            label="Amount"
                            value={formik.values.allowances?.food?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                          />
                        )}
                      </Box>
                    </Grid>

                    {/* Mobile Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.mobile?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.mobile.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Mobile Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.mobile?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.mobile.amount"
                            label="Amount"
                            value={formik.values.allowances?.mobile?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                          />
                        )}
                      </Box>
                    </Grid>

                    {/* Vehicle Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.vehicle?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.vehicle.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Vehicle Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.vehicle?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.vehicle.amount"
                            label="Amount"
                            value={formik.values.allowances?.vehicle?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                          />
                        )}
                      </Box>
                    </Grid>

                    {/* Fuel Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.fuel?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.fuel.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Fuel Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.fuel?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.fuel.amount"
                            label="Amount"
                            value={formik.values.allowances?.fuel?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                          />
                        )}
                      </Box>
                    </Grid>

                    {/* Medical Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.medical?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.medical.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Medical Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.medical?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.medical.amount"
                            label="Amount"
                            value={formik.values.allowances?.medical?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                          />
                        )}
                      </Box>
                    </Grid>

                    {/* Special Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.special?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.special.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Special Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.special?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.special.amount"
                            label="Amount"
                            value={formik.values.allowances?.special?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                          />
                        )}
                      </Box>
                    </Grid>

                    {/* Other Allowance */}
                    <Grid item xs={12} sm={6} md={4}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <input
                            type="checkbox"
                            checked={formik.values.allowances?.other?.isActive || false}
                            onChange={(e) => formik.setFieldValue('allowances.other.isActive', e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          <Typography variant="subtitle2">Other Allowance</Typography>
                        </Box>
                        {formik.values.allowances?.other?.isActive && (
                          <TextField
                            fullWidth
                            type="number"
                            name="allowances.other.amount"
                            label="Amount"
                            value={formik.values.allowances?.other?.amount || ''}
                            onChange={formik.handleChange}
                            inputProps={{
                              step: "1",
                              min: "0"
                            }}
                            InputProps={{
                              startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                            }}
                          />
                        )}
                      </Box>
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            </Grid>
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Bonuses</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="bonuses.performance"
                        label="Performance Bonus"
                        value={formik.values.bonuses.performance}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="bonuses.attendance"
                        label="Attendance Bonus"
                        value={formik.values.bonuses.attendance}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="bonuses.other"
                        label="Other Bonus"
                        value={formik.values.bonuses.other}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            </Grid>
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Overtime</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="overtime.hours"
                        label="Overtime Hours"
                        value={formik.values.overtime.hours}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="overtime.rate"
                        label="Overtime Rate per Hour"
                        value={formik.values.overtime.rate}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        label="Overtime Amount"
                        value={formatCurrency(totals.overtimeAmount)}
                        InputProps={{ readOnly: true }}
                      />
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            </Grid>
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Deductions</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.incomeTax"
                        label="Income Tax"
                        value={formik.values.deductions.incomeTax || 0}
                        onChange={formik.handleChange}
                        helperText="Auto-calculated based on salary and allowances"
                        InputProps={{
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.tax"
                        label="Tax"
                        value={formik.values.deductions.tax}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.insurance"
                        label="Insurance"
                        value={formik.values.deductions.insurance}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.pension"
                        label="Pension"
                        value={formik.values.deductions.pension}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.eobi"
                        label="EOBI"
                        value={formik.values.deductions.eobi}
                        onChange={formik.handleChange}
                        InputProps={{
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                        }}
                        helperText="Pakistan EOBI"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.providentFund"
                        label={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            Provident Fund
                            <Chip
                              label="Coming Soon"
                              size="small"
                              color="warning"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem', height: 20 }}
                            />
                          </Box>
                        }
                        value={formik.values.deductions.providentFund}
                        onChange={formik.handleChange}
                        InputProps={{
                          readOnly: true,
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>,
                          sx: {
                            bgcolor: 'grey.100',
                            '& .MuiInputBase-input': { color: 'text.secondary' }
                          }
                        }}
                        helperText="Provident Fund (8.34% of basic salary) - Not yet active in calculations"
                        sx={{
                          '& .MuiInputLabel-root': { color: 'text.secondary' },
                          '& .MuiOutlinedInput-root': {
                            borderColor: 'warning.main',
                            '&:hover fieldset': { borderColor: 'warning.main' }
                          }
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.employeeSecurity"
                        label="Employee Security"
                        value={formik.values.deductions.employeeSecurity || 0}
                        onChange={formik.handleChange}
                        InputProps={{
                          startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                        }}
                        helperText="Employee Security Deduction"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.loan"
                        label="Loan"
                        value={formik.values.deductions.loan}
                        onChange={formik.handleChange}
                        helperText={
                          employeeLoans.length > 0
                            ? `Active Loan: ${employeeLoans.find(l => ['Active', 'Disbursed'].includes(l.status))?.loanType || 'N/A'} | Outstanding: ${formatPKR(employeeLoans.find(l => ['Active', 'Disbursed'].includes(l.status))?.outstandingBalance || 0)}`
                            : 'No active loans'
                        }
                        disabled={employeeLoans.length === 0}
                        InputProps={{
                          endAdornment: employeeLoans.length > 0 && (
                            <Chip
                              size="small"
                              label={employeeLoans.find(l => ['Active', 'Disbursed'].includes(l.status))?.outstandingBalance > 0 ? 'Active' : 'Paid'}
                              color={employeeLoans.find(l => ['Active', 'Disbursed'].includes(l.status))?.outstandingBalance > 0 ? 'warning' : 'success'}
                            />
                          )
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="deductions.other"
                        label="Other Deduction"
                        value={formik.values.deductions.other}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            </Grid>
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Attendance</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="attendance.totalDays"
                        label="Total Days"
                        value={formik.values.attendance.totalDays}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="attendance.presentDays"
                        label="Present Days"
                        value={formik.values.attendance.presentDays}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="attendance.absentDays"
                        label="Absent Days"
                        value={formik.values.attendance.absentDays}
                        onChange={formik.handleChange}
                        InputProps={{
                          readOnly: true,
                        }}
                        helperText="Calculated automatically: Total Days - Present Days - Leave Days"
                        sx={{
                          '& .MuiInputBase-input.Mui-readOnly': {
                            backgroundColor: '#f5f5f5',
                            cursor: 'not-allowed'
                          }
                        }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="attendance.lateDays"
                        label="Late Days"
                        value={formik.values.attendance.lateDays}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="attendance.halfDays"
                        label="Half Days"
                        value={formik.values.attendance.halfDays}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            </Grid>
            <Grid item xs={12}>
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Leave Deductions</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="leaveDeductions.unpaidLeave"
                        label="Unpaid Leave (Days)"
                        value={formik.values.leaveDeductions?.unpaidLeave || 0}
                        onChange={formik.handleChange}
                        helperText="Deducted from salary"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="leaveDeductions.sickLeave"
                        label="Sick Leave (Days)"
                        value={formik.values.leaveDeductions?.sickLeave || 0}
                        onChange={formik.handleChange}
                        helperText="Usually paid"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="leaveDeductions.casualLeave"
                        label="Casual Leave (Days)"
                        value={formik.values.leaveDeductions?.casualLeave || 0}
                        onChange={formik.handleChange}
                        helperText="Usually paid"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="leaveDeductions.annualLeave"
                        label="Annual Leave (Days)"
                        value={formik.values.leaveDeductions?.annualLeave || 0}
                        onChange={formik.handleChange}
                        helperText="Usually paid"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        type="number"
                        name="leaveDeductions.otherLeave"
                        label="Other Leave (Days)"
                        value={formik.values.leaveDeductions?.otherLeave || 0}
                        onChange={formik.handleChange}
                        helperText="Deducted from salary"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <TextField
                        fullWidth
                        label="Total Leave Days"
                        value={(formik.values.leaveDeductions?.unpaidLeave || 0) +
                          (formik.values.leaveDeductions?.sickLeave || 0) +
                          (formik.values.leaveDeductions?.casualLeave || 0) +
                          (formik.values.leaveDeductions?.annualLeave || 0) +
                          (formik.values.leaveDeductions?.otherLeave || 0)}
                        InputProps={{ readOnly: true }}
                        helperText="Auto-calculated"
                      />
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            </Grid>
          </Grid>
        );

      case 3:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Payroll Summary
                  </Typography>

                  {/* Pay Period Information */}
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <Box sx={{ mb: 2, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                        <Typography variant="subtitle1" color="primary" gutterBottom>
                          Pay Period Information
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          <strong>Month:</strong> {months.find(m => m.value === formik.values.payPeriod.month)?.label || 'Not selected'}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          <strong>Year:</strong> {formik.values.payPeriod.year || 'Not selected'}
                        </Typography>
                        <Typography variant="body2" color="textSecondary">
                          <strong>Type:</strong> {formik.values.payPeriod.type.charAt(0).toUpperCase() + formik.values.payPeriod.type.slice(1)}
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>

                  {/* Earnings Breakdown */}
                  <Grid container spacing={3} sx={{ mb: 3 }}>
                    <Grid item xs={12} md={6}>
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                          <Typography variant="h6" color="primary" gutterBottom>
                            📈 Earnings Breakdown
                          </Typography>

                          {/* Gross Salary (Base) */}
                          <Box sx={{ mb: 2, p: 2, bgcolor: '#e3f2fd', borderRadius: 1 }}>
                            <Typography variant="subtitle2" color="primary" gutterBottom>
                              Gross Salary (Base)
                            </Typography>
                            <Typography variant="h6" color="primary">
                              {formatPKR(formik.values.grossSalaryBase || 0)}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              66.66% Basic + 10% Medical + 23.34% House Rent
                            </Typography>
                          </Box>

                          {/* Basic Salary */}
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Basic Salary (66.66%):</strong> {formatPKR(formik.values.basicSalary || 0)}
                          </Typography>

                          {/* House Rent Allowance */}
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>House Rent Allowance (23.34%):</strong> {formatPKR(formik.values.houseRentAllowance || 0)}
                          </Typography>

                          {/* Medical Allowance */}
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Medical Allowance (10%):</strong> {formatPKR(formik.values.medicalAllowance || 0)}
                          </Typography>

                          <Divider sx={{ my: 2 }} />

                          {/* Additional Allowances */}
                          <Typography variant="subtitle2" color="primary" gutterBottom>
                            Additional Allowances
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Conveyance:</strong> {formatPKR(formik.values.allowances?.conveyance?.isActive ? formik.values.allowances.conveyance.amount : 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Food:</strong> {formatPKR(formik.values.allowances?.food?.isActive ? formik.values.allowances.food.amount : 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Mobile:</strong> {formatPKR(formik.values.allowances?.mobile?.isActive ? formik.values.allowances.mobile.amount : 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Vehicle:</strong> {formatPKR(formik.values.allowances?.vehicle?.isActive ? formik.values.allowances.vehicle.amount : 0)}
                            {' · '}
                            <strong>Fuel:</strong> {formatPKR(formik.values.allowances?.fuel?.isActive ? formik.values.allowances.fuel.amount : 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Special:</strong> {formatPKR(formik.values.allowances?.special?.isActive ? formik.values.allowances.special.amount : 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Other:</strong> {formatPKR(formik.values.allowances?.other?.isActive ? formik.values.allowances.other.amount : 0)}
                          </Typography>

                          <Divider sx={{ my: 2 }} />

                          {/* Other Earnings */}
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Overtime:</strong> {formatPKR(formik.values.overtime?.amount || 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Performance Bonus:</strong> {formatPKR(formik.values.bonuses?.performance || 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Other Bonus:</strong> {formatPKR(formik.values.bonuses?.other || 0)}
                          </Typography>

                          <Divider sx={{ my: 2 }} />

                          {/* Total Earnings */}
                          <Box sx={{ p: 2, bgcolor: 'primary.main', color: 'white', borderRadius: 1 }}>
                            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                              💰 Total Earnings
                            </Typography>
                            <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                              {formatPKR(totals.totalEarnings || totals.grossPay)}
                            </Typography>
                            <Typography variant="caption">
                              Gross Salary (Base) + Additional Allowances + Overtime + Bonuses
                            </Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>

                    {/* Deductions Breakdown */}
                    <Grid item xs={12} md={6}>
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                          <Typography variant="h6" color="error" gutterBottom>
                            💸 Deductions Breakdown
                          </Typography>

                          {/* Tax Calculation */}
                          <Box sx={{ mb: 2, p: 2, bgcolor: '#ffebee', borderRadius: 1 }}>
                            <Typography variant="subtitle2" color="error" gutterBottom>
                              Income Tax
                            </Typography>
                            <Typography variant="h6" color="error">
                              {formatPKR(totals.autoCalculatedTax || 0)}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              Calculated on (Total Earnings - 10% Medical Allowance) per FBR 2026-2027
                            </Typography>
                          </Box>

                          {/* Other Deductions */}
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Health Insurance:</strong> {formatPKR(formik.values.deductions.insurance || 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>EOBI:</strong> {formatPKR(formik.values.deductions.eobi || 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Loan Deduction:</strong> {formatPKR(formik.values.deductions.loan || 0)}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Other Deductions:</strong> {formatPKR(formik.values.deductions.other || 0)}
                          </Typography>

                          {/* Provident Fund */}
                          <Box sx={{ mb: 2, p: 2, bgcolor: '#fff3e0', borderRadius: 1, border: '1px solid #ffb74d' }}>
                            <Typography variant="subtitle2" color="warning.dark" gutterBottom>
                              Provident Fund
                            </Typography>
                            <Typography variant="h6" color="warning.dark">
                              {formatPKR(formik.values.deductions.providentFund || 0)}
                            </Typography>
                            <Typography variant="caption" color="warning.dark">
                              8.34% of Basic Salary - Not included in total deductions (Coming Soon)
                            </Typography>
                          </Box>

                          {/* Leave Deductions */}
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Leave Deduction:</strong> {formatPKR(totals.leaveDeductionAmount || 0)}
                          </Typography>

                          <Divider sx={{ my: 2 }} />

                          {/* Total Deductions */}
                          <Box sx={{ p: 2, bgcolor: 'error.main', color: 'white', borderRadius: 1 }}>
                            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                              💸 Total Deductions
                            </Typography>
                            <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                              {formatPKR(totals.totalDeductions || 0)}
                            </Typography>
                            <Typography variant="caption">
                              Tax + Insurance + EOBI + Loan + Other + Leave (Excluding PF)
                            </Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  {/* Net Salary Display */}
                  <Grid container spacing={3} sx={{ mb: 3 }}>
                    {/* Net Salary WITH Deductions */}
                    <Grid item xs={12} md={6}>
                      <Card sx={{
                        bgcolor: 'primary.main',
                        color: 'white',
                        position: 'relative',
                        overflow: 'hidden',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          width: '100px',
                          height: '100px',
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: '50%',
                          transform: 'translate(30px, -30px)'
                        }
                      }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                          <Typography variant="h6" sx={{ mb: 2, opacity: 0.9 }}>
                            💰 Net Salary (With Deductions)
                          </Typography>
                          <Typography variant="h3" sx={{ fontWeight: 'bold', mb: 1 }}>
                            {formatPKR(totals.netPay)}
                          </Typography>
                          <Typography variant="body2" sx={{ opacity: 0.8 }}>
                            Take-Home Amount
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>

                    {/* Net Salary WITHOUT PF & EOBI */}
                    <Grid item xs={12} md={6}>
                      <Card sx={{
                        bgcolor: 'success.main',
                        color: 'white',
                        position: 'relative',
                        overflow: 'hidden',
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          width: '100px',
                          height: '100px',
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: '50%',
                          transform: 'translate(30px, -30px)'
                        }
                      }}>
                        <CardContent sx={{ textAlign: 'center', py: 4 }}>
                          <Typography variant="h6" sx={{ mb: 2, opacity: 0.9 }}>
                            💰 Net Salary (Without PF & EOBI)
                          </Typography>
                          <Typography variant="h3" sx={{ fontWeight: 'bold', mb: 1 }}>
                            {formatPKR((totals.totalEarnings || totals.grossPay) - (totals.totalDeductions - (formik.values.deductions.eobi || 0)))}
                          </Typography>
                          <Typography variant="body2" sx={{ opacity: 0.8 }}>
                            Excluding PF & EOBI Deductions
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  {/* Tax Calculation Details */}
                  <Grid item xs={12}>
                    <Card variant="outlined" sx={{ bgcolor: '#f8f9fa' }}>
                      <CardContent>
                        <Typography variant="h6" gutterBottom color="primary">
                          🧮 Pakistan FBR Tax Calculation (FY 2026-27)
                        </Typography>
                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Total Earnings:</strong> {formatPKR(totals.totalEarnings || totals.grossPay)}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Medical Allowance (10%):</strong> {formatPKR(Math.round((totals.totalEarnings || totals.grossPay) * 0.1))} (tax-exempt)
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Taxable Income (Monthly):</strong> {formatPKR((totals.totalEarnings || totals.grossPay) - Math.round((totals.totalEarnings || totals.grossPay) * 0.1))}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Taxable Income (Annual):</strong> {formatPKR(((totals.totalEarnings || totals.grossPay) - Math.round((totals.totalEarnings || totals.grossPay) * 0.1)) * 12)}
                            </Typography>
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Tax Slab:</strong> Based on annual taxable income
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Tax Rate:</strong> Per FBR 2026-2027 rules
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Monthly Tax:</strong> {formatPKR(totals.autoCalculatedTax || 0)}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                              <strong>Annual Tax:</strong> {formatPKR((totals.autoCalculatedTax || 0) * 12)}
                            </Typography>
                          </Grid>
                        </Grid>
                        <Box sx={{ mt: 2, p: 2, bgcolor: '#e3f2fd', borderRadius: 1 }}>
                          <Typography variant="body2" color="primary">
                            <strong>Note:</strong> Tax is calculated on Total Gross Amount (Basic + All Allowances) minus 10% Medical Allowance (tax-exempt)
                          </Typography>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        );

      default:
        return null;
    }
  };

  if (loading && id) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Edit Payroll
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <form onSubmit={(e) => {
          console.log('Form submit event triggered');
          console.log('Formik errors:', formik.errors);
          console.log('Formik touched:', formik.touched);
          console.log('Formik isValid:', formik.isValid);
          formik.handleSubmit(e);
        }}>
          {renderStepContent(activeStep)}

          {/* Tax Calculation Information */}
          {taxInfo && (
            <Card sx={{ mb: 3, bgcolor: '#f8f9fa' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ color: '#1976d2', display: 'flex', alignItems: 'center' }}>
                  <CalculateIcon sx={{ mr: 1 }} />
                  Pakistan FBR Tax Calculation (FY 2026-27)
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Taxable Income (Monthly):</strong> Rs {taxInfo.taxableIncome.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Taxable Income (Annual):</strong> Rs {taxInfo.annualTaxableIncome.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Tax Slab:</strong> {taxInfo.taxSlab}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Tax Rate:</strong> {taxInfo.taxRate}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Monthly Tax:</strong> Rs {taxInfo.monthlyTax.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Annual Tax:</strong> Rs {(taxInfo.monthlyTax * 12).toLocaleString()}
                    </Typography>
                  </Grid>
                </Grid>
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    <strong>Note:</strong> Tax is calculated on Total Gross Amount (Basic + All Allowances) minus 10% Medical Allowance (tax-exempt)
                  </Typography>
                </Alert>
              </CardContent>
            </Card>
          )}

          {/* Pakistan FBR Tax Calculation Display */}
          {taxInfo && (
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ bgcolor: '#f8f9fa' }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    🧮 Pakistan FBR Tax Calculation (FY 2026-27)
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Total Earnings:</strong> {formatPKR(taxInfo.totalEarnings || 0)}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Medical Allowance (10%):</strong> {formatPKR(taxInfo.medicalAllowanceForTax || 0)} (tax-exempt)
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Taxable Income (Monthly):</strong> {formatPKR(taxInfo.taxableIncome || 0)}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Taxable Income (Annual):</strong> {formatPKR(taxInfo.annualTaxableIncome || 0)}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Tax Slab:</strong> {taxInfo.taxSlab || 'N/A'}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Tax Rate:</strong> {taxInfo.taxRate || 'N/A'}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Monthly Tax:</strong> {formatPKR(taxInfo.monthlyTax || 0)}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Annual Tax:</strong> {formatPKR((taxInfo.monthlyTax || 0) * 12)}
                      </Typography>
                    </Grid>
                  </Grid>
                  <Box sx={{ mt: 2, p: 2, bgcolor: '#e3f2fd', borderRadius: 1 }}>
                    <Typography variant="body2" color="primary">
                      <strong>Note:</strong> Tax is calculated on Total Gross Amount (Basic + All Allowances) minus 10% Medical Allowance (tax-exempt)
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
            <Button
              disabled={activeStep === 0}
              onClick={handleBack}
              startIcon={<ArrowBackIcon />}
            >
              Back
            </Button>
            <Box>
              {activeStep === steps.length - 1 ? (
                <>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      console.log('Manual form submission test');
                      console.log('Form values:', formik.values);
                      console.log('Form errors:', formik.errors);
                      console.log('Form touched:', formik.touched);
                      formik.handleSubmit();
                    }}
                    sx={{ mr: 2 }}
                  >
                    Test Submit
                  </Button>
                  <Button
                    variant="contained"
                    type="submit"
                    disabled={loading}
                    startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
                  >
                    {loading ? 'Saving...' : 'Save Payroll'}
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  onClick={handleNext}
                  startIcon={<ArrowForwardIcon />}
                >
                  Next
                </Button>
              )}
            </Box>
          </Box>
        </form>
      </Paper>
    </Box>
  );
};

export default PayrollForm; 