import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel,
  MenuItem, Select, Stack, TextField, Typography
} from '@mui/material';
import { Business as CompanyIcon } from '@mui/icons-material';
import toast from 'react-hot-toast';
import api from '../../../services/api';

/** Hub row key prefix → document kind on the server */
export const COMPANY_CHANGE_KIND = { ap: 'bill', ca: 'cash-approval', po: 'po' };

/**
 * Move a payable to another company. Shows what will happen first (entries re-posted in the new company's books,
 * accounts matched by number) or why it can't move (payments already made, PO in another company, missing accounts).
 */
export default function ChangeCompanyDialog({ row, companies, onClose, onChanged }) {
  const kind = row ? COMPANY_CHANGE_KIND[row.key.split(':')[0]] : null;
  const [companyId, setCompanyId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCompanyId('');
    setReason('');
    setPreview(null);
  }, [row]);

  useEffect(() => {
    if (!row || !kind || !companyId) { setPreview(null); return undefined; }
    let cancelled = false;
    setChecking(true);
    api.get(`/finance/payables-hub/company-change/${kind}/${row.id}`, { params: { companyId } })
      .then((res) => { if (!cancelled) setPreview(res.data?.data || null); })
      .catch((err) => {
        if (!cancelled) setPreview({ canChange: false, blockers: [err.response?.data?.message || 'Could not check this change'], steps: [], warnings: [] });
      })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [row, kind, companyId]);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/finance/payables-hub/company-change/${kind}/${row.id}`, { companyId, reason });
      toast.success(res.data?.message || 'Company changed');
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not change the company');
    } finally {
      setSaving(false);
    }
  };

  const others = (companies || []).filter((c) => String(c._id) !== String(row?.companyId || ''));

  return (
    <Dialog open={Boolean(row)} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CompanyIcon color="primary" /> Change company — {row?.number}
      </DialogTitle>
      <DialogContent dividers>
        <Stack gap={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">Current company</Typography>
            <Typography variant="body2" fontWeight={600}>{row?.company || 'No company'}</Typography>
            <Typography variant="caption" color="text.secondary">{row?.party} · {row?.sourceLabel}</Typography>
          </Box>
          <FormControl fullWidth size="small">
            <InputLabel>Move to company</InputLabel>
            <Select label="Move to company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {others.map((c) => <MenuItem key={c._id} value={c._id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
          {checking && <Stack direction="row" gap={1} alignItems="center"><CircularProgress size={16} /><Typography variant="body2">Checking…</Typography></Stack>}
          {!checking && preview && !preview.canChange && (
            <Alert severity="error">
              {preview.blockers.map((b) => <Typography key={b} variant="body2" sx={{ mb: 0.5 }}>{b}</Typography>)}
            </Alert>
          )}
          {!checking && preview?.canChange && (
            <Alert severity="info">
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>What will happen</Typography>
              {preview.steps.map((s) => <Typography key={s} variant="body2" sx={{ mb: 0.5 }}>• {s}</Typography>)}
              {(preview.warnings || []).map((w) => <Typography key={w} variant="body2" color="warning.main">• {w}</Typography>)}
            </Alert>
          )}
          <TextField size="small" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Company renamed / booked to wrong company" fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!preview?.canChange || checking || saving}>
          {saving ? 'Moving…' : 'Change company'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
