import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Collapse, FormControl, IconButton, InputAdornment, InputLabel, LinearProgress, MenuItem,
  Paper, Select, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableRow,
  TextField, ToggleButton, ToggleButtonGroup, Typography
} from '@mui/material';
import {
  AccountTree as SubIcon, ArrowForward as ArrowIcon, ChevronRight as CollapsedIcon, Description as ContractIcon,
  Download as DownloadIcon, ExpandMore as ExpandIcon, Engineering as ContractorIcon, FilterAltOff as ClearIcon,
  Refresh as RefreshIcon, Search as SearchIcon, Timeline as PipelineIcon, Category as TypeIcon, Place as SectorIcon,
  ListAlt as LinesIcon
} from '@mui/icons-material';
import { getProjectCostAnalysis, getProjectCostReport } from '../../services/projectManagementService';
import SubCostLines from './SubCostLines';
import {
  ACCENT, BORDER, CONTRACT_STATUS_COLOR, CR_STATUS_COLOR, ContractTypeTag, Empty, INK, IPC_APPROVAL_COLOR,
  Label, SOFT, fmt, plural, progressColor
} from './mainProjectUi';

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const sumBy = (list, f) => Math.round(list.reduce((t, x) => t + (Number(f(x)) || 0), 0) * 100) / 100;
const contractorKey = (r) => (r.contractor?._id ? String(r.contractor._id) : 'none');
const contractorName = (r) => r.contractor?.name || 'No contractor';
const typeLabel = (r) => (!r.contract ? 'No contract' : r.contract.type === 'Slab' ? 'Slab-wise' : 'BOQ-wise');
const PROJECT_TYPE_LABEL = { 'INFRASTRUCTURE DEVELOPMENT': 'Infrastructure Development', COMMERCIAL: 'Commercial', VILLAS: 'Villas' };
const projectTypeLabel = (t) => PROJECT_TYPE_LABEL[t] || t || 'Other';
const sectorLabel = (s) => s || 'No sector';

const CR_STAGES = ['Draft', 'Submitted', 'Verified', 'Billed'];
const IPC_STAGES = ['Draft', 'Pending Audit', 'Forwarded to Audit Director', 'Send to CEO Office', 'Forwarded to CEO', 'Approved'];

/** Roll a set of contract rows up into counts and money */
const rollup = (rows) => {
  const contracts = rows.filter((r) => r.contract);
  return {
    contracts: contracts.length,
    boq: contracts.filter((r) => r.contract.type !== 'Slab').length,
    slab: contracts.filter((r) => r.contract.type === 'Slab').length,
    value: sumBy(contracts, (r) => r.contract.value),
    checkRequests: sumBy(rows, (r) => r.checkRequests.count),
    verified: sumBy(rows, (r) => r.checkRequests.verified),
    ipcs: sumBy(rows, (r) => r.ipcs.count),
    billed: sumBy(rows, (r) => r.ipcs.billed),
    approved: sumBy(rows, (r) => r.ipcs.approved),
    paid: sumBy(rows, (r) => r.ipcs.paid),
    outstanding: sumBy(rows, (r) => r.outstanding)
  };
};

const mergeCounts = (rows, pick) => rows.reduce((acc, r) => {
  Object.entries(pick(r) || {}).forEach(([k, n]) => { acc[k] = (acc[k] || 0) + n; });
  return acc;
}, {});

/** CSV download of whatever the current view shows */
const downloadCsv = (filename, headers, lines) => {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...lines].map((l) => l.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const countText = (counts) => Object.entries(counts || {}).map(([k, n]) => `${n} ${k}`).join('; ');

// ─── Small pieces ─────────────────────────────────────────────────────────────
/** "1 Billed · 2 Draft" style chips from a { status: count } map */
const CountChips = ({ counts, colors }) => {
  const entries = Object.entries(counts || {});
  if (!entries.length) return null;
  return (
    <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
      {entries.map(([status, n]) => (
        <Chip key={status} size="small" variant="outlined" label={`${n} ${status}`} color={colors[status] || 'default'} sx={{ height: 20, fontSize: 11 }} />
      ))}
    </Stack>
  );
};

const Kpi = ({ label, value, hint, color }) => (
  <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: SOFT, border: `1px solid ${BORDER}` }}>
    <Label>{label}</Label>
    <Typography variant="h6" fontWeight={800} sx={{ color: color || INK, lineHeight: 1.3 }}>{fmt(value)}</Typography>
    {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
  </Box>
);

