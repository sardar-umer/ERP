import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { DeleteForever as DeleteForeverIcon } from '@mui/icons-material';
import { deleteProjectPermanently, getProjectDeleteImpact } from '../../services/projectManagementService';

const IMPACT_LABELS = [
  ['subProjects', 'Sub Projects'],
  ['boqItems', 'BOQ items'],
  ['boqHeaders', 'BOQ documents'],
  ['subletContracts', 'Sublet contracts'],
  ['checkRequests', 'Check requests'],
  ['invoices', 'Invoices / IPCs'],
  ['expenses', 'Expenses'],
  ['dailyReports', 'Daily progress reports'],
  ['wbsRows', 'WBS progress rows']
];

/**
 * Developer-only permanent delete of a Main or Sub Project and everything under it.
 * Shows what will be removed and requires typing the project number to confirm.
 */
const PermanentDeleteProjectDialog = ({ project, onClose, onDeleted }) => {
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  const expected = String(project?.projectNumber || project?.name || '').trim();

  useEffect(() => {
    if (!project?._id) return;
    let cancelled = false;
    setImpact(null);
    setConfirmText('');
    setError('');
    setLoading(true);
    getProjectDeleteImpact(project._id)
      .then((res) => { if (!cancelled) setImpact(res.data?.data?.counts || {}); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Failed to load what will be deleted'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project?._id]);

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      const res = await deleteProjectPermanently(project._id, confirmText.trim());
      onDeleted?.(res.data?.message || 'Project permanently deleted');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete project');
    } finally {
      setDeleting(false);
    }
  };

  const impactRows = impact ? IMPACT_LABELS.filter(([key]) => impact[key] > 0) : [];

  return (
    <Dialog open={Boolean(project)} onClose={() => !deleting && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
        <DeleteForeverIcon /> Permanently delete project
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="error">
            This <strong>cannot be undone</strong>. <strong>{project?.projectNumber} — {project?.name}</strong>
            {project?.parentProject ? '' : ' and every Sub Project under it'} will be removed together with all their records.
          </Alert>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
          ) : impact && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>Also deleted:</Typography>
              {impactRows.length ? (
                <Box component="ul" sx={{ m: 0, pl: 3 }}>
                  {impactRows.map(([key, label]) => (
                    <li key={key}><Typography variant="body2">{impact[key]} {label}</Typography></li>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">No linked records — only the project itself.</Typography>
              )}
            </Box>
          )}

          <TextField
            fullWidth
            autoFocus
            label={`Type ${expected} to confirm`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleting}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
          disabled={deleting || loading || confirmText.trim() !== expected}
          onClick={handleDelete}
        >
          {deleting ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PermanentDeleteProjectDialog;
