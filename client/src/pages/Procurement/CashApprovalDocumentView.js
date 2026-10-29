import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, CircularProgress, Alert, Divider, Grid,
  Table, TableBody, TableCell, TableHead, TableRow, Paper, TableContainer
} from '@mui/material';
import { Print as PrintIcon, ArrowBack as BackIcon } from '@mui/icons-material';
import procurementService from '../../services/procurementService';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import { formatPKR } from '../../utils/currency';
import { getDocCompanyName } from '../../utils/documentCompany';
import CashApprovalGeneralDetailShell from '../../components/CashApprovals/CashApprovalGeneralDetailShell';
import { isGeneralModuleCashApproval } from '../../components/CashApprovals/cashApprovalGeneralDocumentUtils';

const CashApprovalDocumentView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ca, setCa] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await procurementService.getCashApprovalById(id);
        const data = res.data;
        if (isGeneralModuleCashApproval(data)) {
          navigate(`/cash-approvals/${id}/view?from=print`, { replace: true });
          return;
        }
        setCa(data);
      } catch {
        setError('Failed to load Cash Approval');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!ca) return null;
  if (isGeneralModuleCashApproval(ca)) {
    return (
      <CashApprovalGeneralDetailShell ca={ca} onBack={() => navigate(-1)} backLabel="Back" />
    );
  }

  const aa = ca.approvalAuthorities || {};
  const indent = ca.indent && typeof ca.indent === 'object' ? ca.indent : {};
  const csa = indent.comparativeStatementApprovals || {};
  const approvalSteps = Array.isArray(indent?.comparativeApproval?.approvers)
    ? indent.comparativeApproval.approvers
    : [];
  const stepByUserId = new Map(
    approvalSteps.map((s) => [String(s?.approver?._id || s?.approver || ''), s])
  );
  const personName = (user, fallback = '') => (
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
    user?.email ||
    fallback ||
    '—'
  );
  const authorityRows = [
    { label: 'Prepared By', user: csa.preparedByUser, fallback: aa.preparedBy || csa.preparedBy || '' },
    { label: 'Verified By (Procurement Committee)', user: csa.verifiedByUser, fallback: aa.verifiedBy || csa.verifiedBy || '' },
    { label: 'Authorised Rep.', user: csa.authorisedRepUser, fallback: aa.authorisedRep || csa.authorisedRep || '' },
    { label: 'Finance Rep.', user: csa.financeRepUser, fallback: aa.financeRep || csa.financeRep || '' },
    { label: 'Manager Procurement', user: csa.managerProcurementUser, fallback: aa.managerProcurement || csa.managerProcurement || '' }
  ];

  return (
    <Box>
      {/* Screen-only action bar */}
      <Box sx={{ display: 'flex', gap: 1, p: 2, mb: 1 }} className="app-print-hide">
        <Button startIcon={<BackIcon />} onClick={() => navigate(-1)}>Back</Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
      </Box>

      {/* Printable document */}
      <Box sx={{ maxWidth: 900, mx: 'auto', p: 4, bgcolor: 'white', fontFamily: 'Arial, sans-serif' }}
        id="ca-print-area">

        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h5" fontWeight={700} sx={{ letterSpacing: 2, textTransform: 'uppercase' }}>
            CASH APPROVAL
          </Typography>
          <Typography variant="subtitle2" color="text.secondary">Sung Choi Group of Companies</Typography>
          <Divider sx={{ my: 1 }} />
        </Box>

        {/* Meta info */}
        <Grid container spacing={2} mb={2}>
          <Grid item xs={6}>
            <InfoRow label="CA Number" value={ca.caNumber} />
            <InfoRow label="Company" value={getDocCompanyName(ca)} />
            <InfoRow label="Approval Date" value={formatDate(ca.approvalDate)} />
            <InfoRow label="Expected Purchase Date" value={formatDate(ca.expectedPurchaseDate)} />
            <InfoRow label="Priority" value={ca.priority} />
          </Grid>
          <Grid item xs={6}>
            <InfoRow label="Vendor" value={ca.vendor?.name || '—'} />
            <InfoRow label="Vendor Contact" value={ca.vendor?.email || ca.vendor?.phone || '—'} />
            <InfoRow label="Status" value={ca.status} />
            {ca.deliveryAddress && <InfoRow label="Delivery Address" value={ca.deliveryAddress} />}
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        {/* Items Table */}
        <Typography variant="subtitle1" fontWeight={700} mb={1}>Items</Typography>
        <Table size="small" sx={{ border: '1px solid #ccc', mb: 2 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: '#f5f5f5' }}>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc', width: 40 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc' }}>Description</TableCell>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc' }}>Specification / Brand</TableCell>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc', textAlign: 'center' }}>Qty</TableCell>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc' }}>Unit</TableCell>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc', textAlign: 'right' }}>Unit Price</TableCell>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc', textAlign: 'right' }}>Tax %</TableCell>
              <TableCell sx={{ fontWeight: 700, border: '1px solid #ccc', textAlign: 'right' }}>Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(ca.items || []).map((item, i) => (
              <TableRow key={i}>
                <TableCell sx={{ border: '1px solid #ccc' }}>{i + 1}</TableCell>
                <TableCell sx={{ border: '1px solid #ccc' }}>{item.description}</TableCell>
                <TableCell sx={{ border: '1px solid #ccc' }}>{[item.specification, item.brand].filter(Boolean).join(' / ') || '—'}</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', textAlign: 'center' }}>{item.quantity}</TableCell>
                <TableCell sx={{ border: '1px solid #ccc' }}>{item.unit}</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', textAlign: 'right' }}>{formatPKR(item.unitPrice)}</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', textAlign: 'right' }}>{item.taxRate || 0}%</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', textAlign: 'right' }}>{formatPKR(item.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={7} sx={{ border: '1px solid #ccc', textAlign: 'right', fontWeight: 600 }}>Subtotal</TableCell>
              <TableCell sx={{ border: '1px solid #ccc', textAlign: 'right', fontWeight: 600 }}>{formatPKR(ca.subtotal)}</TableCell>
            </TableRow>
            {ca.taxAmount > 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ border: '1px solid #ccc', textAlign: 'right' }}>Tax</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', textAlign: 'right' }}>{formatPKR(ca.taxAmount)}</TableCell>
              </TableRow>
            )}
            {ca.shippingCost > 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ border: '1px solid #ccc', textAlign: 'right' }}>Shipping</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', textAlign: 'right' }}>{formatPKR(ca.shippingCost)}</TableCell>
              </TableRow>
            )}
            <TableRow sx={{ bgcolor: '#f5f5f5' }}>
              <TableCell colSpan={7} sx={{ border: '1px solid #ccc', textAlign: 'right', fontWeight: 700, fontSize: 15 }}>TOTAL AMOUNT</TableCell>
              <TableCell sx={{ border: '1px solid #ccc', textAlign: 'right', fontWeight: 700, fontSize: 15 }}>{formatPKR(ca.totalAmount)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* Finance / Advance info (if issued) */}
        {ca.advanceAmount > 0 && (
          <Box sx={{ border: '1px solid #ccc', p: 2, mb: 2, borderRadius: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} mb={1}>Advance Details</Typography>
            <Grid container spacing={1}>
              <Grid item xs={4}><InfoRow label="Advance To" value={ca.advanceToName || (ca.advanceTo ? `${ca.advanceTo.firstName} ${ca.advanceTo.lastName}` : '—')} /></Grid>
              <Grid item xs={4}><InfoRow label="Advance Amount" value={formatPKR(ca.advanceAmount)} /></Grid>
              <Grid item xs={4}><InfoRow label="Payment Method" value={ca.advancePaymentMethod} /></Grid>
              {ca.advanceVoucherNo && <Grid item xs={4}><InfoRow label="Voucher No." value={ca.advanceVoucherNo} /></Grid>}
              {ca.advanceIssuedBy && <Grid item xs={4}><InfoRow label="Issued By" value={`${ca.advanceIssuedBy.firstName} ${ca.advanceIssuedBy.lastName}`} /></Grid>}
              {ca.advanceIssuedAt && <Grid item xs={4}><InfoRow label="Issued On" value={formatDate(ca.advanceIssuedAt)} /></Grid>}
            </Grid>
          </Box>
        )}

        {/* Settlement info (if settled) */}
        {ca.actualAmountSpent > 0 && (
          <Box sx={{ border: '1px solid #ccc', p: 2, mb: 2, borderRadius: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} mb={1}>Settlement Details</Typography>
            <Grid container spacing={1}>
              <Grid item xs={4}><InfoRow label="Actual Amount Spent" value={formatPKR(ca.actualAmountSpent)} /></Grid>
              <Grid item xs={4}><InfoRow label="Excess Returned" value={formatPKR(ca.excessReturned)} /></Grid>
              <Grid item xs={4}><InfoRow label="Additional Paid" value={formatPKR(ca.additionalPaid)} /></Grid>
              {ca.settlementDate && <Grid item xs={4}><InfoRow label="Settlement Date" value={formatDate(ca.settlementDate)} /></Grid>}
            </Grid>
          </Box>
        )}

        {ca.notes && (
          <Box mb={2}>
            <Typography variant="subtitle2" fontWeight={600}>Notes:</Typography>
            <Typography variant="body2">{ca.notes}</Typography>
          </Box>
        )}

        <Divider sx={{ my: 3 }} />

        {/* Approval authorities — same layout as Purchase Order */}
        <Typography variant="subtitle1" fontWeight={700} mb={1.5} sx={{ textAlign: 'center' }}>APPROVAL AUTHORITIES</Typography>
        <TableContainer component={Box} sx={{ border: '1px solid #ccc', mb: 4 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700 }}>Authority</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700, textAlign: 'center' }}>Digital Signature</TableCell>
                <TableCell sx={{ border: '1px solid #ccc', fontWeight: 700 }}>Date &amp; Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {authorityRows.map((row) => {
                const uid = String(row?.user?._id || row?.user || '');
                const step = uid ? stepByUserId.get(uid) : null;
                const approvalUser = step?.approver && typeof step.approver === 'object' ? step.approver : row.user;
                return (
                  <TableRow key={row.label}>
                    <TableCell sx={{ border: '1px solid #ccc', fontWeight: 600 }}>{row.label}</TableCell>
                    <TableCell sx={{ border: '1px solid #ccc' }}>{personName(approvalUser, row.fallback)}</TableCell>
                    <TableCell sx={{ border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'middle' }}>
                      {approvalUser?.digitalSignature ? (
                        <DigitalSignatureImage userOrPath={approvalUser} alt={`${row.label} signature`} />
                      ) : (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ border: '1px solid #ccc' }}>
                      {step?.actedAt ? formatDateTime(step.actedAt) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {/* CEO Digital Signature (if approved) */}
        {ca.ceoApprovedBy && (
          <Box sx={{ textAlign: 'center', mt: 2 }}>
            <Typography variant="caption" color="text.secondary">CEO Approved by: {ca.ceoApprovedBy.firstName} {ca.ceoApprovedBy.lastName} on {formatDate(ca.ceoApprovedAt)}</Typography>
            {ca.ceoDigitalSignature && <Typography variant="body2" fontStyle="italic" mt={0.5}>{ca.ceoDigitalSignature}</Typography>}
          </Box>
        )}

        {/* Footer */}
        <Divider sx={{ mt: 4, mb: 1 }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
          Generated: {new Date().toLocaleString()} — SGC ERP System
        </Typography>
      </Box>

      <style>{`
        @media print {
          .app-print-hide { display: none !important; }
          body { margin: 0; }
          #ca-print-area { max-width: 100% !important; padding: 20px !important; }
        }
      `}</style>
    </Box>
  );
};

const InfoRow = ({ label, value }) => (
  <Box sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140, flexShrink: 0 }}>{label}:</Typography>
    <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
  </Box>
);

export default CashApprovalDocumentView;
