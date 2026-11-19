import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
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
import api from '../../services/api';
import dayjs from 'dayjs';
import { DigitalSignatureImage } from '../../components/common/DigitalSignatureImage';
import { TovusPrintDocument, TovusDocDetails } from '../../components/common/TovusDocumentBrand';

function renderIndentItemDescriptionCell(item) {
  const name = String(item?.itemName || '').trim();
  const desc = String(item?.description || '').trim();
  if (!name && !desc) return '___________';
  if (name && desc && name !== desc) {
    return (
      <>
        <div style={{ fontWeight: 600 }}>{name}</div>
        <div style={{ marginTop: 4, fontSize: '0.92em', lineHeight: 1.45, color: '#333' }}>{desc}</div>
      </>
    );
  }
  return name || desc;
}

const RequisitionPrintView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [requisition, setRequisition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadRequisition = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/indents/${id}`);
        if (response.data.success) {
          setRequisition(response.data.data);
        } else {
          setError('Failed to load requisition');
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load requisition');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      loadRequisition();
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

  if (error || !requisition) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error || 'Requisition not found'}</Alert>
      </Box>
    );
  }

  const approvalNameFromChain = (index) => {
    const step = requisition.approvalChain?.[index];
    if (step?.approver) {
      const n = [step.approver.firstName, step.approver.lastName].filter(Boolean).join(' ').trim();
      if (n) return n;
      if (step.approver.email) return step.approver.email;
    }
    const keys = ['headOfDepartment', 'gmPd', 'svpAvp'];
    return requisition.signatures?.[keys[index]]?.name || '';
  };

  const approvalDateFromChain = (index) => {
    const step = requisition.approvalChain?.[index];
    if (step?.actedAt && step?.status === 'approved') return step.actedAt;
    const keys = ['headOfDepartment', 'gmPd', 'svpAvp'];
    return requisition.signatures?.[keys[index]]?.date;
  };

  const chainStep = (index) => requisition.approvalChain?.[index];

  return (
    <>
      {/* Print Controls - Hidden when printing */}
      <Box sx={{ p: 2, display: 'flex', gap: 2, '@media print': { display: 'none' } }}>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/procurement/requisitions')}
        >
          Back
        </Button>
        <Button
          variant="contained"
          startIcon={<PrintIcon />}
          onClick={handlePrint}
        >
          Print
        </Button>
      </Box>

      {/* Print Content — Tovus branded A4 document (header, footer, one-page auto-fit) */}
      <TovusPrintDocument title="Purchase Request Form" docRef={requisition.indentNumber} company={requisition.companyId}>
        <TovusDocDetails
          fields={[
            { label: 'ERP Ref', value: requisition.erpRef || 'PR #' + (requisition.indentNumber?.split('-').pop() || ''), upper: true },
            { label: 'Indent No.', value: requisition.indentNumber },
            { label: 'Date', value: formatDate(requisition.requestedDate) },
            { label: 'Required Date', value: requisition.requiredDate ? formatDate(requisition.requiredDate) : '' },
            { label: 'Department', value: requisition.department?.name, upper: true },
            {
              label: 'Originator',
              value: requisition.requestedBy?.firstName && requisition.requestedBy?.lastName
                ? `${requisition.requestedBy.firstName} ${requisition.requestedBy.lastName}`
                : '',
              upper: true
            },
            { label: 'Category', value: requisition.category, upper: true },
            { label: 'Company', value: requisition.companyId?.name, upper: true, span: 2 },
            requisition.title ? { label: 'Subject', value: requisition.title, full: true } : null
          ]}
        />

        {/* Items Table */}
        <Box sx={{ mb: 3 }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              border: '1px solid #000',
              fontSize: '0.85rem',
              fontFamily: 'Arial, sans-serif'
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: '5%' }}>
                  S#
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '30%' }}>
                  Description
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '15%' }}>
                  Brand
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '10%' }}>
                  Unit
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: '8%' }}>
                  Qty.
                </th>
                <th style={{ border: '1px solid #000', padding: '10px 8px', fontWeight: 700, textAlign: 'left', width: '32%' }}>
                  Purpose
                </th>
              </tr>
            </thead>
            <tbody>
              {requisition.items && requisition.items.length > 0 ? (
                requisition.items.map((item, index) => (
                  <tr key={index} style={{ border: '1px solid #000' }}>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                      {(index + 1).toString().padStart(2, '0')}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {renderIndentItemDescriptionCell(item)}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.brand || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.unit || '___________'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center', verticalAlign: 'top' }}>
                      {item.quantity || '___'}
                    </td>
                    <td style={{ border: '1px solid #000', padding: '10px 8px', verticalAlign: 'top' }}>
                      {item.purpose || '___________'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center' }}>
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
            {requisition.justification || '___________'}
          </Box>
        </Box>

        {/* Signatures — large image area inside fixed 150px-tall boxes (screen + print) */}
        <Box sx={{ mb: 3 }}>
          <Grid container spacing={1.5}>
            <Grid item xs={12} sm={6} md={6}>
              <Box
                sx={{
                  border: '1px solid #ccc',
                  p: 0.75,
                  height: 150,
                  minHeight: 150,
                  maxHeight: 150,
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  textAlign: 'left',
                  '@media print': { height: 150, minHeight: 150, maxHeight: 150 }
                }}
              >
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25, fontSize: '0.8rem', lineHeight: 1.15, flexShrink: 0 }}>
                  Sig of Requester:
                </Typography>
                {requisition.requestedBy?.digitalSignature ? (
                  <Box
                    sx={{
                      flex: '1 1 0',
                      minHeight: 0,
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      overflow: 'hidden',
                      py: 0.25,
                      pl: 0.25
                    }}
                  >
                    <DigitalSignatureImage
                      userOrPath={requisition.requestedBy}
                      alt="Requester"
                      sx={{
                        maxHeight: '100%',
                        maxWidth: '100%',
                        width: 'auto',
                        height: '100%',
                        mx: 0,
                        alignSelf: 'center',
                        objectFit: 'contain',
                        objectPosition: 'left center',
                        '@media print': { maxHeight: '100%', maxWidth: '100%', objectPosition: 'left center' }
                      }}
                    />
                  </Box>
                ) : null}
                <Box sx={{ flexShrink: 0, mt: 0.25, minHeight: '18px', fontSize: '0.8rem', lineHeight: 1.2 }}>
                  {requisition.signatures?.requester?.name ||
                    (requisition.requestedBy?.firstName && requisition.requestedBy?.lastName
                      ? `${requisition.requestedBy.firstName} ${requisition.requestedBy.lastName}`
                      : '___________')}
                </Box>
                {(requisition.signatures?.requester?.date || requisition.requestedDate || requisition.createdAt) && (
                  <Typography variant="caption" sx={{ mt: 0.125, display: 'block', fontSize: '0.7rem', lineHeight: 1.1, flexShrink: 0 }}>
                    {formatDate(requisition.signatures?.requester?.date || requisition.requestedDate || requisition.createdAt)}
                  </Typography>
                )}
              </Box>
            </Grid>
            <Grid item xs={12} sm={6} md={6}>
              <Box
                sx={{
                  border: '1px solid #ccc',
                  p: 0.75,
                  height: 150,
                  minHeight: 150,
                  maxHeight: 150,
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  textAlign: 'left',
                  '@media print': { height: 150, minHeight: 150, maxHeight: 150 }
                }}
              >
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25, fontSize: '0.8rem', lineHeight: 1.15, flexShrink: 0 }}>
                  Head of Department:
                </Typography>
                {chainStep(0)?.status === 'approved' && chainStep(0)?.approver?.digitalSignature ? (
                  <Box
                    sx={{
                      flex: '1 1 0',
                      minHeight: 0,
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      overflow: 'hidden',
                      py: 0.25,
                      pl: 0.25
                    }}
                  >
                    <DigitalSignatureImage
                      userOrPath={chainStep(0).approver}
                      alt="Head of Department"
                      sx={{
                        maxHeight: '100%',
                        maxWidth: '100%',
                        width: 'auto',
                        height: '100%',
                        mx: 0,
                        alignSelf: 'center',
                        objectFit: 'contain',
                        objectPosition: 'left center',
                        '@media print': { maxHeight: '100%', maxWidth: '100%', objectPosition: 'left center' }
                      }}
                    />
                  </Box>
                ) : null}
                <Box sx={{ flexShrink: 0, mt: 0.25, minHeight: '18px', fontSize: '0.8rem', lineHeight: 1.2 }}>
                  {approvalNameFromChain(0) || '___________'}
                </Box>
                {approvalDateFromChain(0) && (
                  <Typography variant="caption" sx={{ mt: 0.125, display: 'block', fontSize: '0.7rem', lineHeight: 1.1, flexShrink: 0 }}>
                    {formatDate(approvalDateFromChain(0))}
                  </Typography>
                )}
              </Box>
            </Grid>
          </Grid>
        </Box>

      </TovusPrintDocument>

    </>
  );
};

export default RequisitionPrintView;
