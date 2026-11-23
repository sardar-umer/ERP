import React from 'react';
import { Box, Typography, Paper, Stack, Button } from '@mui/material';
import dayjs from 'dayjs';

/**
 * Shared Quotation detail view (same as Procurement > Quotations view dialog).
 * Used in Procurement (Quotations page view) and Pre-Audit (Quotations tab).
 * @param {Object} quotation - Full quotation object (vendor, items, indent, etc.)
 * @param {function} formatNumber - (num) => string, default uses toFixed(2)
 * @param {function} formatDateForPrint - (date) => DD/MM/YYYY
 * @param {function} formatDateForQuotation - (date) => DD-Month-YYYY
 */
const QuotationDetailView = ({
  quotation,
  formatNumber = (num) => (num == null ? '0.00' : parseFloat(num).toFixed(2)),
  formatDateForPrint = (date) => {
    if (date === undefined || date === null || date === '') return '';
    const d = dayjs(date);
    return d.isValid() ? d.format('DD/MM/YYYY') : '';
  },
  formatDateForQuotation = (date) => {
    if (!date) return '';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const d = new Date(date);
    return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }
}) => {
  if (!quotation) return null;
  const data = quotation;
  const pickText = (...values) => {
    for (const value of values) {
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return '—';
  };
  const computedDiscountAmount = Array.isArray(data.items)
    ? data.items.reduce((sum, item) => sum + (Number(item?.discount) || 0), 0)
    : 0;
  const effectiveDiscountAmount = Number(data.discountAmount ?? computedDiscountAmount) || 0;

  return (
    <Paper
      sx={{
        p: { xs: 3, sm: 3.5, md: 4 },
        maxWidth: '210mm',
        mx: 'auto',
        backgroundColor: '#fff',
        boxShadow: 'none',
        width: '100%',
        fontFamily: 'Arial, sans-serif',
        '@media print': { boxShadow: 'none', p: 2.5, maxWidth: '100%', mx: 0, width: '100%', pageBreakInside: 'avoid' }
      }}
      className="print-content quotation-detail-view"
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ fontSize: '1.2rem', fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>
            {data.vendor?.name || 'Vendor Name'}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', flex: 1 }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 0.5 }}>{data.vendor?.name || 'Vendor Name'}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mb: 0.3 }}>Date: {formatDateForQuotation(data.quotationDate)}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mb: 0.3 }}>Ref No: {data.quotationNumber || 'N/A'}</Typography>
          {data.vendor?.ntnNo && <Typography sx={{ fontSize: '0.85rem', mb: 0.3 }}>NTN No: {data.vendor.ntnNo}</Typography>}
          {data.vendor?.gstNo && <Typography sx={{ fontSize: '0.85rem', mb: 0.3 }}>GST No: {data.vendor.gstNo}</Typography>}
        </Box>
      </Box>

      <Typography variant="h4" align="center" sx={{ fontSize: '1.8rem', fontWeight: 700, mb: 3, textDecoration: 'underline', textDecorationThickness: '2px' }}>
        Quotation
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 500 }}>M/S: Taj Residencia Islamabad</Typography>
      </Box>

      <Box sx={{ mb: 1.5, fontSize: '0.9rem', lineHeight: 1.8, textAlign: 'center' }}>
        <Typography component="span" fontWeight={600}>Quotation No.:</Typography>
        <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>{data.quotationNumber || '___________'}</Typography>
      </Box>

      <Box sx={{ mb: 1.5, fontSize: '0.9rem', lineHeight: 1.8 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' }}>
          <Box sx={{ minWidth: '120px' }}>
            <Typography component="span" fontWeight={600}>Quotation Date:</Typography>
            <Typography component="span" sx={{ ml: 1 }}>{formatDateForPrint(data.quotationDate)}</Typography>
          </Box>
          <Box sx={{ minWidth: '150px' }}>
            <Typography component="span" fontWeight={600}>Expiry Date:</Typography>
            <Typography component="span" sx={{ ml: 1 }}>{data.expiryDate ? formatDateForPrint(data.expiryDate) : '___________'}</Typography>
          </Box>
          <Box sx={{ minWidth: '120px' }}>
            <Typography component="span" fontWeight={600}>Indent No.:</Typography>
            <Typography component="span" sx={{ ml: 1 }}>{data.indent?.indentNumber || '___________'}</Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mb: 3, fontSize: '0.9rem', lineHeight: 1.8 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' }}>
          <Box sx={{ minWidth: '200px' }}>
            <Typography component="span" fontWeight={600}>Vendor:</Typography>
            <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>{data.vendor?.name || '___________'}</Typography>
          </Box>
          <Box sx={{ minWidth: '200px' }}>
            <Typography component="span" fontWeight={600}>Department:</Typography>
            <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>{data.indent?.department?.name || '___________'}</Typography>
          </Box>
          <Box sx={{ minWidth: '200px' }}>
            <Typography component="span" fontWeight={600}>Cost Center:</Typography>
            <Typography component="span" sx={{ ml: 1, textTransform: 'uppercase' }}>
              {data.indent?.costCenter && typeof data.indent.costCenter === 'object'
                ? [data.indent.costCenter.code, data.indent.costCenter.name].filter(Boolean).join(' — ')
                : '___________'}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mb: 3 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', fontSize: '0.9rem', fontFamily: 'Arial, sans-serif' }}>
          <thead>
            <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
              <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'left', fontWeight: 700, width: '8%' }}>S/No</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '50%' }}>Items Description</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: '12%' }}>Qty.</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', fontWeight: 700, width: '15%' }}>Unit Rate</th>
              <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', fontWeight: 700, width: '15%' }}>Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.items?.length > 0 ? data.items.map((item, index) => {
              const baseTotal = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
              const discount = Number(item.discount) || 0;
              const taxRate = Number(item.taxRate) || 0;
              const itemTotal = (baseTotal - discount) + (((baseTotal - discount) * taxRate) / 100);
              return (
                <tr key={index} style={{ border: '1px solid #000' }}>
                  <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'left', verticalAlign: 'top' }}>{index + 1}</td>
                  <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>{item.description || '___________'}</td>
                  <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>{item.quantity ?? '___'}</td>
                  <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>{formatNumber(item.unitPrice)}</td>
                  <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>{formatNumber(itemTotal)}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={5} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center' }}>No items</td>
              </tr>
            )}
            {data.items?.length > 0 && (
              <>
                {effectiveDiscountAmount > 0 && (
                  <tr>
                    <td colSpan={3} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 600 }}>Discount</td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px' }} />
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', fontWeight: 600 }}>
                      {formatNumber(effectiveDiscountAmount)}
                    </td>
                  </tr>
                )}
                <tr style={{ borderTop: '2px solid #000', borderBottom: '1px solid #000' }}>
                  <td colSpan={3} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700 }}>Total Amount</td>
                  <td style={{ border: '1px solid #000', padding: '10px 8px' }} />
                  <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>{formatNumber(data.totalAmount || 0)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </Box>

      <Box sx={{ mb: 3, fontSize: '0.9rem', lineHeight: 1.9 }}>
        <Typography sx={{ mb: 1.5 }}>Above prices are CASH</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '170px 1fr', rowGap: 0.8, columnGap: 2, mb: 1.5 }}>
          <Typography component="span" sx={{ fontWeight: 500 }}>Delivery:</Typography>
          <Typography component="span">{pickText(data.deliveryTime)}</Typography>

          <Typography component="span" sx={{ fontWeight: 500 }}>Payment:</Typography>
          <Typography component="span">{pickText(data.paymentTerms)}</Typography>

          <Typography component="span" sx={{ fontWeight: 500 }}>Delivery Place:</Typography>
          <Typography component="span">{pickText(data.deliveryPlace, data.delivery_location, data.deliveryLocation, data.terms?.deliveryPlace, data.quotationTerms?.deliveryPlace)}</Typography>

          <Typography component="span" sx={{ fontWeight: 500 }}>Validity:</Typography>
          <Typography component="span">{data.validityDays ? `${data.validityDays}Days` : '—'}</Typography>

          <Typography component="span" sx={{ fontWeight: 500 }}>Carriage:</Typography>
          <Typography component="span" sx={{ whiteSpace: 'pre-wrap' }}>{pickText(data.freightCarriage, data.freight_carriage, data.carriage, data.terms?.freightCarriage, data.terms?.freight_carriage, data.terms?.carriage, data.quotationTerms?.freightCarriage, data.quotationTerms?.carriage)}</Typography>

          <Typography component="span" sx={{ fontWeight: 500 }}>Installation:</Typography>
          <Typography component="span" sx={{ whiteSpace: 'pre-wrap' }}>{pickText(data.installation, data.installationDetails, data.terms?.installation, data.terms?.installationDetails, data.quotationTerms?.installation)}</Typography>

          <Typography component="span" sx={{ fontWeight: 500 }}>Freight:</Typography>
          <Typography component="span" sx={{ whiteSpace: 'pre-wrap' }}>{pickText(data.freight, data.terms?.freight, data.quotationTerms?.freight)}</Typography>
        </Box>
        {Array.isArray(data.attachments) && data.attachments.length > 0 && (
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontWeight: 500, mb: 0.5 }}>Attachments:</Typography>
            <Stack spacing={1}>
              {data.attachments.map((att, i) => {
                const name = att?.filename || att?.originalName || `Document ${i + 1}`;
                const isImage = /\.(png|jpe?g|webp|gif)$/i.test(String(att?.url || '')) || String(att?.mimeType || '').startsWith('image/');
                return (
                  <Box key={i}>
                    <Button size="small" variant="outlined" onClick={() => window.open(att?.url, '_blank', 'noopener,noreferrer')}>
                      {name}
                    </Button>
                    {isImage && att?.url ? (
                      <Box
                        component="img"
                        src={att.url}
                        alt={name}
                        sx={{ mt: 1, width: '100%', maxHeight: 260, objectFit: 'contain', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                      />
                    ) : null}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        )}
        <Typography sx={{ mt: 1.5, mb: 2.5 }}>For further Information, please feel free to contact us.</Typography>
      </Box>

      <Box sx={{ mb: 3, fontSize: '0.9rem' }}>
        <Typography sx={{ mb: 1 }}>With regards.</Typography>
        <Typography sx={{ mb: 1.5, fontWeight: 600 }}>For {data.vendor?.name || 'Vendor Name'}</Typography>
        {data.vendor?.email && <Typography sx={{ mb: 0.5, color: '#0066cc' }}>Email: {data.vendor.email}</Typography>}
        {data.vendor?.website && <Typography sx={{ mb: 0.5, color: '#0066cc' }}>{data.vendor.website}</Typography>}
      </Box>

      <Box sx={{ textAlign: 'center', fontSize: '0.8rem', mt: 5, pt: 2.5, borderTop: '1px solid #ccc' }}>
        <Typography>
          {data.vendor?.address && <span>{data.vendor.address}</span>}
          {data.vendor?.phone && <span>{data.vendor?.address ? ' Cell: ' : ''}{data.vendor.phone}{data.vendor?.officePhone ? ` | Office: ${data.vendor.officePhone}` : ''}</span>}
          {!data.vendor?.address && !data.vendor?.phone && '—'}
        </Typography>
      </Box>
    </Paper>
  );
};

export default QuotationDetailView;
