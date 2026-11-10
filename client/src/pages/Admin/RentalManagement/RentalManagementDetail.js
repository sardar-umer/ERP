import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  Divider,
  Stack,
  Alert,
  CircularProgress,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Tooltip
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  Business as BusinessIcon,
  AccountBalance as AccountBalanceIcon,
  Payment as PaymentIcon,
  Assignment as AssignmentIcon,
  AttachMoney as AttachMoneyIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  CheckCircle as CheckCircleIcon,
  AttachFile as AttachFileIcon,
  Download as DownloadIcon,
  Visibility as VisibilityIcon,
  Print as PrintIcon,
  Description as DescriptionIcon,
  Image as ImageIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RestartAlt as RestartAltIcon
} from '@mui/icons-material';
import { format } from 'date-fns';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import toast from 'react-hot-toast';
import { getImageUrl } from '../../../utils/imageService';
import { useAuth } from '../../../contexts/AuthContext';
import { DigitalSignatureImage } from '../../../components/common/DigitalSignatureImage';
import {
  AuditReturnFeedbackSection,
  ResendToPreAuditDialog,
  useAdminWorkflowAuditReturn,
  isWorkflowAuditBlockingEditStatus
} from '../../../components/Admin/workflowAuditReturn';

const rentalObservationKey = (obs) => {
  if (!obs) return '';
  return String(obs._id || obs.id || '');
};

