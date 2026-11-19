import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Print as PrintIcon } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import landAcquisitionPurchaseService from '../../services/landAcquisitionPurchaseService';
import landAcquisitionTransferService from '../../services/landAcquisitionTransferService';
import { formatAreaReadable } from '../../utils/landAreaUnits';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('en-GB', { month: 'short' });
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
};

const formatMoney = (value) =>
  Number(value || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: '20px',
  fontFamily: 'sans-serif',
  fontSize: '11px',
};

const thStyle = {
  border: '1px solid #000',
  padding: '2px 4px',
  fontWeight: 'bold',
  textAlign: 'left',
  backgroundColor: '#f9f9f9'
};

const tdStyle = {
  border: '1px solid #000',
  padding: '2px 4px',
  textAlign: 'left'
};

const sectionHeaderStyle = {
  textAlign: 'center',
  fontWeight: 'bold',
  backgroundColor: '#f9f9f9',
  border: '1px solid #000',
  padding: '4px',
};

export default function LandPurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [purchase, setPurchase] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [purchaseRes, transfersRes] = await Promise.all([
          landAcquisitionPurchaseService.getPurchase(id),
          landAcquisitionTransferService.getTransfers({ purchase: id, limit: 100 })
        ]);
        setPurchase(purchaseRes.data?.data || purchaseRes.data || null);
        setTransfers(transfersRes.data?.transfers || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load land purchase details');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mt: 2 }}>
          Back to list
        </Button>
      </Box>
    );
  }

  if (!purchase) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Land purchase not found.</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mt: 2 }}>
          Back to list
        </Button>
      </Box>
    );
  }

  const handlePrint = () => {
    printTovusElement('.tv-land-purchase-doc', { title: 'Land Purchase' });
  };

  const khasrasText = purchase.lines?.map(l => l.khasraNo).filter(Boolean).join(', ') || '';

  const totalInstallmentAmount = purchase.installments?.reduce((sum, inst) => sum + (inst.amount || 0), 0) || 0;
  const totalInstallmentPaid = purchase.installments?.reduce((sum, inst) => sum + (inst.paidAmount || 0), 0) || 0;
  const totalInstallmentBalance = totalInstallmentAmount - totalInstallmentPaid;

  const totalPaymentsReceived = totalInstallmentPaid; // In actual logic, this might be from a separate payments endpoint

  return (
    <Box className="tv-land-purchase-doc" sx={{ p: { xs: 2, md: 4 }, bgcolor: 'grey.100', minHeight: '100vh', '@media print': { bgcolor: 'white', p: 0, m: 0 } }}>
      <Stack direction="row" justifyContent="space-between" mb={2} sx={{ '@media print': { display: 'none' }, maxWidth: 800, mx: 'auto' }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/taj-residencia/land-purchase')}>
          Back
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint}>
          Print / Save as PDF
        </Button>
      </Stack>

      <Box sx={{ 
        maxWidth: 800, 
        mx: 'auto', 
        bgcolor: 'white', 
        p: 4, 
        boxShadow: 1,
        '@media print': { 
          boxShadow: 'none', 
          p: 0, 
          maxWidth: '100%',
          width: '100%' 
        } 
      }}>
        {/* Print Styles to force 1 page */}
        <style>
          {`
            @media print {
              @page { margin: 0.5cm; }
              body { -webkit-print-color-adjust: exact; }
              table { margin-bottom: 10px !important; }
              h2 { font-size: 18px !important; line-height: 40px !important; }
              img { height: 40px !important; }
            }
          `}
        </style>

        {/* Header */}
        <Box sx={{ position: 'relative', textAlign: 'center', mb: 2, minHeight: '60px' }}>
          <img src="/images/taj-logo.png" alt="Taj Residencia" style={{ height: '60px', position: 'absolute', left: 0, top: 0 }} />
          <h2 style={{ margin: 0, fontFamily: 'serif', lineHeight: '60px' }}>Land Purchase Detail Report</h2>
        </Box>

        {/* Seller Information */}
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td colSpan={2} style={sectionHeaderStyle}>Seller Information</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, width: '30%', textAlign: 'center' }}>Name</td>
              <td style={tdStyle}>{purchase.seller?.name || ''}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Father's Name</td>
              <td style={tdStyle}></td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Cnic</td>
              <td style={tdStyle}>{purchase.seller?.cnic || ''}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Contact</td>
              <td style={tdStyle}>{purchase.seller?.phoneNumber || ''}</td>
            </tr>
          </tbody>
        </table>

        {/* Deal Information */}
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td colSpan={2} style={sectionHeaderStyle}>Deal Information</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, width: '30%', textAlign: 'center' }}>Deal No.</td>
              <td style={tdStyle}>{purchase.dealNo || ''}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Land Purchase No.</td>
              <td style={tdStyle}>{purchase.purchaseNo || ''}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Project</td>
              <td style={tdStyle}>{purchase.project || ''}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Date</td>
              <td style={tdStyle}>{formatDate(purchase.purchaseDate)}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Moza</td>
              <td style={tdStyle}>{purchase.moza?.name || ''}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Khasras</td>
              <td style={tdStyle}>{khasrasText}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Agents</td>
              <td style={tdStyle}>{purchase.dealer?.name || ''}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Actual Size</td>
              <td style={tdStyle}>{formatAreaReadable(purchase.totalArea)}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Raw Size</td>
              <td style={tdStyle}></td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Rate Per Kanal</td>
              <td style={tdStyle}>{formatMoney(purchase.ratePerKanal)}</td>
            </tr>
            <tr>
              <td style={{ ...thStyle, textAlign: 'center' }}>Agreed Amount</td>
              <td style={tdStyle}>{formatMoney(purchase.agreedAmount)}</td>
            </tr>
          </tbody>
        </table>

        {/* Installment Plan */}
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td colSpan={7} style={sectionHeaderStyle}>Installment Plan</td>
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>#</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Description</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Amount</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Paid</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Balance</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Due Date</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
            </tr>
            {purchase.installments?.map((inst, idx) => (
              <tr key={idx}>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{inst.description || ''}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{formatMoney(inst.amount)}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{formatMoney(inst.paidAmount)}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{formatMoney(inst.amount - (inst.paidAmount || 0))}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{formatDate(inst.dueDate)}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{inst.status || ''}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ ...thStyle, textAlign: 'center', fontSize: '14px' }}>Total</td>
              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>
                <div style={{ fontSize: '10px', color: '#666' }}>Total</div>
                {formatMoney(totalInstallmentAmount)}
              </td>
              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>
                <div style={{ fontSize: '10px', color: '#666' }}>Paid</div>
                {formatMoney(totalInstallmentPaid)}
              </td>
              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>
                <div style={{ fontSize: '10px', color: '#666' }}>Balance</div>
                {formatMoney(totalInstallmentBalance)}
              </td>
              <td colSpan={2} style={tdStyle}></td>
            </tr>
          </tbody>
        </table>

        {/* Land Transfers */}
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td colSpan={8} style={sectionHeaderStyle}>Land Transfers</td>
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>#</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Transfer No</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Inteqal</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Registry</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Moza</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Size</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Cost</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Transfer Date</th>
            </tr>
            {transfers.length === 0 ? (
              <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>No land transfers recorded</td></tr>
            ) : transfers.map((t, idx) => (
              <tr key={idx}>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{t.transferNo || ''}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{t.intiqalNo || ''}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{t.registryNo || ''}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{purchase.moza?.name || ''}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{formatAreaReadable(t.transferArea)}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{formatMoney(t.totalTransferPayments)}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{formatDate(t.transferDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Land Purchase Payments */}
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td colSpan={7} style={sectionHeaderStyle}>Land Purchase Payments</td>
            </tr>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center' }}>#</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Ref No.</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Description</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Amount</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Payee</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Cheque No.</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Date</th>
            </tr>
            {(() => {
              const installments = purchase.installments || [];
              const paidInsts = installments.filter(inst => inst.paidAmount > 0);
              
              if (!purchase.paymentRemarks) {
                return paidInsts.map((inst, idx) => (
                  <tr key={idx}>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{inst.refNo || ''}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{inst.description || ''}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{formatMoney(inst.paidAmount)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{inst.drawnOn || (purchase.seller?.name || '')}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{inst.refNo || ''}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{formatDate(inst.paymentDate || inst.dueDate)}</td>
                  </tr>
                ));
              }

              // Parse paymentRemarks sequence to preserve exact Excel order (e.g. 1st, 4th, 8th, 12th...)
              const remarkEntries = purchase.paymentRemarks.split(';').map(s => s.trim()).filter(Boolean);
              const orderedList = [];

              remarkEntries.forEach(entry => {
                const parts = entry.split('|').map(p => p.trim());
                const descPart = parts[0] || '';
                if (descPart.toLowerCase() === 'total') return;

                const refPart = (parts.find(p => p.toLowerCase().startsWith('ref:')) || '').replace(/^ref:\s*/i, '');
                const payeePart = (parts.find(p => p.toLowerCase().startsWith('payee:')) || '').replace(/^payee:\s*/i, '');
                const chqPart = (parts.find(p => p.toLowerCase().startsWith('chq:')) || '').replace(/^chq:\s*/i, '');

                const matchedInst = paidInsts.find(i => i.description && i.description.trim().toLowerCase() === descPart.toLowerCase()) 
                  || paidInsts.find(i => i.refNo === refPart);

                orderedList.push({
                  refNo: refPart || matchedInst?.refNo || '',
                  description: descPart || matchedInst?.description || '',
                  amount: matchedInst ? matchedInst.paidAmount : 0,
                  payee: payeePart || matchedInst?.drawnOn || purchase.seller?.name || '',
                  chequeNo: chqPart || matchedInst?.narration || '',
                  date: matchedInst?.paymentDate || matchedInst?.dueDate
                });
              });

              // Also append any paid installments not captured in remarks
              paidInsts.forEach(inst => {
                const alreadyAdded = orderedList.some(item => item.description.toLowerCase() === (inst.description || '').toLowerCase());
                if (!alreadyAdded) {
                  orderedList.push({
                    refNo: inst.refNo || '',
                    description: inst.description || '',
                    amount: inst.paidAmount,
                    payee: inst.drawnOn || purchase.seller?.name || '',
                    chequeNo: inst.narration || '',
                    date: inst.paymentDate || inst.dueDate
                  });
                }
              });

              const filteredList = orderedList.filter(item => {
                const desc = String(item.description || '').trim().toLowerCase();
                const ref = String(item.refNo || '').trim().toLowerCase();
                return desc !== 'total' && ref !== 'total';
              });

              return filteredList.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{item.refNo}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{item.description || ''}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{formatMoney(item.amount)}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{item.payee}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{item.chequeNo}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{formatDate(item.date)}</td>
                </tr>
              ));
            })()}
            <tr>
              <td colSpan={3} style={{ ...thStyle, textAlign: 'center', fontWeight: 'bold' }}>Received Amount (Approved, Unapproved)</td>
              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>{formatMoney(totalPaymentsReceived)}</td>
              <td colSpan={3} style={tdStyle}></td>
            </tr>
            <tr>
              <td colSpan={3} style={{ ...thStyle, textAlign: 'center', fontWeight: 'bold' }}>- Reversed Amount</td>
              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>{formatMoney(0)}</td>
              <td colSpan={3} style={tdStyle}></td>
            </tr>
            <tr>
              <td colSpan={3} style={{ ...thStyle, textAlign: 'center', fontWeight: 'bold' }}>Net Received Amount</td>
              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold' }}>{formatMoney(totalPaymentsReceived)}</td>
              <td colSpan={3} style={tdStyle}></td>
            </tr>
          </tbody>
        </table>
      </Box>
    </Box>
  );
}
