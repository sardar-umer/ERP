import React from 'react';
import { Box, Chip, Divider, Grid, Paper, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { formatPKR } from '../../utils/currency';
import { formatDateTime } from '../../utils/dateUtils';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const personName = (u) => (u && typeof u === 'object'
  ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || ''
  : '');

const EARNINGS = [
  ['basicSalary', 'Basic Salary'],
  ['houseRentAllowance', 'House Rent'],
  ['medicalAllowance', 'Medical Allowance'],
  ['conveyanceAllowance', 'Conveyance Allowance'],
  ['vehicleAllowance', 'Vehicle Allowance'],
  ['fuelAllowance', 'Fuel Allowance'],
  ['foodAllowance', 'Food Allowance'],
  ['specialAllowance', 'Special Allowance'],
  ['otherAllowance', 'Other Allowance']
];

/** Read-only manual salary record for the Pre-Audit review dialog */
export default function ManualSalaryAuditView({ record: r }) {
  if (!r) return null;
  const period = `${MONTHS[(r.month || 1) - 1]} ${r.year}`;
  const steps = [
    ['Initiated by HR', r.initiator, r.initiatedAt || r.createdAt, ''],
    ['GM HR', r.hodApprovedBy, r.hodApprovedAt, r.hodComments],
    ['AVP Taj', r.avpApprovedBy, r.avpApprovedAt, r.avpComments],
    ...(r.ceoApprovedAt ? [['CEO (old flow)', r.ceoApprovedBy, r.ceoApprovedAt, r.ceoComments]] : []),
    ['Pre-Audit (initial)', r.preAuditInitialApprovedBy, r.preAuditInitialApprovedAt, r.preAuditInitialComments],
    ['Audit Director', r.auditApprovedBy, r.auditApprovedAt, r.auditComments]
  ];

  return (
    <Box sx={{ p: 1 }}>
      <Typography variant="overline" color="text.secondary">{r.companyName || 'Sardar Group of Companies'}</Typography>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>{r.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {[r.empId, r.designation, r.project].filter(Boolean).join(' · ') || 'Manual salary'}
          </Typography>
          <Typography variant="body2" color="text.secondary">Period: {period}{r.doj ? ` · DOJ: ${r.doj}` : ''}</Typography>
        </Box>
        <Chip label={r.workflowStatus} color="primary" variant="outlined" />
      </Stack>

      <Paper variant="outlined">
        <Table size="small">
          <TableBody>
            {EARNINGS.filter(([k]) => Number(r[k]) > 0).map(([k, label]) => (
              <TableRow key={k}>
                <TableCell>{label}</TableCell>
                <TableCell align="right">{formatPKR(r[k])}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Gross Salary</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>{formatPKR(r.grossSalary)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Income Tax</TableCell>
              <TableCell align="right">({formatPKR(r.incomeTax)})</TableCell>
            </TableRow>
            <TableRow sx={{ bgcolor: '#fffde7' }}>
              <TableCell sx={{ fontWeight: 700 }}>Net Payable</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>{formatPKR(r.netPayable)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>
      {r.remarks ? <Typography variant="body2" sx={{ mt: 1 }}>Remarks / bank: {r.remarks}</Typography> : null}

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Approval trail</Typography>
      <Grid container spacing={1}>
        {steps.map(([label, by, at, note]) => (
          <Grid item xs={12} sm={6} md={4} key={label}>
            <Paper variant="outlined" sx={{ p: 1.25, height: '100%', borderLeft: 4, borderLeftColor: at ? 'success.main' : 'grey.300' }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">{label}</Typography>
              <Typography variant="body2" fontWeight={600}>{personName(by) || (at ? 'Approved' : 'Not yet')}</Typography>
              {at ? <Typography variant="caption" color="text.secondary">{formatDateTime(at)}</Typography> : null}
              {note ? <Typography variant="body2" sx={{ mt: 0.5 }}>“{note}”</Typography> : null}
            </Paper>
          </Grid>
        ))}
      </Grid>

      {(r.auditObservations || []).length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Audit observations</Typography>
          {r.auditObservations.map((o, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1.25, mb: 1 }}>
              <Chip size="small" label={o.severity} sx={{ mr: 1 }} />
              <Typography variant="body2" component="span">{o.observation}</Typography>
            </Paper>
          ))}
        </>
      )}
    </Box>
  );
}
