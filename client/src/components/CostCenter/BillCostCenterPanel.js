import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography
} from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import CostCenterSelect from './CostCenterSelect';

const FINANCE_ROLES = ['super_admin', 'admin', 'finance_manager'];

const labelOf = (cc) => (cc && typeof cc === 'object' ? `${cc.code} — ${cc.path || cc.name}` : '');

/**
 * Cost center line for a document Finance is handling, with "Set / Change" for Finance.
 * `onSave(costCenterId, reason)` performs the request and resolves to { data, message }.
 */
export function DocumentCostCenterPanel({
  costCenter, documentLabel, canEdit, requireReasonOnChange = true, missingText, onSave, onUpdated, companyId
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hasCurrent = Boolean(costCenter);
  const needReason = hasCurrent && requireReasonOnChange;

  const handleOpen = () => {
    setValue(costCenter?._id || costCenter || '');
    setReason('');
    setError('');
    setOpen(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      const result = await onSave(value, reason);
      setOpen(false);
      onUpdated?.(result?.data, result?.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update cost center');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Alert
        severity={hasCurrent ? 'info' : 'warning'}
        icon={false}
        sx={{ mb: 2, alignItems: 'center' }}
        action={canEdit ? (
          <Button size="small" startIcon={<EditIcon fontSize="small" />} onClick={handleOpen}>
            {hasCurrent ? 'Change' : 'Set cost center'}
          </Button>
        ) : null}
      >
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Typography variant="body2" fontWeight={700}>Cost center:</Typography>
          <Typography variant="body2">
            {hasCurrent ? labelOf(costCenter) || 'Set' : (missingText || 'Not set')}
          </Typography>
        </Box>
      </Alert>

      <Dialog open={open} onClose={saving ? undefined : () => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {hasCurrent ? 'Change cost center' : 'Set cost center'}{documentLabel ? ` — ${documentLabel}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <CostCenterSelect value={value} companyId={companyId} onChange={(id) => setValue(id)} sx={{ mb: 2 }} />
          {needReason && (
            <TextField
              fullWidth
              required
              multiline
              rows={2}
              label="Reason for change"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              helperText="Saved in the document's history"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !value || (needReason && !reason.trim())
              || String(value) === String(costCenter?._id || costCenter || '')}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/**
 * Bill cost center line with Finance's "Set / Change cost center" (PUT /finance/accounts-payable/:id/cost-center).
 * A bill without one cannot be paid once the cost center go-live date applies to it.
 */
export default function BillCostCenterPanel({ bill, onUpdated }) {
  const { user } = useAuth();
  if (!bill?._id) return null;
  return (
    <DocumentCostCenterPanel
      costCenter={bill.costCenter}
      documentLabel={bill.billNumber}
      companyId={bill.companyId?._id || bill.companyId}
      canEdit={FINANCE_ROLES.includes(user?.role) && bill.status !== 'cancelled'}
      missingText="Not set — required before this bill can be paid"
      onSave={async (costCenter, reason) => {
        const res = await api.put(`/finance/accounts-payable/${bill._id}/cost-center`, { costCenter, reason });
        return { data: res.data.data, message: res.data.message };
      }}
      onUpdated={onUpdated}
    />
  );
}
