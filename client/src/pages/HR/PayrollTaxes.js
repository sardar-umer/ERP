import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  FormControl,
  Select,
  MenuItem,
  Alert,
  RadioGroup,
  FormControlLabel,
  Radio,
  Autocomplete,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import api from '../../services/api';

const DEFAULT_POLICIES = () => ({
  conveyance: { mode: 'taxable', exemptPercent: 0 },
  food: { mode: 'taxable', exemptPercent: 0 },
  mobile: { mode: 'taxable', exemptPercent: 0 },
  vehicle: { mode: 'taxable', exemptPercent: 0 },
  fuel: { mode: 'taxable', exemptPercent: 0 },
  medical: { mode: 'taxable', exemptPercent: 0 },
  houseRent: { mode: 'taxable', exemptPercent: 0 },
  special: { mode: 'taxable', exemptPercent: 0 },
  other: { mode: 'taxable', exemptPercent: 0 }
});

const PayrollTaxes = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [meta, setMeta] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState({
    salaryMedicalExemptPercent: 10,
    applyScope: 'all',
    selectedEmployeeIds: [],
    allowancePolicies: DEFAULT_POLICIES()
  });

  const selectedEmployees = useMemo(() => {
    const ids = new Set(settings.selectedEmployeeIds.map(String));
    return employees.filter((e) => ids.has(String(e._id)));
  }, [employees, settings.selectedEmployeeIds]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, metaRes, employeesRes] = await Promise.all([
        api.get('/hr/payroll-taxes'),
        api.get('/hr/payroll-taxes/meta'),
        api.get('/hr/payroll-taxes/employees', { params: { active: 'true' } })
      ]);

      const data = settingsRes.data.data;
      setSettings({
        salaryMedicalExemptPercent: data.salaryMedicalExemptPercent ?? 10,
        applyScope: data.applyScope || 'all',
        selectedEmployeeIds: (data.selectedEmployeeIds || []).map(String),
        allowancePolicies: {
          ...DEFAULT_POLICIES(),
          ...data.allowancePolicies
        }
      });
      setMeta(metaRes.data.data);
      setEmployees(employeesRes.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load payroll tax settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const updatePolicy = (key, field, value) => {
    setSettings((prev) => {
      const next = { ...prev.allowancePolicies[key], [field]: value };
      if (field === 'mode') {
        if (value === 'fully_exempt') next.exemptPercent = 100;
        if (value === 'taxable') next.exemptPercent = 0;
      }
      return {
        ...prev,
        allowancePolicies: {
          ...prev.allowancePolicies,
          [key]: next
        }
      };
    });
  };

  const handleSave = async () => {
    if (settings.applyScope === 'selected' && settings.selectedEmployeeIds.length === 0) {
      setError('Select at least one employee when using "Selected employees" scope.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.put('/hr/payroll-taxes', settings);
      setSuccess(response.data.message || 'Settings saved.');
      if (response.data.data?.settings) {
        setSettings({
          salaryMedicalExemptPercent: response.data.data.settings.salaryMedicalExemptPercent,
          applyScope: response.data.data.settings.applyScope,
          selectedEmployeeIds: (response.data.data.settings.selectedEmployeeIds || []).map(String),
          allowancePolicies: {
            ...DEFAULT_POLICIES(),
            ...response.data.data.settings.allowancePolicies
          }
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  const allowanceKeys = meta?.allowanceKeys || Object.keys(DEFAULT_POLICIES());
  const allowanceLabels = meta?.allowanceLabels || {};

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Payroll Taxes
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Taxable income = <strong>(gross salary − medical exemption %)</strong> + taxable portions of
        allowances. Example: gross 312,000 with 10% medical → 280,800, then + house allowance 60,000
        (if Fully taxable) → tax on 340,800. Each of the 8 allowance types can be taxable, fully
        exempt, or partially exempt (from Payroll Taxes). Employees outside scope keep the legacy
        rule (10% exemption on gross + allowances combined). Saving updates <strong>Draft</strong>{' '}
        monthly payrolls only; Approved payrolls and General Payroll preview use these rules
        immediately.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Salary exemption
          </Typography>
          <TextField
            label="Medical exemption on gross salary (%)"
            type="number"
            value={settings.salaryMedicalExemptPercent}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                salaryMedicalExemptPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0))
              }))
            }
            inputProps={{ min: 0, max: 100, step: 0.1 }}
            sx={{ maxWidth: 320 }}
            helperText="Default 10%. Applied to gross salary only, then taxable allowances are added."
          />
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Apply to
          </Typography>
          <RadioGroup
            row
            value={settings.applyScope}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, applyScope: e.target.value }))
            }
          >
            <FormControlLabel value="all" control={<Radio />} label="All employees" />
            <FormControlLabel value="selected" control={<Radio />} label="Selected employees only" />
          </RadioGroup>

          {settings.applyScope === 'selected' && (
            <Autocomplete
              multiple
              options={employees}
              value={selectedEmployees}
              onChange={(_, value) =>
                setSettings((prev) => ({
                  ...prev,
                  selectedEmployeeIds: value.map((e) => String(e._id))
                }))
              }
              getOptionLabel={(option) =>
                `${option.employeeId || ''} — ${option.firstName || ''} ${option.lastName || ''}`.trim()
              }
              isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option._id}
                    label={`${option.employeeId} ${option.firstName} ${option.lastName}`}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Employees" placeholder="Search by ID or name" />
              )}
              sx={{ mt: 2 }}
            />
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Allowance tax rules (8 types)
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Allowance</TableCell>
                  <TableCell>Tax treatment</TableCell>
                  <TableCell width={160}>Exempt %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {allowanceKeys.map((key) => {
                  const policy = settings.allowancePolicies[key] || {
                    mode: 'taxable',
                    exemptPercent: 0
                  };
                  return (
                    <TableRow key={key}>
                      <TableCell>{allowanceLabels[key] || key}</TableCell>
                      <TableCell>
                        <FormControl size="small" fullWidth>
                          <Select
                            value={policy.mode || 'taxable'}
                            onChange={(e) => updatePolicy(key, 'mode', e.target.value)}
                          >
                            <MenuItem value="taxable">Fully taxable</MenuItem>
                            <MenuItem value="fully_exempt">Fully exempt</MenuItem>
                            <MenuItem value="partial_exempt">Partially exempt</MenuItem>
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          type="number"
                          fullWidth
                          disabled={policy.mode !== 'partial_exempt'}
                          value={policy.exemptPercent ?? 0}
                          onChange={(e) =>
                            updatePolicy(
                              key,
                              'exemptPercent',
                              Math.min(100, Math.max(0, Number(e.target.value) || 0))
                            )
                          }
                          inputProps={{ min: 0, max: 100 }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving}
        >
          Save & refresh draft payrolls
        </Button>
      </Box>
    </Box>
  );
};

export default PayrollTaxes;
