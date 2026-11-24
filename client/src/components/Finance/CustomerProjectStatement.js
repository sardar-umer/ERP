import React from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Grid, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography
} from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateText = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');
const TYPE_COLOR = {
  Invoice: 'primary', Receipt: 'success', 'Vendor bill': 'warning', 'Vendor advance': 'secondary',
  'Vendor payment': 'error', 'Journal voucher': 'default'
};

const exportCsv = (statement, customerName) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const s = statement.summary || {};
  const rows = [
    ['Project statement', customerName || ''],
    ['Cost center', (statement.costCenters || []).map((c) => [c.code, c.name].filter(Boolean).join(' ')).join(', ')],
    [],
    ['Invoiced', s.invoiced], ['Received', s.received], ['Outstanding', s.outstanding],
    ['Expenses booked', s.expensesBooked], ['Vendor advances not yet billed', s.openAdvances], ['Project cost', s.projectCost],
    ['Paid to vendors', s.paidToVendors], ['Cash position (received - paid)', s.cashPosition],
    ['Profit', s.profit], ['Profit %', s.profitPercent],
    [],
    ['Date', 'Type', 'Voucher #', 'Reference', 'Vendor', 'Description', 'Invoiced', 'Received', 'Cost booked', 'Paid to vendor', 'Cash position'],
    ...(statement.entries || []).map((e) => [
      dateText(e.date), e.type, e.voucher, e.reference, e.party, e.description,
      e.invoiced || '', e.received || '', e.cost || '', e.paidOut || '', e.cashPosition
    ])
  ];
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `project-statement-${String(customerName || 'customer').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/**
 * Cost Center tab: the customer's project from the posted books — invoices and receipts, and every vendor
 * bill / advance / payment / journal voucher tagged to the project's cost center.
 */
export default function CustomerProjectStatement({ statement, customerName }) {
  if (!statement) {
    return <Alert severity="info">Project statement is not available.</Alert>;
  }
  const s = statement.summary || {};
  const entries = statement.entries || [];
  const cards = [
    { label: 'Invoiced', value: s.invoiced, color: 'primary.main' },
    { label: 'Received', value: s.received, color: 'success.main', note: `Outstanding ${fmt(s.outstanding)}` },
    {
      label: 'Project cost', value: s.projectCost, color: 'warning.main',
      note: `Expenses ${fmt(s.expensesBooked)} + advances not yet billed ${fmt(s.openAdvances)}`
    },
    { label: 'Paid to vendors', value: s.paidToVendors, color: 'error.main', note: `Cash position ${fmt(s.cashPosition)}` },
    { label: 'Profit', value: s.profit, color: (s.profit || 0) >= 0 ? 'success.main' : 'error.main', note: `${Number(s.profitPercent || 0).toFixed(2)}% of invoiced` }
  ];

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1} mb={2}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>Project statement</Typography>
          <Typography variant="body2" color="text.secondary">
            {statement.hasCostCenter
              ? `Cost center: ${(statement.costCenters || []).map((c) => [c.code, c.name].filter(Boolean).join(' ')).join(', ')} · from posted entries`
              : 'From posted entries'}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportCsv(statement, customerName)}>
          Export to Excel
        </Button>
      </Stack>

      {!statement.hasCostCenter && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This customer's invoices have no cost center, so vendor bills, advances and payments for the project can't be linked.
          Give the project a cost center on its invoice, and pick the same cost center on every PO, vendor bill, advance and payment for it.
        </Alert>
      )}

      <Grid container spacing={2} mb={3}>
        {cards.map((c) => (
          <Grid item xs={12} sm={6} md key={c.label}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                <Typography variant="h6" fontWeight={700} color={c.color}>PKR {fmt(c.value)}</Typography>
                {c.note ? <Typography variant="caption" color="text.secondary">{c.note}</Typography> : null}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell><b>Date</b></TableCell>
              <TableCell><b>Type</b></TableCell>
              <TableCell><b>Voucher #</b></TableCell>
              <TableCell><b>Vendor / Details</b></TableCell>
              <TableCell align="right"><b>Invoiced</b></TableCell>
              <TableCell align="right"><b>Received</b></TableCell>
              <TableCell align="right"><b>Cost booked</b></TableCell>
              <TableCell align="right"><b>Paid to vendor</b></TableCell>
              <TableCell align="right"><b>Cash position</b></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((e, i) => (
              <TableRow key={`${e.voucher}-${i}`} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateText(e.date)}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={e.type} color={TYPE_COLOR[e.type] || 'default'} /></TableCell>
                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {e.voucher || '—'}
                  {e.reference && e.reference !== e.voucher ? (
                    <Typography variant="caption" color="text.secondary" display="block">{e.reference}</Typography>
                  ) : null}
                </TableCell>
                <TableCell sx={{ maxWidth: 360 }}>
                  {e.party ? <Typography variant="body2" fontWeight={600}>{e.party}</Typography> : null}
                  <Tooltip title={e.description || ''}>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">{e.description || ''}</Typography>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">{e.invoiced ? fmt(e.invoiced) : ''}</TableCell>
                <TableCell align="right" sx={{ color: 'success.main' }}>{e.received ? fmt(e.received) : ''}</TableCell>
                <TableCell align="right" sx={{ color: 'warning.dark' }}>{e.cost ? fmt(e.cost) : ''}</TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>{e.paidOut ? fmt(e.paidOut) : ''}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, color: e.cashPosition < 0 ? 'error.main' : undefined }}>{fmt(e.cashPosition)}</TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 3, color: 'text.secondary' }}>No entries for this project.</TableCell>
              </TableRow>
            )}
            {entries.length > 0 && (
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell colSpan={4}><b>Total</b></TableCell>
                <TableCell align="right"><b>{fmt(s.invoiced)}</b></TableCell>
                <TableCell align="right"><b>{fmt(s.received)}</b></TableCell>
                <TableCell align="right"><b>{fmt(s.expensesBooked)}</b></TableCell>
                <TableCell align="right"><b>{fmt(s.paidToVendors)}</b></TableCell>
                <TableCell align="right"><b>{fmt(s.cashPosition)}</b></TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        Project cost = expenses booked on the cost center + vendor advances paid but not yet set off against a bill.
        Profit = invoiced − project cost. Cash position = received − paid to vendors.
      </Typography>
    </Box>
  );
}
