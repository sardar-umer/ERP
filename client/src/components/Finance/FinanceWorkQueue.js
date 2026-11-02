import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Chip, Divider, Paper, Skeleton, Stack, Tooltip, Typography
} from '@mui/material';
import {
  ArrowForward as GoIcon, CallMade as OutIcon, CallReceived as InIcon, CheckCircle as OkIcon,
  ErrorOutline as AlertIcon, ReportProblem as WarnIcon
} from '@mui/icons-material';
import api from '../../services/api';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const full = (n) => `PKR ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
const compact = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)} Lac`;
  return Math.round(v).toLocaleString('en-PK');
};
const dayLabel = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');

/** Ageing buckets, oldest last; colours go from calm to alarming */
const BUCKETS = [
  { key: 'current', label: 'Not due', color: '#94a3b8' },
  { key: 'days1_30', label: '1–30', color: '#facc15' },
  { key: 'days31_60', label: '31–60', color: '#fb923c' },
  { key: 'days61_90', label: '61–90', color: '#f97316' },
  { key: 'over90', label: '90+', color: '#dc2626' }
];

/** Everything past its due date (1 day or more) */
export const overdueOf = (aging) => (aging?.totals
  ? Math.max(0, (aging.totals.balance || 0) - (aging.totals.current || 0))
  : 0);

const Panel = ({ title, subtitle, action, children, sx }) => (
  <Paper elevation={0} sx={{ p: 2.25, borderRadius: 3, border: `1px solid ${LINE}`, bgcolor: '#fff', height: '100%', ...sx }}>
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1} sx={{ mb: 1.5 }}>
      <Box>
        <Typography sx={{ fontWeight: 800, color: INK, fontSize: 15.5 }}>{title}</Typography>
        {subtitle && <Typography sx={{ fontSize: 12.5, color: MUTED }}>{subtitle}</Typography>}
      </Box>
      {action}
    </Stack>
    {children}
  </Paper>
);

