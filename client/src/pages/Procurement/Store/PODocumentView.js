import React from 'react';
import { Box, Typography, Paper, Divider, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, alpha, useTheme } from '@mui/material';
import { DigitalSignatureImage, ProcurementDigitalSignaturesRow } from '../../../components/common/DigitalSignatureImage';
import StoreVettingNotice from '../../../components/Procurement/StoreVettingNotice';
import { sanitizeApprovalAuthorities, formatPurchaseOrderCostCenter } from '../../../utils/purchaseOrderAuthority';

const formatDateForPrint = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
};

const formatDate = (date) => {
  if (!date) return '';
  try {
    const d = new Date(date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return String(date);
  }
};

const formatNumber = (num) =>
  new Intl.NumberFormat('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(num || 0);

const numberToWords = (num) => {
  if (!num || num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const convert = (n) => {
    if (n === 0) return '';
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  };
  const amount = Math.floor(num);
  const paise = Math.round((num - amount) * 100);
  let result = convert(amount) + ' Rupees';
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
  return result + ' Only';
};

/**
 * Full Purchase Order document view (same layout as Store Dashboard PO view).
 * Used by Store Dashboard PO view dialog.
 * Includes audit observations, approval authority values, and supports workflow history from parent.
 */
const PODocumentView = ({ data }) => {
  const theme = useTheme();
  if (!data) return null;

  const observations = (data?.auditObservations && data.auditObservations.length > 0)
    ? data.auditObservations
    : (data?.auditRejectObservations || []).map((obs) => ({
        observation: typeof obs === 'object' ? obs.observation : obs,
        severity: typeof obs === 'object' ? (obs.severity || 'medium') : 'medium',
        addedBy: data.auditRejectedBy,
        addedAt: data.auditRejectedAt,
        answer: null,
        answeredBy: null,
        answeredAt: null,
        resolved: false
      }));
  const hasObservations = Array.isArray(observations) && observations.length > 0;
  const hasChangeSummary = data?.resubmissionChangeSummary && String(data.resubmissionChangeSummary).trim().length > 0;
  const auth = sanitizeApprovalAuthorities(data?.approvalAuthorities || {}, data?.createdAt);
  const csa = data?.indent?.comparativeStatementApprovals || {};
  const approverLabel = (u) => {
    if (!u) return '';
    return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || '';
  };
  const formatDateTime = (date) => {
    if (!date) return '—';
    try {
      return new Date(date).toLocaleString();
    } catch {
      return '—';
    }
  };
  const authorityRows = [
    {
      key: 'preparedBy',
      label: 'Prepared By',
      user: csa.preparedByUser || null,
      fallback: auth.preparedBy || csa.preparedBy || ''
    },
    {
      key: 'managerProcurement',
      label: 'Manager Procurement',
      user: csa.managerProcurementUser || null,
      fallback: auth.managerProcurement || csa.managerProcurement || ''
    },
    ...(auth.srManagerProcurement
      ? [{
          key: 'srManagerProcurement',
          label: 'Sr Manager Procurement',
          user: null,
          fallback: auth.srManagerProcurement || ''
        }]
      : []),
    {
      key: 'chiefOperatingOfficer',
      label: 'Chief operating officer',
      user: null,
      fallback: auth.chiefOperatingOfficer || auth.verifiedBy || csa.verifiedBy || ''
    },
    {
      key: 'avpTaj',
      label: 'AVP Taj',
      user: null,
      fallback: auth.avpTaj || auth.authorisedRep || csa.authorisedRep || ''
    },
    ...(auth.technicalDepartment || csa.technicalDepartment
      ? [{
          key: 'technicalDepartment',
          label: 'Technical Department',
          user: null,
          fallback: auth.technicalDepartment || csa.technicalDepartment || ''
        }]
      : [])
  ];
  const authorityApprovalHistory = Array.isArray(data?.workflowHistory)
    ? [...data.workflowHistory]
        .reverse()
        .find((h) => h?.fromStatus === 'Pending Approval' && h?.toStatus === 'Pending Audit')
    : null;
  const authorityApprovedBy = data?.approvedBy || authorityApprovalHistory?.changedBy || null;
  const authorityApprovedAt = data?.approvedAt || authorityApprovalHistory?.changedAt || null;
  const authorityApprovals = Array.isArray(data?.authorityApprovals) ? data.authorityApprovals : [];
  const authorityApprovalByKey = new Map(
    authorityApprovals
      .map((approval) => [String(approval?.authorityKey || '').trim(), approval])
      .filter(([key]) => Boolean(key))
  );
  const normalizeToken = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const getUserTokens = (u) => {
    if (!u || typeof u !== 'object') return [];
    return [
      [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
      u.email,
      u.employeeId
    ].map(normalizeToken).filter(Boolean);
  };
  const authorityTokens = getUserTokens(authorityApprovedBy);
  const matchesAuthority = (value) => {
    const token = normalizeToken(value);
    if (!token || authorityTokens.length === 0) return false;
    return authorityTokens.some((at) => at === token || at.includes(token) || token.includes(at));
  };

  return (
    <Paper
      className="po-print-page"
      sx={{
        p: { xs: 3, sm: 3.5, md: 4 },
        maxWidth: '210mm',
        mx: 'auto',
        backgroundColor: '#fff',
        boxShadow: 'none',
        width: '100%',
        fontFamily: 'Arial, sans-serif',
        '@media print': {
          boxShadow: 'none',
          p: '7mm 9mm',
          maxWidth: '100%',
          backgroundColor: '#fff',
          mx: 0,
          width: '100%'
        }
      }}
    >
      <Typography
        variant="h4"
        fontWeight={700}
        align="center"
        sx={{
          textTransform: 'uppercase',
          mb: 3,
          fontSize: { xs: '1.8rem', print: '1.1rem' },
          letterSpacing: 1,
          '@media print': { mb: 1, fontSize: '22px', letterSpacing: 0.4 }
        }}
      >
        Purchase Order
      </Typography>

      {/* Audit Observations & Procurement Responses */}
      {hasObservations && (
        <Box sx={{ mb: 3, p: 2, bgcolor: alpha(theme.palette.warning.main, 0.08), border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
          <Typography variant="h6" sx={{ mb: 2, color: 'warning.dark', fontWeight: 'bold' }}>
            Audit Observations &amp; Procurement Responses
          </Typography>
          {data.auditReturnComments && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Return Comments:</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{data.auditReturnComments}</Typography>
            </Box>
          )}
          {data.auditRejectionComments && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Rejection Comments:</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{data.auditRejectionComments}</Typography>
            </Box>
          )}
          {hasChangeSummary && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: alpha(theme.palette.info.main, 0.08), borderRadius: 1, border: '1px solid', borderColor: 'info.light' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'info.dark' }}>
                Changes made to PO by Procurement (on resubmission):
              </Typography>
              <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.875rem', m: 0 }}>
                {data.resubmissionChangeSummary}
              </Typography>
            </Box>
          )}
          {observations.map((obs, index) => (
            <Box key={obs._id || index} sx={{ mb: 2, p: 1.5, bgcolor: '#fff', borderRadius: 1, border: '1px solid', borderColor: 'warning.light' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Observation {index + 1}</Typography>
                {obs.severity && (
                  <Chip
                    label={String(obs.severity).charAt(0).toUpperCase() + String(obs.severity).slice(1)}
                    size="small"
                    color={obs.severity === 'critical' ? 'error' : obs.severity === 'high' ? 'warning' : 'default'}
                  />
                )}
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Raised by Audit{obs.addedBy ? `: ${obs.addedBy?.firstName || ''} ${obs.addedBy?.lastName || ''}` : ''}
                {obs.addedAt ? ` on ${formatDate(obs.addedAt)}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: obs.answer ? 1.5 : 0 }}>{obs.observation}</Typography>
              {obs.answer ? (
                <Box sx={{ mt: 1.5, p: 1.5, bgcolor: alpha(theme.palette.success.main, 0.1), borderRadius: 1, border: '1px solid', borderColor: 'success.light' }}>
                  <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5, color: 'success.dark' }}>
                    Response from Procurement (edit / correction):
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{obs.answer}</Typography>
                  {obs.answeredBy && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                      Answered by: {obs.answeredBy?.firstName || ''} {obs.answeredBy?.lastName || ''}
                      {obs.answeredAt ? ` on ${formatDate(obs.answeredAt)}` : ''}
                    </Typography>
                  )}
                </Box>
              ) : hasChangeSummary ? (
                <Typography variant="caption" sx={{ color: 'info.dark', display: 'block', mt: 1 }}>
                  Procurement updated the PO in response (see changes above).
                </Typography>
              ) : (
                <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic', display: 'block', mt: 1 }}>
                  No response from Procurement yet
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ mb: 2.5, '@media print': { mb: 1 } }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: '1.1rem', '@media print': { mb: 0.45, fontSize: '14px' } }}>
          {data.companyId?.name || data.indent?.companyId?.name || '—'}
        </Typography>
        <Typography sx={{ fontSize: '0.9rem', '@media print': { fontSize: '12.5px' } }}>Link Road I-14, adjacent to CDA Sectors I-14 and I-15</Typography>
      </Box>


      <Box sx={{ mb: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', gap: { xs: 2, md: 3 }, '@media print': { mb: 1, gap: 2 } }}>
        <Box sx={{ width: { xs: '100%', md: '45%' }, fontSize: '0.9rem' }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1, fontSize: { xs: '1rem', sm: '1.1rem' } }}>{data.vendor?.name || 'Vendor Name'}</Typography>
          <Typography sx={{ fontSize: '0.9rem', lineHeight: 1.6, mb: 1 }}>{data.vendor?.address || 'Vendor Address'}</Typography>
          {(data.vendor?.ntnCnic || data.vendor?.ntnNo || data.vendor?.cnic) && (
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, mb: 1.5, color: 'text.secondary' }}>
              ntn / cnic : {data.vendor.ntnCnic || data.vendor.ntnNo || data.vendor.cnic}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', lineHeight: 1.6, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ fontWeight: 600, mr: 1 }}>Indent Details:</Typography>
            <Typography component="span">
              Indent# {data.indent?.indentNumber || 'N/A'} Dated. {data.indent?.requestedDate ? formatDateForPrint(data.indent.requestedDate) : 'N/A'}.
              {data.indent?.title && ` ${data.indent.title}.`}
              {data.indent?.requestedBy && ` End User. ${data.indent.requestedBy.firstName} ${data.indent.requestedBy.lastName}`}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ width: { xs: '100%', md: '50%' }, fontSize: '0.9rem', lineHeight: 2 }}>
          <Box sx={{ display: 'flex', mb: 0.5, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ minWidth: { xs: 110, sm: 140 }, fontWeight: 600 }}>P.O No.:</Typography>
            <Typography component="span">
              {data.orderNumber
                ? (data.orderNumber.startsWith('P') && !data.orderNumber.includes('-')
                  ? data.orderNumber
                  : 'P' + (data.orderNumber.match(/\d+$/)?.[0] || data.orderNumber.split('-').pop() || '').padStart(9, '0'))
                : 'N/A'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', mb: 0.5, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ minWidth: { xs: 110, sm: 140 }, fontWeight: 600 }}>Date:</Typography>
            <Typography component="span">{formatDateForPrint(data.orderDate)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', mb: 0.5, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ minWidth: { xs: 110, sm: 140 }, fontWeight: 600 }}>Delivery Date:</Typography>
            <Typography component="span">{data.expectedDeliveryDate ? formatDateForPrint(data.expectedDeliveryDate) : '___________'}</Typography>
          </Box>
          <Box sx={{ display: 'flex', mb: 0.5, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ minWidth: { xs: 110, sm: 140 }, fontWeight: 600 }}>Delivery Address:</Typography>
            <Typography component="span">
              {data.shippingAddress ? `${(data.shippingAddress.street || '')} ${(data.shippingAddress.city || '')}`.trim() || '___________' : '___________'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', mb: 0.5, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ minWidth: { xs: 110, sm: 140 }, fontWeight: 600 }}>Cost Center:</Typography>
            <Typography component="span">{formatPurchaseOrderCostCenter(data)}</Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mb: 3, overflowX: 'auto', WebkitOverflowScrolling: 'touch', '@media print': { mb: 1, overflow: 'visible' } }}>
        <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse', border: '1px solid #000', fontSize: '0.85rem', fontFamily: 'Arial, sans-serif' }}>
          <thead>
            <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'center', width: '5%' }}>Sr no</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '11%' }}>Product</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '23%' }}>Description</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '14%' }}>Specification</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '10%' }}>Brand</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'center', width: '8%' }}>Quantity Unit</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'right', width: '8%' }}>Rate</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'right', width: '8%' }}>Discount</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'right', width: '9%' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.items?.length > 0 ? (
              data.items.map((item, index) => (
                <tr key={index}>
                  <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'center' }}>{index + 1}</td>
                  <td style={{ border: '1px solid #000', padding: '8px' }}>{item.product || item.description?.split(' ')[0] || '-'}</td>
                  <td style={{ border: '1px solid #000', padding: '8px' }}>{item.description || '-'}</td>
                  <td style={{ border: '1px solid #000', padding: '8px' }}>{item.specification || '-'}</td>
                  <td style={{ border: '1px solid #000', padding: '8px' }}>{item.brand || '-'}</td>
                  <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'center' }}>{item.quantity} {item.unit || 'pcs'}</td>
                  <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'right' }}>{formatNumber(item.unitPrice || 0)}</td>
                  <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'right' }}>{formatNumber(item.discount || 0)}</td>
                  <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'right' }}>{formatNumber(item.amount || 0)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} style={{ border: '1px solid #000', padding: '10px', textAlign: 'center' }}>No items</td>
              </tr>
            )}
          </tbody>
        </table>
      </Box>

      <Box sx={{ mb: 3, display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, '@media print': { mb: 1 } }}>
        <Box sx={{ width: { xs: '100%', sm: 300 }, fontSize: '0.9rem', '@media print': { fontSize: '12.5px', width: 300 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography component="span" fontWeight={600}>Total (Rupees):</Typography>
            <Typography component="span">{formatNumber(data.totalAmount || 0)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography component="span" fontWeight={600}>Net Total:</Typography>
            <Typography component="span">{formatNumber(data.totalAmount || 0)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography component="span" fontWeight={600}>Freight Charges:</Typography>
            <Typography component="span">{formatNumber(data.shippingCost || 0)}</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, fontStyle: 'italic' }}>Rupees {numberToWords(data.totalAmount || 0)}</Typography>
        </Box>
      </Box>

        <Box className="po-terms-block" sx={{ mb: 3, border: '1px solid #ccc', p: 2, fontSize: '0.9rem', '@media print': { mb: 0.5, p: 0.5, fontSize: '9px' } }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, textDecoration: 'underline', '@media print': { mb: 0.15, fontSize: '10px' } }}>TERMS & CONDITIONS</Typography>
        <Box sx={{ lineHeight: 1.8, '@media print': { lineHeight: 1.12 } }}>
          <Typography sx={{ mb: 1, fontWeight: 600, '@media print': { mb: 0 } }}>Main Terms & Conditions</Typography>
          <Box sx={{ mb: 1, '@media print': { mb: 0 } }}>
            <Typography component="span" fontWeight={600}>Payment Terms:</Typography>
            <Typography component="span" sx={{ ml: 1 }}>{data.paymentTerms || '100% Advance Payment'}</Typography>
          </Box>
          <Box sx={{ mb: 1, '@media print': { mb: 0 } }}>
            <Typography component="span" fontWeight={600}>Delivery Terms:</Typography>
            <Typography component="span" sx={{ ml: 1 }}>At-Site Delivery</Typography>
          </Box>
          <Box sx={{ mb: 1, '@media print': { mb: 0 } }}>
            <Typography component="span" fontWeight={600}>Delivery Time.</Typography>
            <Typography component="span" sx={{ ml: 1 }}>Delivery within: {data.quotation?.deliveryTime || '03 days'} of confirmed PO & Payment</Typography>
          </Box>
          <Typography sx={{ mb: 1, '@media print': { mb: 0 } }}>Rates Are Exclusive Of all The Taxes</Typography>
          {data.vendor?.cnic && <Typography sx={{ mb: 1, '@media print': { mb: 0 } }}>CNIC {data.vendor.cnic}</Typography>}
          {data.vendor?.payeeName && <Typography>Payee Name: {data.vendor.payeeName}</Typography>}
        </Box>
      </Box>

      {/* Approval authorities with digital signatures — keep on same A4 page */}
      <Box
        className="po-approval-block"
        sx={{
          mt: 4,
          '@media print': { mt: 1 }
        }}
      >
        <StoreVettingNotice indent={data.indent} sx={{ mb: 0.4, '@media print': { mb: 0.35 } }} />
        <Typography
          variant="subtitle2"
          fontWeight={800}
          sx={{ mb: 0.5, fontSize: '0.75rem', color: '#1e293b', '@media print': { fontSize: '13px', mb: 0.4 } }}
        >
          Finance Document Approval Authority
        </Typography>
        <TableContainer component={Box} sx={{ border: '1.5px solid #334155' }}>
          <Table
            size="small"
            className="po-authority-table"
            sx={{
              '& th': {
                bgcolor: '#f1f5f9',
                fontWeight: 800,
                fontSize: 12,
                border: '1px solid #cbd5e1',
                py: 0.45,
                px: 0.8,
                '@media print': { py: '5px', px: '7px', fontSize: '12px', lineHeight: 1.3 }
              },
              '& td': {
                fontSize: 12,
                border: '1px solid #cbd5e1',
                py: 0.4,
                px: 0.8,
                verticalAlign: 'middle',
                '@media print': { py: '5px', px: '7px', fontSize: '12px', lineHeight: 1.3 }
              }
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>Authority</TableCell>
                <TableCell>Name</TableCell>
                <TableCell align="center">Digital Signature</TableCell>
                <TableCell>Date & Time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(() => {
                let legacyAuthorityApplied = false;
                return authorityRows.map((row) => {
                  const authorityApproval = authorityApprovalByKey.get(row.key);
                  const authorityUser = authorityApproval?.approver || row.user;
                  const isLegacyApproved = !authorityApproval && !legacyAuthorityApplied && matchesAuthority(row.fallback);
                  if (isLegacyApproved) legacyAuthorityApplied = true;
                  const signatureUser = authorityApproval?.approver || row.user || (isLegacyApproved ? authorityApprovedBy : null);
                  const isApprovedRow = Boolean(authorityApproval || isLegacyApproved);
                  const actedAt = authorityApproval?.approvedAt || (isLegacyApproved ? authorityApprovedAt : null);
                  return (
                    <TableRow key={row.key}>
                      <TableCell sx={{ fontWeight: 800 }}>{row.label}</TableCell>
                      <TableCell>{row.fallback || (authorityUser ? approverLabel(authorityUser) : '—')}</TableCell>
                      <TableCell align="center">
                        {isApprovedRow && signatureUser?.digitalSignature ? (
                          <Box
                            sx={{
                              maxHeight: 28,
                              display: 'flex',
                              justifyContent: 'center',
                              '& img': { maxHeight: 28, width: 'auto', objectFit: 'contain' },
                              '@media print': { maxHeight: 28, '& img': { maxHeight: 28 } }
                            }}
                          >
                            <DigitalSignatureImage
                              userOrPath={signatureUser}
                              alt={`Signature ${row.label}`}
                              sx={{ maxHeight: 28, maxWidth: 100, '@media print': { maxHeight: 28, maxWidth: 110 } }}
                            />
                          </Box>
                        ) : isApprovedRow ? (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', '@media print': { fontSize: '8px' } }}>
                            Approved
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', '@media print': { fontSize: '8px' } }}>
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{actedAt ? formatDateTime(actedAt) : '—'}</TableCell>
                    </TableRow>
                  );
                });
              })()}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Box sx={{ '@media print': { display: 'none' } }}>
        <ProcurementDigitalSignaturesRow purchaseOrder={data} />
      </Box>
    </Paper>
  );
};

export default PODocumentView;
