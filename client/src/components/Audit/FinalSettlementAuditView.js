import React from 'react';
import { Box, Chip, Divider, Grid, Paper, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { formatPKR } from '../../utils/currency';
import { formatDateTime } from '../../utils/dateUtils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const personName = (u) => (u && typeof u === 'object'
  ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || ''
  : '');

const EARNINGS = [
  ['basicSalary', 'Basic Salary'], ['houseRent', 'House Rent'], ['medicalAllowance', 'Medical Allowance'],
  ['conveyanceAllowance', 'Conveyance Allowance'], ['foodAllowance', 'Food Allowance'], ['mobileAllowance', 'Mobile Allowance'],
  ['vehicleAllowance', 'Vehicle Allowance'], ['fuelAllowance', 'Fuel Allowance'], ['specialAllowance', 'Special Allowance'],
  ['otherAllowances', 'Other Allowances'], ['otherEarnings', 'Other Earnings'], ['overtime', 'Overtime'], ['bonus', 'Bonus'],
  ['gratuity', 'Gratuity'], ['leaveEncashment', 'Leave Encashment'], ['noticePay', 'Notice Pay'],
  ['providentFund', 'Provident Fund'], ['eobi', 'EOBI']
];
const DEDUCTIONS = [
  ['incomeTax', 'Income Tax'], ['providentFund', 'Provident Fund'], ['eobi', 'EOBI'], ['loanDeductions', 'Loan Deductions'],
  ['noticePeriodDeduction', 'Notice Period Deduction'], ['security', 'Security'], ['healthInsurance', 'Health Insurance'],
  ['advanceDeductions', 'Advance Deductions'], ['pension', 'Pension'], ['otherDeductions', 'Other Deductions']
];
const TYPE_LABEL = { resignation: 'Resignation', termination: 'Termination', retirement: 'Retirement', contract_end: 'Contract End', death: 'Death', other: 'Other' };

/** Read-only final settlement for the Pre-Audit review dialog */
export default function FinalSettlementAuditView({ record: r }) {
  if (!r) return null;
  const e = r.earnings || {};
  const d = r.deductions || {};
  const steps = [
    ['Forwarded by HR', r.forwardedBy, r.forwardedAt, ''],
    ['GM HR', r.hodApprovedBy, r.hodApprovedAt, r.hodComments],
    ...(r.avpApprovedAt ? [['AVP (old flow)', r.avpApprovedBy, r.avpApprovedAt, r.avpComments]] : []),
    ['Pre-Audit (initial)', r.preAuditInitialApprovedBy, r.preAuditInitialApprovedAt, r.preAuditInitialComments],
    ['Audit Director', r.auditApprovedBy, r.auditApprovedAt, r.auditComments],
    ['CEO', r.ceoApprovedBy, r.ceoApprovedAt, r.ceoComments]
  ];
  const row = (label, v, bold, neg) => (
    <TableRow key={label} sx={bold ? { bgcolor: '#fafafa' } : undefined}>
      <TableCell sx={bold ? { fontWeight: 700 } : undefined}>{label}</TableCell>
      <TableCell align="right" sx={bold ? { fontWeight: 700 } : undefined}>{neg ? `(${formatPKR(v)})` : formatPKR(v)}</TableCell>
    </TableRow>
  );

  return (
    <Box sx={{ p: 1 }}>
      <Typography variant="overline" color="text.secondary">{r.companyName || 'Final Settlement'}</Typography>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>{r.employeeName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {[r.employeeId, r.designation, r.department].filter((x) => x && x !== 'Unknown').join(' · ')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {TYPE_LABEL[r.settlementType] || r.settlementType || ''}
            {r.lastWorkingDate ? ` · Last working date: ${new Date(r.lastWorkingDate).toLocaleDateString('en-GB')}` : ''}
            {r.reason ? ` · Reason: ${r.reason}` : ''}
          </Typography>
        </Box>
        <Chip label={r.workflowStatus} color="primary" variant="outlined" />
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Earnings</Typography>
          <Paper variant="outlined">
            <Table size="small">
              <TableBody>
                {EARNINGS.filter(([k]) => Number(e[k]) > 0).map(([k, label]) => row(label, e[k]))}
                {(r.monthSalaries || []).map((m) => row(`Salary ${MONTHS[(m.month || 1) - 1]} ${m.year}${m.note ? ` (${m.note})` : ''}`, m.amount))}
                {row('Total Earnings', e.totalEarnings ?? r.grossSettlementAmount, true)}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Deductions</Typography>
          <Paper variant="outlined">
            <Table size="small">
              <TableBody>
                {DEDUCTIONS.filter(([k]) => Number(d[k]) > 0).map(([k, label]) => row(label, d[k], false, true))}
                {row('Total Deductions', d.totalDeductions || 0, true, true)}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ mt: 2, p: 1.5, bgcolor: '#fffde7', display: 'flex', justifyContent: 'space-between' }}>
        <Typography fontWeight={700}>Net Settlement</Typography>
        <Typography fontWeight={700}>{formatPKR(r.netSettlementAmount || 0)}</Typography>
      </Paper>

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Approval trail</Typography>
      <Grid container spacing={1}>
        {steps.map(([label, by, at, note]) => (
          <Grid item xs={12} sm={6} md={4} key={label}>
            <Paper variant="outlined" sx={{ p: 1.25, height: '100%', borderLeft: 4, borderLeftColor: at ? 'success.main' : 'grey.300' }}>
              <Typography variant="body2" fontWeight={700}>{label}</Typography>
              <Typography variant="body2" color="text.secondary">
                {[personName(by), at ? formatDateTime(at) : ''].filter(Boolean).join(' · ') || 'Not yet'}
              </Typography>
              {note ? <Typography variant="body2" sx={{ mt: 0.5 }}>“{note}”</Typography> : null}
            </Paper>
          </Grid>
        ))}
      </Grid>
      {(r.auditObservations || []).length > 0 ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Earlier audit observations</Typography>
          {r.auditObservations.map((o, i) => (
            <Typography key={i} variant="body2" color="text.secondary">
              • {o.observation}{o.addedBy ? ` — ${personName(o.addedBy)}` : ''}{o.addedAt ? `, ${formatDateTime(o.addedAt)}` : ''}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
