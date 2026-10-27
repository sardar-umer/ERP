import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Breadcrumbs, Button, Link, Skeleton, Stack, TableCell, TableRow, Typography } from '@mui/material';
import { Print as PrintIcon, ReceiptLong as VoucherIcon } from '@mui/icons-material';
import api from '../../../services/api';
import {
  ActionBar, InfoCard, JournalCard, SectionHeading, StatusChip, TableCard, TotalsCard, fmtDate, money
} from './PayablesDetailParts';

const HUB = '/finance/payables-hub';

/**
 * One payment (its voucher) on the same layout as the document page: payee / bank details, the documents it paid,
 * applied → WHT → paid from bank → settled, finance authority sign-offs and the accounting entry.
 */
export default function PayablesPayment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setPayment(null);
    api.get(`/finance/payables-hub/payment/${id}`)
      .then((res) => setPayment(res.data?.data || null))
      .catch((err) => setError(err.response?.data?.message || 'Could not load the payment'));
  }, [id]);

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} component={RouterLink} to={HUB}>Back to payables</Button>
      </Box>
    );
  }
  if (!payment) return <Box sx={{ p: 3 }}><Skeleton width={320} height={48} /><Skeleton variant="rounded" height={480} sx={{ mt: 2 }} /></Box>;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1400 }}>
      <Breadcrumbs sx={{ mb: 0.5 }}>
        <Link component={RouterLink} to={HUB} underline="hover" variant="body2">Payables</Link>
        <Typography variant="body2" color="text.secondary">Payments</Typography>
      </Breadcrumbs>
      <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap" sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>{payment.kindLabel} {payment.number}</Typography>
        <StatusChip status={payment.status} />
      </Stack>

      <InfoCard title="Payment details" fields={payment.fields} />

      <TableCard
        title="Documents paid"
        subtitle="Bills, POs and cash approvals settled by this payment"
        right={payment.documents.length ? 'Click a document to open it' : ''}
        columns={[
          { key: 'number', label: 'Document', render: (r) => <Typography variant="body2" color="primary" fontWeight={600}>{r.type} {r.number}</Typography> },
          { key: 'reference', label: 'Supplier inv. / reference', render: (r) => r.reference || '—' },
          { key: 'date', label: 'Document date', render: (r) => fmtDate(r.date) },
          { key: 'amount', label: 'Paid', align: 'right', render: (r) => money(r.amount) }
        ]}
        rows={payment.documents}
        footer={payment.documents.length > 1 ? (
          <TableRow sx={{ '& td': { fontWeight: 600 } }}>
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell align="right">{money(payment.documents.reduce((t, d) => t + (Number(d.amount) || 0), 0))}</TableCell>
          </TableRow>
        ) : null}
        empty="No linked documents"
        onRowClick={(r) => r.id && navigate(`${HUB}/document/${r.kind}/${r.id}`)}
      />

      <TotalsCard title="Payment summary" lines={payment.summary} />

      {payment.approvals.length > 0 && (
        <TableCard
          title="Finance authority sign-off"
          columns={[
            { key: 'label', label: 'Authority' },
            { key: 'by', label: 'Name', render: (r) => r.by || '—' },
            { key: 'decision', label: 'Decision', render: (r) => <StatusChip status={r.decision === 'rejected' ? 'Rejected' : 'Approved'} /> },
            { key: 'at', label: 'Date', align: 'right', render: (r) => fmtDate(r.at) }
          ]}
          rows={payment.approvals}
        />
      )}

      {payment.journals.length > 0 && <SectionHeading>Accounting entries ({payment.journals.length})</SectionHeading>}
      {payment.journals.map((j) => (
        <JournalCard key={j.id} journal={j} title={`Accounting entry — ${j.role || 'Payment'}`} />
      ))}

      <ActionBar>
        <Button variant="contained" startIcon={<VoucherIcon />} onClick={() => navigate(payment.voucherUrl)}>Open voucher</Button>
        <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
        <Link component="button" type="button" underline="hover" onClick={() => navigate(-1)} sx={{ ml: 0.5 }}>Back</Link>
      </ActionBar>
    </Box>
  );
}
