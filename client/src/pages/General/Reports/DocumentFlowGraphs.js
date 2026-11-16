import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography
} from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Download as DownloadIcon, PictureAsPdf as PdfIcon } from '@mui/icons-material';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import api from '../../../services/api';

const KIND_COLORS = {
  indent: '#3b6fb6',
  purchase_order: '#2a9d8f',
  cash_approval: '#e9a23b',
  vendor_bill: '#8e6bbf',
  utility_bill: '#d1603d'
};

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

// Value label at the end of a bar, always on one line. (The stock label wraps its text to the
// bar's own width, so labels on short bars broke into overlapping pieces.)
const renderBarEndLabel = ({ x, y, width, height, value }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <text x={Number(x) + Number(width) + 6} y={Number(y) + Number(height) / 2} dominantBaseline="central" fontSize={12} fontWeight={600} fill="#333">
      {value}
    </text>
  );
};

const StuckTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const g = payload[0].payload;
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {g.label}
      </Typography>
      <Typography variant="body2">
        {g.count} document{g.count === 1 ? '' : 's'} waiting ({g.percent}% of all in progress) · avg {g.avgDays} days · oldest {g.oldestDays} days
      </Typography>
      {payload
        .filter((p) => p.value)
        .map((p) => (
          <Typography key={p.dataKey} variant="caption" component="div" sx={{ color: p.fill }}>
            {p.name}: {p.value}
          </Typography>
        ))}
    </Paper>
  );
};

/**
 * Graphs tab of the Document Flow report: where in-progress documents are stuck, and which stages are slowest —
 * for one document type or all of them together.
 */
