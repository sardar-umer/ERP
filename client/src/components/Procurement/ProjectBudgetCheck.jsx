import React, { useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import api from '../../services/api';

const fmt = (n) => `Rs ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;

/**
 * Budget warning for a project indent / PO: budget, committed elsewhere, this document's amount and
 * what is left after it, per category (or the sub-project total when its budget has no category split).
 * Only warns — it never stops the indent or PO.
 *
 * Pass `result` (already fetched, e.g. live on the indent form), or `poId` / `indentId` to fetch it.
 * `chargeTo` lets the fetch be skipped for department-only documents.
 */
export const ProjectBudgetCheck = ({ result: given, poId, indentId, chargeTo, loading: givenLoading, docLabel, sx }) => {
  const [fetched, setFetched] = useState(null);
  const [loading, setLoading] = useState(false);
  const shouldFetch = !given && Boolean(chargeTo?.project) && Boolean(poId || indentId);

  useEffect(() => {
    if (!shouldFetch) { setFetched(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    const url = poId
      ? `/procurement/purchase-orders/${poId}/budget-check`
      : `/indents/${indentId}/budget-check`;
    api.get(url)
      .then((res) => { if (!cancelled) setFetched(res.data?.data || null); })
      .catch(() => { if (!cancelled) setFetched(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shouldFetch, poId, indentId]);

  const result = given || fetched;
  const label = docLabel || (poId ? 'This PO' : 'This indent');

  if (loading || givenLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, ...sx }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">Checking project budget…</Typography>
      </Box>
    );
  }
  if (!result) return null;

  const pendingElsewhere = result.rows.reduce((t, r) => t + (r.indentedElsewhere || 0), 0);

  return (
    <Box sx={{ mb: 2, ...sx }}>
      <Alert severity={result.overBudget ? 'error' : 'success'} sx={{ mb: 1 }}>
        <AlertTitle sx={{ mb: 0 }}>
          {result.overBudget
            ? `Over budget by ${fmt(result.overBy)}`
            : 'Within project budget'}
        </AlertTitle>
        <Typography variant="body2">
          {label} adds {fmt(result.thisTotal)} to {result.subProject?.name || 'the sub-project'}.
          {result.overBudget ? ' It can still go ahead; the approver decides.' : ''}
        </Typography>
        {!result.budgetApproved && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            The sub-project budget is not approved yet, so this compares with the estimate.
          </Typography>
        )}
      </Alert>
      <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>{result.mode === 'category' ? 'Budget category' : 'Budget'}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Budget</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Committed</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>{label}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Left after</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.rows.map((r) => (
              <TableRow key={r.category} sx={r.overBy > 0 ? { bgcolor: 'rgba(211, 47, 47, 0.06)', '& td': { color: 'error.main' } } : undefined}>
                <TableCell>{r.category}</TableCell>
                <TableCell align="right">{fmt(r.budget)}</TableCell>
                <TableCell align="right">{fmt(r.committed)}</TableCell>
                <TableCell align="right">{fmt(r.thisAmount)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(r.availableAfter)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {pendingElsewhere > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Other open indents for these categories are waiting for POs worth about {fmt(pendingElsewhere)} (not counted above).
        </Typography>
      )}
    </Box>
  );
};

export default ProjectBudgetCheck;
