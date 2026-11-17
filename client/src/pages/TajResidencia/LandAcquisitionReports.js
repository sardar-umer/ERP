import React, { useCallback, useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  TextField
} from '@mui/material';
import { ExpandMore, Download as DownloadIcon } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { getMozas } from '../../services/landAcquisitionMozaService';
import { getPossessionStatus } from '../../services/landAcquisitionPossessionService';
import { formatKMS, addAreas, subtractAreas } from '../../utils/landAreaUnits';
import RegistryViewer from './RegistryViewer';
import PossessionViewer from './PossessionViewer';
import KhasraSummaryViewer from './KhasraSummaryViewer';
import PendingPossessionRegistryViewer from './PendingPossessionRegistryViewer';
import useClientPagination from '../../hooks/useClientPagination';

const TABLE_HEAD_SX = {
  fontWeight: 700,
  fontSize: '0.875rem',
  lineHeight: 1.3,
  whiteSpace: 'nowrap',
  px: 1.75,
  py: 1.1
};

const COMPACT_CELL_SX = {
  px: 1.75,
  py: 1,
  whiteSpace: 'nowrap',
  fontSize: '0.9375rem',
  fontWeight: 500
};

const KMS_GROUP_BG = '#f3f6fa';
const KMS_GROUP_BORDER = '1px solid #d5dde8';

const kmsCellSx = (part, { header = false } = {}) => {
  const base = {
    width: 36,
    minWidth: 36,
    maxWidth: 36,
    px: 0.35,
    py: header ? 0.85 : 1,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    bgcolor: KMS_GROUP_BG,
    fontSize: header ? '0.75rem' : '0.9375rem',
    fontWeight: header ? 700 : 600,
    color: header ? 'text.secondary' : 'text.primary',
    letterSpacing: header ? 0.6 : 0
  };

  if (part === 'k') {
    return {
      ...base,
      borderLeft: KMS_GROUP_BORDER,
      pl: 0.75,
      borderTopLeftRadius: header ? 0 : 0
    };
  }
  if (part === 's') {
    return {
      ...base,
      borderRight: KMS_GROUP_BORDER,
      pr: 0.75
    };
  }
  return base;
};

const kmsHeaderGroupSx = {
  ...TABLE_HEAD_SX,
  bgcolor: KMS_GROUP_BG,
  borderBottom: KMS_GROUP_BORDER,
  borderLeft: KMS_GROUP_BORDER,
  borderRight: KMS_GROUP_BORDER,
  px: 1
};

const AREA_COLUMNS = [
  { key: 'baseline', label: 'Land in Khasra' },
  { key: 'registered', label: 'Purchased (Registry)' },
  { key: 'remainingToRegister', label: 'Pending Purchased' },
  { key: 'possessed', label: 'Possession' },
  { key: 'remainingToPossess', label: 'Pending Possession' }
];

