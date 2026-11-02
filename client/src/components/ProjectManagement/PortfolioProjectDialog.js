import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Breadcrumbs, Button, Chip, CircularProgress, Dialog, IconButton, LinearProgress, Link, Stack, Tooltip, Typography, Tab, Tabs
} from '@mui/material';
import { keyframes } from '@mui/material/styles';
import {
  AccountTree as TreeIcon, ArrowBack as BackIcon, ChevronLeft as PrevIcon, ChevronRight as NextIcon, ChevronRight as GoIcon,
  Close as CloseIcon, Description as ContractIcon, Event as DateIcon, FactCheck as CrIcon, OpenInNew as OpenIcon,
  Person as PersonIcon, Place as PlaceIcon, ReceiptLong as IpcIcon, TravelExplore as InspectionIcon,
  PlayCircle as VideoIcon, BarChart as CostIcon, InfoOutlined as DetailsIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { getProjectCostDetail, getProjectSummary, getProjectTree } from '../../services/projectManagementService';
import {
  CONTRACT_STATUS_COLOR, CR_STATUS_COLOR, ContractTypeTag, HEALTH_COLOR, INK, IPC_APPROVAL_COLOR, STATUS_DOT, fmt, plural, progressColor
} from './mainProjectUi';
import { HEALTH_STYLE, ProgressRing } from './portfolioUi';
import MainCostReport from './MainCostReport';
import { ContractCost, CrCost, IpcCost, IrCost } from './PortfolioCostViews';
import { getImageUrl } from '../../utils/imageService';
import { DigitalSignatureImage } from '../common/DigitalSignatureImage';

const MUTED = '#64748b';
const LINE = '#e2e8f0';
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const slideIn = keyframes`from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; }`;
const slideBack = keyframes`from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; }`;

/** Small figure tile */
const Stat = ({ label, value, tone, note }) => (
  <Box sx={{ p: 1.5, borderRadius: 2.5, bgcolor: '#f8fafc', border: `1px solid ${LINE}`, minWidth: 0 }}>
    <Typography sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: MUTED }}>{label}</Typography>
    <Typography sx={{ fontSize: 16, fontWeight: 900, color: tone || INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</Typography>
    {note && <Typography sx={{ fontSize: 11, color: MUTED }}>{note}</Typography>}
  </Box>
);

const Stats = ({ items }) => (
  <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(3, minmax(0,1fr))' } }}>
    {items.filter(Boolean).map((s) => <Stat key={s.label} {...s} />)}
  </Box>
);

const SectionTitle = ({ children, count }) => (
  <Typography sx={{ mt: 2.5, mb: 1, fontSize: 13, fontWeight: 900, color: INK, letterSpacing: 0.3 }}>
    {children}{count !== undefined && <Box component="span" sx={{ color: MUTED, fontWeight: 700 }}> · {count}</Box>}
  </Typography>
);

const Empty = ({ children }) => (
  <Box sx={{ py: 3, textAlign: 'center', color: MUTED, fontSize: 14, bgcolor: '#f8fafc', borderRadius: 2, border: `1px dashed ${LINE}` }}>{children}</Box>
);

/** Clickable row that opens the next level */
const Row = ({ icon, title, subtitle, right, rightNote, chip, progress, color, onClick, index = 0 }) => (
  <Box
    onClick={onClick}
    sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, mb: 1, borderRadius: 2.5, bgcolor: '#fff', border: `1px solid ${LINE}`,
      cursor: onClick ? 'pointer' : 'default', animation: `${slideIn} .35s ${0.04 * Math.min(index, 10)}s both`,
      transition: 'border-color .15s, box-shadow .15s, transform .15s',
      '&:hover': onClick ? { borderColor: color, boxShadow: `0 6px 18px -8px ${color}`, transform: 'translateX(2px)' } : {}
    }}
  >
    <Box sx={{ width: 38, height: 38, borderRadius: 2, flexShrink: 0, display: 'grid', placeItems: 'center', bgcolor: `${color}1a`, color }}>{icon}</Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 800, color: INK, fontSize: 14 }} noWrap>{title}</Typography>
        {chip}
      </Stack>
      {subtitle && <Typography sx={{ fontSize: 12, color: MUTED }} noWrap>{subtitle}</Typography>}
      {progress !== undefined && (
        <LinearProgress variant="determinate" value={Math.min(100, progress)} color={progressColor(progress)} sx={{ mt: 0.75, height: 5, borderRadius: 3, maxWidth: 260 }} />
      )}
    </Box>
    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
      {right && <Typography sx={{ fontWeight: 900, color: INK, fontSize: 14, whiteSpace: 'nowrap' }}>{right}</Typography>}
      {rightNote && <Typography sx={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{rightNote}</Typography>}
    </Box>
    {onClick && <GoIcon sx={{ color: '#cbd5e1' }} />}
  </Box>
);

const StatusChip = ({ label, colorMap }) => (
  <Chip size="small" label={label || 'Draft'} color={colorMap[label] || 'default'} variant="outlined" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />
);

const ipcTitle = (i) => i.ipcNumber ? `IPC #${i.ipcNumber}` : (i.invoiceNumber || 'IPC');

