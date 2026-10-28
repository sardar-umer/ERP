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
  Snackbar,
  CircularProgress,
  Chip,
  FormHelperText,
  InputAdornment
} from '@mui/material';
import {
  Save as SaveIcon,
  ArrowBack as BackIcon,
  ArrowForward as NextIcon,
  Person as PersonIcon,
  Payment as PaymentIcon,
  Description as DescriptionIcon,
  CheckCircle as CheckIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import finalSettlementService from '../../services/finalSettlementService';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import {
  getCalendarDaysInMonth,
  resolveSettlementRateDate,
  getSettlementDailyRateRounded,
  getSettlementActualSalary,
  getSettlementShortfallDeduction,
  prorateSettlementAmount
} from '../../utils/finalSettlementDays';
import { PageLoading, LoadingSpinner } from '../../components/LoadingSpinner';

const steps = [
  'Employee & Basic Info',
  'Settlement Details',
  'Salary & Calculations',
  'Payment & Documents',
  'Review & Submit'
];

const FinalSettlementForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeLoans, setEmployeeLoans] = useState([]);
  const [loansLoading, setLoansLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  // Filter employees based on search term
  const filteredEmployees = employees.filter((employee) => {
    if (!employeeSearch) return true;

    const searchTerm = employeeSearch.toLowerCase();
    const employeeName = employee.fullName ||
      `${employee.firstName || ''} ${employee.lastName || ''}`.trim() ||
      'Unknown';
    const departmentName = typeof employee.placementDepartment === 'object' ?
      (employee.placementDepartment?.name || employee.placementDepartment?.title || 'Unknown') :
      typeof employee.department === 'object' ?
        (employee.department?.name || employee.department?.title || 'Unknown') :
        (employee.placementDepartment || employee.department || 'Unknown');

    return (
      employee.employeeId?.toLowerCase().includes(searchTerm) ||
      employeeName.toLowerCase().includes(searchTerm) ||
      departmentName.toLowerCase().includes(searchTerm) ||
      employee.email?.toLowerCase().includes(searchTerm) ||
      employee.phone?.includes(searchTerm)
    );
  });

  const parseAmount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : 0;
  };

  const computeSettlementTotals = (values) => {
    const e = values.earnings || {};
    const d = values.deductions || {};
    const totalEarnings =
      parseAmount(e.basicSalary) +
      parseAmount(e.houseRent) +
      parseAmount(e.medicalAllowance) +
      parseAmount(e.transportAllowance) +
      parseAmount(e.foodAllowance) +
      parseAmount(e.mobileAllowance) +
      parseAmount(e.vehicleAllowance) +
      parseAmount(e.fuelAllowance) +
      parseAmount(e.specialAllowance) +
      parseAmount(e.otherAllowances) +
      parseAmount(e.overtime) +
      parseAmount(e.bonus) +
      parseAmount(e.gratuity) +
      parseAmount(e.leaveEncashment) +
      parseAmount(e.noticePay) +
      parseAmount(e.otherEarnings);
    const totalDeductions =
      parseAmount(d.noticePeriodDeduction) +
      parseAmount(d.loanDeductions) +
      parseAmount(d.advanceDeductions) +
      parseAmount(d.taxDeductions) +
      parseAmount(d.healthInsurance) +
      parseAmount(d.providentFund) +
      parseAmount(d.security) +
      parseAmount(d.pension) +
      parseAmount(d.otherDeductions);

    return {
      totalEarnings,
      totalDeductions,
      grossSettlementAmount: totalEarnings,
      netSettlementAmount: Math.max(0, totalEarnings - totalDeductions)
    };
  };

  const buildSettlementPayload = (values, loans, shortfallDays) => {
    const e = values.earnings || {};
    const d = values.deductions || {};
    const rateDate = resolveSettlementRateDate({
      lastWorkingDate: values.lastWorkingDate,
      settlementDate: values.settlementDate
    });
    const gross = parseAmount(values.grossSalary);
    // Use form value only (defaults to 0). Do not auto-apply computed shortfall.
    const noticePeriodDeduction = parseAmount(d.noticePeriodDeduction);

    const valuesForTotals = {
      ...values,
      deductions: {
        ...d,
        noticePeriodDeduction
      }
    };
    const totals = computeSettlementTotals(valuesForTotals);
    const leaveBalance = values.leaveBalance || {};

    const earnings = {
      basicSalary: parseAmount(e.basicSalary),
      houseRent: parseAmount(e.houseRent),
      medicalAllowance: parseAmount(e.medicalAllowance),
      conveyanceAllowance: parseAmount(e.transportAllowance) || parseAmount(e.conveyanceAllowance),
      foodAllowance: parseAmount(e.foodAllowance),
      mobileAllowance: parseAmount(e.mobileAllowance),
      vehicleAllowance: parseAmount(e.vehicleAllowance),
      fuelAllowance: parseAmount(e.fuelAllowance),
      specialAllowance: parseAmount(e.specialAllowance),
      otherAllowances: parseAmount(e.otherAllowances),
      otherEarnings: parseAmount(e.otherEarnings),
      overtime: parseAmount(e.overtime),
      bonus: parseAmount(e.bonus),
      gratuity: parseAmount(e.gratuity),
      leaveEncashment: parseAmount(e.leaveEncashment),
      noticePay: parseAmount(e.noticePay),
      providentFund: 0,
      eobi: 0,
      totalEarnings: totals.totalEarnings
    };

    const deductions = {
      incomeTax: parseAmount(d.taxDeductions) || parseAmount(d.incomeTax),
      providentFund: parseAmount(d.providentFund),
      eobi: parseAmount(d.eobi),
      loanDeductions: parseAmount(d.loanDeductions),
      noticePeriodDeduction,
      security: parseAmount(d.security),
      healthInsurance: parseAmount(d.healthInsurance),
      advanceDeductions: parseAmount(d.advanceDeductions),
      pension: parseAmount(d.pension),
      otherDeductions: parseAmount(d.otherDeductions),
      totalDeductions: totals.totalDeductions
    };

    return {
      employeeId: values.employeeId,
      settlementType: values.settlementType,
      reason: values.reason,
      lastWorkingDate: values.lastWorkingDate,
      settlementDate: values.settlementDate || values.lastWorkingDate || new Date().toISOString().split('T')[0],
      noticePeriod: values.noticePeriod || 30,
      noticePeriodServed: values.noticePeriodServed,
      noticePeriodShortfall: shortfallDays,
      paymentMethod: values.paymentMethod,
      bankDetails: values.bankDetails,
      notes: values.notes,
      basicSalary: parseAmount(values.basicSalary) || earnings.basicSalary,
      grossSalary: gross,
      netSalary: parseAmount(values.netSalary),
      actualSalary: getSettlementActualSalary(gross, values.noticePeriodServed, rateDate),
      dailyRate: getSettlementDailyRateRounded(gross, rateDate),
      earnings,
      deductions,
      grossSettlementAmount: totals.grossSettlementAmount,
      netSettlementAmount: totals.netSettlementAmount,
      leaveBalance: {
        annual: parseAmount(leaveBalance.annual),
        sick: parseAmount(leaveBalance.sick),
        casual: parseAmount(leaveBalance.casual),
        other: parseAmount(leaveBalance.other),
        total:
          parseAmount(leaveBalance.annual) +
          parseAmount(leaveBalance.sick) +
          parseAmount(leaveBalance.casual) +
          parseAmount(leaveBalance.other)
      },
      loans: (loans || []).map((loan) => ({
        loanId: loan._id || loan.loanId,
        loanType: loan.loanType,
        originalAmount: loan.loanAmount || loan.originalAmount || 0,
        outstandingBalance: loan.outstandingBalance || 0,
        settledAmount: loan.settledAmount || 0,
        settlementType: loan.settlementType || 'pending'
      }))
    };
  };

  const amountInputProps = {
    startAdornment: <InputAdornment position="start">₨</InputAdornment>
  };

  // Form validation schema
  const validationSchema = Yup.object({
    employeeId: Yup.string().required('Employee is required'),
    settlementType: Yup.string().required('Settlement type is required'),
    reason: Yup.string().required('Reason is required').min(10, 'Reason must be at least 10 characters'),
    lastWorkingDate: Yup.date().required('Last working date is required'),
    noticePeriodServed: Yup.number().min(0, 'Notice period served cannot be negative'),
    paymentMethod: Yup.string().required('Payment method is required'),
    bankDetails: Yup.object({
      bankName: Yup.string().when('paymentMethod', {
        is: 'bank_transfer',
        then: Yup.string().required('Bank name is required')
      }),
      accountNumber: Yup.string().when('paymentMethod', {
        is: 'bank_transfer',
        then: Yup.string().required('Account number is required')
      }),
      accountTitle: Yup.string().when('paymentMethod', {
        is: 'bank_transfer',
        then: Yup.string().required('Account title is required')
      })
    })
  });

  // Formik form
  const formik = useFormik({
    initialValues: {
      employeeId: '',
      settlementType: '',
      reason: '',
      lastWorkingDate: '',
      settlementDate: '',
      noticePeriod: 30,
      noticePeriodServed: 0,
      paymentMethod: 'bank_transfer',
      bankDetails: {
        bankName: '',
        accountNumber: '',
        accountTitle: ''
      },
      notes: '',
      // Salary & Financial Details
      basicSalary: 0,
      grossSalary: 0,
      netSalary: 0,
      dailyRate: 0,
      earnings: {
        basicSalary: 0,
        houseRent: 0,
        medicalAllowance: 0,
        transportAllowance: 0,
        foodAllowance: 0,
        mobileAllowance: 0,
        vehicleAllowance: 0,
        fuelAllowance: 0,
        specialAllowance: 0,
        otherAllowances: 0,
        leaveEncashment: 0,
        noticePay: 0,
        gratuity: 0,
        bonus: 0,
        overtime: 0,
        otherEarnings: 0
      },
      deductions: {
        noticePeriodDeduction: 0,
        loanDeductions: 0,
        advanceDeductions: 0,
        taxDeductions: 0,
        healthInsurance: 0,
        providentFund: 0,
        eobi: 0,
        security: 0,
        pension: 0,
        otherDeductions: 0
      },
      shortfallBreakdown: {
        basicSalary: 0,
        houseRent: 0,
        medicalAllowance: 0,
        transportAllowance: 0,
        foodAllowance: 0,
        mobileAllowance: 0,
        vehicleAllowance: 0,
        fuelAllowance: 0,
        specialAllowance: 0,
        otherAllowances: 0,
        total: 0
      },
      leaveBalance: {
        annual: 0,
        sick: 0,
        casual: 0,
        other: 0
      }
    },
    validationSchema,
    onSubmit: async (values) => {
      try {
        setLoading(true);

        const shortfallDays = Math.max(0, values.noticePeriod - values.noticePeriodServed);
        const settlementData = buildSettlementPayload(values, employeeLoans, shortfallDays);

        if (id) {
          // Update existing settlement
          await finalSettlementService.updateSettlement(id, settlementData);
          setSnackbar({
            open: true,
            message: 'Settlement updated successfully',
            severity: 'success'
          });
        } else {
          // Create new settlement
          await finalSettlementService.createSettlement(settlementData);
          setSnackbar({
            open: true,
            message: 'Settlement created successfully',
            severity: 'success'
          });
        }

        setTimeout(() => {
          navigate('/hr/settlements');
        }, 1500);
      } catch (error) {
        console.error('Error saving settlement:', error);
        setSnackbar({
          open: true,
          message: error.response?.data?.message || 'Error saving settlement',
          severity: 'error'
        });
      } finally {
        setLoading(false);
      }
    }
  });

  // Load employees
  const fetchEmployees = async () => {
    try {
      setEmployeesLoading(true);
      const response = await api.get('/hr/employees?limit=1000');
      setEmployees(response.data.data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
      setSnackbar({
        open: true,
        message: 'Error fetching employees',
        severity: 'error'
      });
    } finally {
      setEmployeesLoading(false);
    }
  };

  // Load employee loans
  const fetchEmployeeLoans = async (employeeObjectId) => {
    if (!employeeObjectId) return;

    try {
      setLoansLoading(true);
      const response = await api.get(`/loans/employee/${employeeObjectId}`);
      const loans = response.data || [];
      setEmployeeLoans(loans);

      // Update loan deductions field
      const totalLoans = loans.reduce((sum, loan) => sum + (loan.outstandingBalance || 0), 0);
      formik.setFieldValue('deductions.loanDeductions', totalLoans);

    } catch (error) {
      console.error('Error fetching employee loans:', error);
      setSnackbar({
        open: true,
        message: 'Error fetching employee loans',
        severity: 'error'
      });
    } finally {
      setLoansLoading(false);
    }
  };

  // Handle employee selection
  const handleEmployeeChange = (employeeId) => {
    formik.setFieldValue('employeeId', employeeId);
    const employee = employees.find(emp => emp.employeeId === employeeId);

    if (employee) {
      // Get employee name from firstName + lastName or fullName virtual
      const employeeName = employee.fullName ||
        `${employee.firstName || ''} ${employee.lastName || ''}`.trim() ||
        'Unknown';

      // Handle nested department object
      const departmentName = typeof employee.placementDepartment === 'object' ?
        (employee.placementDepartment?.name || employee.placementDepartment?.title || 'Unknown') :
        typeof employee.department === 'object' ?
          (employee.department?.name || employee.department?.title || 'Unknown') :
          (employee.placementDepartment || employee.department || 'Unknown');

      // Handle nested designation object
      const designationName = typeof employee.designation === 'object' ?
        (employee.designation?.name || employee.designation?.title || 'Unknown') :
        (employee.designation || 'Unknown');

      const processedEmployee = {
        ...employee,
        name: employeeName,
        department: departmentName,
        designation: designationName
      };

      setSelectedEmployee(processedEmployee);

      // Helper to safely extract numeric allowance amount
      const getAllow = (key) => {
        const a = employee.allowances?.[key] || employee.salary?.[key];
        if (a == null) return 0;
        if (typeof a === 'number') return a > 0 ? a : 0;
        if (typeof a === 'object') {
          if (a.isActive === false) return 0;
          return Number(a.amount) || 0;
        }
        return Number(a) || 0;
      };

      // Calculate salary breakdown — basic is NOT full gross (allowances are separate)
      const grossSalary = Math.round(employee.salary?.gross || 70000);
      const medicalAllowance = getAllow('medical');
      const houseRentAllowance = getAllow('houseRent');
      const foodAllowance = getAllow('food');
      const mobileAllowance = getAllow('mobile');
      const vehicleAllowance = getAllow('vehicle');
      const fuelAllowance = getAllow('fuel');
      const specialAllowance = getAllow('special');
      const otherAllowances = getAllow('other');
      const transportAllowance = getAllow('conveyance') || getAllow('transport');

      const basicSalary = Math.round(
        Number(employee.salary?.basic) > 0
          ? employee.salary.basic
          : Math.max(0, grossSalary - medicalAllowance - houseRentAllowance - foodAllowance - mobileAllowance - vehicleAllowance - fuelAllowance - specialAllowance - otherAllowances - transportAllowance)
      );

      // Calculate daily rate from calendar days in last-working / settlement month
      const rateDate = resolveSettlementRateDate({
        lastWorkingDate: formik.values.lastWorkingDate,
        settlementDate: formik.values.settlementDate
      });
      const dailyRate = getSettlementDailyRateRounded(grossSalary, rateDate);
      const leaveEncashment = 0; // Default to 0, user will input manually

      // Calculate gratuity based on years of service (using Gross Salary)
      const yearsOfService = employee.dateOfJoining ?
        Math.floor((new Date() - new Date(employee.dateOfJoining)) / (1000 * 60 * 60 * 24 * 365)) : 0;
      const gratuity = Math.round(grossSalary * Math.min(yearsOfService, 5)); // Max 5 years

      const leaveBalance = employee.leaveBalance || {};
      const taxDeduction = employee.deductions?.incomeTax || employee.salary?.tax || 0;
      const securityAmount = Number(
        employee.employeeSecurity?.totalAccumulated ||
        employee.employeeSecurity?.amount ||
        employee.salary?.security ||
        employee.deductions?.security ||
        0
      );

      // Update Formik values in one single atomic call so nested fields do not collide
      formik.setValues((prevValues) => ({
        ...prevValues,
        employeeId: employee.employeeId,
        basicSalary,
        grossSalary,
        netSalary: employee.salary?.net || grossSalary,
        dailyRate,
        earnings: {
          ...prevValues.earnings,
          basicSalary,
          houseRent: houseRentAllowance,
          medicalAllowance,
          transportAllowance,
          foodAllowance,
          mobileAllowance,
          vehicleAllowance,
          fuelAllowance,
          specialAllowance,
          otherAllowances,
          leaveEncashment,
          noticePay: 0,
          gratuity,
          bonus: 0,
          overtime: 0,
          otherEarnings: 0
        },
        deductions: {
          ...prevValues.deductions,
          noticePeriodDeduction: 0,
          loanDeductions: 0,
          advanceDeductions: 0,
          eobi: 0,
          taxDeductions: taxDeduction,
          healthInsurance: employee.deductions?.healthInsurance || employee.deductions?.insurance || 0,
          providentFund: employee.deductions?.providentFund || 0,
          security: securityAmount,
          pension: employee.deductions?.pension || 0,
          otherDeductions: employee.deductions?.other || 0
        },
        leaveBalance: {
          annual: leaveBalance.annual || 0,
          sick: leaveBalance.sick || 0,
          casual: leaveBalance.casual || 0,
          other: leaveBalance.other || 0
        },
        bankDetails: {
          bankName: employee.bankDetails?.bankName || prevValues.bankDetails?.bankName || '',
          accountNumber: employee.bankDetails?.accountNumber || prevValues.bankDetails?.accountNumber || '',
          accountTitle: employeeName || prevValues.bankDetails?.accountTitle || ''
        }
      }));

      fetchEmployeeLoans(employee._id);
    }
  };

  // Load settlement data for editing
  const loadSettlementData = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const response = await finalSettlementService.getSettlement(id);
      const settlement = response.data;

      const earnings = settlement.earnings || {};
      const deductions = settlement.deductions || {};
      const leaveBalance = settlement.leaveBalance || {};

      formik.setValues({
        employeeId: settlement.employeeId,
        settlementType: settlement.settlementType,
        reason: settlement.reason,
        lastWorkingDate: settlement.lastWorkingDate.split('T')[0],
        settlementDate: settlement.settlementDate.split('T')[0],
        noticePeriod: settlement.noticePeriod,
        noticePeriodServed: settlement.noticePeriodServed,
        paymentMethod: settlement.paymentMethod,
        bankDetails: settlement.bankDetails || {
          bankName: '',
          accountNumber: '',
          accountTitle: ''
        },
        notes: settlement.notes || '',
        basicSalary: settlement.basicSalary || 0,
        grossSalary: settlement.grossSalary || 0,
        netSalary: settlement.netSalary || 0,
        dailyRate: getSettlementDailyRateRounded(
          settlement.grossSalary || 0,
          resolveSettlementRateDate({
            lastWorkingDate: settlement.lastWorkingDate,
            settlementDate: settlement.settlementDate
          })
        ),
        earnings: {
          basicSalary: earnings.basicSalary || 0,
          houseRent: earnings.houseRent || 0,
          medicalAllowance: earnings.medicalAllowance || 0,
          transportAllowance: earnings.conveyanceAllowance || earnings.transportAllowance || 0,
          foodAllowance: earnings.foodAllowance || 0,
          mobileAllowance: earnings.mobileAllowance || 0,
          vehicleAllowance: earnings.vehicleAllowance || 0,
          fuelAllowance: earnings.fuelAllowance || 0,
          specialAllowance: earnings.specialAllowance || 0,
          otherAllowances: earnings.otherAllowances || 0,
          leaveEncashment: earnings.leaveEncashment || 0,
          noticePay: earnings.noticePay || 0,
          gratuity: earnings.gratuity || 0,
          bonus: earnings.bonus || 0,
          overtime: earnings.overtime || 0,
          otherEarnings: earnings.otherEarnings || 0
        },
        deductions: {
          noticePeriodDeduction: deductions.noticePeriodDeduction || 0,
          loanDeductions: deductions.loanDeductions || 0,
          advanceDeductions: deductions.advanceDeductions || 0,
          taxDeductions: deductions.incomeTax || 0,
          healthInsurance: deductions.healthInsurance || 0,
          providentFund: deductions.providentFund || 0,
          eobi: deductions.eobi || 0,
          security: deductions.security || (deductions.otherDeductions > 0 && !deductions.security ? deductions.otherDeductions : 0),
          pension: deductions.pension || 0,
          otherDeductions: deductions.security ? (deductions.otherDeductions || 0) : 0
        },
        leaveBalance: {
          annual: leaveBalance.annual || 0,
          sick: leaveBalance.sick || 0,
          casual: leaveBalance.casual || 0,
          other: leaveBalance.other || 0
        }
      });

      // Get employee name from firstName + lastName or fullName virtual
      const employeeName = settlement.employeeName ||
        `${settlement.employee?.firstName || ''} ${settlement.employee?.lastName || ''}`.trim() ||
        'Unknown';

      const departmentName = typeof settlement.department === 'object' ?
        (settlement.department?.name || settlement.department?.title || 'Unknown') :
        (settlement.department || 'Unknown');

      const designationName = typeof settlement.designation === 'object' ?
        (settlement.designation?.name || settlement.designation?.title || 'Unknown') :
        (settlement.designation || 'Unknown');

      setSelectedEmployee({
        _id: settlement.employee?._id || settlement.employee,
        employeeId: settlement.employeeId,
        name: employeeName,
        department: departmentName,
        designation: designationName
      });

      setEmployeeLoans(settlement.loans || []);
    } catch (error) {
      console.error('Error loading settlement:', error);
      setSnackbar({
        open: true,
        message: 'Error loading settlement data',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
    if (id) {
      loadSettlementData();
    }
  }, [id]);

  // Handle next step
  const handleNext = () => {
    // Validate current step before moving to next
    const currentStepFields = getStepFields(activeStep);
    const stepErrors = {};

    currentStepFields.forEach(field => {
      if (formik.errors[field]) {
        stepErrors[field] = formik.errors[field];
      }
    });

    if (Object.keys(stepErrors).length > 0) {
      // Mark fields as touched to show errors
      const touchedFields = {};
      currentStepFields.forEach(field => {
        touchedFields[field] = true;
      });
      formik.setTouched({ ...formik.touched, ...touchedFields });

      setSnackbar({
        open: true,
        message: 'Please fill in all required fields before proceeding',
        severity: 'error'
      });
      return;
    }

    setActiveStep((prevStep) => prevStep + 1);
  };

  // Get required fields for each step
  const getStepFields = (step) => {
    switch (step) {
      case 0: // Employee & Basic Info
        return ['employeeId'];
      case 1: // Settlement Details
        return ['settlementType', 'reason', 'lastWorkingDate'];
      case 2: // Salary & Calculations
        return []; // No required fields in this step
      case 3: // Payment & Documents
        const fields = ['paymentMethod'];
        if (formik.values.paymentMethod === 'bank_transfer') {
          fields.push('bankDetails.bankName', 'bankDetails.accountNumber', 'bankDetails.accountTitle');
        }
        return fields;
      default:
        return [];
    }
  };

  // Handle previous step
  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  // Calculate notice period shortfall
  const noticePeriodShortfall = Math.max(0, formik.values.noticePeriod - formik.values.noticePeriodServed);

  // Recalculate daily rate when last working / settlement month changes
  useEffect(() => {
    if (!formik.values.grossSalary && !selectedEmployee?.salary?.gross) return;
    const rateDate = resolveSettlementRateDate({
      lastWorkingDate: formik.values.lastWorkingDate,
      settlementDate: formik.values.settlementDate
    });
    const gross = formik.values.grossSalary || selectedEmployee?.salary?.gross || 0;
    const nextRate = getSettlementDailyRateRounded(gross, rateDate);
    if (Number(formik.values.dailyRate) !== nextRate) {
      formik.setFieldValue('dailyRate', nextRate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formik.values.lastWorkingDate, formik.values.settlementDate, formik.values.grossSalary, selectedEmployee]);

  // Auto-prorate earnings from GROSS components + notice shortfall deduction from GROSS daily rate
  useEffect(() => {
    if (!selectedEmployee) return;

    const servedDays = Number(formik.values.noticePeriodServed);
    const noticePeriod = Number(formik.values.noticePeriod) || 30;
    const shortfallDays = Math.max(0, noticePeriod - (Number.isFinite(servedDays) ? servedDays : 0));
    const rateDate = resolveSettlementRateDate({
      lastWorkingDate: formik.values.lastWorkingDate,
      settlementDate: formik.values.settlementDate
    });

    const getAllow = (key) => {
      const a = selectedEmployee.allowances?.[key] || selectedEmployee.salary?.[key];
      if (a == null) return 0;
      if (typeof a === 'number') return a > 0 ? a : 0;
      if (typeof a === 'object') {
        if (a.isActive === false) return 0;
        return Number(a.amount) || 0;
      }
      return Number(a) || 0;
    };

    const grossSalary = Math.round(selectedEmployee.salary?.gross || formik.values.grossSalary || 70000);
    const medicalAllowance = getAllow('medical');
    const houseRentAllowance = getAllow('houseRent');
    const foodAllowance = getAllow('food');
      const mobileAllowance = getAllow('mobile');
    const vehicleAllowance = getAllow('vehicle');
    const fuelAllowance = getAllow('fuel');
    const specialAllowance = getAllow('special');
    const otherAllowances = getAllow('other');
    const transportAllowance = getAllow('conveyance') || getAllow('transport');

    const basicSalaryBase = Number(selectedEmployee.salary?.basic) > 0
      ? Number(selectedEmployee.salary.basic)
      : Math.max(
        0,
        grossSalary -
          medicalAllowance -
          houseRentAllowance -
          foodAllowance -
          mobileAllowance -
          vehicleAllowance -
          fuelAllowance -
          specialAllowance -
          otherAllowances -
          transportAllowance
      );

    const prorate = (amount) => prorateSettlementAmount(amount, servedDays, rateDate);
    const dailyRate = getSettlementDailyRateRounded(grossSalary, rateDate);
    const shortfallDeduction = getSettlementShortfallDeduction(
      grossSalary,
      noticePeriod,
      servedDays,
      rateDate
    );

    // Shortfall portion of each salary component (basic + allowances) — from GROSS package
    const shortfallOf = (amount) => {
      const baseAmount = Number(amount) || 0;
      if (baseAmount === 0 || shortfallDays <= 0) return 0;
      const days = getCalendarDaysInMonth(rateDate);
      return Math.round((baseAmount / (days > 0 ? days : 30)) * shortfallDays);
    };

    formik.setValues((prevValues) => ({
      ...prevValues,
      dailyRate,
      basicSalary: basicSalaryBase,
      grossSalary,
      earnings: {
        ...prevValues.earnings,
        basicSalary: prorate(basicSalaryBase),
        medicalAllowance: prorate(medicalAllowance),
        houseRent: prorate(houseRentAllowance),
        transportAllowance: prorate(transportAllowance),
        foodAllowance: prorate(foodAllowance),
        mobileAllowance: prorate(mobileAllowance),
        vehicleAllowance: prorate(vehicleAllowance),
        fuelAllowance: prorate(fuelAllowance),
        specialAllowance: prorate(specialAllowance),
        otherAllowances: prorate(otherAllowances)
      },
      deductions: {
        ...prevValues.deductions,
        // Recurring deductions also follow served days; notice period deduction stays user-controlled (default 0)
        taxDeductions: prorate(Number(prevValues.deductions?.taxDeductions) || Number(selectedEmployee.deductions?.incomeTax) || Number(selectedEmployee.salary?.tax) || 0),
        healthInsurance: prorate(Number(selectedEmployee.deductions?.healthInsurance) || Number(selectedEmployee.deductions?.insurance) || 0),
        providentFund: prorate(Number(selectedEmployee.deductions?.providentFund) || 0),
        pension: prorate(Number(selectedEmployee.deductions?.pension) || 0),
        noticePeriodDeduction: parseAmount(prevValues.deductions?.noticePeriodDeduction)
      },
      // snapshot for UI / forward display
      shortfallBreakdown: {
        basicSalary: shortfallOf(basicSalaryBase),
        houseRent: shortfallOf(houseRentAllowance),
        medicalAllowance: shortfallOf(medicalAllowance),
        transportAllowance: shortfallOf(transportAllowance),
        foodAllowance: shortfallOf(foodAllowance),
        mobileAllowance: shortfallOf(mobileAllowance),
        vehicleAllowance: shortfallOf(vehicleAllowance),
        fuelAllowance: shortfallOf(fuelAllowance),
        specialAllowance: shortfallOf(specialAllowance),
        otherAllowances: shortfallOf(otherAllowances),
        total: shortfallDeduction
      }
    }));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formik.values.noticePeriodServed,
    formik.values.noticePeriod,
    formik.values.lastWorkingDate,
    formik.values.settlementDate,
    selectedEmployee
  ]);

  const settlementTotals = computeSettlementTotals(formik.values);
  const rateDateForUi = resolveSettlementRateDate({
    lastWorkingDate: formik.values.lastWorkingDate,
    settlementDate: formik.values.settlementDate
  });
  const actualSalaryAmount = getSettlementActualSalary(
    formik.values.grossSalary || selectedEmployee?.salary?.gross || 0,
    formik.values.noticePeriodServed,
    rateDateForUi
  );
  const shortfallDeductionAmount = getSettlementShortfallDeduction(
    formik.values.grossSalary || selectedEmployee?.salary?.gross || 0,
    formik.values.noticePeriod || 30,
    formik.values.noticePeriodServed,
    rateDateForUi
  );

  const yearsOfService = selectedEmployee?.dateOfJoining
    ? Math.floor((new Date() - new Date(selectedEmployee.dateOfJoining)) / (1000 * 60 * 60 * 24 * 365))
    : 0;

  // Render step content
  const renderStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth error={formik.touched.employeeId && Boolean(formik.errors.employeeId)}>
                <InputLabel>Employee</InputLabel>
                <Select
                  name="employeeId"
                  value={formik.values.employeeId}
                  onChange={(e) => handleEmployeeChange(e.target.value)}
                  label="Employee"
                  disabled={employeesLoading}
                  onOpen={() => setEmployeeSearch('')}
                  MenuProps={{
                    PaperProps: {
                      style: {
                        maxHeight: 300
                      }
                    }
                  }}
                >
                  {/* Search Input */}
                  <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
                    <TextField
                      size="small"
                      placeholder="Search by ID, name, department..."
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      fullWidth
                      variant="outlined"
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <PersonIcon fontSize="small" />
                          </InputAdornment>
                        ),
                        endAdornment: employeesLoading ? (
                          <InputAdornment position="end">
                            <CircularProgress size={16} />
                          </InputAdornment>
                        ) : null
                      }}
                    />
                  </Box>

                  {employeesLoading ? (
                    <MenuItem disabled>
                      <Box display="flex" alignItems="center" justifyContent="center" width="100%">
                        <CircularProgress size={20} />
                        <Typography variant="body2" style={{ marginLeft: 8 }}>
                          Loading employees...
                        </Typography>
                      </Box>
                    </MenuItem>
                  ) : filteredEmployees.length === 0 ? (
                    <MenuItem disabled>
                      {employeeSearch ? 'No employees found matching your search' : 'No employees found'}
                    </MenuItem>
                  ) : (
                    filteredEmployees.map((employee) => {
                      // Get employee name from firstName + lastName or fullName virtual
                      const employeeName = employee.fullName ||
                        `${employee.firstName || ''} ${employee.lastName || ''}`.trim() ||
                        'Unknown';

                      // Handle nested department object
                      const departmentName = typeof employee.placementDepartment === 'object' ?
                        (employee.placementDepartment?.name || employee.placementDepartment?.title || 'Unknown') :
                        typeof employee.department === 'object' ?
                          (employee.department?.name || employee.department?.title || 'Unknown') :
                          (employee.placementDepartment || employee.department || 'Unknown');

                      return (
                        <MenuItem key={employee._id} value={employee.employeeId}>
                          <Box>
                            <Typography variant="body1" fontWeight="bold">
                              {String(employee.employeeId || '')} - {String(employeeName)}
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                              {String(departmentName)} • {String(employee.designation || 'N/A')}
                            </Typography>
                          </Box>
                        </MenuItem>
                      );
                    })
                  )}
                </Select>
                {formik.touched.employeeId && formik.errors.employeeId && (
                  <FormHelperText>{formik.errors.employeeId}</FormHelperText>
                )}
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth error={formik.touched.settlementType && Boolean(formik.errors.settlementType)}>
                <InputLabel>Settlement Type</InputLabel>
                <Select
                  name="settlementType"
                  value={formik.values.settlementType}
                  onChange={formik.handleChange}
                  label="Settlement Type"
                >
                  <MenuItem value="resignation">Resignation</MenuItem>
                  <MenuItem value="termination">Termination</MenuItem>
                  <MenuItem value="retirement">Retirement</MenuItem>
                  <MenuItem value="contract_end">Contract End</MenuItem>
                  <MenuItem value="death">Death</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
                {formik.touched.settlementType && formik.errors.settlementType && (
                  <FormHelperText>{formik.errors.settlementType}</FormHelperText>
                )}
              </FormControl>
            </Grid>

            {selectedEmployee && (
              <Grid item xs={12}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Employee Information
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="body2" color="textSecondary">Employee ID</Typography>
                        <Typography variant="body1">{String(selectedEmployee.employeeId || 'N/A')}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="body2" color="textSecondary">Name</Typography>
                        <Typography variant="body1">{String(selectedEmployee.name || 'N/A')}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="body2" color="textSecondary">Department</Typography>
                        <Typography variant="body1">{String(selectedEmployee.department || 'N/A')}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Typography variant="body2" color="textSecondary">Designation</Typography>
                        <Typography variant="body1">{String(selectedEmployee.designation || 'N/A')}</Typography>
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
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={4}
                name="reason"
                label="Reason for Settlement"
                value={formik.values.reason}
                onChange={formik.handleChange}
                error={formik.touched.reason && Boolean(formik.errors.reason)}
                helperText={formik.touched.reason && formik.errors.reason}
                placeholder="Please provide detailed reason for the settlement..."
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                type="date"
                name="lastWorkingDate"
                label="Last Working Date"
                value={formik.values.lastWorkingDate}
                onChange={formik.handleChange}
                error={formik.touched.lastWorkingDate && Boolean(formik.errors.lastWorkingDate)}
                helperText={formik.touched.lastWorkingDate && formik.errors.lastWorkingDate}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            {!selectedEmployee ? (
              <Grid item xs={12}>
                <Alert severity="info">Select an employee in step 1 to configure salary calculations.</Alert>
              </Grid>
            ) : (
              <>
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom>
                    Salary Calculations
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    All amounts are editable. The final settlement updates as you change values.
                  </Typography>
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    type="number"
                    name="grossSalary"
                    label="Gross Salary"
                    value={formik.values.grossSalary}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    type="number"
                    name="basicSalary"
                    label="Basic Salary (Reference)"
                    value={formik.values.basicSalary}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                    helperText="Stored on settlement record"
                  />
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    type="number"
                    name="dailyRate"
                    label="Daily Rate"
                    value={formik.values.dailyRate}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                    helperText={`Gross salary ÷ ${getCalendarDaysInMonth(
                      resolveSettlementRateDate({
                        lastWorkingDate: formik.values.lastWorkingDate,
                        settlementDate: formik.values.settlementDate
                      })
                    )} (calendar month)`}
                  />
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    type="number"
                    name="noticePeriodServed"
                    label="Notice Period Served (Days)"
                    value={formik.values.noticePeriodServed}
                    onChange={formik.handleChange}
                    error={formik.touched.noticePeriodServed && Boolean(formik.errors.noticePeriodServed)}
                    helperText={formik.touched.noticePeriodServed && formik.errors.noticePeriodServed}
                  />
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    type="number"
                    name="actualSalary"
                    label="Actual Salary"
                    value={actualSalaryAmount}
                    InputProps={amountInputProps}
                    disabled
                    helperText="Gross daily rate × notice period served days"
                  />
                </Grid>

                {formik.values.noticePeriodServed > 0 && (
                  <Grid item xs={12}>
                    <Alert severity="info">
                      Notice period served: {formik.values.noticePeriodServed} days
                      {' '}· Month days:{' '}
                      {getCalendarDaysInMonth(rateDateForUi)}
                      {' '}· Daily rate (from gross): {formatPKR(formik.values.dailyRate || 0)}
                      <br />
                      Actual salary (gross × served): {formatPKR(actualSalaryAmount)}
                      {noticePeriodShortfall > 0 && (
                        <>
                          <br />
                          Shortfall: {noticePeriodShortfall} days · Notice deduction (gross × shortfall):{' '}
                          {formatPKR(shortfallDeductionAmount)}
                          <br />
                          Shortfall includes unpaid basic + allowances for those days
                          {formik.values.shortfallBreakdown && (
                            <>
                              {' '}(
                              {[
                                formik.values.shortfallBreakdown.basicSalary > 0 && `Basic ${formatPKR(formik.values.shortfallBreakdown.basicSalary)}`,
                                formik.values.shortfallBreakdown.foodAllowance > 0 && `Food ${formatPKR(formik.values.shortfallBreakdown.foodAllowance)}`,
                                formik.values.shortfallBreakdown.mobileAllowance > 0 && `Mobile ${formatPKR(formik.values.shortfallBreakdown.mobileAllowance)}`,
                                formik.values.shortfallBreakdown.houseRent > 0 && `HRA ${formatPKR(formik.values.shortfallBreakdown.houseRent)}`,
                                formik.values.shortfallBreakdown.medicalAllowance > 0 && `Medical ${formatPKR(formik.values.shortfallBreakdown.medicalAllowance)}`,
                                formik.values.shortfallBreakdown.transportAllowance > 0 && `Transport ${formatPKR(formik.values.shortfallBreakdown.transportAllowance)}`,
                                formik.values.shortfallBreakdown.vehicleAllowance > 0 && `Vehicle ${formatPKR(formik.values.shortfallBreakdown.vehicleAllowance)}`,
                                formik.values.shortfallBreakdown.fuelAllowance > 0 && `Fuel ${formatPKR(formik.values.shortfallBreakdown.fuelAllowance)}`,
                                formik.values.shortfallBreakdown.specialAllowance > 0 && `Special ${formatPKR(formik.values.shortfallBreakdown.specialAllowance)}`,
                                formik.values.shortfallBreakdown.otherAllowances > 0 && `Other ${formatPKR(formik.values.shortfallBreakdown.otherAllowances)}`
                              ].filter(Boolean).join(' + ') || 'gross package'}
                              )
                            </>
                          )}
                        </>
                      )}
                    </Alert>
                  </Grid>
                )}

                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle1" gutterBottom>
                    Earnings
                  </Typography>
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.basicSalary"
                    label="Basic Salary (Earning)"
                    value={formik.values.earnings.basicSalary}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                    helperText="Prorated basic included in total earnings"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.medicalAllowance"
                    label="Medical Allowance"
                    value={formik.values.earnings.medicalAllowance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.houseRent"
                    label="House Rent Allowance"
                    value={formik.values.earnings.houseRent}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.transportAllowance"
                    label="Transport / Conveyance Allowance"
                    value={formik.values.earnings.transportAllowance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.foodAllowance"
                    label="Food Allowance"
                    value={formik.values.earnings.foodAllowance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.mobileAllowance"
                    label="Mobile Allowance"
                    value={formik.values.earnings.mobileAllowance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.vehicleAllowance"
                    label="Vehicle Allowance"
                    value={formik.values.earnings.vehicleAllowance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.fuelAllowance"
                    label="Fuel Allowance"
                    value={formik.values.earnings.fuelAllowance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.specialAllowance"
                    label="Special Allowance"
                    value={formik.values.earnings.specialAllowance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.otherAllowances"
                    label="Other Allowances"
                    value={formik.values.earnings.otherAllowances}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.leaveEncashment"
                    label="Leave Encashment"
                    value={formik.values.earnings.leaveEncashment}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.noticePay"
                    label="Notice Pay"
                    value={formik.values.earnings.noticePay}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                    helperText="Notice pay earning (defaults to 0)"
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.gratuity"
                    label="Gratuity"
                    value={formik.values.earnings.gratuity}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                    helperText={`${Math.min(yearsOfService, 5)} years of service`}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.bonus"
                    label="Bonus"
                    value={formik.values.earnings.bonus}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.overtime"
                    label="Overtime"
                    value={formik.values.earnings.overtime}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="earnings.otherEarnings"
                    label="Other Earnings"
                    value={formik.values.earnings.otherEarnings}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle1" gutterBottom>
                    Deductions
                  </Typography>
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.noticePeriodDeduction"
                    label="Notice Period Deduction"
                    value={formik.values.deductions.noticePeriodDeduction}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                    helperText={
                      noticePeriodShortfall > 0
                        ? `Defaults to 0. Suggested shortfall (${noticePeriodShortfall} day(s)): ${formatPKR(shortfallDeductionAmount)} — enter manually if needed`
                        : 'Defaults to 0 — enter an amount only if you want to deduct'
                    }
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.loanDeductions"
                    label="Loan Deductions"
                    value={formik.values.deductions.loanDeductions}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                    helperText={loansLoading ? 'Loading loans...' : `${employeeLoans.length} active loan(s)`}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.advanceDeductions"
                    label="Advance Deductions"
                    value={formik.values.deductions.advanceDeductions}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.taxDeductions"
                    label="Tax Deductions"
                    value={formik.values.deductions.taxDeductions}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.healthInsurance"
                    label="Health Insurance"
                    value={formik.values.deductions.healthInsurance}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.providentFund"
                    label="Provident Fund"
                    value={formik.values.deductions.providentFund}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>



                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.security"
                    label="Employee Security"
                    value={formik.values.deductions.security}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.pension"
                    label="Pension"
                    value={formik.values.deductions.pension}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    name="deductions.otherDeductions"
                    label="Other Deductions"
                    value={formik.values.deductions.otherDeductions}
                    onChange={formik.handleChange}
                    InputProps={amountInputProps}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Card variant="outlined">
                    <CardContent>
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary">
                            Total Earnings
                          </Typography>
                          <Typography variant="h6" color="success.main">
                            {formatPKR(settlementTotals.totalEarnings)}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary">
                            Total Deductions
                          </Typography>
                          <Typography variant="h6" color="error.main">
                            {formatPKR(settlementTotals.totalDeductions)}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} md={4}>
                          <Typography variant="body2" color="text.secondary">
                            Net Settlement
                          </Typography>
                          <Typography variant="h6">
                            {formatPKR(settlementTotals.netSettlementAmount)}
                          </Typography>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12}>
                  <Card sx={{ backgroundColor: 'primary.light', color: 'white' }}>
                    <CardContent>
                      <Typography variant="h5" gutterBottom>
                        Final Settlement Amount
                      </Typography>
                      <Typography variant="h3">
                        {formatPKR(settlementTotals.netSettlementAmount)}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Total Earnings − Total Deductions
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </>
            )}
          </Grid>
        );

      case 3:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth error={formik.touched.paymentMethod && Boolean(formik.errors.paymentMethod)}>
                <InputLabel>Payment Method</InputLabel>
                <Select
                  name="paymentMethod"
                  value={formik.values.paymentMethod}
                  onChange={formik.handleChange}
                  label="Payment Method"
                >
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="cheque">Cheque</MenuItem>
                  <MenuItem value="online">Online Payment</MenuItem>
                </Select>
                {formik.touched.paymentMethod && formik.errors.paymentMethod && (
                  <FormHelperText>{formik.errors.paymentMethod}</FormHelperText>
                )}
              </FormControl>
            </Grid>

            {formik.values.paymentMethod === 'bank_transfer' && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    name="bankDetails.bankName"
                    label="Bank Name"
                    value={formik.values.bankDetails.bankName}
                    onChange={formik.handleChange}
                    error={formik.touched.bankDetails?.bankName && Boolean(formik.errors.bankDetails?.bankName)}
                    helperText={formik.touched.bankDetails?.bankName && formik.errors.bankDetails?.bankName}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    name="bankDetails.accountNumber"
                    label="Account Number"
                    value={formik.values.bankDetails.accountNumber}
                    onChange={formik.handleChange}
                    error={formik.touched.bankDetails?.accountNumber && Boolean(formik.errors.bankDetails?.accountNumber)}
                    helperText={formik.touched.bankDetails?.accountNumber && formik.errors.bankDetails?.accountNumber}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    name="bankDetails.accountTitle"
                    label="Account Title"
                    value={formik.values.bankDetails.accountTitle}
                    onChange={formik.handleChange}
                    error={formik.touched.bankDetails?.accountTitle && Boolean(formik.errors.bankDetails?.accountTitle)}
                    helperText={formik.touched.bankDetails?.accountTitle && formik.errors.bankDetails?.accountTitle}
                  />
                </Grid>
              </>
            )}

            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                name="notes"
                label="Additional Notes"
                value={formik.values.notes}
                onChange={formik.handleChange}
                placeholder="Any additional notes or special instructions..."
              />
            </Grid>
          </Grid>
        );

      case 4:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Settlement Summary
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Employee Details
                  </Typography>
                  <Typography><strong>Name:</strong> {selectedEmployee?.name}</Typography>
                  <Typography><strong>ID:</strong> {selectedEmployee?.employeeId}</Typography>
                  <Typography><strong>Company:</strong> {selectedEmployee?.placementCompany?.name || 'N/A'}</Typography>
                  <Typography><strong>Department:</strong> {selectedEmployee?.placementDepartment?.name || 'N/A'}</Typography>
                  <Typography><strong>Designation:</strong> {selectedEmployee?.placementDesignation?.title || 'N/A'}</Typography>
                  <Typography><strong>Location:</strong> {selectedEmployee?.placementLocation?.name || 'N/A'}</Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Settlement Details
                  </Typography>
                  <Typography><strong>Type:</strong> {finalSettlementService.getSettlementTypeLabel(formik.values.settlementType)}</Typography>
                  <Typography><strong>Last Working Date:</strong> {formik.values.lastWorkingDate}</Typography>
                  <Typography><strong>Notice Served:</strong> {formik.values.noticePeriodServed} days</Typography>
                  {noticePeriodShortfall > 0 && (
                    <Typography color="error">
                      <strong>Shortfall:</strong> {noticePeriodShortfall} days
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Reason
                  </Typography>
                  <Typography>{formik.values.reason}</Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Salary & Calculations
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Gross Salary</Typography>
                      <Typography fontWeight={700}>{formatPKR(formik.values.grossSalary)}</Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Basic (Reference)</Typography>
                      <Typography fontWeight={700}>{formatPKR(formik.values.basicSalary)}</Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Daily Rate (Gross)</Typography>
                      <Typography fontWeight={700}>{formatPKR(formik.values.dailyRate)}</Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Actual Salary</Typography>
                      <Typography fontWeight={700} color="primary.main">{formatPKR(actualSalaryAmount)}</Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Notice Served</Typography>
                      <Typography fontWeight={700}>{formik.values.noticePeriodServed || 0} days</Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Shortfall</Typography>
                      <Typography fontWeight={700} color={noticePeriodShortfall > 0 ? 'error.main' : 'text.primary'}>
                        {noticePeriodShortfall} days
                      </Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Notice Deduction</Typography>
                      <Typography fontWeight={700} color="error.main">
                        {formatPKR(formik.values.deductions.noticePeriodDeduction)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <Typography variant="body2" color="text.secondary">Month Days</Typography>
                      <Typography fontWeight={700}>{getCalendarDaysInMonth(rateDateForUi)}</Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Settlement Amount
                  </Typography>
                  <Typography variant="h4" color="primary">
                    {formatPKR(settlementTotals.netSettlementAmount)}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Total Earnings: {formatPKR(settlementTotals.grossSettlementAmount)} · Total Deductions:{' '}
                    {formatPKR(settlementTotals.totalDeductions)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            {formik.values.notes && (
              <Grid item xs={12}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Additional Notes
                    </Typography>
                    <Typography>{formik.values.notes}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            )}
          </Grid>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <PageLoading
        message="Loading final settlement form..."
        showSkeleton={true}
        skeletonType="cards"
      />
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          {id ? 'Edit Final Settlement' : 'New Final Settlement'}
        </Typography>
        <Button
          variant="outlined"
          onClick={() => navigate('/hr/settlements')}
        >
          Back to Settlements
        </Button>
      </Box>

      {/* Stepper */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Paper>

      {/* Form Content */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <form onSubmit={formik.handleSubmit}>
          {renderStepContent(activeStep)}
        </form>
      </Paper>

      {/* Navigation Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          disabled={activeStep === 0}
          onClick={handleBack}
          startIcon={<BackIcon />}
        >
          Back
        </Button>

        <Box>
          {activeStep === steps.length - 1 ? (
            <Button
              variant="contained"
              onClick={formik.handleSubmit}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
            >
              {loading ? 'Saving...' : (id ? 'Update Settlement' : 'Create Settlement')}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleNext}
              startIcon={<NextIcon />}
            >
              Next
            </Button>
          )}
        </Box>
      </Box>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default FinalSettlementForm; 