/** One stacked bar across the ageing buckets, with a legend underneath */
const AgingStrip = ({ totals }) => {
  const total = totals?.balance || 0;
  if (!total) return <Typography sx={{ fontSize: 13, color: MUTED, py: 1 }}>Nothing outstanding.</Typography>;
  return (
    <Box>
      <Stack direction="row" sx={{ height: 12, borderRadius: 6, overflow: 'hidden', bgcolor: '#f1f5f9' }}>
        {BUCKETS.map((b) => {
          const v = totals[b.key] || 0;
          if (!v) return null;
          return (
            <Tooltip key={b.key} title={`${b.label === 'Not due' ? 'Not due yet' : `${b.label} days overdue`}: ${full(v)}`}>
              <Box sx={{ width: `${(v / total) * 100}%`, bgcolor: b.color, transition: 'width .6s' }} />
            </Tooltip>
          );
        })}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', mt: 1, gap: 0.5 }}>
        {BUCKETS.map((b) => (
          <Box key={b.key}>
            <Stack direction="row" alignItems="center" gap={0.5}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: b.color }} />
              <Typography sx={{ fontSize: 10.5, color: MUTED, fontWeight: 700 }}>{b.label}</Typography>
            </Stack>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: INK, fontVariantNumeric: 'tabular-nums' }}>{compact(totals[b.key])}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

/** Ageing + the five parties with the most outstanding */
const PartyPanel = ({ title, subtitle, aging, color, emptyText, onOpen, onAll }) => {
  const parties = (aging?.parties || []).slice(0, 5);
  const max = Math.max(1, ...parties.map((p) => p.balance));
  return (
    <Panel
      title={title}
      subtitle={aging ? `${full(aging.totals?.balance)} outstanding · ${full(overdueOf(aging))} overdue` : subtitle}
      action={<Chip size="small" label="Ageing" onClick={onAll} icon={<GoIcon sx={{ fontSize: '14px !important' }} />} sx={{ fontWeight: 700 }} />}
    >
      {!aging ? <Skeleton variant="rounded" height={220} /> : (
        <>
          <AgingStrip totals={aging.totals} />
          <Divider sx={{ my: 1.75 }} />
          <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, mb: 1 }}>
            Top {parties.length || ''} {subtitle}
          </Typography>
          {!parties.length ? <Typography sx={{ fontSize: 13, color: MUTED }}>{emptyText}</Typography> : (
            <Stack gap={1}>
              {parties.map((p) => {
                const overdue = p.balance - (p.current || 0);
                return (
                  <Box key={p.key} onClick={() => onOpen(p)} sx={{ cursor: 'pointer', borderRadius: 1.5, mx: -0.75, px: 0.75, py: 0.25, '&:hover': { bgcolor: '#f8fafc' } }}>
                    <Stack direction="row" justifyContent="space-between" gap={1}>
                      <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: INK }}>{p.name}</Typography>
                      <Tooltip title={full(p.balance)}>
                        <Typography sx={{ fontSize: 13, fontWeight: 800, color: INK, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{compact(p.balance)}</Typography>
                      </Tooltip>
                    </Stack>
                    <Box sx={{ mt: 0.5, height: 5, borderRadius: 3, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                      <Box sx={{ height: '100%', width: `${(p.balance / max) * 100}%`, bgcolor: color, borderRadius: 3 }} />
                    </Box>
                    <Typography sx={{ fontSize: 11, color: overdue > 0.5 ? '#dc2626' : MUTED, mt: 0.25 }}>
                      {p.items?.length || 0} document{p.items?.length === 1 ? '' : 's'}{overdue > 0.5 ? ` · ${compact(overdue)} overdue` : ' · nothing overdue'}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          )}
        </>
      )}
    </Panel>
  );
};

/** Money coming in and going out over the next 7 days (plus anything already overdue) */
const DueThisWeek = ({ ar, ap, onOpen }) => {
  const rows = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() + 7);
    const pick = (aging, dir) => (aging?.parties || []).flatMap((p) => (p.items || [])
      .filter((i) => i.dueDate && new Date(i.dueDate) <= end)
      .map((i) => ({ ...i, party: p.name, dir })));
    return [...pick(ar, 'in'), ...pick(ap, 'out')].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }, [ar, ap]);
  const sum = (dir, overdue) => rows.filter((r) => r.dir === dir && Boolean(r.overdue) === overdue).reduce((t, r) => t + r.balance, 0);

  return (
    <Panel title="Due this week" subtitle="Next 7 days, and anything already overdue">
      {!ar || !ap ? <Skeleton variant="rounded" height={220} /> : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1.5 }}>
            {[['in', 'To collect', '#15803d'], ['out', 'To pay', '#b45309']].map(([dir, label, color]) => (
              <Box key={dir} sx={{ p: 1.25, borderRadius: 2, bgcolor: dir === 'in' ? '#f0fdf4' : '#fffbeb' }}>
                <Typography sx={{ fontSize: 11.5, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Typography>
                <Typography sx={{ fontSize: 18, fontWeight: 900, color: INK, fontVariantNumeric: 'tabular-nums' }}>{compact(sum(dir, false) + sum(dir, true))}</Typography>
                <Typography sx={{ fontSize: 11, color: sum(dir, true) > 0.5 ? '#dc2626' : MUTED }}>
                  {sum(dir, true) > 0.5 ? `${compact(sum(dir, true))} already overdue` : 'None overdue'}
                </Typography>
              </Box>
            ))}
          </Box>
          {!rows.length ? <Typography sx={{ fontSize: 13, color: MUTED }}>Nothing falls due this week.</Typography> : (
            <Stack gap={0.25} sx={{ maxHeight: 230, overflowY: 'auto', pr: 0.5 }}>
              {rows.slice(0, 30).map((r) => (
                <Stack
                  key={`${r.dir}-${r._id}`} direction="row" alignItems="center" gap={1}
                  onClick={() => onOpen(r)}
                  sx={{ py: 0.6, px: 0.5, borderRadius: 1.5, cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' } }}
                >
                  {r.dir === 'in' ? <InIcon sx={{ fontSize: 16, color: '#15803d' }} /> : <OutIcon sx={{ fontSize: 16, color: '#b45309' }} />}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{r.party}</Typography>
                    <Typography noWrap sx={{ fontSize: 11, color: r.overdue ? '#dc2626' : MUTED }}>
                      {r.number || 'Document'} · {r.overdue ? `${r.daysOverdue} day${r.daysOverdue === 1 ? '' : 's'} overdue` : `due ${dayLabel(r.dueDate)}`}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{compact(r.balance)}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </>
      )}
    </Panel>
  );
};

const SEVERITY = {
  high: { color: '#dc2626', bg: '#fef2f2', Icon: AlertIcon },
  medium: { color: '#b45309', bg: '#fffbeb', Icon: WarnIcon },
  ok: { color: '#15803d', bg: '#f0fdf4', Icon: OkIcon }
};

/** Everything waiting on Finance, most urgent first; each row links to where it is fixed */
const NeedsAction = ({ actions, ar, ap, bankData, tlData, onGo }) => {
  const items = [];
  if (tlData?.totals && tlData.totals.isBalanced === false) {
    items.push({ sev: 'high', title: 'Books are out of balance', text: `Trial balance debits and credits differ${tlData.totals.difference ? ` by ${full(tlData.totals.difference)}` : ''}`, path: '/finance/trial-balance' });
  }
  const pe = actions?.postingExceptions;
  if (pe?.count) {
    items.push({
      sev: 'high', title: `${pe.count} approved document${pe.count === 1 ? '' : 's'} not posted to Finance`,
      text: [pe.projectDocuments && `${pe.projectDocuments} IPC / client invoice${pe.projectDocuments === 1 ? '' : 's'}`, pe.storeIssues && `${pe.storeIssues} store issue${pe.storeIssues === 1 ? '' : 's'}`].filter(Boolean).join(' · ') + (pe.amount ? ` · ${full(pe.amount)}` : ''),
      path: '/finance/payables-hub'
    });
  }
  const arOver = ar?.totals?.over90 || 0;
  if (arOver > 0.5) items.push({ sev: 'high', title: 'Receivables over 90 days', text: `${full(arOver)} — chase or provide for it`, path: '/finance/aged-receivables' });
  const ba = actions?.billsAwaitingApproval;
  if (ba?.count) {
    items.push({ sev: ba.oldestDays > 7 ? 'high' : 'medium', title: `${ba.count} bill${ba.count === 1 ? '' : 's'} waiting for approval`, text: `${full(ba.amount)}${ba.oldestDays ? ` · oldest ${ba.oldestDays} day${ba.oldestDays === 1 ? '' : 's'}` : ''}`, path: '/finance/accounts-payable' });
  }
  const apOver = overdueOf(ap);
  if (apOver > 0.5) items.push({ sev: 'medium', title: 'Payables past due date', text: `${full(apOver)} across ${(ap.parties || []).filter((p) => p.balance - (p.current || 0) > 0.5).length} vendor(s)`, path: '/finance/aged-payables' });
  const arDue = overdueOf(ar) - arOver;
  if (arDue > 0.5) items.push({ sev: 'medium', title: 'Receivables past due date', text: `${full(arDue)} overdue up to 90 days`, path: '/finance/aged-receivables' });
  const dj = actions?.draftJournals;
  if (dj?.count) {
    items.push({ sev: 'medium', title: `${dj.count} journal${dj.count === 1 ? '' : 's'} / voucher${dj.count === 1 ? '' : 's'} still in draft`, text: `${full(dj.amount)} not yet in the ledger${dj.oldestDays ? ` · oldest ${dj.oldestDays} day${dj.oldestDays === 1 ? '' : 's'}` : ''}`, path: '/finance/journal-entries' });
  }
  if (bankData && Math.abs(bankData.difference || 0) >= 0.01) {
    items.push({ sev: 'medium', title: 'Bank not reconciled', text: `Difference ${full(bankData.difference)}${bankData.unreconciledCount ? ` · ${bankData.unreconciledCount} unreconciled line(s)` : ''}`, path: '/finance/bank-reconciliation' });
  }

  const loading = !actions || !ar || !ap;
  return (
    <Panel
      title="Needs action"
      subtitle={loading ? 'Checking…' : items.length ? `${items.length} item${items.length === 1 ? '' : 's'}, most urgent first` : 'All clear'}
    >
      {loading ? <Skeleton variant="rounded" height={220} /> : !items.length ? (
        <Stack direction="row" alignItems="center" gap={1.25} sx={{ p: 2, borderRadius: 2, bgcolor: SEVERITY.ok.bg }}>
          <OkIcon sx={{ color: SEVERITY.ok.color }} />
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: SEVERITY.ok.color }}>Nothing is waiting on Finance right now.</Typography>
        </Stack>
      ) : (
        <Stack gap={1}>
          {items.map((it) => {
            const s = SEVERITY[it.sev];
            return (
              <Stack
                key={it.title} direction="row" alignItems="center" gap={1.25} onClick={() => onGo(it.path)}
                sx={{ p: 1.25, borderRadius: 2, bgcolor: s.bg, cursor: 'pointer', border: '1px solid transparent', transition: 'all .15s', '&:hover': { borderColor: s.color } }}
              >
                <s.Icon sx={{ color: s.color, fontSize: 20 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: INK }}>{it.title}</Typography>
                  <Typography sx={{ fontSize: 12, color: MUTED }}>{it.text}</Typography>
                </Box>
                <GoIcon sx={{ fontSize: 16, color: s.color }} />
              </Stack>
            );
          })}
        </Stack>
      )}
    </Panel>
  );
};

/**
 * Collections & payments (ageing, top customers / vendors, due this week) and the Needs action
 * list. ar / ap / bankData / tlData are the reports the dashboard already loads.
 */
export default function FinanceWorkQueue({ ar, ap, bankData, tlData, reloadKey }) {
  const navigate = useNavigate();
  const [actions, setActions] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/finance/dashboard/actions');
      setActions(res.data?.data || {});
    } catch {
      setActions({});
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontWeight: 800, color: INK, fontSize: 17 }}>Collections & payments</Typography>
      <Typography sx={{ fontSize: 12.5, color: MUTED, mb: 2 }}>Who owes us, who we owe, and what needs doing</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' } }}>
        <PartyPanel
          title="Receivables" subtitle="customers owing" aging={ar} color="#15803d" emptyText="No customer owes anything."
          onOpen={() => navigate('/finance/aged-receivables')} onAll={() => navigate('/finance/aged-receivables')}
        />
        <PartyPanel
          title="Payables" subtitle="vendors to pay" aging={ap} color="#b45309" emptyText="Nothing owed to vendors."
          onOpen={() => navigate('/finance/aged-payables')} onAll={() => navigate('/finance/aged-payables')}
        />
        <DueThisWeek ar={ar} ap={ap} onOpen={(r) => navigate(r.dir === 'in' ? '/finance/aged-receivables' : '/finance/aged-payables')} />
        <NeedsAction actions={actions} ar={ar} ap={ap} bankData={bankData} tlData={tlData} onGo={(p) => navigate(p)} />
      </Box>
    </Box>
  );
}
