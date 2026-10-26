import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  IconButton, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import {
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Close as RemoveIcon,
  PhotoCamera as PhotoIcon,
  Print as PrintIcon,
  Videocam as VideoIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import {
  cancelInspectionReport,
  createInspectionReport,
  decideInspectionReport,
  getUsersForAssignment
} from '../../services/projectManagementService';
import { DigitalSignatureImage } from '../common/DigitalSignatureImage';
import { printInspectionReport } from '../../utils/inspectionReportPrint';
import { useAuth } from '../../contexts/AuthContext';
import { getImageUrl } from '../../utils/imageService';

const MIN_IMAGES = 3;
const MIN_VIDEOS = 1;
const IMAGE_MAX_MB = 10;
const VIDEO_MAX_MB = 200;
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const fmt = (v) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(v || 0));
const personName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || '';
const STATUS_COLOR = { Pending: 'warning', Approved: 'success', Rejected: 'error', Cancelled: 'default' };

/**
 * Inspection Report for a Submitted Check Request.
 * - `checkRequest` without `report`: create mode (assign inspectors, record inspected quantities).
 * - `report`: view mode — assigned inspectors approve / reject with observations; their profile signature is stamped.
 * `context` = { mainProject, subProject, sector, contractLabel } shown at the top and on the print.
 */
