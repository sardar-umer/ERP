import React from 'react';
import {
  Box, Paper, Typography, Grid, Divider, Stack, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import { AttachFile as AttachFileIcon } from '@mui/icons-material';
import { getDocCompanyName } from '../../utils/documentCompany';
import { resolveUploadFileHref } from '../../utils/uploadPaths';
import { ChargedToPanel } from './ChargedToPanel';

/**
 * Full Goods Received Note, as on the GRN's own view (Procurement → Store → GRN), for a vendor bill's
 * GRN(s) tab — so the Procurement approver, Pre-Audit and Finance all see the complete GRN and its files.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return `${String(x.getDate()).padStart(2, '0')}-${MONTHS[x.getMonth()]}-${x.getFullYear()}`;
};
const formatNumber = (n) => ((n == null || n === '')
  ? ''
  : Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const cell = { border: '1px solid', borderColor: 'divider' };
const head = { ...cell, fontWeight: 'bold', bgcolor: 'grey.100' };

const Field = ({ label, value, first }) => (
  <>
    <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: first ? 0 : 1 }}>{label}</Typography>
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</Typography>
  </>
);

const costCenterLabel = (cc) => (cc && typeof cc === 'object'
  ? [cc.code, cc.path || cc.name].filter(Boolean).join(' — ')
  : '');

const challanLabel = (dc) => {
  if (!dc) return '';
  if (typeof dc !== 'object') return String(dc);
  return `${dc.dcNumber || ''}${dc.gatePassNo ? ` · ${dc.gatePassNo}` : ''}${dc.status ? ` (${dc.status})` : ''}`;
};

const GrnCopyView = ({ grn, companyName, poNumber }) => {
  if (!grn) return null;
  const company = getDocCompanyName(grn, '') || companyName || '';
  const preparedBy = grn.preparedByName
    || [grn.receivedBy?.firstName, grn.receivedBy?.lastName].filter(Boolean).join(' ')
    || '—';
  const attachments = Array.isArray(grn.attachments) ? grn.attachments : [];

  return (
    <Paper sx={{ p: { xs: 2, md: 4 }, mb: 3, maxWidth: 1100, mx: 'auto', backgroundColor: '#fff', border: '1px solid', borderColor: 'divider' }}>
      <Grid container sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 2 }} alignItems="center">
        <Grid item xs={12} md={4}>
          <Typography variant="h6" fontWeight="bold">{company || '—'}</Typography>
          <Typography variant="body2" color="textSecondary">Head Office</Typography>
        </Grid>
        <Grid item xs={12} md={4} sx={{ textAlign: { xs: 'left', md: 'center' } }}>
          <Typography variant="h5" fontWeight="bold">Goods Received Note</Typography>
        </Grid>
        <Grid item xs={12} md={4} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
          {grn.status && <Chip size="small" label={grn.status} variant="outlined" />}
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Typography variant="caption" color="textSecondary">No.</Typography>
          <Typography variant="body1" fontWeight="bold">{grn.receiveNumber || grn._id}</Typography>
          <Field label="Company" value={company} />
          <Field label="Supplier" value={[grn.supplier?.supplierId, grn.supplierName || grn.supplier?.name].filter(Boolean).join(' ')} />
          <Field label="Address" value={grn.supplierAddress || grn.supplier?.address} />
          <Field label="Narration" value={grn.narration} />
        </Grid>
        <Grid item xs={12} md={6}>
          <Field label="Date" value={formatDate(grn.receiveDate)} first />
          <Field label="Currency" value={grn.currency || 'Rupees'} />
          <Field label="P.R No." value={grn.prNumber} />
          <Field label="P.O No." value={grn.poNumber || grn.purchaseOrder?.orderNumber || poNumber} />
          <Field label="Cost Center" value={costCenterLabel(grn.costCenter)} />
          {grn.deliveryChallan && <Field label="Delivery challan" value={challanLabel(grn.deliveryChallan)} />}
          <Field label="Store" value={grn.store} />
          <Field label="Gate Pass No." value={grn.gatePassNo} />
        </Grid>
      </Grid>

      <ChargedToPanel chargeTo={grn.chargeTo} items={grn.items} />

      <TableContainer sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={head}>S. No</TableCell>
              <TableCell sx={head}>Product Code</TableCell>
              <TableCell sx={head}>Description</TableCell>
              <TableCell sx={head}>Unit</TableCell>
              <TableCell sx={head} align="right">Quantity</TableCell>
              <TableCell sx={head} align="right">Rate</TableCell>
              <TableCell sx={head} align="right">Value Excluding Sales Tax</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(grn.items || []).length === 0 ? (
              <TableRow><TableCell colSpan={7} sx={{ ...cell, textAlign: 'center' }}>No items on this GRN</TableCell></TableRow>
            ) : grn.items.map((item, idx) => (
              <TableRow key={idx}>
                <TableCell sx={cell}>{idx + 1}</TableCell>
                <TableCell sx={cell}>{item.productCode || item.itemCode || '—'}</TableCell>
                <TableCell sx={{ ...cell, wordBreak: 'break-word' }}>{item.itemName || '—'}</TableCell>
                <TableCell sx={cell}>{item.unit || '—'}</TableCell>
                <TableCell sx={cell} align="right">{formatNumber(item.quantity)}</TableCell>
                <TableCell sx={cell} align="right">{formatNumber(item.unitPrice)}</TableCell>
                <TableCell sx={cell} align="right">{formatNumber(item.valueExcludingSalesTax ?? ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Grid container spacing={1} sx={{ maxWidth: 320 }}>
          <Grid item xs={6}><Typography variant="body2">Discount</Typography></Grid>
          <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2">{formatNumber(grn.discount)}</Typography></Grid>
          <Grid item xs={6}><Typography variant="body2">Other Charges</Typography></Grid>
          <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2">{formatNumber(grn.otherCharges)}</Typography></Grid>
          <Grid item xs={6}><Typography variant="body2" fontWeight="bold">Net Amount</Typography></Grid>
          <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight="bold">{formatNumber(grn.netAmount)}</Typography></Grid>
          <Grid item xs={6}><Typography variant="body2" fontWeight="bold">Total</Typography></Grid>
          <Grid item xs={6} sx={{ textAlign: 'right' }}><Typography variant="body2" fontWeight="bold">{formatNumber(grn.total ?? grn.netAmount)}</Typography></Grid>
        </Grid>
      </Box>

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="textSecondary">Observation</Typography>
      <Typography variant="body2" sx={{ minHeight: 24 }}>{grn.observation || ' '}</Typography>
      <Box sx={{ mt: 3 }}>
        <Typography variant="caption" color="textSecondary">Prepared By</Typography>
        <Typography variant="body2" fontWeight="medium">{preparedBy}</Typography>
      </Box>

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>GRN Attachments ({attachments.length})</Typography>
      {attachments.length === 0 ? (
        <Typography variant="body2" color="textSecondary">No files attached to this GRN.</Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {attachments.map((att, idx) => {
            const href = resolveUploadFileHref(att.path || att.url || '');
            return (
              <Chip
                key={att._id || idx}
                size="small"
                variant="outlined"
                icon={<AttachFileIcon />}
                label={att.filename || att.originalName || `Attachment ${idx + 1}`}
                component="a"
                href={href || undefined}
                target="_blank"
                rel="noopener noreferrer"
                clickable
              />
            );
          })}
        </Stack>
      )}
    </Paper>
  );
};

export default GrnCopyView;