const headSx = { '& th': { bgcolor: SOFT, color: 'text.secondary', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' } };
const footSx = { '& td': { fontWeight: 800, color: INK, fontSize: 13, borderBottom: 0, bgcolor: SOFT } };

const ExpandCell = ({ open, onClick }) => (
  <TableCell padding="checkbox" sx={{ pl: 1 }}>
    <IconButton size="small" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {open ? <ExpandIcon fontSize="small" /> : <CollapsedIcon fontSize="small" />}
    </IconButton>
  </TableCell>
);

const ContractsCell = ({ r }) => (
  <TableCell>
    <Typography variant="body2" fontWeight={700}>{r.contracts}</Typography>
    {r.contracts > 0 && (
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        {[r.boq && `${r.boq} BOQ-wise`, r.slab && `${r.slab} Slab-wise`].filter(Boolean).join(' · ')}
      </Typography>
    )}
  </TableCell>
);

const ContractLabel = ({ r }) => (r.contract ? (
  <>
    <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap">
      <Typography variant="body2" fontWeight={700}>{r.contract.contractNumber}</Typography>
      <ContractTypeTag type={r.contract.type} />
    </Stack>
    <Chip size="small" variant="outlined" label={r.contract.status} color={CONTRACT_STATUS_COLOR[r.contract.status] || 'default'} sx={{ mt: 0.5, height: 20, fontSize: 11 }} />
  </>
) : <Chip size="small" label="No contract" />);

const useToggleSet = () => {
  const [open, setOpen] = useState(new Set());
  const toggle = (id) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return [open, toggle];
};

/** Contract-level rows shown when a Sub Project or contractor is expanded */
const ContractBreakdown = ({ rows, firstColumn, onOpen }) => (
  <Box sx={{ m: 1.5, mt: 0.5, borderRadius: 2, border: `1px solid ${BORDER}`, overflow: 'hidden', bgcolor: '#fff' }}>
    <Table size="small">
      <TableHead>
        <TableRow sx={headSx}>
          <TableCell>{firstColumn === 'sub' ? 'Sub Project' : 'Contractor'}</TableCell>
          <TableCell>Sublet Contract</TableCell>
          <TableCell align="right">Value</TableCell>
          <TableCell>Check Requests</TableCell>
          <TableCell>IPCs</TableCell>
          <TableCell align="right">Billed</TableCell>
          <TableCell align="right">Approved</TableCell>
          <TableCell align="right">Paid</TableCell>
          <TableCell align="right">Outstanding</TableCell>
          <TableCell align="right">Left to bill</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r._id} hover sx={{ verticalAlign: 'top', cursor: 'pointer' }} onClick={() => onOpen(r)}>
            <TableCell>
              <Typography variant="body2" fontWeight={700}>{firstColumn === 'sub' ? r.subProject?.name : contractorName(r)}</Typography>
            </TableCell>
            <TableCell><ContractLabel r={r} /></TableCell>
            <TableCell align="right">{r.contract ? fmt(r.contract.value) : '—'}</TableCell>
            <TableCell>
              <Typography variant="body2" fontWeight={700}>{r.checkRequests.count}</Typography>
              <CountChips counts={r.checkRequests.byStatus} colors={CR_STATUS_COLOR} />
            </TableCell>
            <TableCell>
              <Typography variant="body2" fontWeight={700}>{r.ipcs.count}</Typography>
              <CountChips counts={r.ipcs.byApproval} colors={IPC_APPROVAL_COLOR} />
            </TableCell>
            <TableCell align="right">{fmt(r.ipcs.billed)}</TableCell>
            <TableCell align="right">{fmt(r.ipcs.approved)}</TableCell>
            <TableCell align="right">{fmt(r.ipcs.paid)}</TableCell>
            <TableCell align="right" sx={{ color: r.outstanding > 0 ? 'warning.dark' : undefined }}>{fmt(r.outstanding)}</TableCell>
            <TableCell align="right">{r.remaining === null ? '—' : fmt(r.remaining)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Box>
);

// ─── Groupings (shared by the views and CSV export) ───────────────────────────
/**
 * Sub Project groups. Unfiltered, money comes from the cost report (same as the KPIs).
 * When narrowed to a contractor or contract type, money is summed from the matching contracts only
 * (budget and variance belong to the whole Sub Project, so they are left out).
 */
const buildSubGroups = (subs, rows, narrowed) => subs
  .map((s) => {
    const subRows = rows.filter((r) => String(r.subProject?._id) === String(s._id));
    const r = rollup(subRows);
    return {
      sub: s,
      rows: subRows,
      contractors: [...new Set(subRows.map((x) => x.contractor?.name).filter(Boolean))],
      ...r,
      money: narrowed
        ? { budget: null, contracted: r.value, verified: r.verified, billed: r.billed, approved: r.approved, paid: r.paid, variance: null }
        : { budget: s.budget, contracted: s.contracted, verified: s.verified, billed: s.billed, approved: s.approved, paid: s.paid, variance: s.variance }
    };
  })
  .filter((g) => !narrowed || g.rows.length);

const buildContractorGroups = (rows) => {
  const byKey = new Map();
  rows.forEach((r) => {
    const key = contractorKey(r);
    if (!byKey.has(key)) byKey.set(key, { key, name: contractorName(r), rows: [] });
    byKey.get(key).rows.push(r);
  });
  return [...byKey.values()]
    .map((g) => ({
      ...g,
      ...rollup(g.rows),
      subProjects: [...new Map(g.rows.filter((r) => r.subProject).map((r) => [String(r.subProject._id), r.subProject.name])).values()],
      crStatus: mergeCounts(g.rows, (r) => r.checkRequests.byStatus),
      ipcApproval: mergeCounts(g.rows, (r) => r.ipcs.byApproval)
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
};

const sortContracts = (rows) => [...rows].sort((a, b) =>
  (a.subProject?.name || '').localeCompare(b.subProject?.name || '')
  || (a.contract?.contractNumber || 'zzz').localeCompare(b.contract?.contractNumber || 'zzz'));

/** Pipeline stages: [{ group, stage, count, amount, rows: [{ row, count, amount }] }] */
const buildPipeline = (rows) => {
  const stage = (group, name, countOf, amountOf) => {
    const hits = rows.map((r) => ({ row: r, count: countOf(r) || 0, amount: amountOf(r) || 0 })).filter((h) => h.count > 0 || h.amount > 0);
    return { group, stage: name, count: sumBy(hits, (h) => h.count), amount: sumBy(hits, (h) => h.amount), rows: hits };
  };
  return [
    ...[...CR_STAGES, 'Rejected'].map((s) => stage('Check Requests', s, (r) => r.checkRequests.byStatus[s], (r) => r.checkRequests.byStatusAmount?.[s])),
    ...[...IPC_STAGES, 'Rejected'].map((s) => stage('IPC Approval', s, (r) => r.ipcs.byApproval[s], (r) => r.ipcs.byApprovalAmount?.[s])),
    stage('Payment', 'Approved, unpaid', () => 0, (r) => r.outstanding),
    stage('Payment', 'Paid', () => 0, (r) => r.ipcs.paid)
  ];
};

// ─── Views ────────────────────────────────────────────────────────────────────
const BySubProject = ({ groups, narrowed, onOpen }) => {
  const [open, toggle] = useToggleSet();
  if (!groups.length) return <Empty>No sub projects match.</Empty>;
  const total = (f) => sumBy(groups, f);
  const money = (v) => (v === null ? '—' : fmt(v));

  return (
    <TableContainer sx={{ border: `1px solid ${BORDER}`, borderRadius: 2 }}>
      <Table size="small" sx={{ minWidth: 1100 }}>
        <TableHead>
          <TableRow sx={headSx}>
            <TableCell padding="checkbox" />
            <TableCell>Sub Project</TableCell>
            <TableCell>Contractors</TableCell>
            <TableCell>Contracts</TableCell>
            <TableCell align="right">Check Req.</TableCell>
            <TableCell align="right">IPCs</TableCell>
            <TableCell align="right">Budget</TableCell>
            <TableCell align="right">Contracted</TableCell>
            <TableCell align="right">Verified</TableCell>
            <TableCell align="right">Billed</TableCell>
            <TableCell align="right">Approved</TableCell>
            <TableCell align="right">Paid</TableCell>
            <TableCell align="right">Outstanding</TableCell>
            <TableCell align="right">Variance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            const id = String(g.sub._id);
            const isOpen = open.has(id);
            return (
              <React.Fragment key={id}>
                <TableRow hover onClick={() => toggle(id)} sx={{ cursor: 'pointer', verticalAlign: 'top', '& > td': { borderBottom: isOpen ? 0 : undefined } }}>
                  <ExpandCell open={isOpen} onClick={() => toggle(id)} />
                  <TableCell>
                    <Typography variant="body2" fontWeight={800} sx={{ color: INK }}>{g.sub.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{g.sub.projectNumber} · {g.sub.progress}% done</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{g.contractors.length}</Typography>
                    <Typography variant="caption" color="text.secondary">{g.contractors.join(', ')}</Typography>
                  </TableCell>
                  <ContractsCell r={g} />
                  <TableCell align="right">{g.checkRequests}</TableCell>
                  <TableCell align="right">{g.ipcs}</TableCell>
                  <TableCell align="right">{money(g.money.budget)}</TableCell>
                  <TableCell align="right">{fmt(g.money.contracted)}</TableCell>
                  <TableCell align="right">{fmt(g.money.verified)}</TableCell>
                  <TableCell align="right">{fmt(g.money.billed)}</TableCell>
                  <TableCell align="right">{fmt(g.money.approved)}</TableCell>
                  <TableCell align="right">{fmt(g.money.paid)}</TableCell>
                  <TableCell align="right" sx={{ color: g.outstanding > 0 ? 'warning.dark' : undefined }}>{fmt(g.outstanding)}</TableCell>
                  <TableCell align="right" sx={{ color: g.money.variance === null ? undefined : g.money.variance > 0 ? 'error.main' : 'success.main' }}>{money(g.money.variance)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={14} sx={{ p: 0, bgcolor: SOFT, borderBottom: isOpen ? undefined : 0 }}>
                    <Collapse in={isOpen} unmountOnExit>
                      {g.rows.length
                        ? <ContractBreakdown rows={g.rows} firstColumn="contractor" onOpen={onOpen} />
                        : <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">No sublet contracts on this sub project yet.</Typography></Box>}
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow sx={footSx}>
            <TableCell />
            <TableCell>Total ({plural(groups.length, 'sub project')})</TableCell>
            <TableCell>{new Set(groups.flatMap((g) => g.contractors)).size}</TableCell>
            <TableCell>{total((g) => g.contracts)}</TableCell>
            <TableCell align="right">{total((g) => g.checkRequests)}</TableCell>
            <TableCell align="right">{total((g) => g.ipcs)}</TableCell>
            <TableCell align="right">{narrowed ? '—' : fmt(total((g) => g.money.budget))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.money.contracted))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.money.verified))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.money.billed))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.money.approved))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.money.paid))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.outstanding))}</TableCell>
            <TableCell align="right">{narrowed ? '—' : fmt(total((g) => g.money.variance))}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  );
};

