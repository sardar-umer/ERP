import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { Search as SearchIcon, Visibility, Download as DownloadIcon } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { getMozas } from '../../services/landAcquisitionMozaService';
import { getKhasraSummary } from '../../services/landAcquisitionRegistryService';
import { formatKMS } from '../../utils/landAreaUnits';
import KhasraDetailDialog from './KhasraDetailDialog';

const hasArea = (a) => Boolean(a && ((a.kanal || 0) > 0 || (a.marla || 0) > 0 || (a.sarsai || 0) > 0));
const linkedLabel = (p) =>
  `${p.possessionRef || 'POS'} → ${p.possessedKhasraNo || '—'} (${formatKMS(p.possessedArea)})`;

const KhasraSummaryViewer = () => {
  const [khasras, setKhasras] = useState([]);
  const [mozas, setMozas] = useState([]);
  const [total, setTotal] = useState(0);
  const [grandTotal, setGrandTotal] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [mozaFilter, setMozaFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailKhasra, setDetailKhasra] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [searchDebounced, mozaFilter]);

  useEffect(() => {
    getMozas().then((res) => setMozas(res.data?.data || [])).catch(() => setMozas([]));
  }, []);

  const loadKhasras = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getKhasraSummary({
        page: page + 1,
        limit: rowsPerPage,
        ...(searchDebounced && { search: searchDebounced }),
        ...(mozaFilter && { moza: mozaFilter })
      });
      const payload = res.data?.data;
      setKhasras(payload?.khasras || []);
      setTotal(payload?.pagination?.total || 0);
      setGrandTotal(payload?.grandTotal || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load khasra summary');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, searchDebounced, mozaFilter]);

  useEffect(() => {
    loadKhasras();
  }, [loadKhasras]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await getKhasraSummary({
        page: 1,
        limit: 100000,
        ...(searchDebounced && { search: searchDebounced }),
        ...(mozaFilter && { moza: mozaFilter })
      });
      const data = res.data?.data?.khasras || [];
      if (!data.length) {
        toast.error('No data to export');
        setExporting(false);
        return;
      }

      const rows = data.map((row) => ({
        'Sr No': row.srNo || '',
        'Moza': row.moza?.name || '',
        'Khewat No': row.khewatNo || '',
        'Khasra No': row.khasraNo || '',
        'Land in Khasra': formatKMS(row.landInKhasra),
        'Purchased (Registry)': formatKMS(row.totalAcquired),
        'Pending Purchased': formatKMS(row.remainingToRegister),
        'Over Registered': hasArea(row.overRegistered) ? formatKMS(row.overRegistered) : '',
        'Possession': formatKMS(row.totalPossessed),
        'Linked Possession': formatKMS(row.linkedPossessed),
        'Linked Possession Details': (row.linkedPossessions || []).map(linkedLabel).join('; ') || '—',
        'Pending Possession': formatKMS(row.remainingToPossess),
        'Over Possessed': hasArea(row.overPossessed) ? formatKMS(row.overPossessed) : '',
        'Pending Possession Registries': (row.pendingByRegistry || [])
          .map((r) => `${r.registryNo || '—'} (${formatKMS(r.pendingPossession)})`)
          .join('; ') || '—',
        'Registries Count': row.registriesCount || 0,
        'Linked Registries': (row.registries || []).map(r => `${r.registryNo || '—'} (${formatKMS(r.acquiredArea)})`).join('; '),
        'Possessions Count': row.possessionsCount || 0,
        'Possessions in Khasra': (row.possessions || []).map(p => `${p.possessionRef || '—'} (${formatKMS(p.possessedArea)})`).join('; '),
        'Handed Over Here for Other Khasras': (row.handedOverPossessions || [])
          .map((p) => `${p.possessionRef || 'POS'} for ${p.registryKhasraNo || '—'} (${formatKMS(p.possessedArea)})`)
          .join('; ')
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Khasra Summary");
      XLSX.writeFile(wb, `Khasra_Summary_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Exported successfully');
    } catch (err) {
      toast.error('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Filters & Grand Totals Header */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2.5 }} alignItems={{ md: 'center' }}>
        <TextField
          size="small"
          placeholder="Search khasra, khewat, registry no…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 260 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            )
          }}
        />
        <TextField
          size="small"
          select
          label="Moza"
          value={mozaFilter}
          onChange={(e) => setMozaFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All mouzas</MenuItem>
          {mozas.map((m) => (
            <MenuItem key={m._id} value={m._id}>{m.name}</MenuItem>
          ))}
        </TextField>

        {grandTotal && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ fontSize: '0.8125rem' }}>
            <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'grey.100', border: '1px solid', borderColor: 'grey.300' }}>
              <Typography variant="caption" color="text.secondary" display="block" fontWeight={600}>Total Land in Khasra</Typography>
              <Typography variant="body2" fontWeight={700}>{formatKMS(grandTotal.baseline)}</Typography>
            </Box>
            <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'success.50', border: '1px solid', borderColor: 'success.200' }}>
              <Typography variant="caption" color="success.main" display="block" fontWeight={600}>Total Purchased (Registry)</Typography>
              <Typography variant="body2" fontWeight={700} color="success.dark">{formatKMS(grandTotal.registered)}</Typography>
            </Box>
            <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'warning.50', border: '1px solid', borderColor: 'warning.200' }}>
              <Typography variant="caption" color="warning.main" display="block" fontWeight={600}>Pending Purchased</Typography>
              <Typography variant="body2" fontWeight={700} color="warning.dark">{formatKMS(grandTotal.remainingToRegister)}</Typography>
            </Box>
            {(grandTotal.overRegisteredCount || 0) > 0 && (
              <Tooltip title="Registered more than the land in khasra — Land − Purchased + Over Registered = Pending Purchased">
                <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'warning.dark', color: 'common.white' }}>
                  <Typography variant="caption" display="block" fontWeight={600}>Over Registered</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {formatKMS(grandTotal.overRegistered)} · {grandTotal.overRegisteredCount} khasras
                  </Typography>
                </Box>
              </Tooltip>
            )}
            <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.200' }}>
              <Typography variant="caption" color="primary.main" display="block" fontWeight={600}>Total Possession</Typography>
              <Typography variant="body2" fontWeight={700} color="primary.dark">{formatKMS(grandTotal.possessed)}</Typography>
              {hasArea(grandTotal.linkedPossessed) && (
                <Typography variant="caption" color="text.secondary" display="block">
                  incl. linked {formatKMS(grandTotal.linkedPossessed)}
                </Typography>
              )}
            </Box>
            <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'error.50', border: '1px solid', borderColor: 'error.200' }}>
              <Typography variant="caption" color="error.main" display="block" fontWeight={600}>Pending Possession</Typography>
              <Typography variant="body2" fontWeight={700} color="error.dark">{formatKMS(grandTotal.remainingToPossess)}</Typography>
            </Box>
            {(grandTotal.overPossessedCount || 0) > 0 && (
              <Tooltip title="Possessed more than registered — Purchased − Possession + Over Possessed = Pending Possession">
                <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'error.main', color: 'common.white' }}>
                  <Typography variant="caption" display="block" fontWeight={600}>Over Possessed</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {formatKMS(grandTotal.overPossessed)} · {grandTotal.overPossessedCount} khasras
                  </Typography>
                </Box>
              </Tooltip>
            )}
          </Stack>
        )}

        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          startIcon={exporting ? <CircularProgress size={20} /> : <DownloadIcon />}
          onClick={handleExport}
          disabled={exporting || loading}
        >
          Export
        </Button>
      </Stack>

      {/* Main Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : !khasras.length ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No khasra summary records found matching your filters.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead sx={{ bgcolor: 'grey.100' }}>
              <TableRow>
                <TableCell><strong>Sr No.</strong></TableCell>
                <TableCell><strong>Moza</strong></TableCell>
                <TableCell><strong>Khewat No.</strong></TableCell>
                <TableCell><strong>Khasra No.</strong></TableCell>
                <TableCell align="center"><strong>Land in Khasra</strong></TableCell>
                <TableCell align="center"><strong>Purchased (Registry)</strong></TableCell>
                <TableCell align="center"><strong>Pending Purchased</strong></TableCell>
                <TableCell align="center"><strong>Possession</strong></TableCell>
                <TableCell align="center">
                  <Tooltip title="Possession taken in another khasra against this khasra's registry">
                    <strong>Linked Possession</strong>
                  </Tooltip>
                </TableCell>
                <TableCell align="center"><strong>Pending Possession</strong></TableCell>
                <TableCell><strong>Registries in Khasra</strong></TableCell>
                <TableCell><strong>Possessions in Khasra</strong></TableCell>
                <TableCell align="center" width={80}><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {khasras.map((row) => (
                <TableRow key={row._id} hover>
                  <TableCell>{row.srNo}</TableCell>
                  <TableCell>{row.moza?.name || '—'}</TableCell>
                  <TableCell><strong>{row.khewatNo}</strong></TableCell>
                  <TableCell><strong>{row.khasraNo}</strong></TableCell>
                  <TableCell align="center">{formatKMS(row.landInKhasra)}</TableCell>
                  <TableCell align="center">
                    <Typography variant="body2" fontWeight={700} color="success.dark">
                      {formatKMS(row.totalAcquired)}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {hasArea(row.overRegistered) ? (
                      <Tooltip title="Registered more than the land in this khasra — check the registries">
                        <Chip
                          size="small"
                          label={`Over by ${formatKMS(row.overRegistered)}`}
                          sx={{ fontWeight: 700, bgcolor: 'warning.dark', color: 'common.white' }}
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" fontWeight={600} color="warning.dark">
                        {formatKMS(row.remainingToRegister)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="body2" fontWeight={700} color="primary.dark">
                      {formatKMS(row.totalPossessed)}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {(row.linkedPossessions || []).length > 0 ? (
                      <Stack spacing={0.25} alignItems="center">
                        <Typography variant="body2" fontWeight={700} color="secondary.dark">
                          {formatKMS(row.linkedPossessed)}
                        </Typography>
                        {row.linkedPossessions.map((p, i) => (
                          <Typography key={p.lineId || i} variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                            {linkedLabel(p)}
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {hasArea(row.overPossessed) ? (
                      <Tooltip title="Possessed more than registered — check for duplicate possessions">
                        <Chip
                          size="small"
                          color="error"
                          label={`Over by ${formatKMS(row.overPossessed)}`}
                          sx={{ fontWeight: 700 }}
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" fontWeight={600} color="error.dark">
                        {formatKMS(row.remainingToPossess)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {(row.registries || []).length > 0 ? (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {row.registries.slice(0, 3).map((r, i) => (
                          <Chip
                            key={r._id || i}
                            size="small"
                            label={`${r.registryNo || 'Reg'} (${formatKMS(r.acquiredArea)})`}
                            color="success"
                            variant="outlined"
                            sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                          />
                        ))}
                        {row.registries.length > 3 && (
                          <Chip
                            size="small"
                            label={`+${row.registries.length - 3} more`}
                            variant="outlined"
                            onClick={() => setDetailKhasra(row)}
                          />
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {(row.possessions || []).length > 0 ? (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {row.possessions.slice(0, 2).map((p, i) => (
                          <Chip
                            key={p._id || i}
                            size="small"
                            label={`${p.possessionRef || 'POS'} (${formatKMS(p.possessedArea)})`}
                            color="primary"
                            variant="outlined"
                            sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                          />
                        ))}
                        {row.possessions.length > 2 && (
                          <Chip
                            size="small"
                            label={`+${row.possessions.length - 2} more`}
                            variant="outlined"
                            onClick={() => setDetailKhasra(row)}
                          />
                        )}
                      </Stack>
                    ) : !(row.handedOverPossessions || []).length ? (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    ) : null}
                    {(row.handedOverPossessions || []).length > 0 && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: (row.possessions || []).length ? 0.5 : 0 }}>
                        {row.handedOverPossessions.slice(0, 2).map((p, i) => (
                          <Tooltip key={p.lineId || i} title={`Handed over here against registry khasra ${p.registryKhasraNo || '—'} — counted there, not here`}>
                            <Chip
                              size="small"
                              label={`${p.possessionRef || 'POS'} for ${p.registryKhasraNo || '—'} (${formatKMS(p.possessedArea)})`}
                              variant="outlined"
                              sx={{ fontSize: '0.7rem', borderStyle: 'dashed', color: 'text.secondary' }}
                            />
                          </Tooltip>
                        ))}
                        {row.handedOverPossessions.length > 2 && (
                          <Chip
                            size="small"
                            label={`+${row.handedOverPossessions.length - 2} more`}
                            variant="outlined"
                            onClick={() => setDetailKhasra(row)}
                          />
                        )}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="View Khasra Summary Details">
                      <IconButton size="small" color="primary" onClick={() => setDetailKhasra(row)}>
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </TableContainer>
      )}

      {/* Detail Dialog */}
      <KhasraDetailDialog
        open={Boolean(detailKhasra)}
        onClose={() => setDetailKhasra(null)}
        khasra={detailKhasra}
      />
    </Box>
  );
};

export default KhasraSummaryViewer;
