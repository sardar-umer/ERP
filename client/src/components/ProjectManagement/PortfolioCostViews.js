/** Cost Report for each step of the portfolio drill-down: contract, check request, inspection report and IPC. */
import React from 'react';
import { Alert, Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import dayjs from 'dayjs';
import { INK, fmt } from './mainProjectUi';

const MUTED = '#64748b';
const LINE = '#e2e8f0';
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const grow = keyframes`from { transform: scaleX(0); } to { transform: scaleX(1); }`;
const qty = (n, unit) => `${Math.round((Number(n) || 0) * 100) / 100}${unit ? ` ${unit}` : ''}`;

const STEP_COLORS = {
  budget: '#94a3b8', value: '#64748b', contracted: '#6366f1', claimed: '#818cf8', verified: '#0ea5e9', inspected: '#0ea5e9',
  billed: '#f59e0b', approved: '#a855f7', net: '#0369a1', paid: '#22c55e'
};

const Title = ({ children, note }) => (
  <Box sx={{ mt: 2.5, mb: 1 }}>
    <Typography sx={{ fontSize: 13, fontWeight: 900, color: INK }}>{children}</Typography>
    {note && <Typography sx={{ fontSize: 12, color: MUTED }}>{note}</Typography>}
  </Box>
);

/** Money steps as bars, each measured against `base` (the first step unless given) */
export const FlowBars = ({ steps, base }) => {
  const max = base || Math.max(1, ...steps.map((s) => s.value || 0));
  return (
    <Box sx={{ p: 2, borderRadius: 3, border: `1px solid ${LINE}`, bgcolor: '#fcfdff' }}>
      <Stack gap={1.25}>
        {steps.map((s, i) => (
          <Box key={s.label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '130px minmax(0,1fr) 150px' }, gap: { xs: 0.5, sm: 1.5 }, alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK }}>{s.label}</Typography>
            <Box sx={{ height: 12, borderRadius: 6, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
              <Box
                sx={{
                  height: '100%', width: `${Math.min(100, Math.max(s.value ? 1 : 0, ((s.value || 0) / max) * 100))}%`, borderRadius: 6,
                  background: `linear-gradient(90deg, ${s.color}99, ${s.color})`, transformOrigin: 'left',
                  animation: `${grow} .8s ${0.08 * i}s cubic-bezier(.2,.8,.2,1) both`
                }}
              />
            </Box>
            <Typography sx={{ fontSize: 13, textAlign: { sm: 'right' }, color: MUTED, whiteSpace: 'nowrap' }}>
              <Box component="span" sx={{ fontWeight: 900, color: INK }}>{fmt(s.value)}</Box>
              {i > 0 && max > 0 && ` · ${pct(s.value, max)}%`}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

/** Small pills under the flow: retention, advance, remaining… */
const Pills = ({ items }) => (
  <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.25 }}>
    {items.filter(Boolean).map((p) => (
      <Tooltip key={p.label} title={p.hint || ''}>
        <Chip size="small" variant="outlined" label={`${p.label}: ${fmt(p.value)}`} color={p.color || 'default'} sx={{ fontWeight: 700 }} />
      </Tooltip>
    ))}
  </Stack>
);

/** Simple table: columns [{ key, label, align, render, total }] */
const CostTable = ({ columns, rows, totals, minWidth = 640 }) => (
  <Box sx={{ border: `1px solid ${LINE}`, borderRadius: 2.5, overflowX: 'auto' }}>
    <Box component="table" sx={{ width: '100%', minWidth, borderCollapse: 'collapse', fontSize: 13, '& td, & th': { px: 1.25, py: 1, borderTop: `1px solid ${LINE}`, whiteSpace: 'nowrap' } }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <Box component="th" key={c.key} sx={{ textAlign: c.align || 'left', bgcolor: '#f8fafc', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', borderTop: '0 !important' }}>{c.label}</Box>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, n) => (
          <Box component="tr" key={n} sx={{ '&:hover': { bgcolor: '#f8fafc' } }}>
            {columns.map((c) => (
              <Box component="td" key={c.key} sx={{ textAlign: c.align || 'left', fontWeight: c.strong ? 800 : 500, color: INK, maxWidth: c.wrap ? 260 : undefined, whiteSpace: c.wrap ? 'normal !important' : undefined }}>
                {c.render ? c.render(r) : r[c.key]}
              </Box>
            ))}
          </Box>
        ))}
      </tbody>
      {totals && (
        <tfoot>
          <tr>
            {columns.map((c, i) => (
              <Box component="td" key={c.key} sx={{ textAlign: c.align || 'left', fontWeight: 900, bgcolor: '#f8fafc', color: INK }}>
                {i === 0 ? 'Total' : totals[c.key] !== undefined ? fmt(totals[c.key]) : ''}
              </Box>
            ))}
          </tr>
        </tfoot>
      )}
    </Box>
  </Box>
);

const sumOf = (rows, key) => Math.round(rows.reduce((t, r) => t + (Number(r[key]) || 0), 0) * 100) / 100;
const red = (cond, v) => <Box component="span" sx={{ color: cond ? '#dc2626' : 'inherit', fontWeight: cond ? 800 : 'inherit' }}>{v}</Box>;

// ─── Contract ────────────────────────────────────────────────────────────────

export const ContractCost = ({ detail }) => {
  if (!detail) return <Alert severity="info">No cost data for this contract.</Alert>;
  const m = detail.money;
  return (
    <>
      <FlowBars
        base={m.value}
        steps={[
          { label: 'Contract value', value: m.value, color: STEP_COLORS.value },
          { label: 'Verified work', value: m.verified, color: STEP_COLORS.verified },
          { label: 'Billed (IPCs)', value: m.billed, color: STEP_COLORS.billed },
          { label: 'CEO approved', value: m.approved, color: STEP_COLORS.approved },
          { label: 'Net payable', value: m.netPayable, color: STEP_COLORS.net },
          { label: 'Paid', value: m.paid, color: STEP_COLORS.paid }
        ]}
      />
      <Pills items={[
        { label: 'Left to bill', value: m.remaining, color: m.remaining < 0 ? 'error' : undefined, hint: 'Contract value − billed' },
        { label: 'Retention held', value: m.retentionHeld, hint: 'Kept from approved IPCs, not released yet' },
        m.advancePaid ? { label: 'Advance paid', value: m.advancePaid } : null,
        m.advancePaid ? { label: 'Advance recovered', value: m.advanceRecovered } : null,
        m.advanceOutstanding ? { label: 'Advance outstanding', value: m.advanceOutstanding, color: 'warning' } : null,
        m.wht ? { label: 'WHT deducted', value: m.wht } : null,
        { label: 'Owed (net − paid)', value: Math.max(0, m.netPayable - m.paid), color: m.netPayable > m.paid ? 'warning' : 'success' }
      ]}
      />
      {detail.contractType === 'Slab' ? (
        <>
          <Title note="Each slab: its share of the contract, then what was verified, billed, approved and paid">By slab</Title>
          <CostTable
            columns={[
              { key: 'name', label: 'Slab', strong: true },
              { key: 'percentage', label: 'Share', align: 'right', render: (r) => `${r.percentage}%` },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => fmt(r.amount) },
              { key: 'verified', label: 'Verified', align: 'right', render: (r) => fmt(r.verified) },
              { key: 'billed', label: 'Billed', align: 'right', render: (r) => red(r.billed > r.amount + 0.5, fmt(r.billed)) },
              { key: 'approved', label: 'Approved', align: 'right', render: (r) => fmt(r.approved) },
              { key: 'paid', label: 'Paid', align: 'right', render: (r) => fmt(r.paid) }
            ]}
            rows={detail.slabs}
            totals={Object.fromEntries(['amount', 'verified', 'billed', 'approved', 'paid'].map((k) => [k, sumOf(detail.slabs, k)]))}
          />
        </>
      ) : (
        <>
          <Title note="BOQ budget for the line, what this contract covers, and how much of it is verified, billed and approved">By BOQ line</Title>
          {detail.lines.length ? (
            <CostTable
              minWidth={900}
              columns={[
                { key: 'title', label: 'BOQ line', strong: true, wrap: true },
                { key: 'budget', label: 'BOQ budget', align: 'right', render: (r) => (r.budget === null ? '—' : fmt(r.budget)) },
                { key: 'contractedQty', label: 'Qty × rate', align: 'right', render: (r) => `${qty(r.contractedQty, r.unit)} × ${fmt(r.rate)}` },
                { key: 'contracted', label: 'Contracted', align: 'right', render: (r) => red(r.budget !== null && r.contracted > r.budget + 0.5, fmt(r.contracted)) },
                { key: 'verified', label: 'Verified', align: 'right', render: (r) => <Tooltip title={qty(r.verifiedQty, r.unit)}><span>{fmt(r.verified)}</span></Tooltip> },
                { key: 'billed', label: 'Billed', align: 'right', render: (r) => <Tooltip title={qty(r.billedQty, r.unit)}><span>{red(r.billed > r.contracted + 0.5, fmt(r.billed))}</span></Tooltip> },
                { key: 'approved', label: 'Approved', align: 'right', render: (r) => fmt(r.approved) },
                { key: 'remaining', label: 'Left to bill', align: 'right', render: (r) => red(r.remaining < 0, fmt(r.remaining)) }
              ]}
              rows={detail.lines}
              totals={Object.fromEntries(['budget', 'contracted', 'verified', 'billed', 'approved', 'remaining'].map((k) => [k, sumOf(detail.lines, k)]))}
            />
          ) : <Alert severity="info">This contract has no BOQ lines.</Alert>}
        </>
      )}
    </>
  );
};

// ─── Check request ───────────────────────────────────────────────────────────

export const CrCost = ({ detail }) => {
  if (!detail) return <Alert severity="info">No cost data for this check request.</Alert>;
  return (
    <>
      <FlowBars
        base={detail.claimed || detail.verified}
        steps={[
          { label: 'Claimed', value: detail.claimed, color: STEP_COLORS.claimed },
          { label: 'Verified', value: detail.verified, color: STEP_COLORS.verified },
          { label: 'Billed (IPCs)', value: detail.billed, color: STEP_COLORS.billed },
          { label: 'CEO approved', value: detail.approved, color: STEP_COLORS.approved },
          { label: 'Net payable', value: detail.netPayable, color: STEP_COLORS.net },
          { label: 'Paid', value: detail.paid, color: STEP_COLORS.paid }
        ]}
      />
      <Pills items={[
        { label: 'Cut at verification', value: Math.max(0, detail.claimed - detail.verified), color: detail.claimed > detail.verified ? 'warning' : undefined, hint: 'Claimed − verified' },
        { label: 'Verified, not billed', value: Math.max(0, detail.verified - detail.billed) },
        { label: 'Owed (net − paid)', value: Math.max(0, detail.netPayable - detail.paid), color: detail.netPayable > detail.paid ? 'warning' : 'success' }
      ]}
      />
      {detail.claimType === 'Slab' ? (
        <>
          <Title>Slab claimed</Title>
          <CostTable
            columns={[
              { key: 'name', label: 'Slab', strong: true },
              { key: 'percentage', label: 'Share', align: 'right', render: (r) => `${r.percentage}%` },
              { key: 'amount', label: 'Slab amount', align: 'right', render: (r) => fmt(r.amount) },
              { key: 'verified', label: 'Verified', align: 'right', render: () => fmt(detail.verified) },
              { key: 'billed', label: 'Billed', align: 'right', render: () => fmt(detail.billed) }
            ]}
            rows={[detail.slab || {}]}
            minWidth={520}
          />
        </>
      ) : (
        <>
          <Title note="Claimed by the contractor, verified on site, then billed on IPCs">By BOQ line</Title>
          {detail.lines.length ? (
            <CostTable
              minWidth={860}
              columns={[
                { key: 'title', label: 'BOQ line', strong: true, wrap: true },
                { key: 'unitPrice', label: 'Rate', align: 'right', render: (r) => fmt(r.unitPrice) },
                { key: 'claimedQty', label: 'Claimed qty', align: 'right', render: (r) => qty(r.claimedQty, r.unit) },
                { key: 'claimed', label: 'Claimed', align: 'right', render: (r) => fmt(r.claimed) },
                { key: 'verifiedQty', label: 'Verified qty', align: 'right', render: (r) => red(r.verifiedQty < r.claimedQty, qty(r.verifiedQty, r.unit)) },
                { key: 'verified', label: 'Verified', align: 'right', render: (r) => fmt(r.verified) },
                { key: 'billed', label: 'Billed', align: 'right', render: (r) => <Tooltip title={qty(r.billedQty, r.unit)}><span>{fmt(r.billed)}</span></Tooltip> }
              ]}
              rows={detail.lines}
              totals={Object.fromEntries(['claimed', 'verified', 'billed'].map((k) => [k, sumOf(detail.lines, k)]))}
            />
          ) : <Alert severity="info">This check request has no BOQ lines.</Alert>}
        </>
      )}
    </>
  );
};

// ─── Inspection report ───────────────────────────────────────────────────────

export const IrCost = ({ ir }) => {
  const isSlab = ir.claimType === 'Slab';
  const lines = (ir.items || []).map((it) => ({
    ...it,
    claimed: Math.round(it.claimedQuantity * it.unitPrice * 100) / 100,
    inspected: Math.round(it.inspectedQuantity * it.unitPrice * 100) / 100
  })).map((l) => ({ ...l, difference: Math.round((l.inspected - l.claimed) * 100) / 100 }));
  const claimed = isSlab ? Number(ir.slab?.amount) || 0 : sumOf(lines, 'claimed');
  const inspected = Number(ir.inspectedTotal) || (isSlab ? 0 : sumOf(lines, 'inspected'));
  return (
    <>
      <FlowBars
        base={claimed || inspected}
        steps={[
          { label: isSlab ? 'Slab amount' : 'Claimed', value: claimed, color: STEP_COLORS.claimed },
          { label: 'Inspected', value: inspected, color: STEP_COLORS.inspected }
        ]}
      />
      <Pills items={[
        { label: 'Difference', value: inspected - claimed, color: inspected < claimed ? 'error' : 'success', hint: 'Inspected − claimed' }
      ]}
      />
      {isSlab ? (
        <Title note={`${ir.slab?.name || 'Slab'} · ${ir.slab?.percentage || 0}% of the contract`}>Slab inspected</Title>
      ) : (
        <>
          <Title note="Claimed quantity against what the inspectors measured on site">By BOQ line</Title>
          {lines.length ? (
            <CostTable
              minWidth={820}
              columns={[
                { key: 'title', label: 'BOQ line', strong: true, wrap: true },
                { key: 'unitPrice', label: 'Rate', align: 'right', render: (r) => fmt(r.unitPrice) },
                { key: 'claimedQuantity', label: 'Claimed qty', align: 'right', render: (r) => qty(r.claimedQuantity, r.unit) },
                { key: 'inspectedQuantity', label: 'Inspected qty', align: 'right', render: (r) => red(r.inspectedQuantity < r.claimedQuantity, qty(r.inspectedQuantity, r.unit)) },
                { key: 'claimed', label: 'Claimed', align: 'right', render: (r) => fmt(r.claimed) },
                { key: 'inspected', label: 'Inspected', align: 'right', render: (r) => fmt(r.inspected) },
                { key: 'difference', label: 'Difference', align: 'right', render: (r) => red(r.difference < 0, fmt(r.difference)) }
              ]}
              rows={lines}
              totals={Object.fromEntries(['claimed', 'inspected', 'difference'].map((k) => [k, sumOf(lines, k)]))}
            />
          ) : <Alert severity="info">No BOQ lines on this report.</Alert>}
        </>
      )}
    </>
  );
};

// ─── IPC ─────────────────────────────────────────────────────────────────────

/** Gross → deductions → net payable, as a statement */
const Statement = ({ d }) => {
  const rows = [
    { label: 'Gross amount', value: d.gross, strong: true },
    d.retention ? { label: `Less retention${d.retentionPercentage ? ` (${d.retentionPercentage}%)` : ''}`, value: -d.retention } : null,
    d.advanceRecovery ? { label: 'Less advance recovery', value: -d.advanceRecovery } : null,
    d.wht ? { label: `Less WHT${d.whtPercentage ? ` (${d.whtPercentage}%)` : ''}`, value: -d.wht } : null,
    { label: 'Net payable', value: d.net, strong: true, line: true },
    { label: 'Paid', value: d.paid, tone: '#15803d' },
    { label: 'Balance to pay', value: d.balance, strong: true, tone: d.balance > 0 ? '#b45309' : '#15803d', line: true }
  ].filter(Boolean);
  return (
    <Box sx={{ p: 2, borderRadius: 3, border: `1px solid ${LINE}`, bgcolor: '#fcfdff' }}>
      {rows.map((r) => (
        <Stack key={r.label} direction="row" justifyContent="space-between" sx={{ py: 0.75, borderTop: r.line ? `1px dashed ${LINE}` : 'none', mt: r.line ? 0.5 : 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: r.strong ? 900 : 600, color: INK }}>{r.label}</Typography>
          <Typography sx={{ fontSize: 14, fontWeight: r.strong ? 900 : 700, color: r.tone || (r.value < 0 ? '#dc2626' : INK) }}>
            {r.value < 0 ? `− ${fmt(-r.value)}` : fmt(r.value)}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
};

export const IpcCost = ({ detail }) => {
  if (!detail) return <Alert severity="info">No cost data for this IPC.</Alert>;
  return (
    <>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: detail.contractValue ? '1fr 1fr' : '1fr' } }}>
        <Statement d={detail} />
        {detail.contractValue !== null && detail.billedToDate !== null && (
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 900, color: INK, mb: 1 }}>Where this leaves the contract</Typography>
            <FlowBars
              base={detail.contractValue}
              steps={[
                { label: 'Contract value', value: detail.contractValue, color: STEP_COLORS.value },
                { label: 'Billed before', value: Math.max(0, detail.billedToDate - detail.gross), color: '#cbd5e1' },
                { label: 'This IPC', value: detail.gross, color: STEP_COLORS.billed },
                { label: 'Left to bill', value: Math.max(0, detail.contractValue - detail.billedToDate), color: STEP_COLORS.paid }
              ]}
            />
          </Box>
        )}
      </Box>
      {detail.lines.length > 0 && (
        <>
          <Title note="Quantity billed before, on this IPC and to date">By BOQ line</Title>
          <CostTable
            minWidth={780}
            columns={[
              { key: 'title', label: 'BOQ line', strong: true, wrap: true },
              { key: 'previousQty', label: 'Previous', align: 'right', render: (r) => qty(r.previousQty, r.unit) },
              { key: 'currentQty', label: 'This IPC', align: 'right', render: (r) => qty(r.currentQty, r.unit) },
              { key: 'cumulativeQty', label: 'To date', align: 'right', render: (r) => qty(r.cumulativeQty, r.unit) },
              { key: 'unitPrice', label: 'Rate', align: 'right', render: (r) => fmt(r.unitPrice) },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => fmt(r.amount) }
            ]}
            rows={detail.lines}
            totals={{ amount: sumOf(detail.lines, 'amount') }}
          />
        </>
      )}
      <Title note={detail.payments.length ? undefined : 'Finance has not paid this IPC yet'}>Payments</Title>
      {detail.payments.length > 0 && (
        <CostTable
          minWidth={520}
          columns={[
            { key: 'paidDate', label: 'Date', render: (r) => (r.paidDate ? dayjs(r.paidDate).format('DD MMM YYYY') : '—') },
            { key: 'method', label: 'Method', render: (r) => r.method || '—' },
            { key: 'reference', label: 'Reference', render: (r) => r.reference || '—' },
            { key: 'amount', label: 'Amount', align: 'right', strong: true, render: (r) => fmt(r.amount) }
          ]}
          rows={detail.payments}
          totals={{ amount: sumOf(detail.payments, 'amount') }}
        />
      )}
    </>
  );
};
