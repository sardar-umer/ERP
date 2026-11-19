import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  Grid
} from '@mui/material';
import {
  Print as PrintIcon,
  ArrowBack as ArrowBackIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import indentService from '../../../services/indentService';
import dayjs from 'dayjs';
import { DigitalSignatureImage } from '../../../components/common/DigitalSignatureImage';
import { TovusDocHeader, TovusDocFooter } from '../../../components/common/TovusDocumentBrand';

const IndentPrintView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [indent, setIndent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadIndent = async () => {
      try {
        setLoading(true);
        const response = await indentService.getIndentById(id);
        setIndent(response.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load indent');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      loadIndent();
    }
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  const formatDate = (date) => {
    if (!date) return '';
    return dayjs(date).format('DD/MM/YYYY');
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !indent) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Indent not found'}</Alert>
      </Box>
    );
  }

  const approvalNameFromChain = (index) => {
    const step = indent.approvalChain?.[index];
    if (step?.approver) {
      const n = [step.approver.firstName, step.approver.lastName].filter(Boolean).join(' ').trim();
      if (n) return n;
      if (step.approver.email) return step.approver.email;
    }
    const keys = ['headOfDepartment', 'gmPd', 'svpAvp'];
    return indent.signatures?.[keys[index]]?.name || '';
  };

  const approvalDateFromChain = (index) => {
    const step = indent.approvalChain?.[index];
    if (step?.actedAt && step?.status === 'approved') return step.actedAt;
    const keys = ['headOfDepartment', 'gmPd', 'svpAvp'];
    return indent.signatures?.[keys[index]]?.date;
  };

  const chainStep = (index) => indent.approvalChain?.[index];

  return (
    <>
      {/* Print Controls - Hidden when printing */}
      <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', gap: 1, flexWrap: 'wrap', '@media print': { display: 'none' } }}>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/general/indents/${id}`)}
          sx={{ minHeight: 40 }}
        >
          Back
        </Button>
        <Button
          variant="contained"
          startIcon={<PrintIcon />}
          onClick={handlePrint}
          sx={{ minHeight: 40 }}
        >
          Print
        </Button>
      </Box>

      {/* Print Content */}
      <Paper
        className="indent-print-doc"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          p: { xs: 2, sm: 4 },
          maxWidth: '210mm',
          width: '100%',
          minHeight: { xs: 'auto', sm: '297mm' },
          mx: 'auto',
          backgroundColor: '#fff',
          overflowX: 'auto',
          '@media print': {
            boxShadow: 'none',
            // bottom padding keeps content clear of the Tovus footer pinned to the page bottom
            p: '8mm 10mm 40mm',
            minHeight: 'auto',
            maxWidth: '100%',
            backgroundColor: '#fff'
          }
        }}
      >
        <TovusDocHeader title="Purchase Request Form" />

        {/* Date / Required Date / Indent No. and Department / Originator / Category:
            same plain "Label: value" style, laid out on a 3-column grid so every column lines up */}
        <Box
          sx={{
            mt: 2.5,
            mb: 3,
            fontSize: '0.9rem',
            lineHeight: 1.8,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            columnGap: 3,
            rowGap: 0.25,
            '@media print': { gridTemplateColumns: 'repeat(3, 1fr)', mt: 2 }
          }}
        >
          {[
            { label: 'ERP Ref', value: indent.erpRef || 'PR #' + (indent.indentNumber?.split('-').pop() || ''), upper: true },
            { label: 'Indent No.', value: indent.indentNumber },
            { label: 'Date', value: formatDate(indent.requestedDate) },
            { label: 'Required Date', value: indent.requiredDate ? formatDate(indent.requiredDate) : '' },
            { label: 'Department', value: indent.department?.name, upper: true },
            {
              label: 'Originator',
              value:
                indent.requestedBy?.firstName && indent.requestedBy?.lastName
                  ? `${indent.requestedBy.firstName} ${indent.requestedBy.lastName}`
                  : '',
              upper: true
            },
            { label: 'Category', value: indent.category, upper: true },
            { label: 'Company', value: indent.companyId?.name, upper: true, span: 2 },
            ...(indent.title ? [{ label: 'Subject', value: indent.title, full: true }] : []),
            ...(indent.chargeTo?.project
              ? [{
                  label: 'Charged to',
                  value: `${indent.chargeTo.projectName || ''}${indent.chargeTo.subProjectName ? ` › ${indent.chargeTo.subProjectName}` : ''}`,
                  full: true
                }]
              : []),
            ...(indent.category === 'Others' && indent.categoryOtherDescription?.trim()
              ? [{ label: 'Specified need', value: indent.categoryOtherDescription.trim(), full: true }]
              : [])
          ].map((f) => (
            <Box
              key={f.label}
              sx={{
                gridColumn: f.full ? '1 / -1' : f.span ? { xs: 'auto', sm: `span ${f.span}` } : 'auto',
                ...(f.span && { '@media print': { gridColumn: `span ${f.span}` } }),
                minWidth: 0
              }}
            >
              <Typography component="span" fontWeight={600}>{f.label}:</Typography>
              <Typography
                component="span"
                sx={{ ml: 1, textTransform: f.upper ? 'uppercase' : 'none', whiteSpace: f.full ? 'pre-wrap' : 'normal' }}
              >
                {f.value || '___________'}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Items Table */}
        <Box sx={{ mb: 3, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table
            className="indent-print-table"
            style={{
              width: '100%',
              minWidth: 640,
              borderCollapse: 'collapse',
              border: '1px solid #000',
              fontSize: '0.85rem',
              fontFamily: 'Arial, sans-serif'
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: '4%' }}>S#</th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '14%' }}>Item Name</th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '14%' }}>Item Description</th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '10%' }}>Brand</th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '8%' }}>Unit</th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: '6%' }}>Qty.</th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '18%' }}>Purpose</th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', fontWeight: 700, width: '10%' }}>Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              {indent.items && indent.items.length > 0 ? (
                indent.items.map((item, index) => (
                  <tr key={index} style={{ border: '1px solid #000' }}>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                      {(index + 1).toString().padStart(2, '0')}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.itemName || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.description || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.brand || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.unit || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                      {item.quantity ?? '___'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.purpose || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>
                      {item.estimatedCost != null ? Number(item.estimatedCost).toFixed(2) : '___________'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center' }}>
                    No items
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Box>

        {/* Justification */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1, fontSize: '0.95rem' }}>
            Justification:
          </Typography>
          <Box
            sx={{
              border: '1px solid #ccc',
              p: 1.5,
              minHeight: '50px',
              fontSize: '0.9rem',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6
            }}
          >
            {indent.justification || '___________'}
          </Box>
        </Box>

        {/* Attachments Section (if any) */}
        {Array.isArray(indent.attachments) && indent.attachments.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1, fontSize: '0.95rem' }}>
              Attachments ({indent.attachments.length}):
            </Typography>
            <Box
              sx={{
                border: '1px solid #ccc',
                p: 1.5,
                fontSize: '0.85rem'
              }}
            >
              {indent.attachments.map((att, idx) => (
                <Typography key={att._id || idx} variant="body2" sx={{ fontSize: '0.85rem', mb: 0.5 }}>
                  {idx + 1}. {att.filename || 'Attachment file'}
                </Typography>
              ))}
            </Box>
          </Box>
        )}

        {/* Signatures Section */}
        <Box sx={{ mb: 3 }}>
          <Grid container spacing={1.5}>
            <Grid item xs={12} sm={6} md={3} className="indent-print-sig">
              <Box sx={{ border: '1px solid #ccc', p: 1.5, minHeight: '90px', textAlign: 'left' }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1, fontSize: '0.85rem' }}>
                  Sig of Requester:
                </Typography>
                {indent.requestedBy?.digitalSignature ? (
                  <Box sx={{ mb: 0.5 }}>
                    <DigitalSignatureImage userOrPath={indent.requestedBy} alt="Requester" sx={{ mx: 0 }} />
                  </Box>
                ) : null}
                <Box sx={{ mt: 0.5, minHeight: '24px', fontSize: '0.9rem' }}>
                  {indent.signatures?.requester?.name ||
                    (indent.requestedBy?.firstName && indent.requestedBy?.lastName
                      ? `${indent.requestedBy.firstName} ${indent.requestedBy.lastName}`
                      : '___________')}
                </Box>
                {(indent.signatures?.requester?.date || indent.requestedDate || indent.createdAt) && (
                  <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontSize: '0.75rem' }}>
                    {formatDate(indent.signatures?.requester?.date || indent.requestedDate || indent.createdAt)}
                  </Typography>
                )}
              </Box>
            </Grid>
            <Grid item xs={12} sm={6} md={3} className="indent-print-sig">
              <Box sx={{ border: '1px solid #ccc', p: 1.5, minHeight: '90px', textAlign: 'left' }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1, fontSize: '0.85rem' }}>
                  Head of Department:
                </Typography>
                {chainStep(0)?.status === 'approved' && chainStep(0)?.approver?.digitalSignature ? (
                  <Box sx={{ mb: 0.5 }}>
                    <DigitalSignatureImage userOrPath={chainStep(0).approver} alt="Head of Department" sx={{ mx: 0 }} />
                  </Box>
                ) : null}
                <Box sx={{ mt: 0.5, minHeight: '24px', fontSize: '0.9rem' }}>
                  {approvalNameFromChain(0) || '___________'}
                </Box>
                {approvalDateFromChain(0) && (
                  <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontSize: '0.75rem' }}>
                    {formatDate(approvalDateFromChain(0))}
                  </Typography>
                )}
              </Box>
            </Grid>
            <Grid item xs={12} sm={6} md={3} className="indent-print-sig">
              <Box sx={{ border: '1px solid #ccc', p: 1.5, minHeight: '90px', textAlign: 'left' }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1, fontSize: '0.85rem' }}>
                  Approved by GM/PD:
                </Typography>
                {chainStep(1)?.status === 'approved' && chainStep(1)?.approver?.digitalSignature ? (
                  <Box sx={{ mb: 0.5 }}>
                    <DigitalSignatureImage userOrPath={chainStep(1).approver} alt="GM/PD" sx={{ mx: 0 }} />
                  </Box>
                ) : null}
                <Box sx={{ mt: 0.5, minHeight: '24px', fontSize: '0.9rem' }}>
                  {approvalNameFromChain(1) || '___________'}
                </Box>
                {approvalDateFromChain(1) && (
                  <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontSize: '0.75rem' }}>
                    {formatDate(approvalDateFromChain(1))}
                  </Typography>
                )}
              </Box>
            </Grid>
            <Grid item xs={12} sm={6} md={3} className="indent-print-sig">
              <Box sx={{ border: '1px solid #ccc', p: 1.5, minHeight: '90px', textAlign: 'left' }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1, fontSize: '0.85rem' }}>
                  SVP/AVP Approval:
                </Typography>
                {chainStep(2)?.status === 'approved' && chainStep(2)?.approver?.digitalSignature ? (
                  <Box sx={{ mb: 0.5 }}>
                    <DigitalSignatureImage userOrPath={chainStep(2).approver} alt="SVP/AVP" sx={{ mx: 0 }} />
                  </Box>
                ) : null}
                <Box sx={{ mt: 0.5, minHeight: '24px', fontSize: '0.9rem' }}>
                  {approvalNameFromChain(2) || '___________'}
                </Box>
                {approvalDateFromChain(2) && (
                  <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontSize: '0.75rem' }}>
                    {formatDate(approvalDateFromChain(2))}
                  </Typography>
                )}
              </Box>
            </Grid>
          </Grid>
        </Box>

        <TovusDocFooter company={indent.companyId} docRef={indent.indentNumber} pinToPageBottom />
      </Paper>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          /* margin 0 stops the browser printing its date/title (top) and URL (bottom);
             the page spacing comes from the document padding instead */
          @page {
            size: A4;
            margin: 0;
          }
          /* whole printed page white: the app layout behind the sheet is grey (theme background) */
          html,
          body,
          #root,
          #root *:has(.indent-print-doc) {
            background: #fff !important;
            background-color: #fff !important;
          }
          /* keep the whole indent on one A4 page */
          .indent-print-doc {
            font-size: 0.82rem;
          }
          .indent-print-doc > .MuiBox-root {
            margin-bottom: 10px;
          }
          .indent-print-table {
            min-width: 0 !important;
            font-size: 0.75rem !important;
          }
          .indent-print-table th,
          .indent-print-table td {
            padding: 4px 6px !important;
          }
          .indent-print-sig {
            flex-basis: 25% !important;
            max-width: 25% !important;
          }
          .indent-print-sig > .MuiBox-root {
            min-height: 70px !important;
            padding: 6px 8px !important;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
};

export default IndentPrintView;
