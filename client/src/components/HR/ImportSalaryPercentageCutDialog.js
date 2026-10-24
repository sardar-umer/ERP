import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Stack,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid
} from '@mui/material';
import {
  Percent as PercentIcon,
  CloudUpload as UploadIcon,
  Close as CloseIcon,
  CheckCircle as SuccessIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import api from '../../services/api';

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
];

export default function ImportSalaryPercentageCutDialog({
  open,
  onClose,
  onImportSuccess,
  currentMonth,
  currentYear
}) {
  const now = new Date();
  const [file, setFile] = useState(null);
  const [month, setMonth] = useState(Number(currentMonth) || now.getMonth() + 1);
  const [year, setYear] = useState(Number(currentYear) || now.getFullYear());
  const [percentage, setPercentage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Keep dialog period in sync with the payroll page when opened
  useEffect(() => {
    if (!open) return;
    const m = Number(currentMonth);
    const y = Number(currentYear);
    if (Number.isInteger(m) && m >= 1 && m <= 12) setMonth(m);
    if (Number.isInteger(y) && y >= 2020) setYear(y);
    setFile(null);
    setPercentage('');
    setError('');
    setResult(null);
  }, [open, currentMonth, currentYear]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError('');
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select an Excel file to upload');
      return;
    }
    const pct = Number(percentage);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      setError('Enter a cut percentage greater than 0 and less than 100');
      return;
    }
    if (!month || !year) {
      setError('Month and year are required');
      return;
    }

    setUploading(true);
    setError('');
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('month', String(month));
    formData.append('year', String(year));
    formData.append('percentage', String(pct));

    try {
      const response = await api.post('/payroll/import-salary-percentage-cut', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data?.success) {
        setResult(response.data.data);
        if (onImportSuccess) onImportSuccess(response.data.data);
      } else {
        setError(response.data?.message || 'Failed to import salary percentage cut');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Error uploading file');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setPercentage('');
    setError('');
    setResult(null);
    onClose();
  };

  const yearOptions = [];
  const baseYear = now.getFullYear();
  for (let y = baseYear + 1; y >= baseYear - 3; y -= 1) yearOptions.push(y);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <PercentIcon color="warning" />
            <Typography variant="h6" fontWeight={700}>
              Import Salary % Cut (One Month)
            </Typography>
          </Stack>
          <IconButton size="small" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!result ? (
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Upload an Excel of employee IDs. Choose the month and cut %. Salary components for those
              employees are reduced for <strong>that month only</strong>. <strong>EOBI stays full</strong>.
              Master salary is not changed permanently.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Month</InputLabel>
                  <Select
                    label="Month"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    disabled={uploading}
                  >
                    {MONTHS.map((m) => (
                      <MenuItem key={m.value} value={m.value}>
                        {m.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Year</InputLabel>
                  <Select
                    label="Year"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    disabled={uploading}
                  >
                    {yearOptions.map((y) => (
                      <MenuItem key={y} value={y}>
                        {y}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Cut %"
                  type="number"
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                  disabled={uploading}
                  inputProps={{ min: 0.01, max: 99.99, step: 0.01 }}
                  placeholder="e.g. 10"
                />
              </Grid>
            </Grid>

            <Paper
              variant="outlined"
              sx={{
                p: 3,
                textAlign: 'center',
                borderStyle: 'dashed',
                borderColor: file ? 'warning.main' : 'divider',
                bgcolor: file ? 'rgba(237, 108, 2, 0.04)' : 'grey.50',
                borderRadius: 2
              }}
            >
              <UploadIcon sx={{ fontSize: 40, color: file ? 'warning.main' : 'text.secondary', mb: 1 }} />
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {file ? file.name : 'Select employee list Excel'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                Supports .xlsx / .xls — column: <strong>EMP ID Tovus</strong> / <strong>Employee ID</strong>
              </Typography>
              <Button variant={file ? 'outlined' : 'contained'} component="label" size="small" disabled={uploading}>
                {file ? 'Change File' : 'Browse File'}
                <input type="file" hidden accept=".xlsx,.xls" onChange={handleFileChange} />
              </Button>
            </Paper>

            <Alert severity="info" sx={{ py: 0.5, fontSize: '0.82rem' }}>
              Select the <strong>same month/year</strong> as the payroll you want to affect. Existing{' '}
              <strong>Draft</strong> payrolls for that month are updated immediately. Locked (non-Draft)
              payrolls are skipped. If no payroll exists yet, the cut applies on Bulk Create / regenerate.
              Loan &amp; advance are not scaled; EOBI stays full.
            </Alert>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Alert
              severity={result.payrollUpdatedCount > 0 ? 'success' : 'warning'}
              icon={<SuccessIcon fontSize="inherit" />}
            >
              <Typography variant="subtitle2" fontWeight={700}>
                Import Complete!
              </Typography>
              Saved <strong>{result.percentage}%</strong> cut for{' '}
              <strong>{result.savedCount}</strong> employees (
              {MONTHS.find((m) => m.value === result.month)?.label} {result.year}). Draft payrolls updated:{' '}
              <strong>{result.payrollUpdatedCount}</strong>.
              {result.payrollUpdatedCount === 0 && result.savedCount > 0 ? (
                <Typography variant="body2" sx={{ mt: 0.75 }}>
                  No Draft payroll was changed for this period. Either payrolls are locked, none exist yet
                  (run Bulk Create / regenerate for this month), or they already had this cut.
                </Typography>
              ) : null}
            </Alert>

            {result.notFoundCount > 0 && (
              <Alert severity="warning" icon={<WarningIcon fontSize="inherit" />}>
                <strong>{result.notFoundCount}</strong> employee IDs not found:
                <Typography variant="caption" display="block" sx={{ mt: 0.5, fontFamily: 'monospace' }}>
                  {result.unmatchedList.join(', ')}
                </Typography>
              </Alert>
            )}

            {(result.payrollSkippedLocked > 0 || result.payrollSkippedAlreadyCut > 0) && (
              <Alert severity="info">
                Locked payrolls skipped: {result.payrollSkippedLocked || 0}. Already-cut drafts skipped:{' '}
                {result.payrollSkippedAlreadyCut || 0}.
              </Alert>
            )}

            <Typography variant="subtitle2" fontWeight={600}>
              Employees
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 240 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.100' }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.100' }}>EMP ID</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.100' }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: 'grey.100' }}>Payroll</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(result.updatedDetails || []).map((item, idx) => (
                    <TableRow key={`${item.employeeId}-${idx}`}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>{item.employeeId}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>
                        <Typography variant="caption">{item.payrollNote}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        {!result ? (
          <>
            <Button onClick={handleClose} disabled={uploading}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={handleUpload}
              disabled={!file || uploading || !percentage}
              startIcon={uploading ? <CircularProgress size={16} /> : <UploadIcon />}
            >
              {uploading ? 'Processing...' : 'Upload & Apply'}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={handleClose}>
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