const ByContractor = ({ groups, onOpen }) => {
  const [open, toggle] = useToggleSet();
  if (!groups.length) return <Empty>No contractors match.</Empty>;
  const total = (f) => sumBy(groups, f);

  return (
    <TableContainer sx={{ border: `1px solid ${BORDER}`, borderRadius: 2 }}>
      <Table size="small" sx={{ minWidth: 1100 }}>
        <TableHead>
          <TableRow sx={headSx}>
            <TableCell padding="checkbox" />
            <TableCell>Contractor</TableCell>
            <TableCell>Sub Projects</TableCell>
            <TableCell>Contracts</TableCell>
            <TableCell>Check Requests</TableCell>
            <TableCell>IPCs</TableCell>
            <TableCell align="right">Contract Value</TableCell>
            <TableCell align="right">Billed</TableCell>
            <TableCell align="right">Approved</TableCell>
            <TableCell align="right">Paid</TableCell>
            <TableCell align="right">Outstanding</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            const isOpen = open.has(g.key);
            return (
              <React.Fragment key={g.key}>
                <TableRow hover onClick={() => toggle(g.key)} sx={{ cursor: 'pointer', verticalAlign: 'top', '& > td': { borderBottom: isOpen ? 0 : undefined } }}>
                  <ExpandCell open={isOpen} onClick={() => toggle(g.key)} />
                  <TableCell>
                    <Typography variant="body2" fontWeight={800} sx={{ color: INK }}>{g.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{pct(g.paid, g.billed)}% of billed paid</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{g.subProjects.length}</Typography>
                    <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                      {g.subProjects.map((n) => <Chip key={n} size="small" label={n} sx={{ height: 20, fontSize: 11 }} />)}
                    </Stack>
                  </TableCell>
                  <ContractsCell r={g} />
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{g.checkRequests}</Typography>
                    <CountChips counts={g.crStatus} colors={CR_STATUS_COLOR} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{g.ipcs}</Typography>
                    <CountChips counts={g.ipcApproval} colors={IPC_APPROVAL_COLOR} />
                  </TableCell>
                  <TableCell align="right">{fmt(g.value)}</TableCell>
                  <TableCell align="right">{fmt(g.billed)}</TableCell>
                  <TableCell align="right">{fmt(g.approved)}</TableCell>
                  <TableCell align="right">{fmt(g.paid)}</TableCell>
                  <TableCell align="right" sx={{ color: g.outstanding > 0 ? 'warning.dark' : undefined }}>{fmt(g.outstanding)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={11} sx={{ p: 0, bgcolor: SOFT, borderBottom: isOpen ? undefined : 0 }}>
                    <Collapse in={isOpen} unmountOnExit>
                      <ContractBreakdown rows={g.rows} firstColumn="sub" onOpen={onOpen} />
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow sx={footSx}>
            <TableCell />
            <TableCell>Total ({plural(groups.length, 'contractor')})</TableCell>
            <TableCell />
            <TableCell>{total((g) => g.contracts)}</TableCell>
            <TableCell>{total((g) => g.checkRequests)}</TableCell>
            <TableCell>{total((g) => g.ipcs)}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.value))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.billed))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.approved))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.paid))}</TableCell>
            <TableCell align="right">{fmt(total((g) => g.outstanding))}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  );
};

