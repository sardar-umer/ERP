import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  CircularProgress,
  Chip
} from '@mui/material';
import { Campaign as CampaignIcon, Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import {
  fetchRecoveryCampaigns,
  createRecoveryCampaign,
  updateRecoveryCampaign,
  deleteRecoveryCampaign
} from '../../../services/recoveryCampaignService';
import useClientPagination from '../../../hooks/useClientPagination';

const getCreatedByName = (doc) => {
  const u = doc.createdBy;
  if (!u) return '—';
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.employeeId || '—';
};

const WHATSAPP_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'en_AE', label: 'English (UAE)' },
  { code: 'en_AU', label: 'English (AUS)' },
  { code: 'en_CA', label: 'English (CAN)' },
  { code: 'en_GH', label: 'English (GHA)' },
  { code: 'en_IE', label: 'English (IRL)' },
  { code: 'en_IN', label: 'English (IND)' },
  { code: 'en_MY', label: 'English (MYS)' },
  { code: 'en_NZ', label: 'English (NZL)' },
  { code: 'en_SG', label: 'English (SGP)' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ar', label: 'Arabic' },
  { code: 'bn', label: 'Bengali' },
  { code: 'hi', label: 'Hindi' },
  { code: 'pa', label: 'Punjabi' }
];

const formatDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' });
};

const RecoveryCampaigns = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [form, setForm] = useState({
    whatsappTemplateName: '',
    whatsappLanguageCode: '',
    messagePreview: ''
  });

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetchRecoveryCampaigns();
      setCampaigns(res.data?.data || []);
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to load campaigns', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const handleOpenAdd = () => {
    setEditingId(null);
    setForm({ whatsappTemplateName: '', whatsappLanguageCode: '', messagePreview: '' });
    setDialogOpen(true);
  };

  const handleOpenEdit = (c) => {
    setEditingId(c._id);
    setForm({
      whatsappTemplateName: c.whatsappTemplateName || '',
      whatsappLanguageCode: c.whatsappLanguageCode || '',
      messagePreview: c.messagePreview || ''
    });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.whatsappTemplateName?.trim()) {
      setSnackbar({ open: true, message: 'WhatsApp template name (Meta) is required', severity: 'warning' });
      return;
    }
    try {
      setSaving(true);
      const payload = {
        whatsappTemplateName: form.whatsappTemplateName.trim(),
        whatsappLanguageCode: form.whatsappLanguageCode?.trim() || '',
        messagePreview: form.messagePreview?.trim() || ''
      };
      if (editingId) {
        await updateRecoveryCampaign(editingId, payload);
        setSnackbar({ open: true, message: 'Campaign updated', severity: 'success' });
      } else {
        await createRecoveryCampaign(payload);
        setSnackbar({ open: true, message: 'Campaign created', severity: 'success' });
      }
      handleCloseDialog();
      loadCampaigns();
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to save campaign', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this campaign?')) return;
    try {
      await deleteRecoveryCampaign(id);
      setSnackbar({ open: true, message: 'Campaign deleted', severity: 'success' });
      loadCampaigns();
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.message || 'Failed to delete', severity: 'error' });
    }
  };

  const pg = useClientPagination(campaigns);
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CampaignIcon color="primary" sx={{ fontSize: 32 }} />
          <Typography variant="h4" fontWeight={600}>
            Campaigns
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAdd} disabled={loading}>
          Add campaign
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Create Meta WhatsApp templates here. Use the exact template name and language code from your Meta Business account.
        Messages are sent only manually from My Tasks — nothing is sent automatically from this page.
      </Alert>

      <Card>
        <CardContent>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : campaigns.length === 0 ? (
            <Typography color="text.secondary">No campaigns yet. Click <strong>Add campaign</strong> to create a Meta WhatsApp template.</Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell><strong>Template name (Meta)</strong></TableCell>
                    <TableCell><strong>Language</strong></TableCell>
                    <TableCell><strong>Message preview</strong></TableCell>
                    <TableCell><strong>Created by</strong></TableCell>
                    <TableCell><strong>Created</strong></TableCell>
                    <TableCell><strong>Status</strong></TableCell>
                    <TableCell align="right"><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg.rows.map((c) => (
                    <TableRow key={c._id}>
                      <TableCell><Typography fontWeight={500}>{c.whatsappTemplateName || '—'}</Typography></TableCell>
                      <TableCell>{c.whatsappLanguageCode || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {String(c.messagePreview || '').trim() || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>{getCreatedByName(c)}</TableCell>
                      <TableCell>{formatDate(c.createdAt)}</TableCell>
                      <TableCell><Chip size="small" label={c.isActive !== false ? 'Active' : 'Inactive'} color={c.isActive !== false ? 'success' : 'default'} variant="outlined" /></TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => handleOpenEdit(c)} title="Edit">
                          <EditIcon />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDelete(c._id)} title="Delete">
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>{pg.bar}
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? 'Edit campaign' : 'Add campaign'}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="WhatsApp template name (Meta)"
            required
            value={form.whatsappTemplateName}
            onChange={(e) => setForm((f) => ({ ...f, whatsappTemplateName: e.target.value }))}
            margin="normal"
            placeholder="Exact Meta template name, e.g. taj_marketing_offer"
          />
          <FormControl fullWidth margin="normal" size="small">
            <InputLabel>Language</InputLabel>
            <Select
              label="Language"
              value={form.whatsappLanguageCode}
              onChange={(e) => setForm((f) => ({ ...f, whatsappLanguageCode: e.target.value || '' }))}
            >
              <MenuItem value="">— Select language —</MenuItem>
              {WHATSAPP_LANGUAGES.map(({ code, label }) => (
                <MenuItem key={code} value={code}>{label} ({code})</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            label="Message preview shown in replies"
            value={form.messagePreview}
            onChange={(e) => setForm((f) => ({ ...f, messagePreview: e.target.value }))}
            margin="normal"
            multiline
            minRows={3}
            placeholder="Write the exact campaign message text you want visible in View replies."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={24} /> : (editingId ? 'Update' : 'Create')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RecoveryCampaigns;
