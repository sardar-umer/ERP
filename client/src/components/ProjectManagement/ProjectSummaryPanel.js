import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Chip, Dialog, DialogContent, Grid, LinearProgress, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography
} from '@mui/material';
import {
  CheckCircle as OkIcon, ErrorOutline as ErrorIcon, InfoOutlined as InfoIcon, WarningAmber as WarnIcon
} from '@mui/icons-material';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis
} from 'recharts';
import dayjs from 'dayjs';
import { getImageUrl } from '../../utils/imageService';
import {
  ACCENT, BORDER, Empty, GLASS_EDGE, HEALTH_COLOR, INK, Label, MUTED, PASTEL_BG_TALL, PASTEL_SHADOW,
  PROJECT_STATUS_COLOR, fmt, fmtShort, plural, progressColor
} from './mainProjectUi';

const CATEGORY_COLORS = ['#4f46e5', '#0ea5e9', '#d97706', '#9333ea', '#be123c', '#16a34a'];
const PENDING_STAGES = ['Pending Audit', 'Forwarded to Audit Director', 'Send to CEO Office', 'Forwarded to CEO'];
const CARD_BG = 'rgba(255,255,255,0.88)';
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : null);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Frosted white card on the pastel panel */
const Card = ({ title, subtitle, children, sx }) => (
  <Paper
    elevation={0}
    sx={{
      p: { xs: 2, sm: 2.5 }, height: '100%', borderRadius: 3, bgcolor: CARD_BG, backdropFilter: 'blur(6px)',
      border: `1px solid ${GLASS_EDGE}`, boxShadow: '0 4px 14px rgba(15,23,42,0.06)', ...sx
    }}
  >
    {title && (
      <Box sx={{ mb: 1.75 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 800, color: INK }}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      </Box>
    )}
    {children}
  </Paper>
);