/** IPC rows; Advance / Retention Release are labelled */
const IpcRows = ({ ipcs, color, open }) => (ipcs.length ? ipcs.map((i, n) => (
  <Row
    key={i._id} index={n} color={color} icon={<IpcIcon fontSize="small" />}
    title={ipcTitle(i)}
    chip={<StatusChip label={i.approvalStatus} colorMap={IPC_APPROVAL_COLOR} />}
    subtitle={`${i.ipcKind || 'Work'} · ${i.invoiceNumber || ''} · ${fmtDate(i.issueDate)}`}
    right={fmt(i.grossAmount)} rightNote={`Paid ${fmt(i.paidAmount)}`}
    onClick={() => open({ type: 'ipc', ipc: i })}
  />
)) : <Empty>No IPCs yet.</Empty>);

/** Check request rows */
const CrRows = ({ crs, color, open }) => (crs.length ? crs.map((c, n) => (
  <Row
    key={c._id} index={n} color={color} icon={<CrIcon fontSize="small" />}
    title={c.checkRequestNumber || 'Check request'}
    chip={<StatusChip label={c.status} colorMap={CR_STATUS_COLOR} />}
    subtitle={[c.slabName && `Slab: ${c.slabName}`, c.contractor, plural(c.inspections?.length || 0, 'inspection'), plural(c.ipcs.length, 'IPC')].filter(Boolean).join(' · ')}
    right={fmt(c.verifiedTotal || c.claimedTotal)} rightNote={c.verifiedTotal ? 'verified' : 'claimed'}
    onClick={() => open({ type: 'cr', cr: c })}
  />
)) : <Empty>No check requests yet.</Empty>);

// ─── Levels ──────────────────────────────────────────────────────────────────