const RentalManagementDetail = ({
  open = false,
  onClose,
  recordId,
  onEdit,
  onStatusChange
}) => {
  const { user } = useAuth();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imageViewer, setImageViewer] = useState({
    open: false,
    imageUrl: '',
    imageName: '',
    isBlob: false
  });
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState({ active: false, startX: 0, startY: 0 });

  const computeRentalAuditUi = useCallback(
    (r) => ({
      auditBlocksEdit: r?.approvalStatus === 'Approved' && isWorkflowAuditBlockingEditStatus(r?.workflowStatus),
      canResendToPreAudit: r?.workflowStatus === 'Returned from Audit' && r?.approvalStatus === 'Approved'
    }),
    []
  );

  const resendRentalToAudit = useCallback(
    async (payload) => {
      const res = await api.post(`/rental-management/${recordId}/resend-to-audit`, payload);
      return res.data?.data ?? res.data;
    },
    [recordId]
  );

  const workflowAudit = useAdminWorkflowAuditReturn({
    document: open ? record : null,
    computeAuditUi: computeRentalAuditUi,
    getObservationKey: rentalObservationKey,
    onResend: resendRentalToAudit,
    onDocumentUpdate: (updated) => {
      const doc = updated?.data ?? updated;
      if (doc) {
        setRecord(doc);
        onStatusChange?.(doc);
      }
    },
    onError: (message) => {
      setError(message);
      toast.error(message);
    },
    onSuccess: (message) => {
      setError('');
      toast.success(message);
    }
  });

  const fetchRecord = useCallback(async () => {
    if (!recordId) return;
    
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/rental-management/${recordId}`);
      setRecord(response.data);
    } catch (error) {
      console.error('Error fetching record:', error);
      setError('Failed to fetch rental management record details');
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    if (open && recordId) {
    fetchRecord();
    }
  }, [open, recordId, fetchRecord]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'Draft': return 'default';
      case 'Submitted': return 'info';
      case 'Approved': return 'success';
      case 'Paid': return 'success';
      case 'Rejected': return 'error';
      default: return 'default';
    }
  };
  const getWorkflowLabel = (doc) => {
    if (doc?.workflowStatus && doc.workflowStatus !== 'Draft') return doc.workflowStatus;
    return doc?.approvalStatus || doc?.status || 'Draft';
  };

  const formatPKR = (amount) => {
    return `PKR ${amount || '0'}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // Handle different date formats
    if (dateString.includes('/')) {
      return dateString; // Already formatted
    }
    try {
      return format(new Date(dateString), 'dd/MM/yyyy');
    } catch {
      return dateString;
    }
  };

  const formatDateTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return format(date, 'dd/MM/yyyy HH:mm');
  };

  const userDisplayName = (u) => {
    if (!u) return '';
    return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.employeeId || '';
  };

  const getUserId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return String(value._id || value.id || value.userId || '');
  };
  const getSignatureSource = (row) => row?.signatureUser?.digitalSignature || '';

  const getApprovalRows = (doc) => {
    const chain = doc?.approvalChain || [];
    const workflowHistory = doc?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findLatestByToStatus = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const findPreferredAuditEntry = (accepted = []) => {
      const entries = history.filter((entry) => {
        const toStatus = normalize(entry?.toStatus);
        return accepted.some((status) => toStatus === status || toStatus.startsWith(status));
      });
      return entries.find((e) => e?.stampUsed && e?.stampImage)
        || entries.find((e) => e?.changedBy?.digitalSignature)
        || entries[0];
    };
    const preAuditActorEntry = findPreferredAuditEntry(['forwarded to audit director', 'initial audit approval']);
    const directorApproval = findLatestByToStatus(['approved (from forwarded to audit director)', 'approved (from send to audit)']);

    return [
      { authority: 'Sig of Requester', signatureUser: doc?.createdBy, dateTime: formatDateTime(doc?.createdAt) },
      { authority: 'Manager Approver', signatureUser: chain[0]?.status === 'approved' ? chain[0]?.approver : null, dateTime: chain[0]?.status === 'approved' ? formatDateTime(chain[0]?.actedAt) : '' },
      { authority: 'Head Of Department Approver', signatureUser: chain[1]?.status === 'approved' ? chain[1]?.approver : null, dateTime: chain[1]?.status === 'approved' ? formatDateTime(chain[1]?.actedAt) : '' },
      { authority: 'Pre-Audit Authority', signatureUser: preAuditActorEntry?.changedBy || null, signaturePath: preAuditActorEntry?.stampUsed && preAuditActorEntry?.stampImage ? preAuditActorEntry.stampImage : preAuditActorEntry?.changedBy?.digitalSignature || '', dateTime: formatDateTime(preAuditActorEntry?.changedAt) },
      { authority: 'Audit Director', signatureUser: directorApproval?.changedBy || null, signaturePath: directorApproval?.stampUsed && directorApproval?.stampImage ? directorApproval.stampImage : directorApproval?.changedBy?.digitalSignature || '', dateTime: formatDateTime(directorApproval?.changedAt) }
    ];
  };
  const getStampRows = (doc) => {
    const workflowHistory = doc?.workflowHistory || [];
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const history = Array.isArray(workflowHistory) ? [...workflowHistory].reverse() : [];
    const findStampedEntry = (accepted = []) => history.find((entry) => {
      const toStatus = normalize(entry?.toStatus);
      return (entry?.stampUsed && entry?.stampImage)
        && accepted.some((status) => toStatus === status || toStatus.startsWith(status));
    });
    const preAuditStamp = findStampedEntry(['forwarded to audit director', 'initial audit approval']);
    const directorStamp = findStampedEntry(['approved (from forwarded to audit director)', 'approved (from send to audit)']);
    return [
      { authority: 'Pre-Audit Authority Stamp', stampImage: preAuditStamp?.stampImage || '', dateTime: formatDateTime(preAuditStamp?.changedAt) },
      { authority: 'Audit Director Stamp', stampImage: directorStamp?.stampImage || '', dateTime: formatDateTime(directorStamp?.changedAt) }
    ].filter((row) => row.stampImage);
  };
  const getReferenceNumber = (doc) =>
    doc?.referenceNumber || doc?.referenceNo || doc?.voucherNumber || doc?._id || '';

  const handleAttachmentClick = async (attachment) => {
    const isImage = attachment.mimeType.startsWith('image/');
    const isPdf = attachment.mimeType === 'application/pdf';
    
    if (isImage) {
      // For images, we'll show them in a simple way for now
      setImageZoom(1);
      setImageOffset({ x: 0, y: 0 });
      setImageViewer({
        open: true,
        imageUrl: attachment.filePath,
        imageName: attachment.originalName,
        isBlob: false
      });
    } else if (isPdf) {
      // Open PDF in new tab
      window.open(attachment.filePath, '_blank');
    } else {
      // Download for other file types
      const link = document.createElement('a');
      link.href = attachment.filePath;
      link.download = attachment.originalName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };
  const changeImageZoom = (delta) => {
    setImageZoom((prev) => Math.min(3, Math.max(0.5, +(prev + delta).toFixed(2))));
  };
  const startImageDrag = (event) => {
    if (imageZoom <= 1) return;
    event.preventDefault();
    setDragState({
      active: true,
      startX: event.clientX - imageOffset.x,
      startY: event.clientY - imageOffset.y
    });
  };
  const onImageDrag = (event) => {
    if (!dragState.active) return;
    setImageOffset({
      x: event.clientX - dragState.startX,
      y: event.clientY - dragState.startY
    });
  };
  const stopImageDrag = () => {
    if (dragState.active) setDragState((prev) => ({ ...prev, active: false }));
  };

  const refreshRecord = async () => {
    if (!recordId) return;
    const response = await api.get(`/rental-management/${recordId}`);
    setRecord(response.data);
    return response.data;
  };

  const handleSubmitForApproval = async () => {
    try {
      await api.post(`/rental-management/${recordId}/submit`, {});
      const updated = await refreshRecord();
      onStatusChange?.(updated);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit for approval');
    }
  };

  const handleApproveAuthority = async () => {
    try {
      await api.post(`/rental-management/${recordId}/approve-authority`, {});
      const updated = await refreshRecord();
      onStatusChange?.(updated);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve');
    }
  };

  const handleRejectAuthority = async () => {
    const reason = window.prompt('Enter rejection reason');
    if (!reason || !reason.trim()) return;
    try {
      await api.post(`/rental-management/${recordId}/reject-authority`, { rejectionReason: reason.trim() });
      const updated = await refreshRecord();
      onStatusChange?.(updated);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reject');
    }
  };

  const handlePrint = () => {
    if (!record) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const approvalRows = getApprovalRows(record);
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Rental Management - ${getReferenceNumber(record) || 'N/A'}</title>
          <style>
            body { font-family: Georgia, "Times New Roman", serif; color: #141414; margin: 20px; font-size: 12px; background: #fff; }
            .memo-paper { max-width: 960px; margin: 0 auto; padding: 30px; }
            .header { text-align: center; line-height: 1.15; margin-bottom: 14px; }
            .company { font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: .35px; }
            .title { font-size: 16px; font-weight: 700; margin-top: 2px; }
            .top-meta { display: grid; grid-template-columns: 1fr 170px; align-items: start; margin-bottom: 26px; }
            .left-meta { display: grid; grid-template-columns: 80px 1fr; width: 380px; line-height: 1.35; font-weight: 700; }
            .right-meta { text-align: right; line-height: 2; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th { font-size: 10.5px; font-weight: 800; text-align: center; border-bottom: 1px solid #c7c7c7; padding: 7px 8px; color: #333; background: #f8f8f8; }
            td { padding: 9px 8px; vertical-align: top; }
            .main-table { margin-top: 6px; border-top: 1px solid #c7c7c7; border-bottom: 1px solid #c7c7c7; }
            .main-table th, .main-table td { border-right: 1px solid #ededed; }
            .main-table th:last-child, .main-table td:last-child { border-right: 0; }
            .body-row td { border-top: 1px solid #d9d9d9; }
            .totals td { padding-top: 4px; padding-bottom: 4px; font-weight: 700; }
            .total-label { text-align: right; }
            .approval-table { margin-top: 56px; border: 1px solid #d8d8d8; }
            .approval-table th { text-align: left; font-size: 12px; background: #f5f5f5; border-bottom: 1px solid #d8d8d8; }
            .approval-table td { border-bottom: 1px solid #e0e0e0; }
            .approval-table tr:last-child td { border-bottom: 0; }
            .authority { font-weight: 800; }
          </style>
        </head>
        <body>
          <div class="memo-paper">
            <div class="header">
              <div class="company">${record?.parentCompanyName || 'RENTAL MANAGEMENT'}</div>
              <div class="title">${record?.subsidiaryName || 'Rental Management'}</div>
            </div>
            <div class="top-meta">
              <div class="left-meta">
                <span>SITE :</span><span>${record?.site || 'N/A'}</span>
                <span>From:</span><span>${record?.fromDepartment || 'N/A'}</span>
                <span>Custodian:</span><span>${record?.custodian || 'N/A'}</span>
              </div>
              <div class="right-meta">
                <div>${formatDate(record?.date)}</div>
                <div>${getReferenceNumber(record)}</div>
              </div>
            </div>
            <table class="main-table">
              <colgroup>
                <col style="width:14%" />
                <col style="width:16%" />
                <col style="width:24%" />
                <col style="width:30%" />
                <col style="width:16%" />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference No</th>
                  <th>To Whom Paid</th>
                  <th>For What</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr class="body-row">
                  <td>${formatDate(record?.date)}</td>
                  <td>${getReferenceNumber(record) || 'N/A'}</td>
                  <td>${record?.toWhomPaid || 'N/A'}</td>
                  <td>${record?.forWhat || 'N/A'}</td>
                  <td style="text-align:right;">${formatPKR(record?.amount)}</td>
                </tr>
                <tr class="totals">
                  <td colspan="4" class="total-label">Grand Total</td>
                  <td style="text-align:right;">${formatPKR(record?.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
            <table class="approval-table">
              <thead>
                <tr>
                  <th>Authority</th>
                  <th>Name</th>
                  <th>Digital Signature</th>
                  <th>Date &amp; Time</th>
                </tr>
              </thead>
              <tbody>
                ${approvalRows.map((row) => `
                  <tr>
                    <td class="authority">${row.authority}</td>
                    <td>${userDisplayName(row.signatureUser) || '-'}</td>
                    <td>${getSignatureSource(row) ? `<img src="${getImageUrl(getSignatureSource(row))}" alt="${row.authority}" style="max-height:42px;max-width:135px;object-fit:contain;" />` : '-'}</td>
                    <td>${row.dateTime || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 0,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            background: '#ffffff'
          }
        }}
      >
        <DialogTitle sx={{ p: 0, m: 0 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              p: 2,
              borderBottom: '1px solid #e0e0e0'
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#333' }}>
              RENTAL MANAGEMENT
            </Typography>
            <IconButton
              onClick={onClose}
              size="small"
              sx={{ color: '#666' }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        
        <DialogContent sx={{ p: 0 }}>
          {loading ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
              <CircularProgress />
            </Box>
          ) : error ? (
            <Box sx={{ p: 3 }}>
              <Alert severity="error">{error}</Alert>
            </Box>
          ) : !record ? (
            <Box sx={{ p: 3 }}>
              <Alert severity="warning">Rental management record not found</Alert>
            </Box>
          ) : (
            <Box
              sx={{
                maxWidth: 1050,
                mx: 'auto',
                p: { xs: 2.25, md: 5 },
                background: '#ffffff',
                color: '#151515',
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: 'grey.200',
                fontFamily: 'Georgia, "Times New Roman", serif'
              }}
            >
              <Box sx={{ textAlign: 'center', lineHeight: 1.12, mb: 2.5, pb: 1.75, borderBottom: '1px solid', borderColor: 'grey.200' }}>
                <Typography variant="h5" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: { xs: 17, md: 19 }, mb: 0.5 }}>
                  {record.parentCompanyName || 'RENTAL MANAGEMENT'}
                </Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: { xs: 15, md: 17 } }}>
                  {record.subsidiaryName || 'Rental Management'}
                </Typography>
              </Box>

              <AuditReturnFeedbackSection
                documentId={record._id}
                auditStatus={record.workflowStatus}
                returnedAuditStatus="Returned from Audit"
                latestReturnHistory={workflowAudit.latestReturnHistory}
                observations={workflowAudit.observations}
                getObservationKey={rentalObservationKey}
                formatDateTime={formatDateTime}
                userDisplayName={userDisplayName}
                returnedIntro={(
                  <>
                    This record was returned for correction. Review the points below, use <strong>Edit Record</strong>{' '}
                    to update it if needed, then use <strong>Resend to Pre-Audit</strong> when you are ready.
                  </>
                )}
              />

              <Box sx={{ mb: 3.5, p: { xs: 1.5, md: 2 }, border: '1px solid', borderColor: 'grey.200', borderRadius: 1.5, background: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)' }}>
                <Grid container spacing={1.25}>
                  <Grid item xs={12} md={8}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '120px 1fr', sm: '140px 1fr' }, rowGap: 0.75, columnGap: 1 }}>
                      <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5 }}>SITE</Typography>
                      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{record.site || 'N/A'}</Typography>
                      <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5 }}>FROM</Typography>
                      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{record.fromDepartment || 'N/A'}</Typography>
                      <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5 }}>CUSTODIAN</Typography>
                      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{record.custodian || 'N/A'}</Typography>
                      <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 12.5 }}>STATUS</Typography>
                      <Box>
                        <Chip label={getWorkflowLabel(record)} color={getStatusColor(record.approvalStatus || record.status)} size="small" />
                      </Box>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ height: '100%', p: 1.25, border: '2px dashed', borderColor: 'grey.300', borderRadius: 1, backgroundColor: 'grey.50', display: 'grid', alignContent: 'center', rowGap: 0.9 }}>
                      <Box>
                        <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 11.5 }}>DATE</Typography>
                        <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: 'grey.900' }}>{formatDate(record.date)}</Typography>
                      </Box>
                      <Box>
                        <Typography sx={{ fontWeight: 800, color: 'grey.700', fontSize: 11.5 }}>DOCUMENT NO.</Typography>
                        <Typography sx={{ fontWeight: 800, fontSize: 13.5, color: 'grey.900' }}>{getReferenceNumber(record)}</Typography>
                      </Box>
                    </Box>
                  </Grid>
                </Grid>
              </Box>

              <Box sx={{ mb: 3 }}>
                <Table size="small" sx={{ width: '100%', tableLayout: 'fixed', mt: 1, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'grey.300', '& th': { bgcolor: 'grey.50', borderBottom: '1px solid', borderRight: '1px solid', borderColor: 'grey.300', p: 1, fontSize: 12, fontWeight: 800, textAlign: 'center', color: 'grey.700' }, '& th:last-of-type': { borderRight: 0 }, '& td': { borderBottom: 0, borderTop: '1px solid', borderRight: '1px solid', borderColor: 'grey.200', p: 1.25, fontSize: 13, verticalAlign: 'top' }, '& td:last-of-type': { borderRight: 0 } }}>
                  <colgroup>
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '16%' }} />
                  </colgroup>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Reference No</TableCell>
                      <TableCell>To Whom Paid</TableCell>
                      <TableCell>For What</TableCell>
                      <TableCell sx={{ textAlign: 'right' }}>Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>{formatDate(record.date)}</TableCell>
                      <TableCell>{getReferenceNumber(record) || 'N/A'}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{record.toWhomPaid || 'N/A'}</TableCell>
                      <TableCell sx={{ fontWeight: 700, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{record.forWhat || 'N/A'}</TableCell>
                      <TableCell sx={{ fontWeight: 800, textAlign: 'right' }}>{formatPKR(record.amount)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4} sx={{ p: 0.6, pr: 2, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                        Grand Total
                      </TableCell>
                      <TableCell sx={{ p: 0.6, pr: 1.25, fontWeight: 800, fontSize: 13, textAlign: 'right', borderTop: 0 }}>
                        {formatPKR(record.grandTotal)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>

              <Box sx={{ mt: 7, border: '1px solid', borderColor: 'grey.300' }}>
                <Table size="small" sx={{ '& th': { bgcolor: 'grey.100', fontWeight: 800, fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.300' }, '& td': { fontSize: 14, borderBottom: '1px solid', borderColor: 'grey.200', py: 1.4 }, '& tr:last-child td': { borderBottom: 0 } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Authority</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Digital Signature</TableCell>
                      <TableCell>Date &amp; Time</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {getApprovalRows(record).map((row) => (
                      <TableRow key={row.authority}>
                        <TableCell sx={{ fontWeight: 800 }}>{row.authority}</TableCell>
                        <TableCell>{userDisplayName(row.signatureUser) || '-'}</TableCell>
                        <TableCell>
                          {getSignatureSource(row) ? (
                            <DigitalSignatureImage userOrPath={getSignatureSource(row)} alt={`${row.authority} signature`} />
                          ) : '-'}
                        </TableCell>
                        <TableCell>{row.dateTime || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              {getStampRows(record).length > 0 && (
                <Box sx={{ mt: 3, p: 2.5, border: '2px solid', borderColor: 'grey.300', borderRadius: 1.5, backgroundColor: 'grey.50' }}>
                  <Typography sx={{ fontWeight: 900, fontSize: 17, mb: 2 }}>Approval Stamp</Typography>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    {getStampRows(record).map((stampRow) => (
                      <Box key={stampRow.authority} sx={{ flex: 1, minWidth: 260, p: 2, bgcolor: 'white', border: '1.5px solid', borderColor: 'grey.400', borderRadius: 1.5, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)' }}>
                        <Typography sx={{ fontWeight: 700, mb: 1 }}>{stampRow.authority}</Typography>
                        <Box component="img" src={getImageUrl(stampRow.stampImage)} alt={stampRow.authority} sx={{ display: 'block', maxHeight: 170, width: '100%', objectFit: 'contain', border: '2px dashed', borderColor: 'grey.400', p: 1.5, backgroundColor: '#fff'  }} />
                        <Typography sx={{ mt: 1, fontSize: 12.5, color: 'grey.700' }}>{stampRow.dateTime || '-'}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}

              {record.rentalAgreement && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, mb: 1.5, fontSize: 13 }}>
                    RENTAL AGREEMENT: {record.rentalAgreement.agreementNumber || 'N/A'} - {record.rentalAgreement.propertyName || 'N/A'}
                  </Typography>
                </Box>
              )}

              {record.attachments && record.attachments.length > 0 && (
                <Box sx={{ mt: 4, borderTop: '1px solid #000', pt: 3 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, mb: 2, fontSize: '14px', textDecoration: 'underline' }}>
                    ATTACHMENTS ({record.attachments.length}):
                  </Typography>
                  <Box sx={{ border: '1px solid #000', p: 2 }}>
                    <Grid container spacing={1}>
                      {record.attachments.map((attachment, index) => (
                        <Grid item xs={12} key={attachment._id || index}>
                          <Box sx={{ p: 1.5, border: '1px solid #ccc', cursor: 'pointer', '&:hover': { borderColor: '#000', background: '#f5f5f5' } }} onClick={() => handleAttachmentClick(attachment)}>
                            <Typography variant="body2" sx={{ fontSize: '12px', fontWeight: 500 }}>
                              {index + 1}. {attachment.originalName}
                            </Typography>
                          </Box>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        
        <DialogActions sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button onClick={onClose} color="inherit">
            Close
          </Button>
          {record && (
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={handlePrint}
              sx={{ mr: 1 }}
            >
              Print
            </Button>
          )}
          {record?.approvalStatus === 'Draft' && (
            <Button variant="contained" color="success" onClick={handleSubmitForApproval}>
              Submit
            </Button>
          )}
          {record?.approvalStatus === 'Submitted' &&
            String(getUserId(record?.createdBy)) !== String(getUserId(user)) &&
            (record?.approvalChain || []).some((step) => String(getUserId(step?.approver)) === String(getUserId(user)) && step?.status === 'pending') && (
              <>
                <Button variant="outlined" color="error" onClick={handleRejectAuthority}>
                  Reject
                </Button>
                <Button variant="contained" color="success" onClick={handleApproveAuthority}>
                  Approve
                </Button>
              </>
            )}
          {record && workflowAudit.canResendToPreAudit && (
            <Button variant="contained" color="warning" startIcon={<RestartAltIcon />} onClick={workflowAudit.openResendDialog}>
              Resend to Pre-Audit
            </Button>
          )}
          {onEdit && record && (
            <Tooltip
              title={
                workflowAudit.auditBlocksEdit
                  ? 'This record is with audit and cannot be edited until it is returned for correction.'
                  : ''
              }
            >
              <span>
                <Button
                  variant="contained"
                  startIcon={<EditIcon />}
                  disabled={workflowAudit.auditBlocksEdit}
                  onClick={() => onEdit(record)}
                >
                  Edit Record
                </Button>
              </span>
            </Tooltip>
          )}
        </DialogActions>
      </Dialog>

      <ResendToPreAuditDialog
        open={workflowAudit.resendDialogOpen}
        onClose={workflowAudit.closeResendDialog}
        submitting={workflowAudit.resendSubmitting}
        observations={workflowAudit.observations}
        getObservationKey={rentalObservationKey}
        resendComments={workflowAudit.resendComments}
        onResendCommentsChange={workflowAudit.setResendComments}
        resendAnswers={workflowAudit.resendAnswers}
        onResendAnswerChange={(key, value) =>
          workflowAudit.setResendAnswers((prev) => ({ ...prev, [key]: value }))}
        onSubmit={workflowAudit.handleResendToAudit}
        intro={(
          <>
            Save any changes with <strong>Edit Record</strong> before confirming. Add replies for each open observation,
            then send the record back to the audit queue.
          </>
        )}
      />

      {/* Image Viewer Dialog */}
      <Dialog
        open={imageViewer.open}
        onClose={() => {
          setImageZoom(1);
          setImageOffset({ x: 0, y: 0 });
          setImageViewer({ open: false, imageUrl: '', imageName: '', isBlob: false });
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Typography variant="h6">{imageViewer.imageName}</Typography>
            <Stack direction="row" spacing={0.5} sx={{ ml: 'auto' }}>
              <IconButton size="small" onClick={() => changeImageZoom(-0.2)} title="Zoom out">
                <ZoomOutIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => { setImageZoom(1); setImageOffset({ x: 0, y: 0 }); }} title="Reset zoom">
                <RestartAltIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => changeImageZoom(0.2)} title="Zoom in">
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </Stack>
            <IconButton
              onClick={() => {
                setImageZoom(1);
                setImageOffset({ x: 0, y: 0 });
                setImageViewer({ open: false, imageUrl: '', imageName: '', isBlob: false });
              }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent
          sx={{ overflow: 'auto', cursor: imageZoom > 1 ? (dragState.active ? 'grabbing' : 'grab') : 'default' }}
          onMouseMove={onImageDrag}
          onMouseUp={stopImageDrag}
          onMouseLeave={stopImageDrag}
        >
          <Box
            component="img"
            src={imageViewer.imageUrl}
            alt={imageViewer.imageName}
            onMouseDown={startImageDrag}
            sx={{
              width: '100%',
              height: 'auto',
              maxHeight: '70vh',
              objectFit: 'contain',
              transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom})`,
              transformOrigin: 'center center',
              transition: dragState.active ? 'none' : 'transform 0.15s ease',
              userSelect: 'none'
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RentalManagementDetail;
