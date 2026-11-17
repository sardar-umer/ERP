import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Chip, IconButton, CircularProgress, Alert,
  Stack, Card, CardContent, Grid, Tooltip, TextField, MenuItem
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  BarChart as BudgetIcon, Visibility as ViewIcon, Lock as LockIcon,
  CheckCircle as ApproveIcon
} from '@mui/icons-material';
import api from '../../services/api';
import useClientPagination from '../../hooks/useClientPagination';

const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0 })}`;
const STATUS_COLOR = { draft: 'default', approved: 'success', locked: 'error' };

export default function BudgetList() {
  const navigate = useNavigate();
  const [budgets, setBudgets]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [yearFilter, setYearFilter] = useState('');

  const currentYear = new Date().getFullYear();
  const years = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/finance/budgets', { params: { fiscalYear: yearFilter || undefined } });
      setBudgets(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load budgets');
    } finally {
      setLoading(false);
    }
  }, [yearFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete budget "${name}"?`)) return;
    try {
      await api.delete(`/finance/budgets/${id}`);
      setSuccess('Budget deleted');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Delete failed');
    }
  };

  const handleApprove = async (id) => {
    try {
      await api.put(`/finance/budgets/${id}`, { status: 'approved' });
      setSuccess('Budget approved');
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Approve failed');
    }
  };

  const totalBudgeted  = budgets.reduce((s, b) => s + (b.totalBudget || 0), 0);
  const approvedCount  = budgets.filter(b => b.status === 'approved').length;

  const pg = useClientPagination(budgets);
  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box display="flex" alignItems="center" gap={1}>
          <BudgetIcon color="primary" />
          <Typography variant="h5" fontWeight={700}>Budgets</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/finance/budgets/new')}>
          Create Budget
        </Button>
      </Stack>

      {error   && <Alert severity="error"   onClose={() => setError('')}   sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {/* Stats */}
      <Grid container spacing={2} mb={3}>
        {[
          { label: 'Total Budgets', value: budgets.length, raw: true, color: 'primary.main' },
          { label: 'Approved',      value: approvedCount,  raw: true, color: 'success.main' },
          { label: 'Total Budgeted', value: fmt(totalBudgeted), color: 'primary.main' }
        ].map(c => (
          <Grid item xs={12} sm={4} key={c.label}>
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                <Typography variant="h6" fontWeight={700} color={c.color}>{c.value}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <TextField select label="Fiscal Year" value={yearFilter} onChange={e => setYearFilter(e.target.value)}
          size="small" sx={{ minWidth: 160 }}>
          <MenuItem value="">All Years</MenuItem>
          {years.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
        </TextField>
      </Paper>

      {loading ? <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: 'primary.main' }}>
                {['Budget Name','Fiscal Year','Department','Period','Lines','Total Budgeted','Status','Actions'].map(h => (
                  <TableCell key={h} sx={{ color: 'white', fontWeight: 700, bgcolor: 'primary.main' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {budgets.length === 0 && (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No budgets found. Create your first budget.
                </TableCell></TableRow>
              )}
              {pg.rows.map(b => (
                <TableRow key={b._id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700} color="primary.main">{b.name}</Typography>
                    {b.description && <Typography variant="caption" color="text.disabled">{b.description}</Typography>}
                  </TableCell>
                  <TableCell><Chip label={b.fiscalYear} size="small" /></TableCell>
                  <TableCell>{b.department || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {b.startDate ? new Date(b.startDate).toLocaleDateString('en-PK') : '—'} →{' '}
                      {b.endDate   ? new Date(b.endDate).toLocaleDateString('en-PK') : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">{(b.lines || []).length}</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'primary.main' }}>{fmt(b.totalBudget)}</TableCell>
                  <TableCell>
                    <Chip label={b.status} color={STATUS_COLOR[b.status] || 'default'} size="small"
                      icon={b.status === 'locked' ? <LockIcon /> : undefined} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="View / Edit">
                        <IconButton size="small" onClick={() => navigate(`/finance/budgets/${b._id}`)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {b.status === 'draft' && (
                        <Tooltip title="Approve">
                          <IconButton size="small" color="success" onClick={() => handleApprove(b._id)}>
                            <ApproveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Budget vs Actual Report">
                        <IconButton size="small" color="info"
                          onClick={() => navigate(`/finance/budget-vs-actual?budgetId=${b._id}`)}>
                          <BarChart fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {b.status !== 'locked' && (
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => handleDelete(b._id, b.name)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}
    </Box>
  );
}

function BarChart(props) { return <BudgetIcon {...props} />; }
