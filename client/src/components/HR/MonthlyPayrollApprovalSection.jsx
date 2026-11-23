import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Typography
} from '@mui/material';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import api from '../../services/authService';
import { useAuth } from '../../contexts/AuthContext';
import PayrollApprovalAuthorityPicker from './PayrollApprovalAuthorityPicker';
import {
  buildPayrollApprovalAuthoritiesPayload,
  fetchPayrollAuthorityCandidates,
  getNextPendingPayrollAuthorityKey,
  PAYROLL_AUTHORITY_SLOTS,
  userOptionLabel,
  validatePayrollAuthoritySelection
} from '../../services/payrollApprovalAuthorityService';
import {
  approverSearchOnInputChange,
  mergeApproverOptionList
} from '../../utils/dualApproverAutocomplete';

const MonthlyPayrollApprovalSection = ({
  month,
  year,
  periodLabel,
  draftCount = 0,
  approvalDoc,
  loading = false,
  onRefresh,
  onUpdated,
  coversComparisonReport = false
}) => {
  const { user } = useAuth();
  const [approverOptions, setApproverOptions] = useState([]);
  const [approverLoading, setApproverLoading] = useState(false);
  const [gmHrUser, setGmHrUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [localError, setLocalError] = useState('');

  const preparerName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'You';

  const loadApproverOptions = async (search = '') => {
    try {
      setApproverLoading(true);
      const list = await fetchPayrollAuthorityCandidates(search);
      setApproverOptions(list);
    } catch {
      setApproverOptions([]);
    } finally {
      setApproverLoading(false);
    }
  };

  useEffect(() => {
    loadApproverOptions('');
  }, []);

  const candidateUsers = useMemo(
    () => mergeApproverOptionList(approverOptions, gmHrUser),
    [approverOptions, gmHrUser]
  );

  useEffect(() => {
    const authorities = approvalDoc?.financeApprovalAuthorities || {};
    setGmHrUser(authorities.financeControllerUser || null);
  }, [approvalDoc]);

  const approvedKeys = useMemo(() => new Set(
    (approvalDoc?.financeAuthorityApprovals || [])
      .filter((a) => String(a?.decision || 'approved') !== 'rejected')
      .map((a) => String(a?.authorityKey || '').trim())
      .filter(Boolean)
  ), [approvalDoc]);

  const assignedAuthorities = approvalDoc?.financeApprovalAuthorities || {};
  const authorityStatus = approvalDoc?.authorityStatus || 'pending';
  const allApproved = authorityStatus === 'approved';

  const myUserId = String(user?.id || user?._id || '');
  const nextPendingKey = getNextPendingPayrollAuthorityKey(approvalDoc);
  const myPendingSlots = PAYROLL_AUTHORITY_SLOTS
    .map((slot) => slot.key)
    .filter((key) => {
      if (key !== nextPendingKey) return false;
      const assigned = assignedAuthorities[key];
      const assignedId = String(assigned?._id || assigned || '');
      return assignedId && assignedId === myUserId && !approvedKeys.has(key);
    });

  const handleSaveAuthorities = async () => {
    const validationError = validatePayrollAuthoritySelection(gmHrUser, myUserId);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    const payload = buildPayrollApprovalAuthoritiesPayload(gmHrUser, myUserId);
    if (!payload) {
      setLocalError('Select GM HR before saving.');
      return;
    }

    try {
      setSaving(true);
      setLocalError('');
      const response = await api.put(`/payroll/monthly-approval/${month}/${year}/authorities`, {
        financeApprovalAuthorities: payload
      });
      onUpdated?.(response.data?.data);
      onRefresh?.();
    } catch (err) {
      setLocalError(err.response?.data?.message || 'Failed to save approval authorities');
    } finally {
      setSaving(false);
    }
  };

  const handleRecordApproval = async () => {
    try {
      setApproving(true);
      setLocalError('');
      const response = await api.patch(`/payroll/monthly-approval/${month}/${year}/authority-approve`, {});
      onUpdated?.(response.data?.data);
      onRefresh?.();
    } catch (err) {
      setLocalError(err.response?.data?.message || 'Failed to record approval');
    } finally {
      setApproving(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Approval Authority — {periodLabel}
        </Typography>
        <Chip
          size="small"
          color={allApproved ? 'success' : authorityStatus === 'rejected' ? 'error' : 'warning'}
          label={
            allApproved
              ? 'All authorities approved'
              : authorityStatus === 'rejected'
                ? 'Rejected'
                : 'Pending authority approvals'
          }
        />
      </Stack>

      {draftCount > 0 && !allApproved && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {draftCount} draft payroll(s) for this month will move forward when each approval authority records their sign-off (Deputy Manager Payroll HR → GM HR). GM HR's approval sends the month to Finance.
          {coversComparisonReport ? ' The monthly payroll comparison report is approved through the same authority chain.' : ''}
        </Alert>
      )}

      {coversComparisonReport && draftCount === 0 && !allApproved && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Approving monthly payroll also approves the payroll comparison report for this period through the same authority chain.
        </Alert>
      )}

      {localError ? <Alert severity="error" sx={{ mb: 2 }}>{localError}</Alert> : null}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <>
          <Grid container spacing={2}>
            <PayrollApprovalAuthorityPicker
              gmHrUser={gmHrUser}
              onGmHrChange={setGmHrUser}
              candidateUsers={candidateUsers}
              approverLoading={approverLoading}
              onOpenApproverSearch={() => loadApproverOptions('')}
              onApproverSearchInput={approverSearchOnInputChange(loadApproverOptions)}
              preparerName={preparerName}
              disabled={saving || allApproved}
              title={
                coversComparisonReport
                  ? 'Payroll & comparison report approval authorities'
                  : 'Payroll approval authorities (required before approving drafts)'
              }
            />
          </Grid>

          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              size="small"
              disabled={saving || allApproved}
              onClick={handleSaveAuthorities}
            >
              {saving ? 'Saving…' : 'Save authorities'}
            </Button>
            {myPendingSlots.length > 0 && (
              <Button
                variant="outlined"
                color="success"
                size="small"
                startIcon={approving ? <CircularProgress size={14} /> : <CheckCircleIcon />}
                disabled={approving}
                onClick={handleRecordApproval}
              >
                Record my approval
              </Button>
            )}
          </Stack>

          {assignedAuthorities.accountsOfficerUser ||
          assignedAuthorities.financeControllerUser ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Approval progress
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {PAYROLL_AUTHORITY_SLOTS.map(({ key, label }) => {
                  const assigned = assignedAuthorities[key];
                  const assignedId = String(assigned?._id || assigned || '');
                  if (!assignedId) return null;
                  const done = approvedKeys.has(key);
                  const name = typeof assigned === 'object' ? userOptionLabel(assigned) : label;
                  return (
                    <Chip
                      key={key}
                      size="small"
                      color={done ? 'success' : 'default'}
                      variant={done ? 'filled' : 'outlined'}
                      label={`${label}: ${name}${done ? ' ✓' : ''}`}
                    />
                  );
                })}
              </Stack>
            </Box>
          ) : null}
        </>
      )}
    </Paper>
  );
};

export default MonthlyPayrollApprovalSection;
