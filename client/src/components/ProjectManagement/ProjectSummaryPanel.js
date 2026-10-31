import React, { useState } from 'react';
import { Box, Dialog, DialogContent, Grid, Stack, Typography } from '@mui/material';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis
} from 'recharts';
import dayjs from 'dayjs';
import { getImageUrl } from '../../utils/imageService';
import { ACCENT, BORDER, Empty, INK, Label, Panel, SOFT, fmt, fmtShort } from './mainProjectUi';

const CATEGORY_COLORS = ['#0f766e', '#0369a1', '#b45309', '#7c3aed', '#be123c', '#475569'];
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : null);

/** Project-level view: money flow, spending charts, project details, site photos */
export default function ProjectSummaryPanel({ project, summary }) {
  const [photo, setPhoto] = useState(null);
  const { totals, subProjects, budgetByCategory, monthlySpend, sitePhotos } = summary;
  const hasMonthlySpend = monthlySpend.some((m) => m.amount > 0);
  const budgetVsSpent = subProjects.map((s) => ({ name: s.name, Budget: s.budget, Spent: s.spent }));

  const moneySteps = [
    { label: 'Lump Sum Budget', value: totals.lumpSumBudget, note: 'Approved for the whole project' },
    { label: 'Allocated to Subs', value: project.budgetAllocation?.totalAllocated, note: 'Shared out to sub projects' },
    { label: 'BOQ Budget', value: totals.budget, note: 'Priced bill of quantities' },
    { label: 'Contracted', value: totals.contracted, note: 'Sublet contracts signed' },
    { label: 'Billed (Spent)', value: totals.spent, note: 'Certified work IPCs' },
    { label: 'CEO Approved', value: totals.approved, note: 'Cleared for payment' },
    { label: 'Paid', value: totals.paid, note: 'Paid to contractors' }
  ];

  const details = [
    ['Project Code', project.projectNumber],
    ['Status', project.status],
    ['Society', project.society],
    ['Sector / Block', project.sector],
    ['Address', project.address],
    ['Client', project.clientName],
    ['Project Manager', project.projectManager ? `${project.projectManager.firstName || ''} ${project.projectManager.lastName || ''}`.trim() : null],
    ['Start Date', fmtDate(project.startDate)],
    ['Expected End', fmtDate(project.expectedEndDate)],
    ['Actual End', fmtDate(project.actualEndDate)],
    ['Budget Status', project.budgetStatus],
    ['Cost Performance (CPI)', totals.cpi === null ? null : `${totals.cpi.toFixed(2)} (${totals.cpi >= 1 ? 'within budget' : 'costing more than earned'})`]
  ];

  return (
    <Stack gap={2}>
      <Panel title="Money flow">
        <Typography variant="body2" color="text.secondary" sx={{ mt: -1, mb: 1.5 }}>
          From the approved budget to what has been paid, in order.
        </Typography>
        <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
          {moneySteps.map((step, i) => (
            <Box
              key={step.label}
              sx={{
                p: 1.5, borderRadius: 2,
                bgcolor: i === 4 ? 'rgba(15,118,110,0.08)' : SOFT,
                border: `1px solid ${i === 4 ? 'rgba(15,118,110,0.3)' : BORDER}`
              }}
            >
              <Stack direction="row" alignItems="center" gap={0.75}>
                <Box sx={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#e2e8f0', color: INK, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                  {i + 1}
                </Box>
                <Typography variant="caption" noWrap sx={{ color: 'text.secondary', fontWeight: 700 }}>{step.label}</Typography>
              </Stack>
              <Typography variant="subtitle1" fontWeight={800} sx={{ mt: 0.75, color: step.value ? INK : 'text.disabled' }}>
                {step.value ? fmt(step.value) : '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">{step.note}</Typography>
            </Box>
          ))}
        </Box>
      </Panel>

      <Panel title="Monthly spend, last 12 months">
        {!hasMonthlySpend ? <Empty>No certified work billed in the last 12 months.</Empty> : (
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={monthlySpend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={48} axisLine={false} tickLine={false} />
              <ChartTooltip formatter={(v) => [fmt(v), 'Spent']} cursor={{ fill: 'rgba(15,118,110,0.06)' }} />
              <Bar dataKey="amount" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Panel title="Budget vs spent by sub project" sx={{ height: '100%' }}>
            {!budgetVsSpent.length ? <Empty>No sub projects yet.</Empty> : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={budgetVsSpent} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} width={48} axisLine={false} tickLine={false} />
                  <ChartTooltip formatter={(v) => fmt(v)} cursor={{ fill: 'rgba(15,118,110,0.06)' }} />
                  <Legend iconType="circle" />
                  <Bar dataKey="Budget" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="Spent" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Panel title="Budget by cost category" sx={{ height: '100%' }}>
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
          </Panel>
        </Grid>
      </Grid>

      <Panel title="Project details">
        <Grid container spacing={2}>
          {details.map(([label, value]) => (
            <Grid item xs={12} sm={6} md={4} key={label}>
              <Label>{label}</Label>
              <Typography variant="body2" fontWeight={600} sx={{ color: value ? INK : 'text.disabled' }}>{value || '—'}</Typography>
            </Grid>
          ))}
          {project.description && (
            <Grid item xs={12}>
              <Label>Description / Scope</Label>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{project.description}</Typography>
            </Grid>
          )}
          {project.notes && (
            <Grid item xs={12}>
              <Label>Notes</Label>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{project.notes}</Typography>
            </Grid>
          )}
        </Grid>
      </Panel>

      <Panel title="Latest site photos">
        {!sitePhotos.length ? <Empty>No inspection photos yet.</Empty> : (
          <Grid container spacing={1.5}>
            {sitePhotos.map((p, i) => (
              <Grid item xs={6} sm={4} lg={3} key={`${p.url}-${i}`}>
                <Box
                  onClick={() => setPhoto(p.url)}
                  sx={{
                    borderRadius: 2, overflow: 'hidden', border: `1px solid ${BORDER}`, cursor: 'pointer',
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
      </Panel>

      <Dialog open={Boolean(photo)} onClose={() => setPhoto(null)} maxWidth="lg">
        <DialogContent sx={{ p: 0, bgcolor: '#000', display: 'flex', justifyContent: 'center' }}>
          <Box component="img" src={getImageUrl(photo)} alt="Site photo" sx={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain' }} />
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
