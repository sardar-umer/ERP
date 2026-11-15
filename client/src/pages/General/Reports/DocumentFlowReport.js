import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  ArrowForward as ArrowForwardIcon,
  Download as DownloadIcon,
  OpenInNew as OpenInNewIcon,
  Print as PrintIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import api from '../../../services/api';

const KIND_COLORS = {
  indent: '#3b6fb6',
  quotation: '#6b7f99',
  purchase_order: '#2a9d8f',
  cash_approval: '#e9a23b',
  grn: '#5f8f4e',
  utility_bill: '#d1603d',
  vendor_bill: '#8e6bbf'
};

const formatDuration = (minutes) => {
  const m = Number(minutes) || 0;
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)} h`;
  const d = m / (60 * 24);
  return `${d.toFixed(d < 10 ? 1 : 0)} days`;
};

const formatAmount = (n) => (Number(n) ? `PKR ${Math.round(Number(n)).toLocaleString('en-PK')}` : '');

const Stat = ({ label, value, hint }) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
        {value || '—'}
      </Typography>
      {hint ? (
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </CardContent>
  </Card>
);

const DocumentFlowReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = searchParams.get('kind');
  const id = searchParams.get('id');

  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);

  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [docFilter, setDocFilter] = useState('');

  // Search as the user types (also loads the most recent documents when empty)
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/general-reports/document-flow/search', { params: { q: query } });
        if (!cancelled) setOptions(res.data?.data || []);
      } catch (e) {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const loadFlow = useCallback(async () => {
    if (!kind || !id) {
      setFlow(null);
      return;
    }
    setLoading(true);
    setError('');
    setDocFilter('');
    try {
      const res = await api.get(`/general-reports/document-flow/${kind}/${id}`);
      setFlow(res.data?.data || null);
    } catch (e) {
      setFlow(null);
      setError(e.response?.data?.message || 'Could not load the document flow');
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  const timeline = useMemo(
    () => (flow?.timeline || []).filter((t) => !docFilter || t.docKey === docFilter),
    [flow, docFilter]
  );

  const exportCsv = () => {
    const header = ['Step', 'Date', 'Time', 'Document', 'Number', 'From', 'To', 'Where', 'By', 'Time since previous step', 'Remarks'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = timeline.map((t) =>
      [
        t.step,
        dayjs(t.at).format('YYYY-MM-DD'),
        dayjs(t.at).format('HH:mm'),
        t.kindLabel,
        t.number,
        t.fromStatus,
        t.toStatus,
        t.module,
        t.by,
        t.minutesSincePrevious === null ? '' : formatDuration(t.minutesSincePrevious),
        t.comments
      ]
        .map(esc)
        .join(',')
    );
    const blob = new Blob([[header.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `document-flow-${flow?.start?.number || 'report'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = flow?.summary;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Document Trace
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Pick any indent, purchase order, cash approval, GRN or bill to see where it started, every desk it passed, and where it is now.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} className="no-print">
          <Button variant="text" onClick={() => navigate('/general/reports/document-flow')}>
            Back to register
          </Button>
        </Stack>
        {flow ? (
          <Stack direction="row" spacing={1} className="no-print">
            <Button startIcon={<DownloadIcon />} variant="outlined" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button startIcon={<PrintIcon />} variant="outlined" onClick={() => window.print()}>
              Print
            </Button>
          </Stack>
        ) : null}
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="no-print">
        <Autocomplete
          options={options}
          loading={searching}
          filterOptions={(x) => x}
          value={null}
          blurOnSelect
          inputValue={query}
          onInputChange={(_, v, reason) => {
            if (reason !== 'reset') setQuery(v);
          }}
          onChange={(_, opt) => {
            if (opt) setSearchParams({ kind: opt.kind, id: opt.id });
          }}
          getOptionLabel={(o) => `${o.kindLabel} ${o.number}`}
          isOptionEqualToValue={(a, b) => a.kind === b.kind && a.id === b.id}
          noOptionsText={query ? 'No document found' : 'Type to search'}
          renderOption={(props, o) => (
            <li {...props} key={`${o.kind}-${o.id}`}>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
                <Chip size="small" label={o.kindLabel} sx={{ bgcolor: KIND_COLORS[o.kind], color: '#fff', minWidth: 110 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {o.number}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {o.title}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {o.status} · {dayjs(o.date).format('DD MMM YYYY')}
                </Typography>
              </Stack>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search by document number, title or vendor"
              placeholder="e.g. PO-202610-0005, an indent number, a bill number, a vendor name"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {searching ? <CircularProgress size={18} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                )
              }}
            />
          )}
        />
      </Paper>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : null}
      {!loading && !flow && !error ? (
        <Alert severity="info">Search for a document above to see its full flow.</Alert>
      ) : null}

      {flow && !loading ? (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Stat
                label="Started"
                value={summary.startedAt ? dayjs(summary.startedAt).format('DD MMM YYYY, hh:mm A') : ''}
                hint={[summary.startedIn, summary.startedBy && `by ${summary.startedBy}`].filter(Boolean).join(' · ')}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Stat
                label="Where it is now"
                value={summary.lastAction}
                hint={[summary.lastActionAt && dayjs(summary.lastActionAt).format('DD MMM YYYY, hh:mm A'), summary.lastActionBy && `by ${summary.lastActionBy}`]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Stat label="Total time" value={formatDuration(summary.totalMinutes)} hint="First step to latest" />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <Stat label="Steps" value={summary.steps} hint={`${summary.documents} linked document${summary.documents === 1 ? '' : 's'}`} />
            </Grid>
            <Grid item xs={12} sm={4} md={2}>
              <Stat label="Returns / rejections" value={String(summary.returns)} />
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Linked documents
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              The chain this document belongs to, in process order. Click one to show only its steps.
            </Typography>
            <Stack direction="row" alignItems="stretch" flexWrap="wrap" useFlexGap spacing={1}>
              {flow.documents.map((d, i) => (
                <React.Fragment key={d.key}>
                  {i > 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.disabled' }}>
                      {flow.documents[i - 1].order !== d.order ? <ArrowForwardIcon fontSize="small" /> : <Typography variant="caption">+</Typography>}
                    </Box>
                  ) : null}
                  <Box
                    onClick={() => setDocFilter((cur) => (cur === d.key ? '' : d.key))}
                    sx={{
                      cursor: 'pointer',
                      minWidth: 180,
                      maxWidth: 240,
                      p: 1.25,
                      border: '1px solid',
                      borderColor: docFilter === d.key ? KIND_COLORS[d.kind] : 'divider',
                      borderLeft: `4px solid ${KIND_COLORS[d.kind]}`,
                      borderRadius: 1,
                      bgcolor: docFilter === d.key ? 'action.selected' : d.isStart ? 'action.hover' : 'background.paper'
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="caption" sx={{ color: KIND_COLORS[d.kind], fontWeight: 700, textTransform: 'uppercase' }}>
                        {d.kindLabel}
                      </Typography>
                      {d.link ? (
                        <Tooltip title="Open document">
                          <IconButton
                            size="small"
                            sx={{ p: 0.25 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(d.link);
                            }}
                          >
                            <OpenInNewIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                    </Stack>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {d.number}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {d.party || d.title || ' '}
                    </Typography>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={d.status || '—'} variant="outlined" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                      {dayjs(d.date).format('DD MMM YYYY')}
                      {formatAmount(d.amount) ? ` · ${formatAmount(d.amount)}` : ''}
                    </Typography>
                  </Box>
                </React.Fragment>
              ))}
            </Stack>
          </Paper>

          <Grid container spacing={2}>
            <Grid item xs={12} lg={9}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    Full flow ({timeline.length} step{timeline.length === 1 ? '' : 's'})
                  </Typography>
                  {docFilter ? <Chip size="small" label="Showing one document" onDelete={() => setDocFilter('')} color="primary" variant="outlined" /> : null}
                </Stack>

                {timeline.map((t, i) => {
                  const newDay = i === 0 || !dayjs(t.at).isSame(timeline[i - 1].at, 'day');
                  const slow = t.minutesSincePrevious !== null && t.minutesSincePrevious >= 60 * 24 * 3;
                  return (
                    <React.Fragment key={t.step}>
                      {newDay ? (
                        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mt: i === 0 ? 0 : 1.5, mb: 0.5 }}>
                          {dayjs(t.at).format('dddd, DD MMM YYYY')}
                        </Typography>
                      ) : null}
                      <Stack direction="row" spacing={1.5} sx={{ breakInside: 'avoid' }}>
                        <Box sx={{ width: 64, flexShrink: 0, textAlign: 'right', pt: 0.25 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {dayjs(t.at).format('hh:mm A')}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <Box sx={{ width: 12, height: 12, borderRadius: '50%', mt: 0.75, bgcolor: t.isReturn ? 'error.main' : KIND_COLORS[t.kind] }} />
                          <Box sx={{ flex: 1, width: 2, bgcolor: 'divider', minHeight: 16 }} />
                        </Box>
                        <Box sx={{ flex: 1, pb: 1.5, minWidth: 0 }}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: t.isReturn ? 'error.main' : 'text.primary' }}>
                              {t.fromStatus && t.fromStatus !== '—' && t.fromStatus !== t.toStatus ? `${t.fromStatus} → ` : ''}
                              {t.toStatus}
                            </Typography>
                            <Chip
                              size="small"
                              label={`${t.kindLabel} ${t.number}`}
                              sx={{ height: 20, fontSize: 11, bgcolor: KIND_COLORS[t.kind], color: '#fff' }}
                            />
                            {t.minutesSincePrevious !== null && t.minutesSincePrevious >= 1 ? (
                              <Chip
                                size="small"
                                variant="outlined"
                                color={slow ? 'warning' : 'default'}
                                label={`after ${formatDuration(t.minutesSincePrevious)}`}
                                sx={{ height: 20, fontSize: 11 }}
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {t.module}
                            {t.by ? ` · ${t.by}` : ''}
                          </Typography>
                          {t.comments ? (
                            <Typography variant="body2" sx={{ mt: 0.25 }}>
                              “{t.comments}”
                            </Typography>
                          ) : null}
                        </Box>
                      </Stack>
                    </React.Fragment>
                  );
                })}
                {!timeline.length ? (
                  <Typography variant="body2" color="text.secondary">
                    No steps recorded for this document.
                  </Typography>
                ) : null}
              </Paper>
            </Grid>

            <Grid item xs={12} lg={3}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Time by desk
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  How long documents waited before each desk acted.
                </Typography>
                {flow.timeByDepartment.length ? (
                  <Stack spacing={1}>
                    {flow.timeByDepartment.map((m) => (
                      <Stack key={m.module} direction="row" justifyContent="space-between" alignItems="baseline">
                        <Typography variant="body2">
                          {m.module}{' '}
                          <Typography component="span" variant="caption" color="text.secondary">
                            ({m.steps} step{m.steps === 1 ? '' : 's'})
                          </Typography>
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {formatDuration(m.minutes)}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Not enough steps yet.
                  </Typography>
                )}
              </Paper>
            </Grid>
          </Grid>
        </>
      ) : null}

      <style>{`@media print { .no-print, .MuiDrawer-root, header.MuiAppBar-root { display: none !important; } main { margin: 0 !important; padding: 0 !important; } }`}</style>
    </Box>
  );
};

export default DocumentFlowReport;
