import React, { useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Button, Alert, Stack,
  Card, CardContent, Grid, Chip, TextField, IconButton, Collapse
} from '@mui/material';
import {
  AccountBalance as BSIcon,
  Print as PrintIcon,
  Refresh as RefreshIcon,
  PictureAsPdf as PdfIcon,
  GridOn as ExcelIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowRight as CollapseIcon
} from '@mui/icons-material';
import api from '../../services/api';
import FinanceCompanyPageHeader from '../../components/Finance/FinanceCompanyPageHeader';
import { useFinanceCompanyReload } from '../../hooks/useFinanceCompanyReload';
import { exportBalanceSheetPDF, exportBalanceSheetExcel } from '../../utils/reportExport';
import { printTovusElement } from '../../utils/tovusPrintBrand';

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BSSectionWithSubgroups = ({ title, rows, total, color, sectionType }) => {
  const [openGroups, setOpenGroups] = useState({});
  const [openSubGroups, setOpenSubGroups] = useState({});

  const toggleGroup = (groupKey) => {
    setOpenGroups((prev) => ({ ...prev, [groupKey]: prev[groupKey] === false ? true : false }));
  };

  const toggleSubGroup = (subKey) => {
    setOpenSubGroups((prev) => ({ ...prev, [subKey]: prev[subKey] === false ? true : false }));
  };

  // Build a clean 2-level hierarchy: Primary Group (e.g. Current Assets) -> Sub-Group (e.g. Cash and Cash Equivalents) -> Accounts
  const tree = {};

  (rows || []).forEach((r) => {
    let mainCategory = (r.accountCategory || '').trim();
    let subCategory = (r.accountDetailType || '').trim();

    // Standardize main category based on sectionType
    if (sectionType === 'assets') {
      if (/fixed|property|equipment|depreciation/i.test(mainCategory + ' ' + subCategory)) {
        mainCategory = 'Long-term / Fixed Assets';
      } else {
        mainCategory = 'Current Assets';
      }
    } else if (sectionType === 'liabilities') {
      if (/long|non-current/i.test(mainCategory + ' ' + subCategory)) {
        mainCategory = 'Long-term Liabilities';
      } else {
        mainCategory = 'Current Liabilities';
      }
    } else {
      mainCategory = 'Shareholders’ Equity';
    }

    // Determine sub-group
    if (!subCategory || subCategory === mainCategory) {
      subCategory = 'General';
    }

    if (!tree[mainCategory]) tree[mainCategory] = { subGroups: {}, total: 0 };
    if (!tree[mainCategory].subGroups[subCategory]) tree[mainCategory].subGroups[subCategory] = { rows: [], total: 0 };

    tree[mainCategory].subGroups[subCategory].rows.push(r);
    const amt = Number(r.balance) || 0;
    tree[mainCategory].subGroups[subCategory].total += amt;
    tree[mainCategory].total += amt;
  });

  const mainCategories = Object.keys(tree);

  return (
    <Box mb={3}>
      <Typography variant="subtitle1" fontWeight={700} color={color} sx={{ mb: 1, textTransform: 'uppercase', letterSpacing: 1, fontSize: 13 }}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ fontWeight: 700, width: '15%' }}>Account #</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Account Name</TableCell>
              <TableCell sx={{ fontWeight: 700, width: '20%' }}>Type</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, width: '22%' }}>Balance (PKR)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                  No accounts in this section
                </TableCell>
              </TableRow>
            )}

            {mainCategories.map((mainCat) => {
              const mainData = tree[mainCat];
              const isMainOpen = openGroups[mainCat] !== false;
              const subCats = Object.keys(mainData.subGroups);

              return (
                <React.Fragment key={mainCat}>
                  {/* Main Head (e.g. Current Assets, Long-term Assets) */}
                  <TableRow
                    sx={{ bgcolor: 'grey.100', cursor: 'pointer' }}
                    onClick={() => toggleGroup(mainCat)}
                    hover
                  >
                    <TableCell colSpan={3} sx={{ fontWeight: 800, color: 'text.primary', pl: 1.5, fontSize: '0.875rem' }}>
                      <IconButton size="small" sx={{ mr: 0.5, p: 0.2 }}>
                        {isMainOpen ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
                      </IconButton>
                      {mainCat}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                      {/* Subtotal shown at group footer */}
                    </TableCell>
                  </TableRow>

                  {/* Render Sub-groups under this Main Head */}
                  {subCats.map((subCat) => {
                    const subData = mainData.subGroups[subCat];
                    const subKey = `${mainCat}-${subCat}`;
                    const isSubOpen = openSubGroups[subKey] !== false && isMainOpen;
                    const hasNamedSubGroup = subCat !== 'General' && subCats.length > 1;

                    return (
                      <React.Fragment key={subKey}>
                        {/* Sub-Group Header (e.g. Cash & Cash Equivalents, Property Plant & Equipment) */}
                        {hasNamedSubGroup && (
                          <TableRow
                            sx={{ bgcolor: 'grey.50', display: isMainOpen ? 'table-row' : 'none', cursor: 'pointer' }}
                            onClick={() => toggleSubGroup(subKey)}
                            hover
                          >
                            <TableCell colSpan={3} sx={{ pl: 3.5, fontWeight: 700, color: 'text.primary', fontSize: '0.82rem' }}>
                              <IconButton size="small" sx={{ mr: 0.5, p: 0.2 }}>
                                {isSubOpen ? <ExpandIcon fontSize="small" /> : <CollapseIcon fontSize="small" />}
                              </IconButton>
                              {subCat}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600, color: 'text.secondary' }} />
                          </TableRow>
                        )}

                        {/* Individual Account Rows */}
                        {subData.rows.map((r) => (
                          <TableRow
                            key={r._id || r.accountNumber}
                            sx={{ display: (isMainOpen && (hasNamedSubGroup ? isSubOpen : true)) ? 'table-row' : 'none' }}
                            hover
                          >
                            <TableCell sx={{ color: 'text.secondary', fontFamily: 'monospace', pl: hasNamedSubGroup ? 6 : 4 }}>
                              {r.accountNumber}
                            </TableCell>
                            <TableCell sx={{ pl: hasNamedSubGroup ? 6 : 4 }}>
                              <span style={{ color: '#9ca3af', marginRight: 6 }}>↳</span>
                              {r.accountName}
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                              {r.accountDetailType || r.accountCategory || '—'}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 500 }}>
                              {fmt(r.balance)}
                            </TableCell>
                          </TableRow>
                        ))}

                        {/* Sub-group Subtotal Row */}
                        {hasNamedSubGroup && (
                          <TableRow sx={{ bgcolor: 'grey.50', display: isMainOpen ? 'table-row' : 'none' }}>
                            <TableCell colSpan={3} sx={{ pl: 5, fontWeight: 700, fontSize: '0.82rem' }}>
                              Total for {subCat}
                            </TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.82rem', color }}>
                              PKR {fmt(subData.total)}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Main Head Subtotal Row */}
                  <TableRow sx={{ bgcolor: 'grey.200', display: isMainOpen ? 'table-row' : 'none' }}>
                    <TableCell colSpan={3} sx={{ pl: 2, fontWeight: 800, fontSize: '0.875rem' }}>
                      Total for {mainCat}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontSize: '0.875rem', color }}>
                      PKR {fmt(mainData.total)}
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}

            {/* Total Section Row */}
            <TableRow sx={{ bgcolor: color === '#1565c0' ? 'primary.50' : color === '#c62828' ? 'error.50' : 'success.50' }}>
              <TableCell colSpan={3} align="right" sx={{ fontWeight: 800, fontSize: '0.92rem' }}>
                Total {title}
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 800, fontSize: '0.95rem', color }}>
                PKR {fmt(total)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default function BalanceSheet() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/finance/reports/balance-sheet', { params: { asOfDate } });
      setData(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load balance sheet');
    } finally {
      setLoading(false);
    }
  }, [asOfDate]);

  useFinanceCompanyReload(load, { skipInitial: true });

  const totalAssets = data?.totals?.totalAssets || 0;
  const totalLiabilitiesAndEquity = data?.totals?.liabilitiesAndEquity ?? data?.totals?.liabilitiesEquityAndPL ?? 0;
  const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 1;

  return (
    <Box className="tv-report-area" sx={{ p: 3 }}>
      <FinanceCompanyPageHeader title="Balance Sheet" icon={BSIcon}>
        <TextField
          label="As of Date"
          type="date"
          size="small"
          value={asOfDate}
          onChange={e => setAsOfDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <Button variant="contained" onClick={load} disabled={loading} startIcon={<RefreshIcon />}>
          {loading ? 'Loading…' : 'Generate'}
        </Button>
        {data && (
          <>
            <Button variant="outlined" startIcon={<PdfIcon />} color="error" onClick={() => exportBalanceSheetPDF(data)}>PDF</Button>
            <Button variant="outlined" startIcon={<ExcelIcon />} color="success" onClick={() => exportBalanceSheetExcel(data)}>Excel</Button>
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => printTovusElement('.tv-report-area', { title: 'Balance Sheet', fit: false })}>Print</Button>
          </>
        )}
      </FinanceCompanyPageHeader>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {!data && !loading && (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">Select a date and click Generate to view the Balance Sheet.</Typography>
        </Paper>
      )}

      {data && (
        <>
          {/* Header */}
          <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: isBalanced ? 'success.50' : 'error.50', borderColor: isBalanced ? 'success.200' : 'error.200' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="h6" fontWeight={700}>Balance Sheet</Typography>
                <Typography variant="body2" color="text.secondary">
                  As of {new Date(data.asOfDate).toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' })}
                </Typography>
              </Box>
              <Chip
                label={isBalanced ? 'Balanced (Assets = Liabilities + Equity) ✓' : `Imbalance: PKR ${fmt(Math.abs(totalAssets - totalLiabilitiesAndEquity))}`}
                color={isBalanced ? 'success' : 'error'}
                variant="filled"
                sx={{ fontWeight: 700 }}
              />
            </Stack>
          </Paper>

          {/* Summary KPI row */}
          <Grid container spacing={2} mb={3}>
            {[
              { label: 'Total Assets',                      value: data.totals.totalAssets,           color: 'primary.main'  },
              { label: 'Total Liabilities',                 value: data.totals.totalLiabilities,      color: 'error.main'    },
              { label: 'Total Equity (incl. P&L)',          value: data.totals.totalEquity,           color: 'success.main'  },
              { label: 'Total Liabilities & Equity',        value: totalLiabilitiesAndEquity,         color: isBalanced ? 'success.dark' : 'error.main' },
            ].map(c => (
              <Grid item xs={12} sm={6} md={3} key={c.label}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                    <Typography variant="h6" fontWeight={700} color={c.color}>PKR {fmt(c.value)}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Sections with Subgroups */}
          <BSSectionWithSubgroups title="Assets"      rows={data.assets.rows}      total={data.assets.total}      color="#1565c0" sectionType="assets" />
          <BSSectionWithSubgroups title="Liabilities" rows={data.liabilities.rows} total={data.liabilities.total} color="#c62828" sectionType="liabilities" />
          <BSSectionWithSubgroups title="Shareholders’ Equity" rows={data.equity.rows} total={data.equity.total} color="#2e7d32" sectionType="equity" />

          {/* Final balance check */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: isBalanced ? 'success.50' : 'error.50', borderColor: isBalanced ? 'success.300' : 'error.300' }}>
            <Stack direction="row" justifyContent="space-between" mb={1}>
              <Typography fontWeight={700}>Total Assets</Typography>
              <Typography fontWeight={700} color="primary.main">PKR {fmt(data.totals.totalAssets)}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography fontWeight={700}>Total Liabilities &amp; Shareholders’ Equity</Typography>
              <Typography fontWeight={700} color={isBalanced ? 'success.main' : 'error.main'}>
                PKR {fmt(totalLiabilitiesAndEquity)}
              </Typography>
            </Stack>
          </Paper>
        </>
      )}
    </Box>
  );
}
