import React from 'react';
import { Box, Chip, Divider, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { CheckCircleOutline as BalancedIcon, ErrorOutline as UnbalancedIcon } from '@mui/icons-material';
import dayjs from 'dayjs';

/** Shared building blocks for the Payables document and payment pages (one layout for every payable). */

export const money = (v) =>
  new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0));

export const fmtDate = (d) => (d ? dayjs(d).format('DD/MM/YYYY') : '—');
const fmtDateTime = (d) => (d ? dayjs(d).format('DD/MM/YYYY h:mm A') : '');

const STATUS_COLOR = {
  paid: 'success', Posted: 'success', posted: 'success', 'Payment Settled': 'success', Completed: 'success', Approved: 'success',
  partial: 'warning', 'In approval': 'info', 'Pending Finance': 'warning', 'Finance Authority Approved': 'info',
  overdue: 'error', Rejected: 'error', reversed: 'error', cancelled: 'default', Draft: 'default', draft: 'default'
};
const STATUS_LABEL = {
  paid: 'Paid', partial: 'Partially paid', approved: 'Approved', overdue: 'Overdue', received: 'Received',
  draft: 'Draft', cancelled: 'Cancelled', posted: 'Posted', reversed: 'Reversed'
};

export const StatusChip = ({ status }) => (
  <Chip size="small" label={STATUS_LABEL[status] || status} color={STATUS_COLOR[status] || 'default'}
    variant="outlined" sx={{ fontWeight: 600, borderRadius: 1 }} />
);

const labelSx = { textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.secondary', fontWeight: 600, fontSize: 11 };
const headSx = { '& th': { ...labelSx, bgcolor: 'action.hover', py: 1 } };

/** Card with an optional heading row (title, small count/subtitle, right-hand note or element) */
export const Card = ({ title, count, subtitle, right, children, sx }) => (
  <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2, overflow: 'hidden', ...sx }}>
    {title && (
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}
        sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {title}
            {count != null && <Typography component="span" variant="body2" color="text.secondary"> ({count})</Typography>}
          </Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {right && (typeof right === 'string'
          ? <Typography variant="caption" color="text.secondary">{right}</Typography>
          : right)}
      </Stack>
    )}
    {children}
  </Paper>
);

const fieldValue = (f) => {
  if (f.type === 'date') return fmtDate(f.value);
  if (f.type === 'user') {
    const [name, meta] = Array.isArray(f.value) ? f.value : [f.value];
    return [name || '—', meta?.date ? fmtDateTime(meta.date) : ''].filter(Boolean).join(' · ');
  }
  return f.value ?? '—';
};

const Field = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={labelSx}>{label}</Typography>
    <Typography variant="body2" sx={{ mt: 0.25, wordBreak: 'break-word' }}>{children}</Typography>
  </Box>
);