const MainLevel = ({ item, summary, tree, color, open }) => {
  const t = summary.totals;
  const health = HEALTH_STYLE[item.health] || HEALTH_STYLE['On Track'];
  const money = new Map(summary.subProjects.map((s) => [String(s._id), s]));
  return (
    <>
      <Box
        sx={{
          position: 'relative', overflow: 'hidden', borderRadius: 3, p: 2.5, color: '#fff',
          background: `radial-gradient(circle at 100% 0%, ${color} 0%, transparent 55%), linear-gradient(135deg, #0f172a, #1e293b)`
        }}
      >
        {item.cover && <Box sx={{ position: 'absolute', inset: 0, backgroundImage: `url(${getImageUrl(item.cover)})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.15 }} />}
        <Stack direction="row" gap={2} alignItems="center" sx={{ position: 'relative' }}>
          <ProgressRing value={item.progress} size={84} stroke={8} color={color} track="rgba(255,255,255,0.15)" textColor="#fff" label="done" />
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mb: 0.5 }}>
              <Chip size="small" label={item.status || 'Draft'} sx={{ height: 20, bgcolor: 'rgba(255,255,255,0.15)', color: '#fff', fontWeight: 700 }} />
              <Chip size="small" label={item.health} sx={{ height: 20, bgcolor: health.bg, color: health.fg, fontWeight: 800 }} />
              {item.contractBasis && <ContractTypeTag type={item.contractBasis} />}
            </Stack>
            <Typography sx={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2 }}>{item.name}</Typography>
            <Stack direction="row" gap={1.5} flexWrap="wrap" sx={{ mt: 0.5, color: 'rgba(255,255,255,0.7)', '& svg': { fontSize: 14 } }}>
              <Typography variant="caption" fontWeight={700}>{item.projectNumber}</Typography>
              {item.location && <Stack direction="row" gap={0.4} alignItems="center"><PlaceIcon /><Typography variant="caption">{item.location}</Typography></Stack>}
              <Stack direction="row" gap={0.4} alignItems="center"><DateIcon /><Typography variant="caption">{fmtDate(item.startDate)} → {fmtDate(item.expectedEndDate)}</Typography></Stack>
              {item.projectManager && <Stack direction="row" gap={0.4} alignItems="center"><PersonIcon /><Typography variant="caption">{item.projectManager}</Typography></Stack>}
            </Stack>
          </Box>
        </Stack>
      </Box>
      <Box sx={{ mt: 2 }}>
        <Stats items={[
          // The approved budget stays in force while a revision is prepared or in approval
          item.budget > 0
            ? { label: 'Approved budget', value: fmt(item.budget), tone: '#0f766e', note: item.budgetStatus === 'Approved' ? `${fmt(item.distributed)} distributed to sub projects` : `${fmt(item.distributed)} distributed · a revision is ${item.budgetStatus === 'Submitted' ? 'in approval' : 'being prepared'}` }
            : { label: 'Budget', value: item.budgetStatus === 'Submitted' ? 'With the CEO' : 'Not set', tone: '#b45309', note: item.budgetStatus === 'Submitted' ? `${fmt(item.lumpSumBudget)} awaiting approval` : 'No contracts until approved' },
          ...(item.contractBasis === 'Slab' ? [
            // Slab-wise: the slab contracts are the yardstick
            { label: 'Contract value (slabs)', value: fmt(t.contracted), note: t.lumpSumBudget ? `Lump sum budget ${fmt(t.lumpSumBudget)}` : plural(item.slabs?.total || 0, 'slab') },
            { label: 'Slabs billed', value: `${item.slabs?.billed || 0} of ${item.slabs?.total || 0}`, note: `${item.slabs?.verified || 0} verified on site` },
            { label: 'Billed (certified)', value: fmt(t.spent), tone: t.contracted && t.spent > t.contracted ? '#dc2626' : '#b45309', note: `${pct(t.spent, t.contracted)}% of contract value` }
          ] : [
            { label: 'Contracted', value: fmt(t.contracted), note: item.contractBasis === 'BOQ' && item.lines?.total ? `${item.lines.contracted} of ${plural(item.lines.total, 'BOQ line')} · ${pct(t.contracted, item.budget)}% of budget` : `${pct(t.contracted, item.budget)}% of budget` },
            { label: 'Spent (certified)', value: fmt(t.spent), tone: item.budget && t.spent > item.budget ? '#dc2626' : '#b45309', note: `${pct(t.spent, item.budget)}% of budget` }
          ]),
          { label: 'CEO approved', value: fmt(t.approved), tone: '#7e22ce' },
          { label: 'Paid', value: fmt(t.paid), tone: '#15803d' },
          { label: 'Awaiting approval', value: item.pendingApprovals ? fmt(item.pendingAmount) : 'None', tone: item.pendingApprovals ? '#dc2626' : undefined, note: item.pendingApprovals ? `${plural(item.pendingApprovals, 'IPC')}${item.oldestPendingDays ? ` · oldest ${item.oldestPendingDays}d` : ''}` : undefined },
          item.retentionHeld ? { label: 'Retention held', value: fmt(item.retentionHeld), note: 'Kept from contractors until release' } : null,
          item.advanceOutstanding ? { label: 'Advance outstanding', value: fmt(item.advanceOutstanding), tone: '#b45309', note: 'Paid ahead, not yet recovered' } : null,
          item.clientBilled ? { label: 'Billed to client', value: fmt(item.clientBilled), tone: '#0f766e' } : null,
          item.clientBilled ? { label: 'Received from client', value: fmt(item.clientReceived), tone: '#0f766e', note: `${pct(item.clientReceived, item.clientBilled)}% of billed` } : null
        ]}
        />
      </Box>
      {item.healthReasons?.length > 0 && (
        <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2.5, bgcolor: health.bg, border: `1px solid ${health.fg}33` }}>
          <Typography sx={{ fontSize: 12, fontWeight: 900, color: health.fg, mb: 0.5 }}>Why this project is “{item.health}”</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25, color: INK, fontSize: 13, '& li': { py: 0.15 } }}>
            {item.healthReasons.map((r) => <li key={r}>{r}</li>)}
          </Box>
        </Box>
      )}
      <SectionTitle count={tree.subProjects.length}>Sub projects</SectionTitle>
      {tree.subProjects.length ? tree.subProjects.map((s, n) => {
        const m = money.get(String(s._id));
        return (
          <Row
            key={s._id} index={n} color={color} icon={<Box sx={{ fontWeight: 900, fontSize: 14 }}>{n + 1}</Box>}
            title={s.name}
            chip={<Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: STATUS_DOT[s.status] || '#94a3b8' }} />}
            subtitle={`${s.progress}% done · ${plural(s.totals.contracts, 'contract')} · ${plural(s.totals.checkRequests, 'check request')} · ${plural(s.totals.ipcs, 'IPC')}`}
            progress={s.progress}
            right={fmt(m?.spent ?? s.totals.billed)} rightNote={m?.budget ? `of ${fmt(m.budget)}` : 'spent'}
            onClick={() => open({ type: 'sub', subId: String(s._id) })}
          />
        );
      }) : <Empty>No sub projects yet.</Empty>}
    </>
  );
};

const SubLevel = ({ sub, money, basis, color, open }) => (
  <>
    <Stack direction="row" gap={2} alignItems="center" sx={{ mb: 2 }}>
      <ProgressRing value={sub.progress} size={72} stroke={7} color={color} label="done" />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK }}>{sub.name}</Typography>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <Typography variant="caption" sx={{ color: MUTED, fontWeight: 700 }}>{sub.projectNumber}{sub.sector ? ` · ${sub.sector}` : ''}</Typography>
          <Chip size="small" label={sub.status || 'Draft'} sx={{ height: 20, fontWeight: 700 }} />
          {basis && <ContractTypeTag type={basis} />}
          {money?.health && <Chip size="small" label={money.health} color={HEALTH_COLOR[money.health] || 'default'} sx={{ height: 20, fontWeight: 700 }} />}
        </Stack>
      </Box>
    </Stack>
    <Stats items={[
      ...(basis === 'Slab'
        ? [{ label: 'Contract value (slabs)', value: fmt(money?.contracted), note: plural(sub.contracts.length, 'contract') }]
        : [
          { label: 'Budget', value: fmt(money?.budget) },
          { label: 'Contracted', value: fmt(money?.contracted), note: `${pct(money?.contracted, money?.budget)}% of budget` }
        ]),
      { label: 'Verified', value: fmt(money?.verified) },
      { label: 'Spent (certified)', value: fmt(money?.spent ?? sub.totals.billed), tone: '#b45309' },
      { label: 'CEO approved', value: fmt(money?.approved ?? sub.totals.approved), tone: '#7e22ce' },
      { label: 'Paid', value: fmt(money?.paid ?? sub.totals.paid), tone: '#15803d' }
    ]}
    />
    <SectionTitle count={sub.contracts.length}>Sublet contracts</SectionTitle>
    {sub.contracts.length ? sub.contracts.map((c, n) => (
      <Row
        key={c._id} index={n} color={color} icon={<ContractIcon fontSize="small" />}
        title={c.contractNumber || c.title || 'Contract'}
        chip={<ContractTypeTag type={c.contractType} />}
        subtitle={`${c.contractor || 'No contractor'} · ${plural(c.totals.checkRequests, 'check request')} · ${plural(c.totals.ipcs, 'IPC')}`}
        progress={pct(c.totals.billed, c.totalAmount)}
        right={fmt(c.totalAmount)} rightNote={`Billed ${fmt(c.totals.billed)}`}
        onClick={() => open({ type: 'contract', contractId: String(c._id) })}
      />
    )) : <Empty>No sublet contracts yet.</Empty>}
    {(sub.unlinked.checkRequests.length > 0 || sub.unlinked.ipcs.length > 0) && (
      <>
        <SectionTitle>Not linked to a contract</SectionTitle>
        <CrRows crs={sub.unlinked.checkRequests} color={color} open={open} />
        {sub.unlinked.ipcs.length > 0 && <IpcRows ipcs={sub.unlinked.ipcs} color={color} open={open} />}
      </>
    )}
  </>
);

const ContractLevel = ({ contract: c, color, open }) => (
  <>
    <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 2 }}>
      <Box sx={{ width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: `${color}1a`, color }}><ContractIcon /></Box>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK }}>{c.contractNumber}</Typography>
          <ContractTypeTag type={c.contractType} />
          <StatusChip label={c.status} colorMap={CONTRACT_STATUS_COLOR} />
        </Stack>
        <Typography variant="body2" sx={{ color: MUTED }}>{[c.contractor, c.title].filter(Boolean).join(' · ')}</Typography>
      </Box>
    </Stack>
    <Stats items={[
      { label: 'Contract value', value: fmt(c.totalAmount) },
      { label: 'Billed (work IPCs)', value: fmt(c.totals.billed), tone: '#b45309', note: `${pct(c.totals.billed, c.totalAmount)}% of contract` },
      { label: 'Remaining', value: fmt(Math.max(0, c.totalAmount - c.totals.billed)) },
      { label: 'CEO approved', value: fmt(c.totals.approved), tone: '#7e22ce' },
      { label: 'Paid', value: fmt(c.totals.paid), tone: '#15803d' },
      { label: 'Check requests', value: c.totals.checkRequests, note: plural(c.totals.ipcs, 'IPC') }
    ]}
    />
    {c.contractType === 'Slab' && c.slabs?.length > 0 && (
      <>
        <SectionTitle count={c.slabs.length}>Slabs</SectionTitle>
        {c.slabs.map((sl, n) => {
          const claim = sl.checkRequests[0];
          return (
            <Row
              key={sl._id} index={n} color={color} icon={<Box sx={{ fontWeight: 900, fontSize: 12 }}>{sl.percentage}%</Box>}
              title={sl.name}
              chip={claim ? <StatusChip label={claim.status} colorMap={CR_STATUS_COLOR} /> : <Chip size="small" label="Not claimed" sx={{ height: 20, fontSize: 11 }} />}
              subtitle={claim ? `${claim.checkRequestNumber} · ${plural(claim.ipcs.length, 'IPC')}` : 'No check request yet'}
              right={fmt(sl.amount)}
              onClick={claim ? () => open({ type: 'cr', cr: claim }) : undefined}
            />
          );
        })}
      </>
    )}
    {c.contractType !== 'Slab' && (
      <>
        <SectionTitle count={c.checkRequests.length}>Check requests</SectionTitle>
        <CrRows crs={c.checkRequests} color={color} open={open} />
      </>
    )}
    {c.otherIpcs.length > 0 && (
      <>
        <SectionTitle count={c.otherIpcs.length}>Advances &amp; retention releases</SectionTitle>
        <IpcRows ipcs={c.otherIpcs} color={color} open={open} />
      </>
    )}
  </>
);

const CrLevel = ({ cr: c, color, open }) => (
  <>
    <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 2 }}>
      <Box sx={{ width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: `${color}1a`, color }}><CrIcon /></Box>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK }}>{c.checkRequestNumber}</Typography>
          <StatusChip label={c.status} colorMap={CR_STATUS_COLOR} />
        </Stack>
        <Typography variant="body2" sx={{ color: MUTED }}>{[c.contractor, c.title, c.slabName && `Slab: ${c.slabName}`].filter(Boolean).join(' · ')}</Typography>
      </Box>
    </Stack>
    <Stats items={[
      { label: 'Claimed', value: fmt(c.claimedTotal) },
      { label: 'Verified', value: fmt(c.verifiedTotal), tone: '#0369a1', note: c.claimedTotal ? `${pct(c.verifiedTotal, c.claimedTotal)}% of claim` : undefined },
      { label: 'Claim type', value: c.claimType === 'Slab' ? 'Slab-wise' : 'BOQ-wise' }
    ]}
    />
    <SectionTitle count={c.inspections?.length || 0}>Inspection reports</SectionTitle>
    {c.inspections?.length ? c.inspections.map((ir, n) => {
      const decided = ir.inspectors.filter((i) => i.status !== 'Pending').length;
      const photos = ir.inspectors.reduce((t, i) => t + (i.attachments || []).length, 0);
      return (
        <Row
          key={ir._id} index={n} color={color} icon={<InspectionIcon fontSize="small" />}
          title={ir.reportNumber || 'Inspection report'}
          chip={<StatusChip label={ir.status} colorMap={IR_STATUS_COLOR} />}
          subtitle={[fmtDate(ir.inspectionDate), ir.location, `${decided}/${ir.inspectors.length} inspectors decided`, photos ? plural(photos, 'attachment') : null].filter(Boolean).join(' · ')}
          right={fmt(ir.inspectedTotal)} rightNote="inspected"
          onClick={() => open({ type: 'ir', ir })}
        />
      );
    }) : <Empty>No inspection reports yet.</Empty>}
    <SectionTitle count={c.ipcs.length}>IPCs raised from this check request</SectionTitle>
    <IpcRows ipcs={c.ipcs} color={color} open={open} />
  </>
);

const IR_STATUS_COLOR = { Pending: 'warning', Approved: 'success', Rejected: 'error' };
const DECISION_STYLE = {
  Approved: { bg: '#dcfce7', fg: '#15803d' }, Rejected: { bg: '#fee2e2', fg: '#b91c1c' }, Pending: { bg: '#fef9c3', fg: '#a16207' }
};

/** One inspection report: what was inspected, each inspector's decision, signature and site evidence */
const IrLevel = ({ ir, color }) => {
  const [media, setMedia] = useState(null);
  const approved = ir.inspectors.filter((i) => i.status === 'Approved').length;
  return (
    <>
      <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: `${color}1a`, color }}><InspectionIcon /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK }}>{ir.reportNumber}</Typography>
            <StatusChip label={ir.status} colorMap={IR_STATUS_COLOR} />
          </Stack>
          <Typography variant="body2" sx={{ color: MUTED }}>{[fmtDate(ir.inspectionDate), ir.location].filter(Boolean).join(' · ')}</Typography>
        </Box>
      </Stack>
      <Stats items={[
        { label: 'Inspected value', value: fmt(ir.inspectedTotal), tone: '#0369a1' },
        { label: 'Inspectors approved', value: `${approved} of ${ir.inspectors.length}` },
        { label: ir.status === 'Pending' ? 'Inspection date' : 'Completed', value: fmtDate(ir.completedAt || ir.inspectionDate) }
      ]}
      />
      {ir.remarks && <Alert severity="info" sx={{ mt: 1.5 }}>{ir.remarks}</Alert>}

      {ir.claimType === 'Slab' ? (
        <>
          <SectionTitle>Slab inspected</SectionTitle>
          <Row color={color} icon={<Box sx={{ fontWeight: 900, fontSize: 12 }}>{ir.slab?.percentage}%</Box>} title={ir.slab?.name || 'Slab'} right={fmt(ir.slab?.amount)} />
        </>
      ) : (
        <>
          <SectionTitle count={ir.items.length}>BOQ lines measured</SectionTitle>
          {ir.items.length ? (
            <Box sx={{ border: `1px solid ${LINE}`, borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 90px 110px', gap: 1, px: 1.5, py: 1, bgcolor: '#f8fafc', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase' }}>
                <span>Item</span><Box sx={{ textAlign: 'right' }}>Claimed</Box><Box sx={{ textAlign: 'right' }}>Inspected</Box><Box sx={{ textAlign: 'right' }}>Value</Box>
              </Box>
              {ir.items.map((it, n) => {
                const short = it.inspectedQuantity < it.claimedQuantity;
                return (
                  <Box key={n} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 90px 110px', gap: 1, px: 1.5, py: 1, borderTop: `1px solid ${LINE}`, fontSize: 13, alignItems: 'center' }}>
                    <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: INK }} title={it.title}>{it.title || 'BOQ item'}</Typography>
                    <Box sx={{ textAlign: 'right', color: MUTED }}>{it.claimedQuantity} {it.unit}</Box>
                    <Box sx={{ textAlign: 'right', fontWeight: 800, color: short ? '#dc2626' : INK }}>{it.inspectedQuantity} {it.unit}</Box>
                    <Box sx={{ textAlign: 'right', fontWeight: 700 }}>{fmt(it.inspectedQuantity * it.unitPrice)}</Box>
                  </Box>
                );
              })}
            </Box>
          ) : <Empty>No BOQ lines on this report.</Empty>}
        </>
      )}

      <SectionTitle count={ir.inspectors.length}>Inspectors</SectionTitle>
      <Stack gap={1.25}>
        {ir.inspectors.map((insp, n) => {
          const st = DECISION_STYLE[insp.status] || DECISION_STYLE.Pending;
          return (
            <Box key={n} sx={{ p: 1.5, borderRadius: 2.5, border: `1px solid ${LINE}`, animation: `${slideIn} .35s ${0.05 * n}s both` }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 800, color: INK, fontSize: 14 }}>{insp.name || 'Inspector'}</Typography>
                  <Typography sx={{ fontSize: 12, color: MUTED }}>{[insp.designation, insp.actedAt && fmtDate(insp.actedAt)].filter(Boolean).join(' · ')}</Typography>
                </Box>
                <Chip size="small" label={insp.status} sx={{ height: 22, fontWeight: 800, bgcolor: st.bg, color: st.fg }} />
              </Stack>
              {insp.observations && <Typography sx={{ mt: 1, fontSize: 13, color: INK, bgcolor: '#f8fafc', p: 1, borderRadius: 1.5 }}>{insp.observations}</Typography>}
              {(insp.attachments || []).length > 0 && (
                <Box sx={{ mt: 1, display: 'grid', gap: 0.75, gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
                  {insp.attachments.map((a, k) => (
                    <Box
                      key={k} onClick={() => setMedia(a)}
                      sx={{ position: 'relative', height: 72, borderRadius: 1.5, overflow: 'hidden', cursor: 'pointer', bgcolor: '#0f172a', border: `1px solid ${LINE}`, '&:hover': { outline: `2px solid ${color}` } }}
                    >
                      {a.kind === 'image'
                        ? <Box component="img" src={getImageUrl(a.url)} alt={a.originalName} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        : <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: '#fff' }}><VideoIcon /></Box>}
                    </Box>
                  ))}
                </Box>
              )}
              {insp.signature && (
                <Box sx={{ mt: 1, pt: 1, borderTop: `1px dashed ${LINE}` }}>
                  <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: MUTED, textTransform: 'uppercase' }}>Signature</Typography>
                  <DigitalSignatureImage userOrPath={insp.signature} alt={`${insp.name} signature`} sx={{ maxHeight: 44, maxWidth: 180 }} />
                </Box>
              )}
            </Box>
          );
        })}
      </Stack>

      <Dialog open={Boolean(media)} onClose={() => setMedia(null)} maxWidth="lg" PaperProps={{ sx: { bgcolor: '#000', borderRadius: 2 } }}>
        {media && (media.kind === 'image'
          ? <Box component="img" src={getImageUrl(media.url)} alt={media.originalName} onClick={() => setMedia(null)} sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block' }} />
          : <Box component="video" src={getImageUrl(media.url)} controls autoPlay sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block' }} />)}
      </Dialog>
    </>
  );
};

const APPROVAL_STEPS = ['Draft', 'Pending Audit', 'Forwarded to Audit Director', 'Send to CEO Office', 'Forwarded to CEO', 'Approved'];

const IpcLevel = ({ ipc: i, color }) => {
  const reached = APPROVAL_STEPS.indexOf(i.approvalStatus);
  const rejected = i.approvalStatus === 'Rejected';
  const pending = !['Draft', 'Approved', 'Rejected'].includes(i.approvalStatus);
  const waiting = pending && i.submittedAt ? Math.max(0, dayjs().diff(dayjs(i.submittedAt), 'day')) : null;
  return (
    <>
      <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: `${color}1a`, color }}><IpcIcon /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography sx={{ fontSize: 20, fontWeight: 900, color: INK }}>{ipcTitle(i)}</Typography>
            <StatusChip label={i.approvalStatus} colorMap={IPC_APPROVAL_COLOR} />
          </Stack>
          <Typography variant="body2" sx={{ color: MUTED }}>{[i.invoiceNumber, i.ipcKind || 'Work', fmtDate(i.issueDate)].filter(Boolean).join(' · ')}</Typography>
          {waiting !== null && (
            <Typography variant="body2" sx={{ color: waiting > 7 ? '#dc2626' : '#b45309', fontWeight: 700 }}>
              Submitted {fmtDate(i.submittedAt)} · waiting {waiting === 0 ? 'since today' : `${waiting} day${waiting === 1 ? '' : 's'}`} for approval
            </Typography>
          )}
        </Box>
      </Stack>
      <Stats items={[
        { label: 'Gross amount', value: fmt(i.grossAmount) },
        { label: 'Net payable', value: fmt(i.netPayableAmount), tone: '#0369a1' },
        { label: 'Paid', value: fmt(i.paidAmount), tone: '#15803d', note: `${pct(i.paidAmount, i.netPayableAmount)}% of net payable` },
        { label: 'Balance', value: fmt(Math.max(0, (i.netPayableAmount || 0) - (i.paidAmount || 0))), tone: '#b45309' },
        { label: 'Payment status', value: i.status || '—' }
      ]}
      />
      <SectionTitle>Approval progress</SectionTitle>
      {rejected ? <Alert severity="error">This IPC was rejected and sent back for revision.</Alert> : (
        <Box sx={{ p: 2, borderRadius: 2.5, border: `1px solid ${LINE}` }}>
          {APPROVAL_STEPS.map((step, n) => {
            const done = n <= reached;
            const current = n === reached;
            return (
              <Stack key={step} direction="row" gap={1.5} alignItems="stretch">
                <Stack alignItems="center" sx={{ width: 18 }}>
                  <Box sx={{ width: 14, height: 14, borderRadius: '50%', mt: 0.25, bgcolor: done ? color : '#fff', border: `2px solid ${done ? color : '#cbd5e1'}`, boxShadow: current ? `0 0 0 4px ${color}33` : 'none' }} />
                  {n < APPROVAL_STEPS.length - 1 && <Box sx={{ flex: 1, width: 2, my: 0.25, minHeight: 14, bgcolor: n < reached ? color : '#e2e8f0' }} />}
                </Stack>
                <Typography sx={{ pb: 1, fontSize: 13, fontWeight: current ? 900 : 600, color: done ? INK : MUTED }}>{step}{current && ' · current'}</Typography>
              </Stack>
            );
          })}
        </Box>
      )}
    </>
  );
};

/**
 * Centered drill-down popup for one Main Project:
 * Main Project → Sub Project → Sublet Contract → Check Request → Inspection Report / IPC, with breadcrumbs and Back.
 * Arrows in the header flip to the previous / next Main Project.
 */
export default function PortfolioProjectDialog({ item, color, onClose, onPrev, onNext, position }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stack, setStack] = useState([{ type: 'main' }]);
  const [dir, setDir] = useState('in');
  // Details or Cost Report; kept while drilling down so management can follow the money level by level
  const [view, setView] = useState('details');
  const [costDetail, setCostDetail] = useState({});
  const [costError, setCostError] = useState('');
  const id = item?._id;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    setSummary(null); setTree(null); setCostDetail({});
    setStack([{ type: 'main' }]);
    try {
      const [s, t] = await Promise.all([getProjectSummary(id), getProjectTree(id)]);
      setSummary(s.data?.data || null);
      setTree(t.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load the project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const open = (level) => { setDir('in'); setStack((s) => [...s, level]); };
  const goTo = (depth) => { setDir('back'); setStack((s) => s.slice(0, depth + 1)); };
  const back = () => stack.length > 1 && goTo(stack.length - 2);

  // Resolve every level of the stack against the loaded tree
  const levels = stack.map((lv) => ({ ...lv }));
  let currentSub = null;
  levels.forEach((lv) => {
    if (lv.type === 'sub') {
      currentSub = tree?.subProjects.find((s) => String(s._id) === lv.subId);
      lv.sub = currentSub;
      lv.label = currentSub?.name || 'Sub project';
    } else if (lv.type === 'contract') {
      lv.contract = currentSub?.contracts.find((c) => String(c._id) === lv.contractId);
      lv.label = lv.contract?.contractNumber || 'Contract';
    } else if (lv.type === 'cr') lv.label = lv.cr.checkRequestNumber || 'Check request';
    else if (lv.type === 'ir') lv.label = lv.ir.reportNumber || 'Inspection report';
    else if (lv.type === 'ipc') lv.label = ipcTitle(lv.ipc);
    else lv.label = item?.name || 'Project';
    lv.subOf = currentSub;
  });
  const top = levels[levels.length - 1];

  // Contract / check request / IPC cost comes from their Sub Project's cost detail, loaded once per Sub
  const costSubId = view === 'cost' && ['contract', 'cr', 'ipc'].includes(top.type) ? String(top.subOf?._id || '') : '';
  useEffect(() => {
    if (!costSubId || costDetail[costSubId]) return;
    setCostError('');
    getProjectCostDetail(costSubId)
      .then((r) => setCostDetail((prev) => ({ ...prev, [costSubId]: r.data?.data || {} })))
      .catch((e) => setCostError(e.response?.data?.message || 'Could not load the cost report'));
  }, [costSubId, costDetail]);
  const subCost = costSubId ? costDetail[costSubId] : null;
  const wide = view === 'cost' && (top.type === 'main' || top.type === 'sub');

  // Full page for the current level: the Sub Project tab that lists it
  const fullPage = () => {
    const sid = top.subOf?._id;
    if (top.type === 'main' || !sid) return navigate(`/general/project-management/${id}`);
    const tab = { sub: 'overview', contract: 'sublet-contracts', cr: 'check-requests', ir: 'check-requests', ipc: 'invoices' }[top.type];
    return navigate(`/general/project-management/${sid}?tab=${tab}`);
  };

  useEffect(() => {
    if (!id) return undefined;
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
      if (e.key === 'Backspace') { e.preventDefault(); back(); }
      if (stack.length === 1 && e.key === 'ArrowLeft') onPrev?.();
      if (stack.length === 1 && e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item) return null;

  return (
    <Dialog
      open={Boolean(item)} onClose={onClose} maxWidth={wide ? 'lg' : 'md'} fullWidth scroll="paper"
      PaperProps={{ sx: { borderRadius: 4, overflow: 'hidden', maxHeight: 'calc(100% - 48px)' } }}
      slotProps={{ backdrop: { sx: { backdropFilter: 'blur(4px)', bgcolor: 'rgba(15,23,42,0.45)' } } }}
    >
      {/* Top bar: back, breadcrumbs, project arrows, close */}
      <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${LINE}`, bgcolor: '#fff', display: 'flex', alignItems: 'center', gap: 1 }}>
        {stack.length > 1 ? (
          <Tooltip title="Back"><IconButton size="small" onClick={back} sx={{ border: `1px solid ${LINE}` }}><BackIcon fontSize="small" /></IconButton></Tooltip>
        ) : (
          <Box sx={{ width: 30, height: 30, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: `${color}1a`, color }}><TreeIcon fontSize="small" /></Box>
        )}
        <Breadcrumbs maxItems={4} sx={{ flex: 1, minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' }, '& li': { minWidth: 0 } }}>
          {levels.map((lv, n) => (n === levels.length - 1 ? (
            <Typography key={n} noWrap sx={{ fontSize: 13, fontWeight: 900, color: INK }}>{lv.label}</Typography>
          ) : (
            <Link key={n} component="button" underline="hover" onClick={() => goTo(n)} noWrap sx={{ fontSize: 13, fontWeight: 700, color: MUTED, display: 'block', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {lv.label}
            </Link>
          )))}
        </Breadcrumbs>
        {stack.length === 1 && (
          <Stack direction="row" alignItems="center" sx={{ display: { xs: 'none', sm: 'flex' } }}>
            <Tooltip title="Previous project"><span><IconButton size="small" onClick={onPrev} disabled={!onPrev}><PrevIcon fontSize="small" /></IconButton></span></Tooltip>
            <Typography sx={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{position}</Typography>
            <Tooltip title="Next project"><span><IconButton size="small" onClick={onNext} disabled={!onNext}><NextIcon fontSize="small" /></IconButton></span></Tooltip>
          </Stack>
        )}
        <Tooltip title="Open full page"><IconButton size="small" onClick={fullPage}><OpenIcon fontSize="small" /></IconButton></Tooltip>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Tabs
        value={view}
        onChange={(_, v) => setView(v)}
        sx={{
          px: 2, minHeight: 0, borderBottom: `1px solid ${LINE}`, bgcolor: '#fff',
          '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontWeight: 800, fontSize: 13 },
          '& .Mui-selected': { color: `${color} !important` },
          '& .MuiTabs-indicator': { bgcolor: color, height: 3, borderRadius: 3 }
        }}
      >
        <Tab value="details" icon={<DetailsIcon fontSize="small" />} iconPosition="start" label="Details" />
        <Tab value="cost" icon={<CostIcon fontSize="small" />} iconPosition="start" label="Cost Report" />
      </Tabs>

      <Box sx={{ p: { xs: 2, sm: 2.5 }, overflowY: 'auto', bgcolor: '#fff', minHeight: 360 }}>
        {loading ? (
          <Box sx={{ py: 10, textAlign: 'center' }}><CircularProgress size={30} sx={{ color }} /></Box>
        ) : error ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>{error}</Alert>
        ) : summary && tree && (
          <Box key={`${id}-${stack.length}-${top.label}-${view}`} sx={{ animation: `${dir === 'in' ? slideIn : slideBack} .3s cubic-bezier(.2,.8,.2,1)` }}>
            {view === 'cost' ? (
              <>
                {top.type === 'main' && <MainCostReport project={{ _id: id, projectNumber: item.projectNumber }} />}
                {top.type === 'sub' && top.sub && <MainCostReport project={{ _id: top.sub._id, parentProject: id, projectNumber: top.sub.projectNumber }} />}
                {top.type === 'ir' && <IrCost ir={top.ir} />}
                {['contract', 'cr', 'ipc'].includes(top.type) && (costError
                  ? <Alert severity="error">{costError}</Alert>
                  : !subCost ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress size={28} sx={{ color }} /></Box>
                    : (
                      <>
                        {top.type === 'contract' && <ContractCost detail={(subCost.contracts || []).find((c) => String(c._id) === top.contractId)} />}
                        {top.type === 'cr' && <CrCost detail={subCost.checkRequests?.[String(top.cr._id)]} />}
                        {top.type === 'ipc' && <IpcCost detail={subCost.ipcs?.[String(top.ipc._id)]} />}
                      </>
                    ))}
              </>
            ) : (
            <>
            {top.type === 'main' && <MainLevel item={item} summary={summary} tree={tree} color={color} open={open} />}
            {top.type === 'sub' && (top.sub
              ? <SubLevel sub={top.sub} basis={item.contractBasis} money={summary.subProjects.find((s) => String(s._id) === String(top.sub._id))} color={color} open={open} />
              : <Empty>This sub project is no longer available.</Empty>)}
            {top.type === 'contract' && (top.contract ? <ContractLevel contract={top.contract} color={color} open={open} /> : <Empty>This contract is no longer available.</Empty>)}
            {top.type === 'cr' && <CrLevel cr={top.cr} color={color} open={open} />}
            {top.type === 'ir' && <IrLevel ir={top.ir} color={color} />}
            {top.type === 'ipc' && <IpcLevel ipc={top.ipc} color={color} />}
            </>
            )}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