export default function InspectionReportDialog({ open, onClose, projectId, checkRequest, report, context = {}, onChanged }) {
  const { user } = useAuth();
  const myId = String(user?._id || user?.id || '');
  const isCreate = !report;
  const cr = useMemo(() => report?.checkRequest || checkRequest || {}, [report, checkRequest]);
  const claimType = report?.claimType || cr.claimType || 'BOQ';
  const isSlab = claimType === 'Slab';

  const [users, setUsers] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [inspectionDate, setInspectionDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [location, setLocation] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState([]);
  const [observations, setObservations] = useState('');
  // Evidence picked for this inspector's decision: { file, preview }
  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [uploadPct, setUploadPct] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setObservations('');
    setImages([]);
    setVideos([]);
    setUploadPct(null);
    if (isCreate) {
      setInspectors([]);
      setInspectionDate(dayjs().format('YYYY-MM-DD'));
      setLocation('');
      setRemarks('');
      setLines((checkRequest?.items || []).map((i) => ({
        boqItemId: String(i.boqItem?._id || i.boqItem),
        title: i.title || i.description,
        unit: i.unit,
        claimedQuantity: Number(i.claimedQuantity) || 0,
        inspectedQuantity: Number(i.claimedQuantity) || 0,
        unitPrice: Number(i.unitPrice) || 0
      })));
      getUsersForAssignment()
        .then((res) => setUsers(res.data?.data?.users || []))
        .catch(() => setUsers([]));
    }
  }, [open, isCreate, checkRequest]);

  useEffect(() => () => {
    [...images, ...videos].forEach((f) => URL.revokeObjectURL(f.preview));
  }, [images, videos]);

  const addFiles = (kind, fileList) => {
    const maxMb = kind === 'image' ? IMAGE_MAX_MB : VIDEO_MAX_MB;
    const picked = Array.from(fileList || []);
    const tooBig = picked.find((f) => f.size > maxMb * 1024 * 1024);
    if (tooBig) {
      setError(`${tooBig.name} is ${mb(tooBig.size)} — ${kind === 'image' ? 'photos' : 'videos'} must be under ${maxMb} MB`);
      return;
    }
    const wrongType = picked.find((f) => !f.type.startsWith(kind === 'image' ? 'image/' : 'video/'));
    if (wrongType) {
      setError(`${wrongType.name} is not ${kind === 'image' ? 'an image' : 'a video'}`);
      return;
    }
    const entries = picked.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    (kind === 'image' ? setImages : setVideos)((prev) => [...prev, ...entries]);
  };
  const removeFile = (kind, idx) => (kind === 'image' ? setImages : setVideos)((prev) => prev.filter((_, i) => i !== idx));
  const evidenceReady = images.length >= MIN_IMAGES && videos.length >= MIN_VIDEOS;

  const inspectedTotal = useMemo(() => (isSlab
    ? Number(cr.slab?.amount) || Number(cr.claimedTotal) || 0
    : lines.reduce((s, l) => s + (Number(l.inspectedQuantity) || 0) * l.unitPrice, 0)), [isSlab, cr, lines]);

  const mySlot = report?.inspectors?.find((i) => String(i.user?._id || i.user) === myId);
  const canSign = report?.status === 'Pending' && mySlot?.status === 'Pending';
  const signedCount = (report?.inspectors || []).filter((i) => i.status === 'Approved').length;

  const handleCreate = async () => {
    if (!inspectors.length) { setError('Assign at least one inspector'); return; }
    try {
      setSaving(true);
      setError('');
      await createInspectionReport(projectId, cr._id, {
        inspectionDate,
        location,
        remarks,
        inspectors: inspectors.map((u) => u.id || u._id),
        items: lines.map((l) => ({ boqItemId: l.boqItemId, inspectedQuantity: Number(l.inspectedQuantity) || 0 }))
      });
      onChanged?.('Inspection report created — inspectors have been notified');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create inspection report');
    } finally {
      setSaving(false);
    }
  };

  const handleDecision = async (decision) => {
    if (decision === 'Rejected' && !observations.trim()) { setError('Write your observations to reject'); return; }
    if (!evidenceReady) {
      setError(`Attach at least ${MIN_IMAGES} photos and ${MIN_VIDEOS} video of the site before you decide`);
      return;
    }
    const body = new FormData();
    body.append('decision', decision);
    body.append('observations', observations.trim());
    images.forEach(({ file }) => body.append('images', file));
    videos.forEach(({ file }) => body.append('videos', file));
    try {
      setSaving(true);
      setError('');
      setUploadPct(0);
      const res = await decideInspectionReport(projectId, report._id, body, (e) => {
        if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100));
      });
      onChanged?.(res.data?.message || `Inspection ${decision.toLowerCase()}`);
    } catch (err) {
      setError(err.response?.data?.message
        || (err.response?.status === 413 ? 'Upload too large for the server — try a shorter video' : 'Could not record your decision'));
    } finally {
      setSaving(false);
      setUploadPct(null);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm(`Cancel inspection report ${report.reportNumber}?`)) return;
    try {
      setSaving(true);
      await cancelInspectionReport(projectId, report._id);
      onChanged?.('Inspection report cancelled');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not cancel');
    } finally {
      setSaving(false);
    }
  };

  const field = (label, value, sm = 4) => (
    <Grid item xs={12} sm={sm} key={label}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>{value || '—'}</Typography>
    </Grid>
  );

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Stack direction="row" alignItems="center" gap={1}>
            <span>{isCreate ? 'New Inspection Report' : `Inspection Report ${report.reportNumber}`}</span>
            {!isCreate && <Chip size="small" label={report.status} color={STATUS_COLOR[report.status] || 'default'} />}
          </Stack>
          {context.contractLabel && <Chip color={isSlab ? 'secondary' : 'primary'} label={context.contractLabel} sx={{ fontWeight: 700 }} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1.5 }}>
            <Grid container spacing={1.5}>
              {field('Main Project', context.mainProject)}
              {field('Sub Project', context.subProject)}
              {field('Sector', context.sector)}
            </Grid>
          </Paper>

          <Grid container spacing={1.5}>
            {field('Check Request', `${cr.checkRequestNumber || ''} — ${cr.title || ''}`, 8)}
            {field('Subcontractor', cr.contractor?.name)}
            {field('Claim basis', isSlab ? 'Slab wise (stage payment)' : 'BOQ wise (quantities)')}
            {!isCreate && field('Inspection date', dayjs(report.inspectionDate).format('DD MMM YYYY'))}
            {!isCreate && field('Location', report.location)}
            {!isCreate && field('Prepared by', `${personName(report.createdBy)} · ${dayjs(report.createdAt).format('DD MMM YYYY')}`)}
            {!isCreate && field('Signatures', `${signedCount} of ${report.inspectors.length} approved`)}
          </Grid>

          {isCreate && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth type="date" label="Inspection date" value={inspectionDate}
                  onChange={(e) => setInspectionDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12} sm={8}>
                <TextField fullWidth label="Location on site" value={location} onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Block A, Street 4" />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  options={users}
                  value={inspectors}
                  onChange={(_, v) => setInspectors(v)}
                  isOptionEqualToValue={(a, b) => String(a.id || a._id) === String(b.id || b._id)}
                  getOptionLabel={(u) => `${personName(u)}${u.position ? ` — ${u.position}` : ''}`}
                  renderOption={(props, u) => (
                    <li {...props} key={u.id || u._id}>
                      <Stack direction="row" justifyContent="space-between" sx={{ width: '100%' }} gap={1}>
                        <span>{personName(u)}{u.position ? ` — ${u.position}` : ''}</span>
                        {!u.digitalSignature && <Typography variant="caption" color="warning.main">No signature on profile</Typography>}
                      </Stack>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} required label="Assign inspectors"
                      helperText="Every inspector must approve. Each signs with the digital signature on their profile." />
                  )}
                />
              </Grid>
            </Grid>
          )}

          {isSlab ? (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={1}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Slab: {(report?.slab || cr.slab)?.name} · {(report?.slab || cr.slab)?.percentage}%
                </Typography>
                <Typography variant="subtitle1" fontWeight={700} color="primary.main">{fmt(inspectedTotal)}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Inspectors confirm every activity in this stage is complete.
              </Typography>
              {(cr.slab?.activities || []).length > 0 && (
                <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 1 }}>
                  {cr.slab.activities.map((a, idx) => <Chip key={idx} size="small" variant="outlined" label={a.name} />)}
                </Stack>
              )}
            </Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell align="right">Claimed</TableCell>
                    <TableCell align="right">Inspected</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(isCreate ? lines : report.items || []).map((l, idx) => (
                    <TableRow key={l.boqItemId || idx}>
                      <TableCell>{l.title}</TableCell>
                      <TableCell align="right">{l.claimedQuantity} {l.unit}</TableCell>
                      <TableCell align="right">
                        {isCreate ? (
                          <TextField
                            size="small"
                            type="number"
                            value={l.inspectedQuantity}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, inspectedQuantity: v } : x)));
                            }}
                            inputProps={{ min: 0, max: l.claimedQuantity, step: 'any' }}
                            sx={{ width: 110 }}
                          />
                        ) : <strong>{l.inspectedQuantity} {l.unit}</strong>}
                      </TableCell>
                      <TableCell align="right">{fmt(l.unitPrice)}</TableCell>
                      <TableCell align="right">{fmt((Number(l.inspectedQuantity) || 0) * (Number(l.unitPrice) || 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {!isSlab && (
            <Typography variant="body2" align="right">Inspected value: <strong>{fmt(inspectedTotal)}</strong></Typography>
          )}

          {isCreate ? (
            <TextField fullWidth multiline minRows={2} label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          ) : (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">Remarks</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{report.remarks || '—'}</Typography>
            </Box>
          )}

          {!isCreate && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Inspectors</Typography>
              <Grid container spacing={1.5}>
                {report.inspectors.map((i) => (
                  <Grid item xs={12} sm={6} md={4} key={i._id}>
                    <Paper variant="outlined" sx={{ p: 1.5, height: '100%', borderRadius: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={700} noWrap>{i.name || personName(i.user)}</Typography>
                          <Typography variant="caption" color="text.secondary">{i.designation || '—'}</Typography>
                        </Box>
                        <Chip size="small" label={i.status} color={STATUS_COLOR[i.status] || 'default'} />
                      </Stack>
                      <Box sx={{ height: 72, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', borderBottom: 1, borderColor: 'divider', my: 1 }}>
                        {i.signature
                          ? <DigitalSignatureImage userOrPath={i.signature} alt={`${i.name} signature`} sx={{ maxHeight: 64, maxWidth: '100%' }} />
                          : <Typography variant="caption" color="text.disabled">Not signed yet</Typography>}
                      </Box>
                      {i.actedAt && <Typography variant="caption" color="text.secondary" display="block">{dayjs(i.actedAt).format('DD MMM YYYY, hh:mm A')}</Typography>}
                      {i.observations && (
                        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                          <strong>Observations:</strong> {i.observations}
                        </Typography>
                      )}
                      {(i.attachments || []).length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Stack direction="row" gap={0.75} flexWrap="wrap">
                            {i.attachments.filter((a) => a.kind === 'image').map((a, idx) => (
                              <Box
                                key={a.url}
                                component="a"
                                href={getImageUrl(a.url)}
                                target="_blank"
                                rel="noreferrer"
                                title={a.originalName || `Photo ${idx + 1}`}
                              >
                                <Box component="img" src={getImageUrl(a.url)} alt={a.originalName || `Photo ${idx + 1}`}
                                  sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider', display: 'block' }} />
                              </Box>
                            ))}
                          </Stack>
                          {i.attachments.filter((a) => a.kind === 'video').map((a) => (
                            <Box key={a.url} component="video" src={getImageUrl(a.url)} controls preload="metadata"
                              sx={{ width: '100%', mt: 0.75, borderRadius: 1, bgcolor: 'black', maxHeight: 180 }} />
                          ))}
                        </Box>
                      )}
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {canSign && (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, borderColor: 'warning.main' }}>
              <Typography variant="subtitle2" fontWeight={700}>Your decision</Typography>
              {!user?.digitalSignature && (
                <Alert severity="warning" sx={{ my: 1 }}>
                  Upload your digital signature in your profile first — it is stamped on this report when you decide.
                </Alert>
              )}
              <TextField
                fullWidth multiline minRows={2} sx={{ mt: 1 }}
                label="Observations (required to reject)"
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
              />

              <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>
                Site evidence — at least {MIN_IMAGES} photos and {MIN_VIDEOS} video
              </Typography>
              <Stack direction="row" gap={1} sx={{ mt: 1 }} flexWrap="wrap">
                <Button component="label" variant="outlined" size="small" startIcon={<PhotoIcon />} disabled={saving}>
                  Add photos
                  <input hidden type="file" accept="image/*" multiple capture="environment"
                    onChange={(e) => { addFiles('image', e.target.files); e.target.value = ''; }} />
                </Button>
                <Button component="label" variant="outlined" size="small" startIcon={<VideoIcon />} disabled={saving}>
                  Add video
                  <input hidden type="file" accept="video/*" capture="environment"
                    onChange={(e) => { addFiles('video', e.target.files); e.target.value = ''; }} />
                </Button>
                <Chip size="small" color={images.length >= MIN_IMAGES ? 'success' : 'default'} label={`Photos ${images.length}/${MIN_IMAGES}`} />
                <Chip size="small" color={videos.length >= MIN_VIDEOS ? 'success' : 'default'} label={`Video ${videos.length}/${MIN_VIDEOS}`} />
              </Stack>
              {(images.length > 0 || videos.length > 0) && (
                <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
                  {images.map((f, idx) => (
                    <Box key={f.preview} sx={{ position: 'relative' }}>
                      <Box component="img" src={f.preview} alt={f.file.name}
                        sx={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider', display: 'block' }} />
                      <IconButton size="small" onClick={() => removeFile('image', idx)} disabled={saving}
                        sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(255,255,255,0.85)', p: 0.25 }}>
                        <RemoveIcon fontSize="inherit" />
                      </IconButton>
                    </Box>
                  ))}
                  {videos.map((f, idx) => (
                    <Box key={f.preview} sx={{ position: 'relative' }}>
                      <Box component="video" src={f.preview} muted preload="metadata"
                        sx={{ width: 150, height: 84, objectFit: 'cover', borderRadius: 1, bgcolor: 'black', display: 'block' }} />
                      <Typography variant="caption" sx={{ position: 'absolute', bottom: 2, left: 4, color: '#fff' }}>{mb(f.file.size)}</Typography>
                      <IconButton size="small" onClick={() => removeFile('video', idx)} disabled={saving}
                        sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(255,255,255,0.85)', p: 0.25 }}>
                        <RemoveIcon fontSize="inherit" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
              )}
              {uploadPct !== null && (
                <Box sx={{ mt: 1.5 }}>
                  <LinearProgress variant="determinate" value={uploadPct} />
                  <Typography variant="caption" color="text.secondary">Uploading evidence… {uploadPct}%</Typography>
                </Box>
              )}
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!isCreate && (
          <Button startIcon={<PrintIcon />} sx={{ mr: 'auto' }}
            onClick={() => printInspectionReport({ report, ...context })}>
            Print
          </Button>
        )}
        {!isCreate && report.status === 'Pending' && (
          <Button color="inherit" onClick={handleCancel} disabled={saving}>Cancel report</Button>
        )}
        <Button onClick={onClose} disabled={saving}>Close</Button>
        {isCreate && (
          <Button variant="contained" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create & assign'}
          </Button>
        )}
        {canSign && (
          <>
            <Button color="error" variant="outlined" startIcon={<RejectIcon />} onClick={() => handleDecision('Rejected')} disabled={saving || !evidenceReady}>
              Reject
            </Button>
            <Button color="success" variant="contained" startIcon={<ApproveIcon />} onClick={() => handleDecision('Approved')} disabled={saving || !evidenceReady}>
              Approve & sign
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
