import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Divider,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
  FormHelperText,
  InputAdornment,
  Chip,
  Stack
} from '@mui/material';
import {
  Save as SaveIcon,
  Calculate as CalculateIcon,
  ArrowBack as BackIcon,
  AccountBalance as BankIcon,
  Person as PersonIcon,
  Description as DescriptionIcon
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { loanService } from '../../services/loanService';
import { formatPKR } from '../../utils/currency';
import api from '../../services/api';

const steps = ['Basic Information', 'Loan Details', 'Guarantor & Documents'];

const LoanForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);

  const [formData, setFormData] = useState({
    employee: '',
    loanType: '',
    loanAmount: '',
    interestRate: '',
    loanTerm: '',
    purpose: '',
    collateral: '',
    collateralValue: '',
    guarantor: {
      name: '',
      relationship: '',
      phone: '',
      idCard: ''
    },
    salaryDeduction: {
      enabled: true,
      deductionType: 'Fixed Amount',
      percentage: '',
      fixedAmount: ''
    }
  });

  const [calculatedValues, setCalculatedValues] = useState({
    monthlyInstallment: 0,
    totalPayable: 0,
    totalInterest: 0,
    lastInstallment: 0,
    suggestedEmi: 0
  });
  const [emiManual, setEmiManual] = useState(false);
  const [emiInput, setEmiInput] = useState('');
  const [emiPlanError, setEmiPlanError] = useState('');

  const [errors, setErrors] = useState({});

  useEffect(() => {
    fetchEmployees();
    if (isEdit) {
      fetchLoan();
    }
  }, [isEdit, id]);

  useEffect(() => {
    recalculatePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.loanAmount, formData.interestRate, formData.loanTerm, emiManual, emiInput]);

  const fetchEmployees = async () => {
    try {
      setEmployeesLoading(true);
      const response = await api.get('/hr/employees?limit=1000');
      setEmployees(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      setError('Failed to fetch employees');
    } finally {
      setEmployeesLoading(false);
    }
  };

  const fetchLoan = async () => {
    try {
      setLoading(true);
      const loan = await loanService.getLoanById(id);
      setFormData({
        employee: loan.employee._id,
        loanType: loan.loanType,
        loanAmount: loan.loanAmount,
        interestRate: loan.interestRate,
        loanTerm: loan.loanTerm,
        purpose: loan.purpose,
        collateral: loan.collateral || '',
        collateralValue: loan.collateralValue || '',
        guarantor: {
          name: loan.guarantor?.name || '',
          relationship: loan.guarantor?.relationship || '',
          phone: loan.guarantor?.phone || '',
          idCard: loan.guarantor?.idCard || ''
        },
        salaryDeduction: {
          enabled: loan.salaryDeduction?.enabled ?? true,
          deductionType: loan.salaryDeduction?.deductionType || 'Fixed Amount',
          percentage: loan.salaryDeduction?.percentage || '',
          fixedAmount: loan.salaryDeduction?.fixedAmount || ''
        }
      });
      if (loan.emiManuallyAdjusted && loan.monthlyInstallment) {
        setEmiManual(true);
        setEmiInput(String(Math.round(Number(loan.monthlyInstallment) * 100) / 100));
      }
    } catch (error) {
      setError(error.message || 'Failed to fetch loan details');
    } finally {
      setLoading(false);
    }
  };

  const recalculatePlan = () => {
    const principal = parseFloat(formData.loanAmount);
    const rate = formData.interestRate === '' || formData.interestRate == null
      ? NaN
      : parseFloat(formData.interestRate);
    const time = parseInt(formData.loanTerm, 10);

    if (!principal || principal <= 0 || !time || time <= 0 || Number.isNaN(rate) || rate < 0) {
      setCalculatedValues({
        monthlyInstallment: 0,
        totalPayable: 0,
        totalInterest: 0,
        lastInstallment: 0,
        suggestedEmi: 0
      });
      setEmiPlanError('');
      return;
    }

    const suggested = Math.round(loanService.calculateEMI(principal, rate, time) * 100) / 100;
    const emiToUse = emiManual
      ? Math.max(0, parseFloat(emiInput) || 0)
      : suggested;

    if (!emiManual) {
      setEmiInput(String(suggested || ''));
    }

    const plan = loanService.previewInstallmentPlan(principal, rate, time, emiToUse);
    setEmiPlanError(plan.valid ? '' : (plan.error || ''));
    setCalculatedValues({
      monthlyInstallment: emiToUse,
      totalPayable: plan.totalPayable,
      totalInterest: plan.totalInterest,
      lastInstallment: plan.lastInstallment,
      suggestedEmi: suggested
    });
  };

  const handleEmiChange = (value) => {
    setEmiManual(true);
    setEmiInput(value);
  };

  const handleUseSuggestedEmi = () => {
    setEmiManual(false);
    setEmiInput(String(calculatedValues.suggestedEmi || ''));
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    // Clear field-specific errors
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const handleGuarantorChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      guarantor: {
        ...prev.guarantor,
        [field]: value
      }
    }));
  };

  const handleSalaryDeductionChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      salaryDeduction: {
        ...prev.salaryDeduction,
        [field]: value
      }
    }));
  };

  const validateStep = (step) => {
    const newErrors = {};

    switch (step) {
      case 0: // Basic Information
        if (!formData.employee) newErrors.employee = 'Employee is required';
        if (!formData.loanType) newErrors.loanType = 'Loan type is required';
        if (!formData.purpose || formData.purpose.trim() === '') {
          newErrors.purpose = 'Loan purpose is required';
        }
        break;

      case 1: // Loan Details
        if (!formData.loanAmount || formData.loanAmount < 1000) {
          newErrors.loanAmount = 'Loan amount must be at least 1,000 PKR';
        }
        if (formData.interestRate === '' || formData.interestRate == null || Number(formData.interestRate) < 0) {
          newErrors.interestRate = 'Interest rate must be 0 or greater';
        }
        if (!formData.loanTerm || formData.loanTerm < 1 || formData.loanTerm > 120) {
          newErrors.loanTerm = 'Loan term must be between 1 and 120 months';
        }
        if (!calculatedValues.monthlyInstallment || calculatedValues.monthlyInstallment <= 0) {
          newErrors.monthlyInstallment = 'Monthly EMI must be greater than zero';
        }
        if (emiPlanError) {
          newErrors.monthlyInstallment = emiPlanError;
        }
        break;

      case 2: // Guarantor & Documents
        if (!formData.guarantor.name) newErrors['guarantor.name'] = 'Guarantor name is required';
        if (!formData.guarantor.relationship) {
          newErrors['guarantor.relationship'] = 'Relationship is required';
        }
        if (!formData.guarantor.phone) {
          newErrors['guarantor.phone'] = 'Guarantor phone is required';
        }
        break;

      default:
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(activeStep)) {
      setActiveStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const handleSubmit = async () => {
    if (!validateStep(activeStep)) {
      return;
    }

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const loanData = {
        ...formData,
        monthlyInstallment: calculatedValues.monthlyInstallment,
        totalPayable: calculatedValues.totalPayable,
        emiManuallyAdjusted: emiManual
      };

      if (isEdit) {
        await loanService.updateLoan(id, loanData);
        setSuccess('Loan application updated successfully');
      } else {
        await loanService.createLoan(loanData);
        setSuccess('Loan application submitted successfully');
      }

      setTimeout(() => {
        navigate('/hr/loans');
      }, 2000);
    } catch (error) {
      setError(error.message || 'Failed to save loan application');
    } finally {
      setSaving(false);
    }
  };

  const renderStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth error={!!errors.employee}>
                <InputLabel>Employee</InputLabel>
                <Select
                  value={formData.employee}
                  label="Employee"
                  onChange={(e) => handleInputChange('employee', e.target.value)}
                  disabled={employeesLoading}
                >
                  {employeesLoading ? (
                    <MenuItem disabled>Loading employees...</MenuItem>
                  ) : (employees || []).length === 0 ? (
                    <MenuItem disabled>No employees found</MenuItem>
                  ) : (
                    (employees || []).map((employee) => (
                      <MenuItem key={employee._id} value={employee._id}>
                        {employee.employeeId} - {employee.firstName} {employee.lastName}
                      </MenuItem>
                    ))
                  )}
                </Select>
                {errors.employee && <FormHelperText>{errors.employee}</FormHelperText>}
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth error={!!errors.loanType}>
                <InputLabel>Loan Type</InputLabel>
                <Select
                  value={formData.loanType}
                  label="Loan Type"
                  onChange={(e) => handleInputChange('loanType', e.target.value)}
                >
                  {loanService.getLoanTypeOptions().map(option => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
                {errors.loanType && <FormHelperText>{errors.loanType}</FormHelperText>}
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={4}
                label="Loan Purpose"
                value={formData.purpose}
                onChange={(e) => handleInputChange('purpose', e.target.value)}
                error={!!errors.purpose}
                helperText={errors.purpose}
                placeholder="Please describe the purpose of this loan..."
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="number"
                label="Loan Amount (PKR)"
                value={formData.loanAmount}
                onChange={(e) => handleInputChange('loanAmount', e.target.value)}
                error={!!errors.loanAmount}
                helperText={errors.loanAmount}
                InputProps={{
                  startAdornment: <InputAdornment position="start">₨</InputAdornment>,
                }}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="number"
                label="Interest Rate (%)"
                value={formData.interestRate}
                onChange={(e) => handleInputChange('interestRate', e.target.value)}
                error={!!errors.interestRate}
                helperText={errors.interestRate}
                InputProps={{
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                }}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                type="number"
                label="Loan Term (Months)"
                value={formData.loanTerm}
                onChange={(e) => handleInputChange('loanTerm', e.target.value)}
                error={!!errors.loanTerm}
                helperText={errors.loanTerm}
                InputProps={{
                  endAdornment: <InputAdornment position="end">months</InputAdornment>,
                }}
              />
            </Grid>

            <Grid item xs={12}>
              <Card sx={{ bgcolor: 'grey.50' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
                    <Typography variant="h6">
                      <CalculateIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                      Loan Calculation Summary
                    </Typography>
                    {emiManual && (
                      <Chip size="small" color="warning" label="Custom EMI" />
                    )}
                  </Stack>

                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={3}>
                      <TextField
                        fullWidth
                        type="number"
                        label="Monthly EMI"
                        value={emiInput}
                        onChange={(e) => handleEmiChange(e.target.value)}
                        error={!!errors.monthlyInstallment || !!emiPlanError}
                        helperText={
                          errors.monthlyInstallment ||
                          emiPlanError ||
                          (emiManual
                            ? 'Editable — last installment will auto-balance'
                            : `Suggested ${formatPKR(calculatedValues.suggestedEmi)} — edit to customize`)
                        }
                        InputProps={{
                          startAdornment: <InputAdornment position="start">₨</InputAdornment>,
                        }}
                      />
                      {emiManual && calculatedValues.suggestedEmi > 0 && (
                        <Button size="small" sx={{ mt: 0.5 }} onClick={handleUseSuggestedEmi}>
                          Use calculated EMI ({formatPKR(calculatedValues.suggestedEmi)})
                        </Button>
                      )}
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Typography variant="body2" color="text.secondary">
                        Last Installment
                      </Typography>
                      <Typography variant="h6" color={
                        Math.abs((calculatedValues.lastInstallment || 0) - (calculatedValues.monthlyInstallment || 0)) > 0.5
                          ? 'warning.main'
                          : 'text.primary'
                      }>
                        {formatPKR(calculatedValues.lastInstallment)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Auto-adjusted to fit loan amount
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Typography variant="body2" color="text.secondary">
                        Total Payable
                      </Typography>
                      <Typography variant="h6" color="secondary">
                        {formatPKR(calculatedValues.totalPayable)}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Typography variant="body2" color="text.secondary">
                        Total Interest
                      </Typography>
                      <Typography variant="h6" color="error">
                        {formatPKR(calculatedValues.totalInterest)}
                      </Typography>
                    </Grid>
                  </Grid>

                  {formData.loanTerm > 1 && calculatedValues.monthlyInstallment > 0 && (
                    <Alert severity="info" sx={{ mt: 2 }}>
                      Months 1–{Math.max(1, Number(formData.loanTerm) - 1)}: <strong>{formatPKR(calculatedValues.monthlyInstallment)}</strong>
                      {' · '}
                      Month {formData.loanTerm}: <strong>{formatPKR(calculatedValues.lastInstallment)}</strong>
                      {' '}(balances remaining principal)
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Collateral Description"
                value={formData.collateral}
                onChange={(e) => handleInputChange('collateral', e.target.value)}
                placeholder="Optional: Describe any collateral provided"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Collateral Value (PKR)"
                value={formData.collateralValue}
                onChange={(e) => handleInputChange('collateralValue', e.target.value)}
                InputProps={{
                  startAdornment: <InputAdornment position="start">₨</InputAdornment>,
                }}
              />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                <BankIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Salary Deduction Settings
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={formData.salaryDeduction.enabled}
                    onChange={(e) => handleSalaryDeductionChange('enabled', e.target.checked)}
                  />
                }
                label="Enable salary deduction for loan repayment"
              />

              {formData.salaryDeduction.enabled && (
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={12} md={4}>
                    <FormControl fullWidth>
                      <InputLabel>Deduction Type</InputLabel>
                      <Select
                        value={formData.salaryDeduction.deductionType}
                        label="Deduction Type"
                        onChange={(e) => handleSalaryDeductionChange('deductionType', e.target.value)}
                      >
                        <MenuItem value="Fixed Amount">Fixed Amount</MenuItem>
                        <MenuItem value="Percentage">Percentage</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      type="number"
                      label={formData.salaryDeduction.deductionType === 'Percentage' ? 'Percentage (%)' : 'Fixed Amount (PKR)'}
                      value={formData.salaryDeduction.deductionType === 'Percentage' ? formData.salaryDeduction.percentage : formData.salaryDeduction.fixedAmount}
                      onChange={(e) => {
                        const field = formData.salaryDeduction.deductionType === 'Percentage' ? 'percentage' : 'fixedAmount';
                        handleSalaryDeductionChange(field, e.target.value);
                      }}
                      InputProps={{
                        startAdornment: formData.salaryDeduction.deductionType === 'Percentage' ?
                          <InputAdornment position="start">%</InputAdornment> :
                          <InputAdornment position="start">₨</InputAdornment>,
                      }}
                    />
                  </Grid>
                </Grid>
              )}
            </Grid>
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                <PersonIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Guarantor Information
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Guarantor Name"
                value={formData.guarantor.name}
                onChange={(e) => handleGuarantorChange('name', e.target.value)}
                error={!!errors['guarantor.name']}
                helperText={errors['guarantor.name']}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Relationship"
                value={formData.guarantor.relationship}
                onChange={(e) => handleGuarantorChange('relationship', e.target.value)}
                error={!!errors['guarantor.relationship']}
                helperText={errors['guarantor.relationship']}
                placeholder="e.g., Father, Brother, Friend"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Phone Number"
                value={formData.guarantor.phone}
                onChange={(e) => handleGuarantorChange('phone', e.target.value)}
                error={!!errors['guarantor.phone']}
                helperText={errors['guarantor.phone']}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="ID Card Number"
                value={formData.guarantor.idCard}
                onChange={(e) => handleGuarantorChange('idCard', e.target.value)}
              />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                <DescriptionIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Required Documents
              </Typography>
              <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  The following documents will be required for loan processing:
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Chip label="Employee ID Card" size="small" sx={{ mr: 1, mb: 1 }} />
                  <Chip label="Salary Slip (Last 3 months)" size="small" sx={{ mr: 1, mb: 1 }} />
                  <Chip label="Bank Statement" size="small" sx={{ mr: 1, mb: 1 }} />
                  <Chip label="Guarantor ID Card" size="small" sx={{ mr: 1, mb: 1 }} />
                  <Chip label="Purpose Documentation" size="small" sx={{ mr: 1, mb: 1 }} />
                </Box>
              </Box>
            </Grid>
          </Grid>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" mb={3}>
        <Button
          startIcon={<BackIcon />}
          onClick={() => navigate('/hr/loans')}
          sx={{ mr: 2 }}
        >
          Back
        </Button>
        <Typography variant="h4" component="h1">
          {isEdit ? 'Edit Loan Application' : 'New Loan Application'}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
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

        {renderStepContent(activeStep)}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          <Button
            disabled={activeStep === 0}
            onClick={handleBack}
          >
            Back
          </Button>

          <Box>
            {activeStep === steps.length - 1 ? (
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={saving}
                startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
              >
                {saving ? 'Saving...' : (isEdit ? 'Update Application' : 'Submit Application')}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
              >
                Next
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};

export default LoanForm; 