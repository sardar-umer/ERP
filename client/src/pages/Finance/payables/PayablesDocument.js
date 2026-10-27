import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Breadcrumbs, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Link,
  Skeleton, Stack, TableCell, TableRow, Tooltip, Typography
} from '@mui/material';
import {
  Close as CloseIcon, Description as DocsIcon, Payments as PayIcon, Print as PrintIcon, Savings as AdvanceIcon
} from '@mui/icons-material';
import api from '../../../services/api';
import AccountsPayable from '../AccountsPayable';
import VendorAdvance from '../VendorAdvance';
import PODocumentView from '../../Procurement/Store/PODocumentView';
import { PO_A4_ONE_PAGE_PRINT_CSS, printPoFitToOneA4 } from '../../../utils/poA4PrintStyles';
import {
  ActionBar, InfoCard, JournalCard, NotesBlock, SectionHeading, StatusChip, TableCard, TotalsCard, fmtDate, money
} from './PayablesDetailParts';

const DETAILS_TITLE = { bill: 'Bill details', 'cash-approval': 'Cash approval details', po: 'Purchase order details' };

const CashApprovals = lazy(() => import('../../Procurement/CashApprovals'));
const HUB = '/finance/payables-hub';

/**
 * One payable (vendor bill / cash approval / PO advance) on a single page: details, lines, totals, payments made
 * and accounting entries, with Pay opening the same payment window the hub uses (authorities, WHT, intercompany
 * and vouchers unchanged). Each payment row opens its payment page.
 */