const TABLE_COLGROUP = (
  <colgroup>
    <col style={{ width: 64 }} />
    <col style={{ width: 96 }} />
    <col style={{ width: 104 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
    <col style={{ width: 36 }} />
  </colgroup>
);

const MozaReportTable = ({ mozaId, mozaName, active }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [khewatFilter, setKhewatFilter] = useState('');
  const [khasraFilter, setKhasraFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadEntries = useCallback(async () => {
    if (!mozaId || !active) return;
    setLoading(true);
    setError('');
    try {
      const res = await getPossessionStatus({ moza: mozaId });
      setEntries(res.data?.data?.rows || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [mozaId, active]);

  useEffect(() => {
    if (active) loadEntries();
  }, [loadEntries, active]);

  const filteredEntries = React.useMemo(() => {
    return entries.filter(row => {
      const matchKhewat = khewatFilter ? String(row.khewatNo || '').toLowerCase().includes(khewatFilter.toLowerCase()) : true;
      const matchKhasra = khasraFilter ? String(row.khasraNo || '').toLowerCase().includes(khasraFilter.toLowerCase()) : true;
      return matchKhewat && matchKhasra;
    }).map(row => {
      const baseline = row.baseline || { kanal: 0, marla: 0, sarsai: 0 };
      const registered = row.registered || { kanal: 0, marla: 0, sarsai: 0 };
      const possessed = row.possessed || { kanal: 0, marla: 0, sarsai: 0 };
      return {
        ...row,
        baseline,
        registered,
        possessed,
        remainingToRegister: subtractAreas(baseline, registered),
        remainingToPossess: subtractAreas(registered, possessed)
      };
    });
  }, [entries, khewatFilter, khasraFilter]);

  const totals = React.useMemo(() => {
    const res = {};
    AREA_COLUMNS.forEach(col => {
      res[col.key] = { kanal: 0, marla: 0, sarsai: 0 };
    });
    filteredEntries.forEach(row => {
      AREA_COLUMNS.forEach(col => {
        if (row[col.key]) {
          res[col.key] = addAreas(res[col.key], row[col.key]);
        }
      });
    });
    return res;
  }, [filteredEntries]);

  const handleExport = () => {
    if (!filteredEntries.length) {
      toast.error('No data to export');
      return;
    }
    setExporting(true);
    try {
      const rows = filteredEntries.map((row) => ({
        'Sr No': row.srNo || '',
        'Khewat No': row.khewatNo || '',
        'Khasra No': row.khasraNo || '',
        'Land in Khasra (K-M-S)': formatKMS(row.baseline),
        'Land in Khasra - Kanal': row.baseline?.kanal || 0,
        'Land in Khasra - Marla': row.baseline?.marla || 0,
        'Land in Khasra - Sarsai': row.baseline?.sarsai || 0,
        'Purchased Registry (K-M-S)': formatKMS(row.registered),
        'Purchased - Kanal': row.registered?.kanal || 0,
        'Purchased - Marla': row.registered?.marla || 0,
        'Purchased - Sarsai': row.registered?.sarsai || 0,
        'Pending Purchased (K-M-S)': formatKMS(row.remainingToRegister),
        'Pending Purchased - Kanal': row.remainingToRegister?.kanal || 0,
        'Pending Purchased - Marla': row.remainingToRegister?.marla || 0,
        'Pending Purchased - Sarsai': row.remainingToRegister?.sarsai || 0,
        'Possession (K-M-S)': formatKMS(row.possessed),
        'Possession - Kanal': row.possessed?.kanal || 0,
        'Possession - Marla': row.possessed?.marla || 0,
        'Possession - Sarsai': row.possessed?.sarsai || 0,
        'Pending Possession (K-M-S)': formatKMS(row.remainingToPossess),
        'Pending Possession - Kanal': row.remainingToPossess?.kanal || 0,
        'Pending Possession - Marla': row.remainingToPossess?.marla || 0,
        'Pending Possession - Sarsai': row.remainingToPossess?.sarsai || 0
      }));

      // Add summary / total row
      rows.push({
        'Sr No': 'TOTAL',
        'Khewat No': '',
        'Khasra No': '',
        'Land in Khasra (K-M-S)': formatKMS(totals.baseline),
        'Land in Khasra - Kanal': totals.baseline?.kanal || 0,
        'Land in Khasra - Marla': totals.baseline?.marla || 0,
        'Land in Khasra - Sarsai': totals.baseline?.sarsai || 0,
        'Purchased Registry (K-M-S)': formatKMS(totals.registered),
        'Purchased - Kanal': totals.registered?.kanal || 0,
        'Purchased - Marla': totals.registered?.marla || 0,
        'Purchased - Sarsai': totals.registered?.sarsai || 0,
        'Pending Purchased (K-M-S)': formatKMS(totals.remainingToRegister),
        'Pending Purchased - Kanal': totals.remainingToRegister?.kanal || 0,
        'Pending Purchased - Marla': totals.remainingToRegister?.marla || 0,
        'Pending Purchased - Sarsai': totals.remainingToRegister?.sarsai || 0,
        'Possession (K-M-S)': formatKMS(totals.possessed),
        'Possession - Kanal': totals.possessed?.kanal || 0,
        'Possession - Marla': totals.possessed?.marla || 0,
        'Possession - Sarsai': totals.possessed?.sarsai || 0,
        'Pending Possession (K-M-S)': formatKMS(totals.remainingToPossess),
        'Pending Possession - Kanal': totals.remainingToPossess?.kanal || 0,
        'Pending Possession - Marla': totals.remainingToPossess?.marla || 0,
        'Pending Possession - Sarsai': totals.remainingToPossess?.sarsai || 0
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      const safeMozaName = (mozaName || 'Moza').replace(/[^a-zA-Z0-9_-]/g, '_');
      XLSX.utils.book_append_sheet(wb, ws, safeMozaName.substring(0, 31));
      XLSX.writeFile(wb, `Khasra_Acquisition_${safeMozaName}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Exported successfully');
    } catch (err) {
      toast.error('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const pg = useClientPagination(filteredEntries);
  if (!active) return null;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {!loading && !error && entries.length > 0 && (
        <Stack direction="row" spacing={2} sx={{ mb: 2, px: 0.5 }} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={2} alignItems="center">
            <TextField
              size="small"
              label="Filter Khewat No."
              value={khewatFilter}
              onChange={(e) => setKhewatFilter(e.target.value)}
              sx={{ width: 200 }}
            />
            <TextField
              size="small"
              label="Filter Khasra No."
              value={khasraFilter}
              onChange={(e) => setKhasraFilter(e.target.value)}
              sx={{ width: 200 }}
            />
          </Stack>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExport}
            disabled={exporting || !filteredEntries.length}
            sx={{ fontWeight: 600 }}
          >
            {exporting ? 'Exporting...' : 'Export Excel'}
          </Button>
        </Stack>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <TableContainer
          sx={{
            width: '100%',
            maxHeight: 'min(72vh, 720px)',
            minHeight: 420,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'auto'
          }}
        >
          <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', minWidth: 1000 }}>
            {TABLE_COLGROUP}
            <TableHead>
              <TableRow>
                <TableCell rowSpan={2} align="center" sx={TABLE_HEAD_SX}>Sr No</TableCell>
                <TableCell rowSpan={2} align="center" sx={TABLE_HEAD_SX}>Khewat No.</TableCell>
                <TableCell rowSpan={2} align="center" sx={TABLE_HEAD_SX}>Khasra No.</TableCell>
                {AREA_COLUMNS.map((col) => (
                  <TableCell key={col.key} align="center" colSpan={3} sx={kmsHeaderGroupSx}>
                    {col.label}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                {AREA_COLUMNS.map((col) => (
                  <React.Fragment key={`${col.key}-sub`}>
                    <TableCell align="center" sx={kmsCellSx('k', { header: true })}>K</TableCell>
                    <TableCell align="center" sx={kmsCellSx('m', { header: true })}>M</TableCell>
                    <TableCell align="center" sx={kmsCellSx('s', { header: true })}>S</TableCell>
                  </React.Fragment>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {pg.rows.map((row) => (
                <TableRow key={row.khasraEntryId} hover>
                  <TableCell align="center" sx={COMPACT_CELL_SX}>{row.srNo}</TableCell>
                  <TableCell align="center" sx={COMPACT_CELL_SX}>{row.khewatNo}</TableCell>
                  <TableCell align="center" sx={COMPACT_CELL_SX}>{row.khasraNo}</TableCell>
                  {AREA_COLUMNS.map((col) => {
                    const a = row[col.key] || { kanal: 0, marla: 0, sarsai: 0 };
                    return (
                      <React.Fragment key={`${row.khasraEntryId}-${col.key}`}>
                        <TableCell align="center" sx={kmsCellSx('k')}>{a.kanal || '—'}</TableCell>
                        <TableCell align="center" sx={kmsCellSx('m')}>{a.marla || '—'}</TableCell>
                        <TableCell align="center" sx={kmsCellSx('s')}>{a.sarsai || '—'}</TableCell>
                      </React.Fragment>
                    );
                  })}
                </TableRow>
              ))}
              {filteredEntries.length > 0 && (
                <TableRow sx={{ bgcolor: 'primary.main', '& td': { color: 'white !important', fontWeight: 800, border: 'none', py: 1.5 } }}>
                  <TableCell colSpan={3} align="right" sx={{ px: 2, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Total:
                  </TableCell>
                  {AREA_COLUMNS.map((col) => {
                    const a = totals[col.key];
                    return (
                      <React.Fragment key={`total-${col.key}`}>
                        <TableCell align="center" sx={{ fontSize: '1rem' }}>
                          {a.kanal || '—'} <span style={{ opacity: 0.8, fontSize: '0.75rem', marginLeft: 2 }}>K</span>
                        </TableCell>
                        <TableCell align="center" sx={{ fontSize: '1rem' }}>
                          {a.marla || '—'} <span style={{ opacity: 0.8, fontSize: '0.75rem', marginLeft: 2 }}>M</span>
                        </TableCell>
                        <TableCell align="center" sx={{ fontSize: '1rem' }}>
                          {a.sarsai || '—'} <span style={{ opacity: 0.8, fontSize: '0.75rem', marginLeft: 2 }}>S</span>
                        </TableCell>
                      </React.Fragment>
                    );
                  })}
                </TableRow>
              )}
              {!filteredEntries.length && (
                <TableRow>
                  <TableCell colSpan={3 + AREA_COLUMNS.length * 3} align="center" sx={{ py: 4 }}>
                    {entries.length ? 'No records match the filters.' : 'No khasra records found for this mouza.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>{pg.bar}
        </TableContainer>
      )}
    </Box>
  );
};

const LandAcquisitionReports = () => {
  const [reportType, setReportType] = useState('acquisition');
  const [mozas, setMozas] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMozas = useCallback(async () => {
    setListLoading(true);
    setError('');
    try {
      const res = await getMozas();
      const list = res.data?.data || [];
      setMozas(list);
      // Keep all cards collapsed initially for a clean list overview
    } catch {
      setError('Failed to load moza list');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMozas();
  }, [loadMozas]);

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Land Acquisition Reports
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Select a report below to view detailed breakdown and analytics.
        </Typography>
      </Box>

      {/* Report Selection Tabs / Pill Cards */}
      <Paper
        elevation={0}
        sx={{
          p: 0.5,
          mb: 3,
          bgcolor: 'grey.100',
          borderRadius: 2,
          display: 'inline-flex',
          flexWrap: 'wrap',
          gap: 1
        }}
      >
        <Button
          variant={reportType === 'acquisition' ? 'contained' : 'text'}
          color="primary"
          onClick={() => setReportType('acquisition')}
          sx={{ borderRadius: 1.5, px: 2.5, fontWeight: 700 }}
        >
          Khasra Acquisition Report
        </Button>
        <Button
          variant={reportType === 'khasra-summary' ? 'contained' : 'text'}
          color="primary"
          onClick={() => setReportType('khasra-summary')}
          sx={{ borderRadius: 1.5, px: 2.5, fontWeight: 700 }}
        >
          Khasra Summary Report
        </Button>
        <Button
          variant={reportType === 'registry' ? 'contained' : 'text'}
          color="primary"
          onClick={() => setReportType('registry')}
          sx={{ borderRadius: 1.5, px: 2.5, fontWeight: 700 }}
        >
          Registry Summary Report
        </Button>
        <Button
          variant={reportType === 'possession' ? 'contained' : 'text'}
          color="primary"
          onClick={() => setReportType('possession')}
          sx={{ borderRadius: 1.5, px: 2.5, fontWeight: 700 }}
        >
          Possession Summary Report
        </Button>
        <Button
          variant={reportType === 'pending-possession' ? 'contained' : 'text'}
          color="primary"
          onClick={() => setReportType('pending-possession')}
          sx={{ borderRadius: 1.5, px: 2.5, fontWeight: 700 }}
        >
          Pending Possession Registries
        </Button>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {listLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : !mozas.length ? (
        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
          No mouza found.
        </Typography>
      ) : reportType === 'khasra-summary' ? (
        <KhasraSummaryViewer />
      ) : reportType === 'registry' ? (
        <RegistryViewer />
      ) : reportType === 'possession' ? (
        <PossessionViewer />
      ) : reportType === 'pending-possession' ? (
        <PendingPossessionRegistryViewer />
      ) : (
        <Stack spacing={1.5}>
          {mozas.map((m) => {
            const isExpanded = expandedId === m._id;
            const totals = m.totals || {};
            return (
              <Accordion
                key={m._id}
                expanded={isExpanded}
                onChange={(_, open) => setExpandedId(open ? m._id : null)}
                disableGutters
                elevation={0}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '8px !important',
                  '&:before': { display: 'none' },
                  overflow: 'hidden'
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMore />}
                  sx={{
                    bgcolor: isExpanded ? 'action.selected' : 'background.paper',
                    '&:hover': { bgcolor: 'action.hover' },
                    py: 1
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', lg: 'row' }}
                    spacing={2}
                    alignItems={{ lg: 'center' }}
                    justifyContent="space-between"
                    sx={{ width: '100%', pr: 1 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 200 }}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        Mouza {m.name}
                      </Typography>
                      <Chip size="small" label={`${m.entryCount || 0} khasra records`} color="primary" variant="outlined" />
                    </Stack>

                    {totals.baseline && (() => {
                      const regTotal = totals.registered || { kanal: 0, marla: 0, sarsai: 0 };
                      const posTotal = totals.possessed || { kanal: 0, marla: 0, sarsai: 0 };
                      const baseTotal = totals.baseline || { kanal: 0, marla: 0, sarsai: 0 };
                      const pendingPurchase = subtractAreas(baseTotal, regTotal);
                      const pendingPossession = subtractAreas(regTotal, posTotal);

                      return (
                        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ fontSize: '0.8125rem' }}>
                          <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'grey.100', border: '1px solid', borderColor: 'grey.300' }}>
                            <Typography variant="caption" color="text.secondary" display="block" fontWeight={600}>Land in Khasra</Typography>
                            <Typography variant="body2" fontWeight={700}>{formatKMS(baseTotal)}</Typography>
                          </Box>
                          <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'success.50', border: '1px solid', borderColor: 'success.200' }}>
                            <Typography variant="caption" color="success.main" display="block" fontWeight={600}>Purchased (Registry)</Typography>
                            <Typography variant="body2" fontWeight={700} color="success.dark">{formatKMS(regTotal)}</Typography>
                          </Box>
                          <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'warning.50', border: '1px solid', borderColor: 'warning.200' }}>
                            <Typography variant="caption" color="warning.main" display="block" fontWeight={600}>Pending Purchased</Typography>
                            <Typography variant="body2" fontWeight={700} color="warning.dark">{formatKMS(pendingPurchase)}</Typography>
                          </Box>
                          <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.200' }}>
                            <Typography variant="caption" color="primary.main" display="block" fontWeight={600}>Possession</Typography>
                            <Typography variant="body2" fontWeight={700} color="primary.dark">{formatKMS(posTotal)}</Typography>
                          </Box>
                          <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'error.50', border: '1px solid', borderColor: 'error.200' }}>
                            <Typography variant="caption" color="error.main" display="block" fontWeight={600}>Pending Possession</Typography>
                            <Typography variant="body2" fontWeight={700} color="error.dark">{formatKMS(pendingPossession)}</Typography>
                          </Box>
                        </Stack>
                      );
                    })()}
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 1, pb: 2, px: 2, bgcolor: 'grey.50', minHeight: 480 }}>
                  <MozaReportTable mozaId={m._id} mozaName={m.name} active={isExpanded} />
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Stack>
      )}
    </Box>
  );
};

export default LandAcquisitionReports;