const DocumentFlowGraphs = ({ kinds, from, to, reloadKey }) => {
  const [selected, setSelected] = useState('all');
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const chartsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const wanted = selected === 'all' ? kinds : kinds.filter((k) => k.key === selected);
    setLoading(true);
    setError('');
    Promise.all(
      wanted.map((k) =>
        api
          .get('/general-reports/flow-register', { params: { kind: k.key, from, to } })
          .then((res) => ({ ...k, rows: res.data?.data?.rows || [], stageOwners: res.data?.data?.stageOwners || {} }))
      )
    )
      .then((result) => {
        if (!cancelled) setSets(result);
      })
      .catch((e) => {
        if (!cancelled) {
          setSets([]);
          setError(e.response?.data?.message || 'Could not load the graphs');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, kinds, from, to, reloadKey]);

  const totals = useMemo(() => {
    const all = sets.flatMap((s) => s.rows);
    return { documents: all.length, open: all.filter((r) => r.isOpen).length };
  }, [sets]);

  // In-progress documents by the stage (and department) they are waiting at
  const stuck = useMemo(() => {
    const map = new Map();
    sets.forEach((set) => {
      set.rows
        .filter((r) => r.isOpen)
        .forEach((r) => {
          const stage = r.currentStage || r.status || 'Unknown';
          const owner = r.pendingWith || set.stageOwners[stage] || '';
          const label = owner && owner.toLowerCase() !== stage.toLowerCase() ? `${stage} — ${owner}` : stage;
          const g = map.get(label) || { label, stage, owner, count: 0, minutes: 0, oldest: 0 };
          const waited = r.visits[r.visits.length - 1]?.minutes || 0;
          g.count += 1;
          g.minutes += waited;
          g.oldest = Math.max(g.oldest, waited);
          g[set.key] = (g[set.key] || 0) + 1;
          map.set(label, g);
        });
    });
    const openTotal = [...map.values()].reduce((sum, g) => sum + g.count, 0);
    return [...map.values()]
      .map((g) => ({
        ...g,
        percent: pct(g.count, openTotal),
        countLabel: `${g.count} (${pct(g.count, openTotal)}%)`,
        avgDays: round1(g.minutes / g.count / 1440),
        oldestDays: round1(g.oldest / 1440)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [sets]);

  // Average time documents spend in each stage before moving on
  const slowest = useMemo(() => {
    const map = new Map();
    sets.forEach((set) => {
      set.rows.forEach((r) =>
        r.visits.forEach((v) => {
          if (v.minutes === null) return;
          const owner = set.stageOwners[v.stage] || '';
          const label = owner && owner.toLowerCase() !== v.stage.toLowerCase() ? `${v.stage} — ${owner}` : v.stage;
          const g = map.get(label) || { label, visits: 0, minutes: 0 };
          g.visits += 1;
          g.minutes += v.minutes;
          map.set(label, g);
        })
      );
    });
    const totalMinutes = [...map.values()].reduce((sum, g) => sum + g.minutes, 0);
    return [...map.values()]
      .map((g) => {
        const avgDays = Math.round((g.minutes / g.visits / 1440) * 100) / 100;
        const percent = pct(g.minutes, totalMinutes);
        return { ...g, avgDays, percent, daysLabel: `${avgDays} d (${percent}% of time)` };
      })
      .filter((g) => g.avgDays > 0)
      .sort((a, b) => b.avgDays - a.avgDays)
      .slice(0, 12);
  }, [sets]);

  // In-progress count per document type (only meaningful for "All types")
  const byType = useMemo(
    () =>
      sets
        .map((s) => ({ key: s.key, label: s.label, open: s.rows.filter((r) => r.isOpen).length, total: s.rows.length }))
        .map((t, _i, all) => {
          const share = pct(t.open, all.reduce((sum, x) => sum + x.open, 0));
          return { ...t, share, ownPercent: pct(t.open, t.total), openLabel: `${t.open} (${share}%)` };
        })
        .sort((a, b) => b.open - a.open),
    [sets]
  );

  const top = stuck[0];

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const addSheet = (name, head, body, widths) => {
      const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
      ws['!cols'] = head.map((h, i) => ({ wch: widths?.[i] || Math.max(14, String(h).length + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    addSheet(
      'Stuck by stage',
      ['Stage', 'Department / Pending With', ...sets.map((s) => s.label), 'Total Stuck', '% of In Progress', 'Average Days Waiting', 'Oldest Days Waiting'],
      stuck.map((g) => [g.stage, g.owner, ...sets.map((s) => g[s.key] || 0), g.count, `${g.percent}%`, g.avgDays, g.oldestDays]),
      [34, 28]
    );

    addSheet(
      'Slowest stages',
      ['Stage — Department', 'Times Passed', 'Average Days In Stage', '% of All Stage Time'],
      slowest.map((g) => [g.label, g.visits, g.avgDays, `${g.percent}%`]),
      [48]
    );

    addSheet(
      'By document type',
      ['Document Type', 'In Progress', 'Completed', 'Total', '% In Progress (of its own)', '% of Everything In Progress'],
      byType.map((t) => [t.label, t.open, t.total - t.open, t.total, `${t.ownPercent}%`, `${t.share}%`])
    );

    const waiting = sets
      .flatMap((set) =>
        set.rows
          .filter((r) => r.isOpen)
          .map((r) => {
            const last = r.visits[r.visits.length - 1];
            return [
              set.label,
              r.number,
              r.party || r.title,
              r.amount || '',
              r.currentStage || r.status,
              r.pendingWith,
              last ? dayjs(last.at).format('DD MMM YYYY hh:mm A') : '',
              last?.minutes !== null && last?.minutes !== undefined ? Math.round((last.minutes / 1440) * 100) / 100 : '',
              r.initiatedBy,
              dayjs(r.initiatedAt).format('DD MMM YYYY'),
              r.returns,
              r.lastRemark
            ];
          })
      )
      .sort((a, b) => (Number(b[7]) || 0) - (Number(a[7]) || 0));
    addSheet(
      'Stuck documents',
      ['Type', 'Document No', 'Title / Vendor', 'Amount (PKR)', 'Stuck At', 'Pending With', 'Waiting Since', 'Days Waiting', 'Initiated By', 'Initiated On', 'Times Returned / Rejected', 'Last Remark'],
      waiting,
      [16, 20, 32, 14, 28, 26, 22, 14, 24, 14, 12, 50]
    );

    XLSX.writeFile(wb, `document-flow-graphs-${selected}-${dayjs().format('YYYY-MM-DD')}.xlsx`);
  };
  // PDF of the graphs exactly as they are drawn on this page: each graph card is captured as an
  // image and laid out on A4 landscape pages under a heading with the scope, period and totals.
  const exportPdf = async () => {
    const cards = Array.from(chartsRef.current?.querySelectorAll('[data-pdf-card]') || []);
    if (!cards.length) return;
    try {
      setExportingPdf(true);
      // Bars stop animating while exporting (see isAnimationActive below); give them a moment to
      // redraw with their value labels before the snapshot is taken
      await new Promise((resolve) => setTimeout(resolve, 400));
      const [{ default: html2canvas }, { default: JsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const usableW = pageW - margin * 2;
      const typeLabel = selected === 'all' ? 'All types' : (kinds.find((k) => k.key === selected)?.label || selected);
      const period = from || to ? `${from ? dayjs(from).format('DD MMM YYYY') : 'start'} to ${to ? dayjs(to).format('DD MMM YYYY') : 'today'}` : 'All dates';
      const done = totals.documents - totals.open;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(15);
      pdf.text('Document Flow Report — Graphs', margin, margin + 5);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text(`Document type: ${typeLabel}   |   Period: ${period}   |   Generated: ${dayjs().format('DD MMM YYYY, hh:mm A')}`, margin, margin + 11);
      pdf.text(
        `${totals.documents} documents   |   ${totals.open} in progress (${pct(totals.open, totals.documents)}%)   |   ${done} completed (${pct(done, totals.documents)}%)`,
        margin,
        margin + 16
      );
      let y = margin + 21;
      const gridWidth = chartsRef.current.clientWidth || 1;

      for (const card of cards) {
        // The snapshot draws each chart's SVG on its own, where text no longer inherits the page's
        // font — so copy the font each label really has onto the label itself first
        const liveTexts = Array.from(card.querySelectorAll('svg text, svg tspan'));
        const canvas = await html2canvas(card, {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          onclone: (_doc, clonedCard) => {
            clonedCard.querySelectorAll('svg text, svg tspan').forEach((node, i) => {
              const live = liveTexts[i];
              if (!live) return;
              const cs = window.getComputedStyle(live);
              node.style.fontFamily = cs.fontFamily;
              node.style.fontSize = cs.fontSize;
              node.style.fontWeight = cs.fontWeight;
            });
          }
        });
        // A card that takes part of the row on screen keeps that share of the page width,
        // so a small graph is not blown up to the full width
        let w = usableW * Math.min(1, card.offsetWidth / gridWidth);
        let h = (canvas.height * w) / canvas.width;
        if (y + h > pageH - margin && y > margin) {
          pdf.addPage();
          y = margin;
        }
        // A graph taller than a whole page is shrunk to fit one page rather than cut in two
        const maxH = pageH - margin - y;
        if (h > maxH) {
          w = (w * maxH) / h;
          h = maxH;
        }
        // JPEG keeps the file small (a few hundred KB instead of several MB as PNG)
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin + (usableW - w) / 2, y, w, h);
        y += h + 5;
      }

      const pages = pdf.getNumberOfPages();
      pdf.setFontSize(8);
      for (let i = 1; i <= pages; i += 1) {
        pdf.setPage(i);
        pdf.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 4, { align: 'right' });
      }
      pdf.save(`document-flow-graphs-${selected}-${dayjs().format('YYYY-MM-DD')}.pdf`);
    } catch (e) {
      setError(`Could not create the PDF: ${e.message || 'unknown error'}`);
    } finally {
      setExportingPdf(false);
    }
  };

  const scopeLabel = selected === 'all' ? 'documents' : (kinds.find((k) => k.key === selected)?.label || 'documents').toLowerCase();

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>Document type</InputLabel>
            <Select value={selected} label="Document type" onChange={(e) => setSelected(e.target.value)}>
              <MenuItem value="all">All types</MenuItem>
              {kinds.map((k) => (
                <MenuItem key={k.key} value={k.key}>
                  {k.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`${totals.documents} documents`} />
            <Chip size="small" color="warning" variant="outlined" label={`${totals.open} in progress (${pct(totals.open, totals.documents)}%)`} />
            <Chip size="small" color="success" variant="outlined" label={`${totals.documents - totals.open} completed (${pct(totals.documents - totals.open, totals.documents)}%)`} />
          </Stack>
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<PdfIcon />} variant="contained" color="error" onClick={exportPdf} disabled={loading || exportingPdf || !totals.documents}>
            {exportingPdf ? 'Creating PDF…' : 'Export PDF'}
          </Button>
          <Button startIcon={<DownloadIcon />} variant="contained" color="success" onClick={exportExcel} disabled={loading || !totals.documents}>
            Download Excel
          </Button>
        </Stack>
        {loading ? <LinearProgress sx={{ mt: 2 }} /> : null}
      </Paper>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {!error && sets.length ? (
        <Grid container spacing={2} ref={chartsRef}>
          <Grid item xs={12}>
            <Paper variant="outlined" sx={{ p: 2 }} data-pdf-card>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Where {scopeLabel} are stuck right now
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                In-progress documents by the stage and department they are waiting at.
              </Typography>
              {top ? (
                <>
                  <Alert severity="warning" icon={false} sx={{ mb: 1.5, py: 0.5 }}>
                    Most are stuck at <b>{top.label}</b> — {top.count} of {totals.open} in progress (<b>{top.percent}%</b>), waiting {top.avgDays} days on average (oldest{' '}
                    {top.oldestDays} days).
                  </Alert>
                  <ResponsiveContainer width="100%" height={Math.max(180, stuck.length * 40 + 70)}>
                    <BarChart data={stuck} layout="vertical" margin={{ top: 4, right: 84, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="label" width={300} tick={{ fontSize: 12 }} />
                      <ChartTooltip content={<StuckTooltip />} />
                      {sets.length > 1 ? <Legend /> : null}
                      {sets.map((s, i) => (
                        <Bar key={s.key} dataKey={s.key} name={s.label} stackId="stuck" fill={KIND_COLORS[s.key] || '#78909c'} isAnimationActive={!exportingPdf}>
                          {i === sets.length - 1 ? (
                            <LabelList dataKey="countLabel" content={renderBarEndLabel} />
                          ) : null}
                        </Bar>
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Nothing is in progress — every document in this period is completed.
                </Typography>
              )}
            </Paper>
          </Grid>

          <Grid item xs={12} lg={selected === 'all' ? 7 : 12}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }} data-pdf-card>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Slowest stages
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Average days a document stays in each stage before moving on.
              </Typography>
              {slowest.length ? (
                <ResponsiveContainer width="100%" height={Math.max(180, slowest.length * 34 + 40)}>
                  <BarChart data={slowest} layout="vertical" margin={{ top: 4, right: 130, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" unit=" d" />
                    <YAxis type="category" dataKey="label" width={300} tick={{ fontSize: 12 }} />
                    <ChartTooltip
                      formatter={(value, _name, item) => [
                        `${value} days average over ${item.payload.visits} visit${item.payload.visits === 1 ? '' : 's'} · ${item.payload.percent}% of all stage time`,
                        'Time in stage'
                      ]}
                    />
                    <Bar dataKey="avgDays" fill="#5c6f8a" radius={[0, 4, 4, 0]} isAnimationActive={!exportingPdf}>
                      <LabelList dataKey="daysLabel" content={renderBarEndLabel} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Not enough stage movements to compare yet.
                </Typography>
              )}
            </Paper>
          </Grid>

          {selected === 'all' ? (
            <Grid item xs={12} lg={5}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%' }} data-pdf-card>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  In progress by document type
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Which kind of document has the most still open.
                </Typography>
                <ResponsiveContainer width="100%" height={Math.max(180, byType.length * 44 + 40)}>
                  <BarChart data={byType} layout="vertical" margin={{ top: 4, right: 84, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12 }} />
                    <ChartTooltip formatter={(value, _name, item) => [`${value} in progress of ${item.payload.total} (${item.payload.ownPercent}% of its own) · ${item.payload.share}% of everything in progress`, item.payload.label]} />
                    <Bar dataKey="open" fill="#e9a23b" radius={[0, 4, 4, 0]} isAnimationActive={!exportingPdf}>
                      <LabelList dataKey="openLabel" content={renderBarEndLabel} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
          ) : null}
        </Grid>
      ) : null}
    </Box>
  );
};

export default DocumentFlowGraphs;