export default function PayablesDocument() {
  const { kind, id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  // Existing windows opened from here
  const [payBillId, setPayBillId] = useState(null);
  const [caId, setCaId] = useState(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [sourceBillId, setSourceBillId] = useState(null);
  const [sourceCaId, setSourceCaId] = useState(null);
  const [poView, setPoView] = useState({ open: false, data: null });

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await api.get(`/finance/payables-hub/document/${kind}/${id}`);
      setDoc(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the document');
    }
  }, [kind, id]);
  useEffect(() => { load(); }, [load]);

  const afterPay = useCallback(() => { setPayBillId(null); setCaId(null); setAdvanceOpen(false); load(); }, [load]);
  const closeSource = useCallback(() => { setSourceBillId(null); setSourceCaId(null); }, []);

  const pay = () => {
    if (doc.action === 'pay_bill') setPayBillId(String(doc.id));
    else if (doc.action === 'cash_approval') setCaId(String(doc.id));
    else if (doc.action === 'po_advance') setAdvanceOpen(true);
  };

  const openSource = async () => {
    if (doc.kind === 'bill') setSourceBillId(String(doc.id));
    else if (doc.kind === 'cash-approval') setSourceCaId(String(doc.id));
    else {
      setPoView({ open: true, data: null });
      try {
        const res = await api.get(`/procurement/purchase-orders/${doc.id}`);
        setPoView({ open: true, data: res.data?.data || null });
      } catch {
        setPoView({ open: false, data: null });
      }
    }
  };

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} component={RouterLink} to={HUB}>Back to payables</Button>
      </Box>
    );
  }
  if (!doc) return <Box sx={{ p: 3 }}><Skeleton width={320} height={48} /><Skeleton variant="rounded" height={480} sx={{ mt: 2 }} /></Box>;

  const PayIconFor = doc.action === 'po_advance' ? AdvanceIcon : PayIcon;
  const payLabel = doc.action === 'pay_bill' ? 'Pay bill' : (doc.actionLabel || 'Pay');

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1400 }}>
      <Breadcrumbs sx={{ mb: 0.5 }}>
        <Link component={RouterLink} to={HUB} underline="hover" variant="body2">Payables</Link>
        <Typography variant="body2" color="text.secondary">{doc.kindLabel}</Typography>
      </Breadcrumbs>
      <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap" sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>{doc.kindLabel} {doc.number}</Typography>
        <StatusChip status={doc.status} />
        {doc.balance > 0.01 && <Chip size="small" color="warning" label={`Balance due ${money(doc.balance)}`} sx={{ fontWeight: 600 }} />}
      </Stack>

      <InfoCard title={DETAILS_TITLE[doc.kind] || 'Details'} fields={doc.fields} links={doc.links || []} />

      <TableCard
        title="Line items"
        columns={[
          { key: 'description', label: 'Description' },
          { key: 'quantity', label: 'Qty', align: 'right' },
          { key: 'rate', label: 'Rate', align: 'right', render: (r) => money(r.rate) },
          { key: 'taxRate', label: 'Tax %', align: 'right', render: (r) => (r.taxRate ? `${r.taxRate}%` : '—') },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) }
        ]}
        rows={doc.lines}
        empty="No line items"
      />

      <TotalsCard
        title="Amount summary"
        lines={[...doc.totals, { label: 'Balance due', amount: doc.balance, bold: true }]}
        left={<NotesBlock notes={doc.notes} />}
      />

      <TableCard
        title="Payments made"
        subtitle="Bank payments and advances adjusted against this document"
        right={doc.payments.length ? 'Click a payment to open it' : ''}
        columns={[
          { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
          { key: 'kind', label: 'Type' },
          { key: 'method', label: 'Paid by', render: (r) => [r.method, r.bank].filter(Boolean).join(' · ') || '—' },
          { key: 'reference', label: 'Reference', render: (r) => r.reference || '—' },
          { key: 'status', label: 'Status', render: (r) => <StatusChip status={r.status} /> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) }
        ]}
        rows={doc.payments}
        footer={doc.payments.length > 1 ? (
          <TableRow sx={{ '& td': { fontWeight: 600 } }}>
            <TableCell colSpan={5}>Total</TableCell>
            <TableCell align="right">{money(doc.payments.reduce((t, p) => t + (Number(p.amount) || 0), 0))}</TableCell>
          </TableRow>
        ) : null}
        empty="No payments yet"
        onRowClick={(r) => r.journalEntryId && navigate(`${HUB}/payment/${r.journalEntryId}`)}
      />

      {doc.journals.length > 0 && <SectionHeading>Accounting entries ({doc.journals.length})</SectionHeading>}
      {doc.journals.map((j) => (
        <JournalCard key={j.id} journal={j} title={`Accounting entry — ${j.role || 'Entry'}`} />
      ))}

      <ActionBar>
        <Tooltip title={doc.action ? '' : doc.actionDisabledReason}>
          <span>
            <Button variant="contained" color="success" startIcon={<PayIconFor />} disabled={!doc.action} onClick={pay}>
              {payLabel}
            </Button>
          </span>
        </Tooltip>
        {doc.printUrl && (
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.open(doc.printUrl, '_blank', 'noopener')}>Print</Button>
        )}
        <Button variant="outlined" startIcon={<DocsIcon />} onClick={openSource}>
          {doc.kind === 'po' ? 'Purchase order' : 'Source documents'}
        </Button>
        <Link component={RouterLink} to={HUB} underline="hover" sx={{ ml: 0.5 }}>Back to list</Link>
        {!doc.action && doc.actionDisabledReason && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>{doc.actionDisabledReason}</Typography>
        )}
      </ActionBar>

      {/* Existing payment / view windows. The pages mount hidden; their dialogs show on top of this page. */}
      {payBillId && <Box sx={{ display: 'none' }}><AccountsPayable embedPayBillId={payBillId} onEmbedClose={afterPay} /></Box>}
      {sourceBillId && <Box sx={{ display: 'none' }}><AccountsPayable embedViewBillId={sourceBillId} onEmbedClose={closeSource} /></Box>}
      {(caId || sourceCaId) && (
        <Box sx={{ display: 'none' }}>
          <Suspense fallback={null}>
            {caId
              ? <CashApprovals embedCaId={caId} onEmbedClose={afterPay} />
              : <CashApprovals embedViewCaId={sourceCaId} onEmbedClose={closeSource} />}
          </Suspense>
        </Box>
      )}
      {(payBillId || caId || sourceBillId || sourceCaId) && <Box sx={{ position: 'fixed', bottom: 16, right: 16 }}><CircularProgress size={20} /></Box>}

      <Dialog open={advanceOpen} onClose={afterPay} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
          <AdvanceIcon color="primary" />
          <Box component="span" sx={{ flex: 1 }}>Pay vendor advance — {doc.number}</Box>
          <IconButton onClick={afterPay} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {advanceOpen && (
            <VendorAdvance
              embedPrefill={{
                companyId: doc.companyId ? String(doc.companyId) : '',
                vendorId: doc.vendorId,
                vendorName: doc.party,
                po: doc.po
              }}
              onEmbedSubmitted={afterPay}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={poView.open} onClose={() => setPoView({ open: false, data: null })} maxWidth={false} fullWidth
        className="payables-po-print" PaperProps={{ sx: { width: '90%', maxWidth: '210mm', maxHeight: '95vh', m: 2 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Box component="span" sx={{ flex: 1 }}>Purchase Order {doc.number}</Box>
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} disabled={!poView.data} onClick={() => printPoFitToOneA4()}>Print</Button>
          <IconButton onClick={() => setPoView({ open: false, data: null })} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {poView.data ? <PODocumentView data={poView.data} /> : <Box sx={{ p: 3 }}><Skeleton height={400} /></Box>}
        </DialogContent>
      </Dialog>
      {poView.open && (
        <Box component="style" dangerouslySetInnerHTML={{ __html: `
          @media print {
            body * { visibility: hidden; }
            .payables-po-print .po-print-page, .payables-po-print .po-print-page * { visibility: visible; }
            .payables-po-print .MuiDialog-container { position: absolute !important; inset: 0 !important; display: block !important; }
            .payables-po-print .MuiDialog-paper { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; width: 100% !important; max-height: none !important; overflow: visible !important; }
            .payables-po-print .MuiDialogContent-root { overflow: visible !important; padding: 0 !important; }
            .payables-po-print .MuiDialogTitle-root, .MuiBackdrop-root { display: none !important; }
            ${PO_A4_ONE_PAGE_PRINT_CSS}
          }
        ` }} />
      )}
    </Box>
  );
}