const ATTENTION_STYLE = {
  error: { Icon: ErrorIcon, color: '#dc2626', bg: 'rgba(220,38,38,0.07)' },
  warning: { Icon: WarnIcon, color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  info: { Icon: InfoIcon, color: '#0284c7', bg: 'rgba(2,132,199,0.07)' },
  ok: { Icon: OkIcon, color: '#16a34a', bg: 'rgba(22,163,74,0.08)' }
};

/** Everything the summary needs, worked out from the summary + tree data the page already loaded */
const analyse = (project, summary, tree) => {
  const t = summary.totals;
  const subs = tree?.subProjects || [];
  const contracts = subs.flatMap((s) => s.contracts.map((c) => ({ ...c, subName: s.name })));
  const crs = subs.flatMap((s) => [...s.contracts.flatMap((c) => c.checkRequests), ...s.unlinked.checkRequests]);
  const ipcs = subs.flatMap((s) => [
    ...s.contracts.flatMap((c) => [...c.checkRequests.flatMap((cr) => cr.ipcs), ...c.otherIpcs]),
    ...s.unlinked.checkRequests.flatMap((cr) => cr.ipcs), ...s.unlinked.ipcs
  ]);

  const draftIpcs = ipcs.filter((i) => i.approvalStatus === 'Draft');
  const pendingIpcs = ipcs.filter((i) => PENDING_STAGES.includes(i.approvalStatus));
  const rejectedIpcs = ipcs.filter((i) => i.approvalStatus === 'Rejected');
  const submittedCrs = crs.filter((c) => c.status === 'Submitted');
  const outstanding = ipcs
    .filter((i) => i.approvalStatus === 'Approved')
    .reduce((sum, i) => sum + Math.max(0, (i.netPayableAmount || i.grossAmount) - (i.paidAmount || 0)), 0);
  const amount = (list) => list.reduce((sum, i) => sum + (i.grossAmount || 0), 0);

  // Contractors: one row per contractor across all Sub Projects
  const byContractor = new Map();
  contracts.forEach((c) => {
    const key = c.contractor || 'No contractor';
    const row = byContractor.get(key) || { name: key, subs: new Set(), contracts: 0, value: 0, billed: 0, paid: 0 };
    row.subs.add(c.subName);
    row.contracts += 1;
    row.value += c.totalAmount || 0;
    row.billed += c.totals.billed || 0;
    row.paid += c.totals.paid || 0;
    byContractor.set(key, row);
  });
  const contractors = [...byContractor.values()].sort((a, b) => b.value - a.value);

  // Schedule: time elapsed vs work done
  const start = project.startDate ? dayjs(project.startDate) : null;
  const end = project.expectedEndDate ? dayjs(project.expectedEndDate) : null;
  const today = dayjs().startOf('day');
  const done = project.status === 'Completed';
  let schedule = null;
  if (start && end && end.isAfter(start)) {
    const totalDays = end.diff(start, 'day');
    const elapsed = Math.min(totalDays, Math.max(0, today.diff(start, 'day')));
    schedule = {
      totalDays,
      timePct: pct(elapsed, totalDays),
      daysLeft: end.diff(today, 'day'),
      overdue: !done && today.isAfter(end)
    };
  }

  const hasBudget = t.budget > 0;
  const attention = [];
  if (schedule?.overdue) attention.push({ level: 'error', text: `Past the expected end date by ${plural(-schedule.daysLeft, 'day')} and not marked Completed.` });
  if (hasBudget && t.spent > t.budget) attention.push({ level: 'error', text: `Spending is over budget by ${fmt(t.spent - t.budget)}.` });
  summary.subProjects.filter((s) => s.health === 'Over Budget').forEach((s) => attention.push({ level: 'error', text: `${s.name} is over its budget by ${fmt(s.variance)}.` }));
  if (pendingIpcs.length) attention.push({ level: 'warning', text: `${plural(pendingIpcs.length, 'IPC')} waiting in the approval chain (${fmt(amount(pendingIpcs))}).` });
  if (draftIpcs.length) attention.push({ level: 'warning', text: `${plural(draftIpcs.length, 'IPC')} still in Draft, not yet submitted (${fmt(amount(draftIpcs))}).` });
  if (rejectedIpcs.length) attention.push({ level: 'warning', text: `${plural(rejectedIpcs.length, 'IPC')} rejected and waiting to be revised.` });
  if (outstanding > 0) attention.push({ level: 'warning', text: `${fmt(outstanding)} approved by the CEO but not yet paid by Finance.` });
  if (submittedCrs.length) attention.push({ level: 'info', text: `${plural(submittedCrs.length, 'check request')} submitted and waiting for verification.` });
  summary.subProjects.filter((s) => s.health === 'Needs Attention').forEach((s) => attention.push({ level: 'info', text: `${s.name} is active but only ${s.progress}% done.` }));
  if (!hasBudget) attention.push({ level: 'info', text: 'No BOQ budget yet, so budget comparisons use the contract value.' });
  if (!attention.length) attention.push({ level: 'ok', text: 'Everything is on track. Nothing needs attention right now.' });

  return {
    t, hasBudget, contracts, crs, ipcs, contractors, schedule, attention, outstanding,
    approvedIpcs: ipcs.filter((i) => i.approvalStatus === 'Approved').length
  };
};

/** Project-level view: executive summary, key facts, money flow, sub projects, contractors, charts, photos */
export default function ProjectSummaryPanel({ project, summary, tree }) {
  const navigate = useNavigate();
  const [photo, setPhoto] = useState(null);
  const a = analyse(project, summary, tree);
  const { t } = a;
  const { budgetByCategory, monthlySpend, sitePhotos } = summary;
  const hasMonthlySpend = monthlySpend.some((m) => m.amount > 0);
  const budgetVsSpent = summary.subProjects.map((s) => ({ name: s.name, Budget: s.budget, Spent: s.spent }));
  const location = [project.society, project.sector, project.address].filter(Boolean).join(', ');
  const manager = project.projectManager ? `${project.projectManager.firstName || ''} ${project.projectManager.lastName || ''}`.trim() : null;

  // Plain-language overview
  const overview = [
    `${project.name} is ${(project.status || 'Draft').toLowerCase()} with ${plural(t.subProjects, 'sub project')} (${t.activeSubProjects} active) and is ${t.progress}% complete overall.`,
    a.contracts.length
      ? `${fmt(t.contracted)} has been contracted through ${plural(a.contracts.length, 'sublet contract')} with ${plural(a.contractors.length, 'contractor')}, backed by ${plural(a.crs.length, 'check request')} and ${plural(a.ipcs.length, 'IPC')}.`
      : 'No sublet contracts have been signed yet.',
    a.contracts.length
      ? `${fmt(t.spent)} of work has been billed, ${fmt(t.approved)} approved by the CEO and ${fmt(t.paid)} paid${a.outstanding > 0 ? `, leaving ${fmt(a.outstanding)} approved but unpaid` : ''}.`
      : null,
    a.hasBudget
      ? `Against the BOQ budget of ${fmt(t.budget)}, ${pct(t.spent, t.budget)}% has been spent.`
      : null
  ].filter(Boolean).join(' ');

  const moneySteps = [
    { label: 'Lump Sum Budget', value: t.lumpSumBudget, note: 'Approved for the whole project' },
    { label: 'Allocated to Subs', value: project.budgetAllocation?.totalAllocated, note: 'Shared out to sub projects' },
    { label: 'BOQ Budget', value: t.budget, note: 'Priced bill of quantities' },
    { label: 'Contracted', value: t.contracted, note: 'Sublet contracts signed' },
    { label: 'Billed (Spent)', value: t.spent, note: 'Certified work IPCs' },
    { label: 'CEO Approved', value: t.approved, note: 'Cleared for payment' },
    { label: 'Paid', value: t.paid, note: 'Paid to contractors' }
  ];

  const facts = [
    ['Project Code', project.projectNumber],
    ['Location', location],
    ['Client', project.clientName],
    ['Project Manager', manager],
    ['Start Date', fmtDate(project.startDate)],
    ['Expected End', fmtDate(project.expectedEndDate)],
    ['Actual End', fmtDate(project.actualEndDate)],
    ['Budget Status', project.budgetStatus],
    ['Cost Performance (CPI)', t.cpi === null ? null : `${t.cpi.toFixed(2)} · ${t.cpi >= 1 ? 'within budget' : 'costing more than earned'}`]
  ];

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, borderRadius: 3, background: PASTEL_BG_TALL, border: `1px solid ${GLASS_EDGE}`, boxShadow: PASTEL_SHADOW }}>
      {/* Title */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1} sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK, letterSpacing: 0.3 }}>PROJECT SUMMARY</Typography>
          <Typography variant="body2" sx={{ color: MUTED }}>As of {dayjs().format('DD MMM YYYY')}</Typography>
        </Box>
        <Chip label={project.status || 'Draft'} color={PROJECT_STATUS_COLOR[project.status] || 'default'} sx={{ fontWeight: 700 }} />
      </Stack>

      <Stack gap={2}>
        {/* 1. Executive summary + attention */}
        <Grid container spacing={2}>
          <Grid item xs={12} lg={7}>
            <Card title="Executive summary">
              <Typography sx={{ fontSize: 15, lineHeight: 1.75, color: '#334155' }}>{overview}</Typography>
              <Box sx={{ mt: 2, display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
                {[
                  ['Progress', `${t.progress}%`],
                  ['Contracts', String(a.contracts.length)],
                  ['Check Requests', String(a.crs.length)],
                  ['IPCs', `${a.ipcs.length} · ${a.approvedIpcs} approved`]
                ].map(([label, value]) => (
                  <Box key={label} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'rgba(241,245,249,0.8)', border: `1px solid ${BORDER}` }}>
                    <Label>{label}</Label>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: INK }}>{value}</Typography>
                  </Box>
                ))}
              </Box>
            </Card>
          </Grid>
          <Grid item xs={12} lg={5}>
            <Card title="Needs attention" subtitle={a.attention[0].level === 'ok' ? null : `${plural(a.attention.length, 'item')} to review`}>
              <Stack gap={1}>
                {a.attention.map((item, i) => {
                  const st = ATTENTION_STYLE[item.level];
                  return (
                    <Stack key={i} direction="row" gap={1.25} alignItems="flex-start" sx={{ p: 1.25, borderRadius: 2, bgcolor: st.bg }}>
                      <st.Icon sx={{ fontSize: 20, color: st.color, mt: '1px' }} />
                      <Typography sx={{ fontSize: 14, color: '#334155', lineHeight: 1.5 }}>{item.text}</Typography>
                    </Stack>
                  );
                })}
              </Stack>
            </Card>
          </Grid>
        </Grid>

        {/* 2. Key facts + schedule */}
        <Card title="Key facts & schedule">
          <Grid container spacing={2}>
            <Grid item xs={12} md={7}>
              <Grid container spacing={1.75}>
                {facts.map(([label, value]) => (
                  <Grid item xs={6} sm={4} key={label}>
                    <Label>{label}</Label>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: value ? INK : 'text.disabled' }}>{value || '—'}</Typography>
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid item xs={12} md={5}>
              <Box sx={{ p: 2, borderRadius: 2.5, bgcolor: 'rgba(241,245,249,0.8)', border: `1px solid ${BORDER}`, height: '100%' }}>
                <Label>Schedule</Label>
                {a.schedule ? (
                  <>
                    <Typography sx={{ fontSize: 18, fontWeight: 800, color: a.schedule.overdue ? '#dc2626' : INK, mt: 0.25 }}>
                      {project.status === 'Completed'
                        ? 'Completed'
                        : a.schedule.overdue ? `Overdue by ${plural(-a.schedule.daysLeft, 'day')}`
                          : a.schedule.daysLeft === 0 ? 'Due today' : `${plural(a.schedule.daysLeft, 'day')} left`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{plural(a.schedule.totalDays, 'day')} planned</Typography>
                    {[['Time elapsed', a.schedule.timePct, a.schedule.overdue ? 'error' : 'info'], ['Work done', t.progress, progressColor(t.progress)]].map(([label, value, color]) => (
                      <Box key={label} sx={{ mt: 1.25 }}>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography sx={{ fontSize: 13, color: MUTED }}>{label}</Typography>
                          <Typography sx={{ fontSize: 13, fontWeight: 800, color: INK }}>{value}%</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, value)} color={color} sx={{ mt: 0.5, height: 8, borderRadius: 4, bgcolor: '#e2e8f0' }} />
                      </Box>
                    ))}
                  </>
                ) : (
                  <Typography sx={{ mt: 0.5, fontSize: 14, color: 'text.secondary' }}>Add a start and expected end date to track the schedule.</Typography>
                )}
              </Box>
            </Grid>
            {(project.description || project.notes) && (
              <Grid item xs={12}>
                <Box sx={{ pt: 1.5, borderTop: `1px solid ${BORDER}`, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: project.description && project.notes ? '1fr 1fr' : '1fr' } }}>
                  {project.description && (
                    <Box><Label>Description / Scope</Label><Typography sx={{ fontSize: 14, whiteSpace: 'pre-line' }}>{project.description}</Typography></Box>
                  )}
                  {project.notes && (
                    <Box><Label>Notes</Label><Typography sx={{ fontSize: 14, whiteSpace: 'pre-line' }}>{project.notes}</Typography></Box>
                  )}
                </Box>
              </Grid>
            )}
          </Grid>
        </Card>

        {/* 3. Money flow */}
        <Card title="Money flow" subtitle="From the approved budget to what has been paid, in order">
          <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)', xl: 'repeat(7, 1fr)' } }}>
            {moneySteps.map((step, i) => (
              <Box
                key={step.label}
                sx={{
                  p: 1.5, borderRadius: 2,
                  bgcolor: i === 4 ? 'rgba(79,70,229,0.07)' : 'rgba(241,245,249,0.8)',
                  border: `1px solid ${i === 4 ? 'rgba(79,70,229,0.3)' : BORDER}`
                }}
              >
                <Stack direction="row" alignItems="center" gap={0.75}>
                  <Box sx={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: i === 4 ? '#4f46e5' : '#e2e8f0', color: i === 4 ? '#fff' : INK, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                    {i + 1}
                  </Box>
                  <Typography variant="caption" noWrap sx={{ color: 'text.secondary', fontWeight: 700 }}>{step.label}</Typography>
                </Stack>
                <Typography sx={{ mt: 0.75, fontSize: 16, fontWeight: 800, color: step.value ? INK : 'text.disabled' }}>
                  {step.value ? fmt(step.value) : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">{step.note}</Typography>
              </Box>
            ))}
          </Box>
        </Card>

        {/* 4. Sub projects + contractors */}
        <Grid container spacing={2}>
          <Grid item xs={12} lg={6}>
            <Card title="Sub projects" subtitle={`${t.subProjects} total · ${t.activeSubProjects} active`}>
              {!summary.subProjects.length ? <Empty>No sub projects yet.</Empty> : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 420 }}>
                    <TableHead>
                      <TableRow sx={{ '& th': { color: 'text.secondary', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 } }}>
                        <TableCell>Sub Project</TableCell>
                        <TableCell sx={{ minWidth: 110 }}>Progress</TableCell>
                        <TableCell align="right">Spent</TableCell>
                        <TableCell>Health</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {summary.subProjects.map((s) => (
                        <TableRow key={s._id} hover sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }} onClick={() => navigate(`/general/project-management/${project._id}?tab=overview&sub=${s._id}`)}>
                          <TableCell>
                            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{s.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{s.projectNumber}</Typography>
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" alignItems="center" gap={1}>
                              <LinearProgress variant="determinate" value={Math.min(100, s.progress)} color={progressColor(s.progress)} sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: '#e2e8f0' }} />
                              <Typography variant="caption" fontWeight={800}>{s.progress}%</Typography>
                            </Stack>
                          </TableCell>
                          <TableCell align="right">{fmt(s.spent)}</TableCell>
                          <TableCell><Chip size="small" label={s.health} color={HEALTH_COLOR[s.health] || 'default'} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Card>
          </Grid>
          <Grid item xs={12} lg={6}>
            <Card title="Contractors" subtitle={`${plural(a.contractors.length, 'contractor')} on ${plural(a.contracts.length, 'contract')}`}>
              {!a.contractors.length ? <Empty>No contractors yet.</Empty> : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 420 }}>
                    <TableHead>
                      <TableRow sx={{ '& th': { color: 'text.secondary', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 } }}>
                        <TableCell>Contractor</TableCell>
                        <TableCell align="right">Value</TableCell>
                        <TableCell align="right">Billed</TableCell>
                        <TableCell align="right">Paid</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {a.contractors.map((c) => (
                        <TableRow key={c.name} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                          <TableCell>
                            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{c.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{plural(c.contracts, 'contract')} · {[...c.subs].join(', ')}</Typography>
                          </TableCell>
                          <TableCell align="right">{fmt(c.value)}</TableCell>
                          <TableCell align="right">{fmt(c.billed)}</TableCell>
                          <TableCell align="right">{fmt(c.paid)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Card>
          </Grid>
        </Grid>

        {/* 5. Charts */}
        <Card title="Monthly spend" subtitle="Certified work billed, last 12 months">
          {!hasMonthlySpend ? <Empty>No certified work billed in the last 12 months.</Empty> : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={monthlySpend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="summary-spend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#4f46e5" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={48} axisLine={false} tickLine={false} />
                <ChartTooltip formatter={(v) => [fmt(v), 'Spent']} cursor={{ fill: 'rgba(79,70,229,0.06)' }} />
                <Bar dataKey="amount" fill="url(#summary-spend)" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Grid container spacing={2}>
          <Grid item xs={12} lg={7}>
            <Card title="Budget vs spent by sub project" subtitle={a.hasBudget ? null : 'No BOQ budget yet, so only spend is shown'}>
              {!budgetVsSpent.length ? <Empty>No sub projects yet.</Empty> : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={budgetVsSpent} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={48} axisLine={false} tickLine={false} />
                    <ChartTooltip formatter={(v) => fmt(v)} cursor={{ fill: 'rgba(79,70,229,0.06)' }} />
                    <Legend iconType="circle" />
                    <Bar dataKey="Budget" fill="#cbd5e1" radius={[6, 6, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="Spent" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </Grid>
          <Grid item xs={12} lg={5}>
            <Card title="Budget by cost category">
              {!budgetByCategory.length ? <Empty>No BOQ lines yet.</Empty> : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={budgetByCategory} dataKey="budget" nameKey="category" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {budgetByCategory.map((c, i) => <Cell key={c.category} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip formatter={(v) => fmt(v)} />
                    <Legend iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </Grid>
        </Grid>

        {/* 6. Site photos */}
        <Card title="Latest site photos" subtitle={sitePhotos.length ? 'From inspection reports' : null}>
          {!sitePhotos.length ? <Empty>No inspection photos yet.</Empty> : (
            <Grid container spacing={1.5}>
              {sitePhotos.map((p, i) => (
                <Grid item xs={6} sm={4} lg={3} key={`${p.url}-${i}`}>
                  <Box
                    onClick={() => setPhoto(p.url)}
                    sx={{
                      borderRadius: 2, overflow: 'hidden', border: `1px solid ${BORDER}`, cursor: 'pointer', bgcolor: '#fff',
                      '&:hover': { borderColor: ACCENT, boxShadow: '0 4px 12px rgba(15,23,42,0.08)' }
                    }}
                  >
                    <Box component="img" src={getImageUrl(p.url)} alt={p.reportNumber} sx={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                    <Box sx={{ p: 1 }}>
                      <Typography variant="caption" fontWeight={700} display="block" noWrap>{p.projectName}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {[p.reportNumber, p.date && dayjs(p.date).format('DD MMM YY')].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          )}
        </Card>
      </Stack>

      <Dialog open={Boolean(photo)} onClose={() => setPhoto(null)} maxWidth="lg">
        <DialogContent sx={{ p: 0, bgcolor: '#000', display: 'flex', justifyContent: 'center' }}>
          <Box component="img" src={getImageUrl(photo)} alt="Site photo" sx={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain' }} />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