/** Every contract on its own line, across all Sub Projects */
const ByContract = ({ rows, onOpen }) => {
  if (!rows.length) return <Empty>No contracts match.</Empty>;
  const total = (f) => sumBy(rows, f);
  return (
    <TableContainer sx={{ border: `1px solid ${BORDER}`, borderRadius: 2 }}>
      <Table size="small" sx={{ minWidth: 1200 }}>
        <TableHead>
          <TableRow sx={headSx}>
            <TableCell>Sublet Contract</TableCell>
            <TableCell>Sub Project</TableCell>
            <TableCell>Contractor</TableCell>
            <TableCell align="right">Value</TableCell>
            <TableCell>Check Requests</TableCell>
            <TableCell>IPCs</TableCell>
            <TableCell align="right">Verified</TableCell>
            <TableCell align="right">Billed</TableCell>
            <TableCell sx={{ minWidth: 120 }}>Billed of value</TableCell>
            <TableCell align="right">Approved</TableCell>
            <TableCell align="right">Paid</TableCell>
            <TableCell align="right">Outstanding</TableCell>
            <TableCell align="right">Left to bill</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const billedPct = r.contract ? pct(r.ipcs.billed, r.contract.value) : null;
            return (
              <TableRow key={r._id} hover sx={{ verticalAlign: 'top', cursor: 'pointer' }} onClick={() => onOpen(r)}>
                <TableCell><ContractLabel r={r} /></TableCell>
                <TableCell><Typography variant="body2" fontWeight={700}>{r.subProject?.name}</Typography></TableCell>
                <TableCell><Typography variant="body2">{contractorName(r)}</Typography></TableCell>
                <TableCell align="right">{r.contract ? fmt(r.contract.value) : '—'}</TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>{r.checkRequests.count}</Typography>
                  <CountChips counts={r.checkRequests.byStatus} colors={CR_STATUS_COLOR} />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>{r.ipcs.count}</Typography>
                  <CountChips counts={r.ipcs.byApproval} colors={IPC_APPROVAL_COLOR} />
                </TableCell>
                <TableCell align="right">{fmt(r.checkRequests.verified)}</TableCell>
                <TableCell align="right">{fmt(r.ipcs.billed)}</TableCell>
                <TableCell>
                  {billedPct === null ? '—' : (
                    <>
                      <LinearProgress variant="determinate" value={Math.min(100, billedPct)} color={progressColor(billedPct)} sx={{ height: 6, borderRadius: 3, mt: 0.75 }} />
                      <Typography variant="caption" fontWeight={700}>{billedPct}%</Typography>
                    </>
                  )}
                </TableCell>
                <TableCell align="right">{fmt(r.ipcs.approved)}</TableCell>
                <TableCell align="right">{fmt(r.ipcs.paid)}</TableCell>
                <TableCell align="right" sx={{ color: r.outstanding > 0 ? 'warning.dark' : undefined }}>{fmt(r.outstanding)}</TableCell>
                <TableCell align="right">{r.remaining === null ? '—' : fmt(r.remaining)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow sx={footSx}>
            <TableCell>Total ({plural(rows.filter((r) => r.contract).length, 'contract')})</TableCell>
            <TableCell />
            <TableCell />
            <TableCell align="right">{fmt(total((r) => r.contract?.value))}</TableCell>
            <TableCell>{total((r) => r.checkRequests.count)}</TableCell>
            <TableCell>{total((r) => r.ipcs.count)}</TableCell>
            <TableCell align="right">{fmt(total((r) => r.checkRequests.verified))}</TableCell>
            <TableCell align="right">{fmt(total((r) => r.ipcs.billed))}</TableCell>
            <TableCell />
            <TableCell align="right">{fmt(total((r) => r.ipcs.approved))}</TableCell>
            <TableCell align="right">{fmt(total((r) => r.ipcs.paid))}</TableCell>
            <TableCell align="right">{fmt(total((r) => r.outstanding))}</TableCell>
            <TableCell align="right">{fmt(total((r) => r.remaining))}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  );
};

/** Where the money is: how many check requests / IPCs sit at each stage, and how much */
const Pipeline = ({ stages, onOpen }) => {
  const [picked, setPicked] = useState(null);
  const groups = ['Check Requests', 'IPC Approval', 'Payment'];
  const selected = picked && stages.find((s) => `${s.group}|${s.stage}` === picked);

  return (
    <Box>
      {groups.map((group, gi) => {
        const list = stages.filter((s) => s.group === group && (s.stage !== 'Rejected' || s.count > 0));
        return (
          <Box key={group} sx={{ mb: 2 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
              <Box sx={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: ACCENT, color: '#fff', fontSize: 12, fontWeight: 800 }}>{gi + 1}</Box>
              <Typography variant="subtitle2" fontWeight={800} sx={{ color: INK }}>{group}</Typography>
            </Stack>
            <Stack direction="row" alignItems="stretch" gap={0.75} sx={{ overflowX: 'auto', pb: 0.5 }}>
              {list.map((s, i) => {
                const id = `${s.group}|${s.stage}`;
                const active = picked === id;
                const empty = !s.count && !s.amount;
                return (
                  <React.Fragment key={id}>
                    <Paper
                      elevation={0}
                      onClick={() => !empty && setPicked(active ? null : id)}
                      sx={{
                        flex: '1 0 140px', p: 1.5, borderRadius: 2, cursor: empty ? 'default' : 'pointer',
                        border: `1px solid ${active ? ACCENT : BORDER}`,
                        bgcolor: active ? 'rgba(15,118,110,0.08)' : s.stage === 'Rejected' ? 'rgba(211,47,47,0.05)' : '#fff',
                        opacity: empty ? 0.55 : 1,
                        '&:hover': { borderColor: empty ? BORDER : ACCENT }
                      }}
                    >
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{s.stage}</Typography>
                      {group !== 'Payment' && <Typography variant="h6" fontWeight={800} sx={{ color: INK, lineHeight: 1.3 }}>{s.count}</Typography>}
                      <Typography variant={group === 'Payment' ? 'h6' : 'caption'} fontWeight={group === 'Payment' ? 800 : 600} sx={{ color: group === 'Payment' ? INK : 'text.secondary' }}>
                        {fmt(s.amount)}
                      </Typography>
                    </Paper>
                    {i < list.length - 1 && s.stage !== 'Rejected' && list[i + 1].stage !== 'Rejected' && (
                      <ArrowIcon sx={{ alignSelf: 'center', color: '#cbd5e1', fontSize: 16, flexShrink: 0 }} />
                    )}
                  </React.Fragment>
                );
              })}
            </Stack>
          </Box>
        );
      })}

      <Paper elevation={0} sx={{ borderRadius: 2, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
        {!selected ? (
          <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Click a stage to see which contracts have work waiting there.</Typography></Box>
        ) : (
          <>
            <Box sx={{ px: 2, py: 1.25, bgcolor: SOFT, borderBottom: `1px solid ${BORDER}` }}>
              <Typography variant="subtitle2" fontWeight={800}>{selected.group} · {selected.stage}</Typography>
              <Typography variant="caption" color="text.secondary">
                {selected.group === 'Payment' ? fmt(selected.amount) : `${plural(selected.count, 'item')} · ${fmt(selected.amount)}`}
              </Typography>
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow sx={headSx}>
                  <TableCell>Sublet Contract</TableCell>
                  <TableCell>Sub Project</TableCell>
                  <TableCell>Contractor</TableCell>
                  {selected.group !== 'Payment' && <TableCell align="right">Count</TableCell>}
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {selected.rows.map((h) => (
                  <TableRow key={h.row._id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpen(h.row)}>
                    <TableCell><ContractLabel r={h.row} /></TableCell>
                    <TableCell>{h.row.subProject?.name}</TableCell>
                    <TableCell>{contractorName(h.row)}</TableCell>
                    {selected.group !== 'Payment' && <TableCell align="right">{h.count}</TableCell>}
                    <TableCell align="right">{fmt(h.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Paper>
    </Box>
  );
};

/**
 * Roll Sub Project groups up into a bigger bucket (Project Type or Sector).
 * Money comes from each Sub Project's row, so it matches the By Sub Project view.
 */
const buildCategoryGroups = (subGroups, keyOf, labelOf) => {
  const byKey = new Map();
  subGroups.forEach((g) => {
    const key = keyOf(g.sub) || '';
    if (!byKey.has(key)) byKey.set(key, { key, label: labelOf(key), subs: [] });
    byKey.get(key).subs.push(g);
  });
  const sumMoney = (subs, f) => (subs.some((g) => g.money[f] === null) ? null : sumBy(subs, (g) => g.money[f]));
  return [...byKey.values()]
    .map((c) => ({
      ...c,
      ...rollup(c.subs.flatMap((g) => g.rows)),
      contractors: [...new Set(c.subs.flatMap((g) => g.contractors))],
      money: Object.fromEntries(['budget', 'contracted', 'verified', 'billed', 'approved', 'paid', 'variance'].map((f) => [f, sumMoney(c.subs, f)]))
    }))
    .sort((a, b) => (b.money.billed || 0) - (a.money.billed || 0) || a.label.localeCompare(b.label));
};

/** By Project Type / By Sector: one row per bucket, expanding into its Sub Projects */
const ByCategory = ({ groups, heading, emptyText, onPickSub }) => {
  const [open, toggle] = useToggleSet();
  if (!groups.length) return <Empty>{emptyText}</Empty>;
  const total = (f) => sumBy(groups, f);
  const money = (v) => (v === null ? '—' : fmt(v));
  const totalMoney = (f) => (groups.some((g) => g.money[f] === null) ? '—' : fmt(total((g) => g.money[f])));

  return (
    <TableContainer sx={{ border: `1px solid ${BORDER}`, borderRadius: 2 }}>
      <Table size="small" sx={{ minWidth: 1100 }}>
        <TableHead>
          <TableRow sx={headSx}>
            <TableCell padding="checkbox" />
            <TableCell>{heading}</TableCell>
            <TableCell>Sub Projects</TableCell>
            <TableCell>Contractors</TableCell>
            <TableCell>Contracts</TableCell>
            <TableCell align="right">Check Req.</TableCell>
            <TableCell align="right">IPCs</TableCell>
            <TableCell align="right">Budget</TableCell>
            <TableCell align="right">Contracted</TableCell>
            <TableCell align="right">Billed</TableCell>
            <TableCell align="right">Approved</TableCell>
            <TableCell align="right">Paid</TableCell>
            <TableCell align="right">Outstanding</TableCell>
            <TableCell align="right">Variance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((c) => {
            const isOpen = open.has(c.key);
            return (
              <React.Fragment key={c.key}>
                <TableRow hover onClick={() => toggle(c.key)} sx={{ cursor: 'pointer', verticalAlign: 'top', '& > td': { borderBottom: isOpen ? 0 : undefined } }}>
                  <ExpandCell open={isOpen} onClick={() => toggle(c.key)} />
                  <TableCell>
                    <Typography variant="body2" fontWeight={800} sx={{ color: INK }}>{c.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{pct(c.money.paid || 0, c.money.billed || 0)}% of billed paid</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{c.subs.length}</Typography>
                    <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                      {c.subs.map((g) => <Chip key={g.sub._id} size="small" label={g.sub.name} sx={{ height: 20, fontSize: 11 }} />)}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{c.contractors.length}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.contractors.join(', ')}</Typography>
                  </TableCell>
                  <ContractsCell r={c} />
                  <TableCell align="right">{c.checkRequests}</TableCell>
                  <TableCell align="right">{c.ipcs}</TableCell>
                  <TableCell align="right">{money(c.money.budget)}</TableCell>
                  <TableCell align="right">{fmt(c.money.contracted)}</TableCell>
                  <TableCell align="right">{fmt(c.money.billed)}</TableCell>
                  <TableCell align="right">{fmt(c.money.approved)}</TableCell>
                  <TableCell align="right">{fmt(c.money.paid)}</TableCell>
                  <TableCell align="right" sx={{ color: c.outstanding > 0 ? 'warning.dark' : undefined }}>{fmt(c.outstanding)}</TableCell>
                  <TableCell align="right" sx={{ color: c.money.variance === null ? undefined : c.money.variance > 0 ? 'error.main' : 'success.main' }}>{money(c.money.variance)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={14} sx={{ p: 0, bgcolor: SOFT, borderBottom: isOpen ? undefined : 0 }}>
                    <Collapse in={isOpen} unmountOnExit>
                      <Box sx={{ m: 1.5, mt: 0.5, borderRadius: 2, border: `1px solid ${BORDER}`, overflow: 'hidden', bgcolor: '#fff' }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={headSx}>
                              <TableCell>Sub Project</TableCell>
                              <TableCell>Progress</TableCell>
                              <TableCell>Contracts</TableCell>
                              <TableCell align="right">Contracted</TableCell>
                              <TableCell align="right">Billed</TableCell>
                              <TableCell align="right">Approved</TableCell>
                              <TableCell align="right">Paid</TableCell>
                              <TableCell align="right">Outstanding</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {c.subs.map((g) => (
                              <TableRow key={g.sub._id} hover sx={{ cursor: 'pointer' }} onClick={() => onPickSub(g.sub)}>
                                <TableCell>
                                  <Typography variant="body2" fontWeight={700}>{g.sub.name}</Typography>
                                  <Typography variant="caption" color="text.secondary">{[g.sub.projectNumber, g.sub.sector, projectTypeLabel(g.sub.projectType)].filter(Boolean).join(' · ')}</Typography>
                                </TableCell>
                                <TableCell sx={{ minWidth: 120 }}>
                                  <LinearProgress variant="determinate" value={Math.min(100, g.sub.progress)} color={progressColor(g.sub.progress)} sx={{ height: 6, borderRadius: 3, mt: 0.75 }} />
                                  <Typography variant="caption" fontWeight={700}>{g.sub.progress}%</Typography>
                                </TableCell>
                                <ContractsCell r={g} />
                                <TableCell align="right">{fmt(g.money.contracted)}</TableCell>
                                <TableCell align="right">{fmt(g.money.billed)}</TableCell>
                                <TableCell align="right">{fmt(g.money.approved)}</TableCell>
                                <TableCell align="right">{fmt(g.money.paid)}</TableCell>
                                <TableCell align="right" sx={{ color: g.outstanding > 0 ? 'warning.dark' : undefined }}>{fmt(g.outstanding)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow sx={footSx}>
            <TableCell />
            <TableCell>Total ({plural(groups.length, heading.toLowerCase())})</TableCell>
            <TableCell>{total((c) => c.subs.length)}</TableCell>
            <TableCell>{new Set(groups.flatMap((c) => c.contractors)).size}</TableCell>
            <TableCell>{total((c) => c.contracts)}</TableCell>
            <TableCell align="right">{total((c) => c.checkRequests)}</TableCell>
            <TableCell align="right">{total((c) => c.ipcs)}</TableCell>
            <TableCell align="right">{totalMoney('budget')}</TableCell>
            <TableCell align="right">{totalMoney('contracted')}</TableCell>
            <TableCell align="right">{totalMoney('billed')}</TableCell>
            <TableCell align="right">{totalMoney('approved')}</TableCell>
            <TableCell align="right">{totalMoney('paid')}</TableCell>
            <TableCell align="right">{fmt(total((c) => c.outstanding))}</TableCell>
            <TableCell align="right">{totalMoney('variance')}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  );
};

const VIEWS = [
  { id: 'lines', label: 'By BOQ Line', icon: <LinesIcon fontSize="small" />, subOnly: true },
  { id: 'sub', label: 'By Sub Project', icon: <SubIcon fontSize="small" />, mainOnly: true },
  { id: 'type', label: 'By Project Type', icon: <TypeIcon fontSize="small" />, mainOnly: true },
  { id: 'sector', label: 'By Sector', icon: <SectorIcon fontSize="small" />, mainOnly: true },
  { id: 'contractor', label: 'By Contractor', icon: <ContractorIcon fontSize="small" /> },
  { id: 'contract', label: 'By Contract', icon: <ContractIcon fontSize="small" /> },
  { id: 'pipeline', label: 'Approval Pipeline', icon: <PipelineIcon fontSize="small" /> }
];
const NO_FILTERS = { sub: 'all', projectType: 'all', sector: 'all', contractor: 'all', type: 'all' };

/**
 * Cost report for a Main or Sub Project: totals, then the same money seen from different angles.
 * Main: by Sub Project, Project Type, Sector, contractor, contract, approval stage.
 * Sub: by BOQ line (with slab-wise contracts), contractor, contract, approval stage.
 */
export default function MainCostReport({ project }) {
  const navigate = useNavigate();
  const isSub = Boolean(project.parentProject);
  const views = VIEWS.filter((v) => (isSub ? !v.mainOnly : !v.subOnly));
  const [data, setData] = useState(null);
  const [lineData, setLineData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(isSub ? 'lines' : 'sub');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(NO_FILTERS);

  const load = useCallback(async () => {
    try {
      setError('');
      const [res, lines] = await Promise.all([
        getProjectCostAnalysis(project._id),
        isSub ? getProjectCostReport(project._id) : Promise.resolve(null)
      ]);
      setData(res.data?.data || null);
      setLineData(lines?.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the cost report');
    }
  }, [project._id, isSub]);

  useEffect(() => { load(); }, [load]);

  const contractorOptions = useMemo(() => {
    const m = new Map((data?.rows || []).map((r) => [contractorKey(r), contractorName(r)]));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const projectTypeOptions = useMemo(() => [...new Set((data?.subProjects || []).map((s) => s.projectType))].sort(), [data]);
  const sectorOptions = useMemo(() => [...new Set((data?.subProjects || []).map((s) => sectorLabel(s.sector)))].sort(), [data]);

  if (error) return <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>{error}</Alert>;
  if (!data) return <Skeleton height={300} />;

  // Filters apply to every view; search narrows by name
  const q = query.trim().toLowerCase();
  const narrowed = filters.contractor !== 'all' || filters.type !== 'all';
  const filtersOn = narrowed || filters.sub !== 'all' || filters.projectType !== 'all' || filters.sector !== 'all';
  // Project Type / Sector / Sub Project filters pick whole Sub Projects
  const subMatches = (s) => s && (filters.sub === 'all' || String(s._id) === filters.sub)
    && (filters.projectType === 'all' || s.projectType === filters.projectType)
    && (filters.sector === 'all' || sectorLabel(s.sector) === filters.sector);
  const rows = data.rows.filter((r) => subMatches(r.subProject)
    && (filters.contractor === 'all' || contractorKey(r) === filters.contractor)
    && (filters.type === 'all' || (filters.type === 'none' ? !r.contract : r.contract?.type === filters.type)));
  const subs = data.subProjects.filter(subMatches);
  const allSubGroups = buildSubGroups(subs, rows, narrowed);
  const typeGroups = buildCategoryGroups(allSubGroups, (s) => s.projectType, projectTypeLabel)
    .filter((c) => !q || c.label.toLowerCase().includes(q));
  const sectorGroups = buildCategoryGroups(allSubGroups, (s) => sectorLabel(s.sector), (k) => k)
    .filter((c) => !q || c.label.toLowerCase().includes(q));

  const subGroups = allSubGroups
    .filter((g) => !q || g.sub.name.toLowerCase().includes(q) || (g.sub.projectNumber || '').toLowerCase().includes(q));
  const contractorGroups = buildContractorGroups(rows).filter((g) => !q || g.name.toLowerCase().includes(q));
  const contractRows = sortContracts(rows).filter((r) => !q || [r.contract?.contractNumber, r.subProject?.name, contractorName(r)]
    .some((v) => (v || '').toLowerCase().includes(q)));
  const stages = buildPipeline(contractRows);

  const t = data.totals;
  const f = rollup(rows);
  const openRow = (r) => r.subProject && navigate(`/general/project-management/${r.subProject._id}?tab=${r.contract ? 'sublet-contracts' : 'check-requests'}`);
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const pickSub = (sub) => { setFilters((prev) => ({ ...prev, sub: String(sub._id) })); setQuery(''); setView('sub'); };

  const exportView = () => {
    const name = `${project.projectNumber || 'project'}-cost-${view}.csv`;
    if (view === 'lines') {
      const lineRows = (lineData?.lines || []).map((l) => ['BOQ line', l.title, l.contractors.join('; '), `${l.scopeQty} ${l.unit || ''}`.trim(),
        l.budget, l.contracted, l.verified, l.billed, l.approved, l.variance]);
      const slabRows = (lineData?.slabContracts || []).flatMap((c) => c.slabs.map((sl) => [`Slab · ${c.contractNumber}`, sl.name, c.contractor, `${sl.percentage}%`,
        sl.amount, '', sl.verified, sl.billed, sl.approved, '']));
      downloadCsv(name, ['Kind', 'Item / Slab', 'Contractors', 'Scope / Share', 'Budget / Amount', 'Contracted', 'Verified', 'Billed', 'Approved', 'Variance'], [...lineRows, ...slabRows]);
    } else if (view === 'sub') {
      downloadCsv(name,
        ['Sub Project', 'Code', 'Progress %', 'Contractors', 'Contracts', 'BOQ-wise', 'Slab-wise', 'Check Requests', 'IPCs', 'Budget', 'Contracted', 'Verified', 'Billed', 'Approved', 'Paid', 'Outstanding', 'Variance'],
        subGroups.map((g) => [g.sub.name, g.sub.projectNumber, g.sub.progress, g.contractors.join('; '), g.contracts, g.boq, g.slab, g.checkRequests, g.ipcs,
          g.money.budget ?? '', g.money.contracted, g.money.verified, g.money.billed, g.money.approved, g.money.paid, g.outstanding, g.money.variance ?? '']));
    } else if (view === 'type' || view === 'sector') {
      const list = view === 'type' ? typeGroups : sectorGroups;
      downloadCsv(name,
        [view === 'type' ? 'Project Type' : 'Sector', 'Sub Projects', 'Contractors', 'Contracts', 'BOQ-wise', 'Slab-wise', 'Check Requests', 'IPCs', 'Budget', 'Contracted', 'Verified', 'Billed', 'Approved', 'Paid', 'Outstanding', 'Variance'],
        list.map((c) => [c.label, c.subs.map((g) => g.sub.name).join('; '), c.contractors.join('; '), c.contracts, c.boq, c.slab, c.checkRequests, c.ipcs,
          c.money.budget ?? '', c.money.contracted, c.money.verified, c.money.billed, c.money.approved, c.money.paid, c.outstanding, c.money.variance ?? '']));
    } else if (view === 'contractor') {
      downloadCsv(name,
        ['Contractor', 'Sub Projects', 'Contracts', 'BOQ-wise', 'Slab-wise', 'Check Requests', 'Check Request status', 'IPCs', 'IPC approval', 'Contract Value', 'Billed', 'Approved', 'Paid', 'Outstanding'],
        contractorGroups.map((g) => [g.name, g.subProjects.join('; '), g.contracts, g.boq, g.slab, g.checkRequests, countText(g.crStatus), g.ipcs, countText(g.ipcApproval),
          g.value, g.billed, g.approved, g.paid, g.outstanding]));
    } else if (view === 'contract') {
      downloadCsv(name,
        ['Contract', 'Type', 'Status', 'Sub Project', 'Contractor', 'Value', 'Check Requests', 'Check Request status', 'IPCs', 'IPC approval', 'Verified', 'Billed', 'Approved', 'Paid', 'Outstanding', 'Left to bill'],
        contractRows.map((r) => [r.contract?.contractNumber || 'No contract', typeLabel(r), r.contract?.status || '', r.subProject?.name, contractorName(r), r.contract?.value ?? '',
          r.checkRequests.count, countText(r.checkRequests.byStatus), r.ipcs.count, countText(r.ipcs.byApproval),
          r.checkRequests.verified, r.ipcs.billed, r.ipcs.approved, r.ipcs.paid, r.outstanding, r.remaining ?? '']));
    } else {
      downloadCsv(name,
        ['Stage group', 'Stage', 'Count', 'Amount', 'Contracts at this stage'],
        stages.map((s) => [s.group, s.stage, s.group === 'Payment' ? '' : s.count, s.amount,
          s.rows.map((h) => h.row.contract?.contractNumber || `No contract (${h.row.subProject?.name})`).join('; ')]));
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1} sx={{ mb: 2 }}>
        <Box>
          {/* The Sub Project tab bar already titles this "Cost Report" */}
          {!isSub && <Typography variant="h6" fontWeight={800} sx={{ color: INK }}>Cost Report</Typography>}
          <Typography variant="body2" color="text.secondary">
            Budget (BOQ) → contracted (sublet) → verified (check requests) → billed (IPCs) → approved (CEO) → paid (Finance)
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load} sx={{ textTransform: 'none', color: ACCENT, borderColor: ACCENT }}>
          Refresh
        </Button>
      </Stack>

      <Box sx={{ display: 'grid', gap: 1.25, mb: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)', xl: 'repeat(7, 1fr)' } }}>
        <Kpi label="Budget" value={t.budget} hint={t.lumpSumBudget ? `Lump sum ${fmt(t.lumpSumBudget)}` : isSub ? 'This sub project\'s BOQ' : 'Sum of sub project BOQs'} />
        <Kpi label="Contracted" value={t.contracted} color={t.budget > 0 && t.contracted > t.budget ? 'error.main' : undefined} hint={t.budget > 0 ? `${pct(t.contracted, t.budget)}% of budget` : null} />
        <Kpi label="Verified work" value={t.verified} hint={`${pct(t.verified, t.contracted)}% of contracted`} />
        <Kpi label="Billed (IPCs)" value={t.billed} />
        <Kpi label="CEO approved" value={t.approved} hint={`${pct(t.approved, t.billed)}% of billed`} />
        <Kpi label="Paid by Finance" value={t.paid} color="success.main" />
        <Kpi label="Outstanding" value={t.outstanding} color={t.outstanding > 0 ? 'warning.dark' : undefined} hint="Approved, not paid yet" />
      </Box>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 2.5 }}>
        <Chip label={`Variance (contracted − budget): ${fmt(t.variance)}`} color={t.variance > 0 ? 'error' : 'success'} variant="outlined" />
        <Chip label={`Retention held: ${fmt(t.retentionHeld)}`} variant="outlined" />
        <Chip label={`Advance outstanding: ${fmt(t.advanceOutstanding)}`} variant="outlined" />
      </Stack>

      {/* View switch + export */}
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }} gap={1.5} sx={{ mb: 1.5 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_, v) => v && setView(v)}
          sx={{
            flexWrap: 'wrap',
            '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 2, gap: 0.75 },
            '& .Mui-selected': { bgcolor: 'rgba(15,118,110,0.1) !important', color: `${ACCENT} !important` }
          }}
        >
          {views.map((v) => <ToggleButton key={v.id} value={v.id}>{v.icon} {v.label}</ToggleButton>)}
        </ToggleButtonGroup>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportView} sx={{ textTransform: 'none', color: ACCENT, borderColor: ACCENT, alignSelf: { xs: 'flex-start', md: 'center' } }}>
          Export CSV
        </Button>
      </Stack>

      {/* Filters: apply to every view */}
      <Paper elevation={0} sx={{ p: 1.5, mb: 1.5, borderRadius: 2, border: `1px solid ${BORDER}`, bgcolor: SOFT }}>
        <Box
          sx={{
            display: 'grid', gap: 1.25, alignItems: 'center',
            gridTemplateColumns: isSub
              ? { xs: '1fr', sm: '1fr 1fr', md: '2fr 1.4fr 1.2fr auto' }
              : { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)', xl: '1.8fr repeat(5, 1.1fr) auto' }
          }}
        >
          <TextField
            size="small"
            placeholder={isSub ? 'Search BOQ line, contractor or contract no…' : 'Search name, type, sector or contract no…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ bgcolor: '#fff' }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          {!isSub && (
          <>
          <FormControl size="small" sx={{ bgcolor: '#fff' }}>
            <InputLabel>Sub Project</InputLabel>
            <Select label="Sub Project" value={filters.sub} onChange={setFilter('sub')}>
              <MenuItem value="all">All sub projects</MenuItem>
              {data.subProjects.map((s) => <MenuItem key={s._id} value={String(s._id)}>{s.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ bgcolor: '#fff' }}>
            <InputLabel>Project Type</InputLabel>
            <Select label="Project Type" value={filters.projectType} onChange={setFilter('projectType')}>
              <MenuItem value="all">All project types</MenuItem>
              {projectTypeOptions.map((t) => <MenuItem key={t} value={t}>{projectTypeLabel(t)}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ bgcolor: '#fff' }}>
            <InputLabel>Sector</InputLabel>
            <Select label="Sector" value={filters.sector} onChange={setFilter('sector')}>
              <MenuItem value="all">All sectors</MenuItem>
              {sectorOptions.map((sec) => <MenuItem key={sec} value={sec}>{sec}</MenuItem>)}
            </Select>
          </FormControl>
          </>
          )}
          <FormControl size="small" sx={{ bgcolor: '#fff' }}>
            <InputLabel>Contractor</InputLabel>
            <Select label="Contractor" value={filters.contractor} onChange={setFilter('contractor')}>
              <MenuItem value="all">All contractors</MenuItem>
              {contractorOptions.map(([key, name]) => <MenuItem key={key} value={key}>{name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ bgcolor: '#fff' }}>
            <InputLabel>Contract type</InputLabel>
            <Select label="Contract type" value={filters.type} onChange={setFilter('type')}>
              <MenuItem value="all">All types</MenuItem>
              <MenuItem value="BOQ">BOQ-wise</MenuItem>
              <MenuItem value="Slab">Slab-wise</MenuItem>
              <MenuItem value="none">No contract</MenuItem>
            </Select>
          </FormControl>
          <Button
            size="small"
            startIcon={<ClearIcon />}
            disabled={!filtersOn && !q}
            onClick={() => { setFilters(NO_FILTERS); setQuery(''); }}
            sx={{ textTransform: 'none', color: ACCENT }}
          >
            Clear
          </Button>
        </Box>
        {(filtersOn || q) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Filtered: {plural(f.contracts, 'contract')} · {plural(f.checkRequests, 'check request')} · {plural(f.ipcs, 'IPC')}
            {' · '}Billed {fmt(f.billed)} · Approved {fmt(f.approved)} · Paid {fmt(f.paid)} · Outstanding {fmt(f.outstanding)}
            {narrowed && ['sub', 'type', 'sector'].includes(view) && ' · Budget and variance are hidden because they belong to the whole sub project.'}
            {' '}The boxes above are always for the whole {isSub ? 'sub project' : 'project'}.
          </Typography>
        )}
      </Paper>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {view === 'lines'
          ? 'Budget per BOQ line and per slab, with what has been contracted, verified, billed and approved against it.'
          : view === 'pipeline'
          ? 'Each box is a stage. Click one to list the contracts with work at that stage.'
          : view === 'contract'
            ? 'Click a contract to open it in its sub project.'
            : view === 'type' || view === 'sector'
              ? 'Click a row to see its sub projects. Click a sub project to see its contracts.'
            : 'Click a row to see its sublet contracts. Click a contract to open it in its sub project.'}
      </Typography>

      {view === 'lines' && (lineData
        ? <SubCostLines data={lineData} query={query} type={filters.type} contractor={filters.contractor === 'all' ? null : contractorOptions.find(([k]) => k === filters.contractor)?.[1]} />
        : <Skeleton height={200} />)}
      {view === 'sub' && <BySubProject groups={subGroups} narrowed={narrowed} onOpen={openRow} />}
      {view === 'type' && <ByCategory groups={typeGroups} heading="Project Type" emptyText="No project types match." onPickSub={pickSub} />}
      {view === 'sector' && <ByCategory groups={sectorGroups} heading="Sector" emptyText="No sectors match." onPickSub={pickSub} />}
      {view === 'contractor' && <ByContractor groups={contractorGroups} onOpen={openRow} />}
      {view === 'contract' && <ByContract rows={contractRows} onOpen={openRow} />}
      {view === 'pipeline' && <Pipeline stages={stages} onOpen={openRow} />}
    </Box>
  );
}