/** Uppercase label / value grid, five per row on desktop; `links` render as a "Linked documents" row */
export const InfoCard = ({ title, fields = [], links = [] }) => (
  <Card title={title}>
    <Box sx={{ p: 2.5, display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' } }}>
      {fields.map((f) => <Field key={f.label} label={f.label}>{fieldValue(f)}</Field>)}
    </Box>
    {links.length > 0 && (
      <Box sx={{ px: 2.5, pb: 2 }}>
        <Typography sx={{ ...labelSx, mb: 0.75 }}>Linked documents</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {links.map((l) => <Chip key={`${l.type}-${l.number}`} size="small" variant="outlined" label={`${l.type} ${l.number}`} />)}
        </Stack>
      </Box>
    )}
  </Card>
);

/** Table card: columns [{ key, label, align, render }] */
export const TableCard = ({ title, subtitle, right, columns, rows, empty = 'Nothing yet', onRowClick, footer }) => (
  <Card title={title} count={title ? rows.length : null} subtitle={subtitle} right={right}>
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead sx={headSx}>
          <TableRow>{columns.map((c) => <TableCell key={c.key} align={c.align} sx={c.width ? { width: c.width } : undefined}>{c.label}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.key || i} hover={Boolean(onRowClick)} onClick={onRowClick ? () => onRowClick(r) : undefined}
              sx={{ cursor: onRowClick ? 'pointer' : 'default', '& td': { py: 1.25 } }}>
              {columns.map((c) => <TableCell key={c.key} align={c.align}>{c.render ? c.render(r) : r[c.key]}</TableCell>)}
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow><TableCell colSpan={columns.length} align="center"><Typography variant="body2" color="text.secondary" py={1.5}>{empty}</Typography></TableCell></TableRow>
          )}
          {rows.length > 0 && footer}
        </TableBody>
      </Table>
    </Box>
  </Card>
);

/** Right-aligned summary lines (bold lines get a rule above); `left` holds notes */
export const TotalsCard = ({ title, lines = [], left }) => (
  <Card title={title}>
    <Stack direction={{ xs: 'column', md: 'row' }} sx={{ p: 2.5 }} gap={3}>
      <Box sx={{ flex: 1 }}>{left}</Box>
      <Box sx={{ width: { xs: '100%', md: 420 } }}>
        {lines.map((l) => (
          <React.Fragment key={l.label}>
            {l.bold && <Divider sx={{ my: 1 }} />}
            <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
              <Typography variant={l.bold ? 'subtitle1' : 'body2'} fontWeight={l.bold ? 600 : 400} color={l.muted ? 'text.secondary' : 'text.primary'}>{l.label}</Typography>
              <Typography variant={l.bold ? 'subtitle1' : 'body2'} fontWeight={600} color={l.muted ? 'text.secondary' : 'text.primary'}
                sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {money(l.amount)}
              </Typography>
            </Stack>
          </React.Fragment>
        ))}
      </Box>
    </Stack>
  </Card>
);

export const NotesBlock = ({ notes }) => (notes ? (
  <>
    <Typography sx={labelSx}>Notes</Typography>
    <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{notes}</Typography>
  </>
) : null);

const amountCell = { fontVariantNumeric: 'tabular-nums', width: 150 };

/**
 * Accounting entry (one voucher): heading with voucher number and status, a meta row (date, reference, company,
 * prepared / posted by, narration), then debit lines before credit lines with account code and name, and a totals
 * row that says whether the entry balances.
 */
export const JournalCard = ({ journal, title = 'Accounting entry' }) => {
  const lines = [...journal.lines].sort((a, b) => (b.debit > 0) - (a.debit > 0));
  const diff = Math.round((journal.totalDebit - journal.totalCredit) * 100) / 100;
  const meta = [
    { label: 'Voucher', value: journal.number || '—' },
    { label: 'Date', value: fmtDate(journal.date) },
    { label: 'Reference', value: journal.reference || '—' },
    ...(journal.company ? [{ label: 'Company', value: journal.company }] : []),
    { label: 'Prepared by', value: [journal.createdBy || (journal.isAutoGenerated ? 'System' : '—'), fmtDateTime(journal.createdAt)].filter(Boolean).join(' · ') },
    ...(journal.postedBy ? [{ label: 'Posted by', value: [journal.postedBy, fmtDateTime(journal.postedAt)].filter(Boolean).join(' · ') }] : [])
  ];
  return (
    <Card
      title={title}
      subtitle={journal.isAutoGenerated ? 'Posted automatically' : 'Manual entry'}
      right={<StatusChip status={journal.status} />}
    >
      <Box sx={{ px: 2.5, py: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${meta.length}, minmax(0, 1fr))` } }}>
        {meta.map((m) => <Field key={m.label} label={m.label}>{m.value}</Field>)}
      </Box>
      {journal.description && (
        <Box sx={{ px: 2.5, pb: 2 }}>
          <Typography sx={labelSx}>Narration</Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>{journal.description}</Typography>
        </Box>
      )}
      <Box sx={{ overflowX: 'auto', borderTop: 1, borderColor: 'divider' }}>
        <Table size="small">
          <TableHead sx={headSx}>
            <TableRow>
              <TableCell sx={{ width: 110 }}>Code</TableCell>
              <TableCell>Account</TableCell>
              <TableCell>Line description</TableCell>
              <TableCell align="right" sx={amountCell}>Debit</TableCell>
              <TableCell align="right" sx={amountCell}>Credit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i} sx={{ '& td': { py: 1.25 } }}>
                <TableCell sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{l.accountCode || '—'}</TableCell>
                {/* Credit lines are indented, as in a written journal ("To …") */}
                <TableCell sx={{ pl: l.debit > 0 ? 2 : 5 }}>{l.accountName}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {l.description && l.description !== l.accountName && l.description !== journal.description ? l.description : ''}
                </TableCell>
                <TableCell align="right" sx={amountCell}>{l.debit ? money(l.debit) : ''}</TableCell>
                <TableCell align="right" sx={amountCell}>{l.credit ? money(l.credit) : ''}</TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ '& td': { fontWeight: 600, py: 1.25, borderTop: 2, borderColor: 'divider', borderBottom: 0 } }}>
              <TableCell colSpan={3}>
                <Stack direction="row" alignItems="center" gap={1}>
                  Total
                  {Math.abs(diff) < 0.01 ? (
                    <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: 'success.main', fontWeight: 400 }}>
                      <BalancedIcon sx={{ fontSize: 16 }} /><Typography variant="caption">Balanced</Typography>
                    </Stack>
                  ) : (
                    <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: 'error.main', fontWeight: 400 }}>
                      <UnbalancedIcon sx={{ fontSize: 16 }} /><Typography variant="caption">Difference {money(Math.abs(diff))}</Typography>
                    </Stack>
                  )}
                </Stack>
              </TableCell>
              <TableCell align="right" sx={amountCell}>{money(journal.totalDebit)}</TableCell>
              <TableCell align="right" sx={amountCell}>{money(journal.totalCredit)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Box>
    </Card>
  );
};

/** Section heading between groups of cards */
export const SectionHeading = ({ children }) => (
  <Typography variant="overline" sx={{ display: 'block', color: 'text.secondary', fontWeight: 700, letterSpacing: 1, mt: 1, mb: 1 }}>
    {children}
  </Typography>
);

export const ActionBar = ({ children }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
    {children}
  </Paper>
);
