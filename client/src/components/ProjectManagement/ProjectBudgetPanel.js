/**
 * Main Project budget: the project team writes the budget request (purpose, amount per Sub Project, approvers),
 * sends it to COO → AVP Taj → CEO one after another, and on the last approval each line becomes that Sub Project's
 * budget. Sub Projects can only make sublet contracts inside their budget.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  InputAdornment, LinearProgress, MenuItem, Skeleton, Stack, Step, StepLabel, Stepper, TextField, Tooltip, Typography
} from '@mui/material';
import {
  Add as AddIcon, ArrowDownward as DownIcon, ArrowUpward as UpIcon, CheckCircle as ApproveIcon, Delete as RemoveIcon,
  Edit as EditIcon, Print as PrintIcon, Replay as ReturnIcon, Save as SaveIcon, Send as SubmitIcon, Visibility as PreviewIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import {
  approveBudgetRequest, discardBudgetRevision, getBudgetRequest, returnBudgetRequest, saveBudgetRequest, submitBudgetRequest
} from '../../services/projectManagementService';
import { BORDER, INK, Panel, fmt } from './mainProjectUi';
import { budgetDocFromView, budgetDocumentHtml, printBudgetDocument } from './budgetApprovalDocument';

const MUTED = '#64748b';
const STATUS = {
  Draft: { label: 'Not submitted', color: 'default' },
  Submitted: { label: 'In approval', color: 'warning' },
  Approved: { label: 'Approved', color: 'success' }
};
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The budget document page in an iframe, sized to its content */
export function BudgetDocumentFrame({ doc, minHeight = 900 }) {
  const ref = useRef(null);
  const html = useMemo(() => budgetDocumentHtml(doc), [doc]);
  const fit = () => {
    const d = ref.current?.contentDocument;
    if (d?.documentElement) ref.current.style.height = `${d.documentElement.scrollHeight}px`;
  };
  return (
    <Box component="iframe" ref={ref} title="Budget document" srcDoc={html} onLoad={() => { fit(); setTimeout(fit, 400); }}
      sx={{ width: '100%', border: 0, display: 'block', minHeight, bgcolor: '#eceef1' }} />
  );
}

/** Approve / Return buttons for the approver whose turn it is; approving can cut or add amounts per sub project */
export function BudgetApprovalActions({ projectId, view, onDone, onError }) {
  const [mode, setMode] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(false);
  if (!view?.canApprove) return null;
  const isLast = view.request?.currentStep === (view.request?.approvers?.length || 0) - 1;
  const lines = view.request?.lines || [];
  const requestedOf = (id) => (view.request?.submittedLines || []).find((l) => String(l.subProject) === id)?.amount;
  const committedOf = (id) => view.subProjects.find((s) => String(s._id) === id)?.committed || 0;
  const valueOf = (l) => Number(amounts[String(l.subProject)] ?? l.amount) || 0;
  const changed = lines.filter((l) => Math.abs(valueOf(l) - (Number(l.amount) || 0)) >= 0.005);
  const currentTotal = round(lines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
  const newTotal = round(lines.reduce((t, l) => t + valueOf(l), 0));
  const tooLow = lines.filter((l) => valueOf(l) + 0.5 < committedOf(String(l.subProject)));
  const utilizedTotal = round(lines.reduce((t, l) => t + (Number(l.utilized) || 0), 0));
  const hasUtilized = utilizedTotal > 0;
  const needsReason = mode === 'return' || changed.length > 0;

  const open = (m) => {
    setRemarks('');
    setAmounts(Object.fromEntries(lines.map((l) => [String(l.subProject), String(l.amount ?? '')])));
    setMode(m);
  };
  const act = async () => {
    setBusy(true);
    try {
      const res = mode === 'approve'
        ? await approveBudgetRequest(projectId, remarks, changed.length ? lines.map((l) => ({ subProject: l.subProject, amount: valueOf(l) })) : undefined)
        : await returnBudgetRequest(projectId, remarks);
      setMode(null);
      onDone?.(res.data?.message, res.data?.data);
    } catch (e) {
      onError?.(e.response?.data?.message || 'Could not save your decision');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Stack direction="row" gap={1}>
        <Button variant="contained" color="success" startIcon={<ApproveIcon />} onClick={() => open('approve')} sx={{ textTransform: 'none', fontWeight: 700 }}>
          Approve
        </Button>
        <Button variant="outlined" color="error" startIcon={<ReturnIcon />} onClick={() => open('return')} sx={{ textTransform: 'none', fontWeight: 700 }}>
          Return
        </Button>
      </Stack>
      <Dialog open={Boolean(mode)} onClose={() => !busy && setMode(null)} maxWidth={mode === 'approve' ? 'md' : 'xs'} fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{mode === 'approve' ? `Approve the budget for ${view.project.name}` : 'Return the budget?'}</DialogTitle>
        <DialogContent>
          {mode === 'approve' ? (
            <>
              <Typography variant="body2" sx={{ mb: 1.5 }}>
                {hasUtilized && <><b>Already utilized</b> is what was spent before this project came into the ERP; it is part of the total but cannot be used for new contracts. </>}
                You can cut or add to any sub project&apos;s remaining budget before approving. {isLast
                  ? 'Yours is the final approval: these amounts become the budget and each sub project gets its share.'
                  : 'The next approver will see your amounts.'}
              </Typography>
              <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflowX: 'auto', mb: 2 }}>
                <Box component="table" sx={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 14, '& th, & td': { px: 1.5, py: 1, borderTop: `1px solid ${BORDER}`, textAlign: 'left', verticalAlign: 'top' } }}>
                  <thead>
                    <tr>
                      {['Sub project', ...(hasUtilized ? ['Already utilized'] : []), 'Requested', 'Now', hasUtilized ? 'Your remaining budget' : 'Your amount', ...(hasUtilized ? ['Total budget'] : [])].map((h) => (
                        <Box component="th" key={h} sx={{ bgcolor: '#f8fafc', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', borderTop: '0 !important' }}>{h}</Box>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const id = String(l.subProject);
                      const req = requestedOf(id);
                      const diff = round(valueOf(l) - (Number(l.amount) || 0));
                      const low = valueOf(l) + 0.5 < committedOf(id);
                      return (
                        <tr key={id}>
                          <td>
                            <Typography variant="body2" fontWeight={800} sx={{ color: INK }}>{l.name}</Typography>
                            {l.scope && <Typography variant="caption" sx={{ color: MUTED }}>{l.scope}</Typography>}
                          </td>
                          {hasUtilized && <td><Typography variant="body2" fontWeight={700} sx={{ color: MUTED }}>{fmt(l.utilized || 0)}</Typography></td>}
                          <td><Typography variant="body2" sx={{ color: MUTED }}>{req !== undefined ? fmt(req) : '—'}</Typography></td>
                          <td><Typography variant="body2" fontWeight={700}>{fmt(l.amount)}</Typography></td>
                          <td style={{ width: 200 }}>
                            <TextField
                              size="small" type="number" value={amounts[id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [id]: e.target.value }))}
                              error={low} helperText={low ? `At least ${fmt(committedOf(id))} (in contracts)` : diff ? `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}` : ''}
                              FormHelperTextProps={{ sx: { color: low ? undefined : diff > 0 ? '#b45309' : '#15803d', fontWeight: 700 } }}
                              InputProps={{ startAdornment: <InputAdornment position="start">Rs</InputAdornment>, inputProps: { min: 0 } }}
                            />
                          </td>
                          {hasUtilized && <td><Typography variant="body2" fontWeight={900} sx={{ color: INK, pt: 1 }}>{fmt((Number(l.utilized) || 0) + valueOf(l))}</Typography></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <Box component="td" sx={{ fontWeight: 900, bgcolor: '#f8fafc' }}>Total</Box>
                      {hasUtilized && <Box component="td" sx={{ fontWeight: 800, bgcolor: '#f8fafc' }}>{fmt(utilizedTotal)}</Box>}
                      <Box component="td" sx={{ bgcolor: '#f8fafc' }} />
                      <Box component="td" sx={{ fontWeight: 800, bgcolor: '#f8fafc' }}>{fmt(currentTotal)}</Box>
                      <Box component="td" sx={{ fontWeight: 900, bgcolor: '#f8fafc', color: newTotal !== currentTotal ? (newTotal > currentTotal ? '#b45309' : '#15803d') : INK }}>{fmt(newTotal)}</Box>
                      {hasUtilized && <Box component="td" sx={{ fontWeight: 900, bgcolor: '#f8fafc' }}>{fmt(utilizedTotal + newTotal)}</Box>}
                    </tr>
                  </tfoot>
                </Box>
              </Box>
            </>
          ) : (
            <Typography variant="body2" sx={{ mb: 2 }}>It goes back to the project team with your remarks, and has to be approved again from the start.</Typography>
          )}
          <TextField
            autoFocus={mode === 'return'} fullWidth multiline minRows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)}
            required={needsReason}
            label={mode === 'return' ? 'Why is it being returned?' : changed.length ? 'Why did you change the amounts?' : 'Remarks (optional)'}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setMode(null)} disabled={busy}>Cancel</Button>
          <Button
            variant="contained" color={mode === 'approve' ? 'success' : 'error'} onClick={act}
            disabled={busy || (needsReason && remarks.trim().length < 3) || (mode === 'approve' && (tooLow.length > 0 || newTotal <= 0))}
            startIcon={busy ? <CircularProgress size={14} /> : null}
          >
            {mode === 'approve' ? (changed.length ? `Approve with ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Approve and sign') : 'Return'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** Who approves, in order, and where it stands */
const ApprovalSteps = ({ view }) => {
  const approvers = view.request?.approvers || [];
  if (!approvers.length) return null;
  const active = view.status === 'Submitted' ? view.request.currentStep : view.status === 'Approved' ? approvers.length : -1;
  return (
    <Stepper activeStep={active} alternativeLabel sx={{ mt: 2.5, '& .MuiStepLabel-label': { mt: 0.75 } }}>
      {approvers.map((a, i) => (
        <Step key={`${a.user}-${i}`} completed={a.status === 'Approved'}>
          <StepLabel error={a.status === 'Rejected'}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: INK }}>{a.role}</Typography>
            <Typography sx={{ fontSize: 12, color: MUTED }}>{a.name}</Typography>
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: a.status === 'Approved' ? '#15803d' : a.status === 'Rejected' ? '#dc2626' : i === active ? '#b45309' : MUTED }}>
              {a.status === 'Approved' ? `Approved ${dayjs(a.actedAt).format('DD MMM')}` : a.status === 'Rejected' ? 'Returned' : i === active ? 'Waiting for approval' : 'Pending'}
            </Typography>
            {a.changes?.length > 0 && (
              <Tooltip title={a.changes.map((c) => `${c.name}: ${fmt(c.from)} → ${fmt(c.to)}`).join(' · ')}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#7c3aed', cursor: 'help' }}>Changed {a.changes.length} amount{a.changes.length === 1 ? '' : 's'}</Typography>
              </Tooltip>
            )}
          </StepLabel>
        </Step>
      ))}
    </Stepper>
  );
};

/** The request form: purpose, amount per Sub Project, remarks and approvers */
const RequestForm = ({ view, form, setForm }) => {
  const total = round(form.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
  const utilizedTotal = round(form.lines.reduce((t, l) => t + (Number(l.utilized) || 0), 0));
  // Revising an approved budget: show what each sub project has now, and mark new ones
  const approvedLines = view.approved ? new Map(view.approved.lines.map((l) => [String(l.subProject), Number(l.amount) || 0])) : null;
  const approvedTotal = view.approved ? Number(view.approved.amount) || 0 : 0;
  const setLine = (id, field, value) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (String(l.subProject) === id ? { ...l, [field]: value } : l)) }));
  const setApprover = (i, patch) => setForm((f) => ({ ...f, approvers: f.approvers.map((a, k) => (k === i ? { ...a, ...patch } : a)) }));
  const move = (i, d) => setForm((f) => {
    const list = [...f.approvers];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    return { ...f, approvers: list };
  });
  const candidates = view.candidates || [];

  return (
    <Stack gap={2}>
      <Panel title="1. Purpose and scope">
        <TextField
          fullWidth multiline minRows={3} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
          placeholder={`What is this budget for? e.g. Construction of ${view.subProjects.length || 'the'} villas in ${view.project.sector || view.project.society || 'the sector'} — grey structure, finishes and external works, ${view.project.contractBasis === 'Slab' ? 'paid in stages (slabs)' : 'paid on measured BOQ quantities'}.`}
          helperText="The approvers read this first — say what will be built, why, and anything they should know"
        />
      </Panel>

      <Panel title="2. Budget by sub project">
        <Typography variant="body2" sx={{ color: MUTED, mb: 1.5 }}>
          For an ongoing project, enter what each sub project has <b>already utilized</b> (spent before it came into the ERP) and its <b>remaining budget</b>. Total budget = already utilized + remaining. New contracts can only use the remaining budget.
        </Typography>
        {!view.subProjects.length ? (
          <Alert severity="info">Create the sub projects first — the budget is split among them.</Alert>
        ) : (
          <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse', fontSize: 14, '& th, & td': { px: 1.5, py: 1.1, borderTop: `1px solid ${BORDER}`, textAlign: 'left', verticalAlign: 'top' } }}>
              <thead>
                <tr>
                  {['Sub project', 'Scope of work covered', 'Already utilized', ...(approvedLines ? ['Approved now'] : []), approvedLines ? 'Revised remaining budget' : 'Remaining budget', 'Total budget'].map((h) => (
                    <Box component="th" key={h} sx={{ bgcolor: '#f8fafc', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', borderTop: '0 !important' }}>{h}</Box>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.subProjects.map((s) => {
                  const id = String(s._id);
                  const line = form.lines.find((l) => String(l.subProject) === id) || { amount: '', utilized: '', scope: '' };
                  const tooLow = s.committed > 0 && (Number(line.amount) || 0) + 0.5 < s.committed;
                  return (
                    <tr key={id}>
                      <td style={{ width: 200 }}>
                        <Stack direction="row" alignItems="center" gap={0.75}>
                          <Typography variant="body2" fontWeight={800} sx={{ color: INK }}>{s.name}</Typography>
                          {approvedLines && !approvedLines.get(id) && <Chip size="small" label="New" color="info" sx={{ height: 18, fontSize: 10.5, fontWeight: 800 }} />}
                        </Stack>
                        <Typography variant="caption" sx={{ color: MUTED, display: 'block' }}>{[s.projectNumber, s.sector].filter(Boolean).join(' · ')}</Typography>
                        {s.committed > 0 && <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>{fmt(s.committed)} already in contracts</Typography>}
                      </td>
                      <td>
                        <TextField fullWidth size="small" multiline maxRows={4} value={line.scope} onChange={(e) => setLine(id, 'scope', e.target.value)}
                          placeholder="e.g. Grey structure + finishes of 5 villas, boundary wall" />
                      </td>
                      <td style={{ width: 190 }}>
                        <TextField
                          size="small" type="number" value={line.utilized ?? ''} onChange={(e) => setLine(id, 'utilized', e.target.value)}
                          helperText="Spent before the ERP" FormHelperTextProps={{ sx: { mx: 0 } }}
                          InputProps={{ startAdornment: <InputAdornment position="start">Rs</InputAdornment>, inputProps: { min: 0 } }}
                        />
                      </td>
                      {approvedLines && (
                        <td style={{ width: 130 }}>
                          <Typography variant="body2" fontWeight={700} sx={{ color: approvedLines.get(id) ? INK : MUTED, pt: 1 }}>{approvedLines.get(id) ? fmt(approvedLines.get(id)) : '—'}</Typography>
                          {(Number(line.amount) || 0) !== (approvedLines.get(id) || 0) && (
                            <Typography variant="caption" fontWeight={800} sx={{ color: (Number(line.amount) || 0) > (approvedLines.get(id) || 0) ? '#b45309' : '#15803d' }}>
                              {(Number(line.amount) || 0) > (approvedLines.get(id) || 0) ? '+' : '−'}{fmt(Math.abs((Number(line.amount) || 0) - (approvedLines.get(id) || 0)))}
                            </Typography>
                          )}
                        </td>
                      )}
                      <td style={{ width: 210 }}>
                        <TextField
                          size="small" type="number" value={line.amount} onChange={(e) => setLine(id, 'amount', e.target.value)} error={tooLow}
                          helperText={tooLow ? `At least ${fmt(s.committed)}` : 'For new contracts'} FormHelperTextProps={{ sx: { mx: 0 } }}
                          InputProps={{ startAdornment: <InputAdornment position="start">Rs</InputAdornment>, inputProps: { min: 0 } }}
                        />
                      </td>
                      <td style={{ width: 140 }}>
                        <Typography variant="body2" fontWeight={900} sx={{ color: INK, pt: 1 }}>{fmt((Number(line.utilized) || 0) + (Number(line.amount) || 0))}</Typography>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <Box component="td" colSpan={2} sx={{ fontWeight: 900, bgcolor: '#f8fafc' }}>{approvedLines ? 'Total' : 'Total budget requested'}</Box>
                  <Box component="td" sx={{ fontWeight: 800, bgcolor: '#f8fafc' }}>{fmt(utilizedTotal)}</Box>
                  {approvedLines && <Box component="td" sx={{ fontWeight: 800, bgcolor: '#f8fafc' }}>{fmt(approvedTotal)}</Box>}
                  <Box component="td" sx={{ fontWeight: 900, bgcolor: '#f8fafc', fontSize: 16 }}>
                    {fmt(total)}
                    {approvedLines && total !== approvedTotal && (
                      <Typography component="span" sx={{ ml: 1, fontSize: 12, fontWeight: 800, color: total > approvedTotal ? '#b45309' : '#15803d' }}>
                        ({total > approvedTotal ? '+' : '−'}{fmt(Math.abs(total - approvedTotal))})
                      </Typography>
                    )}
                  </Box>
                  <Box component="td" sx={{ fontWeight: 900, bgcolor: '#f8fafc', fontSize: 16 }}>{fmt(utilizedTotal + total)}</Box>
                </tr>
              </tfoot>
            </Box>
          </Box>
        )}
      </Panel>

      <Panel title="3. Assumptions and remarks (optional)">
        <TextField
          fullWidth multiline minRows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="e.g. Rates as per market survey of Oct 2026; 5% contingency included; excludes land and approvals."
        />
      </Panel>

      <Panel
        title="4. Approved by (in this order)"
        action={<Button size="small" startIcon={<AddIcon />} disabled={form.approvers.length >= 6} onClick={() => setForm((f) => ({ ...f, approvers: [...f.approvers, { role: '', user: '' }] }))} sx={{ textTransform: 'none', fontWeight: 700 }}>Add approver</Button>}
      >
        <Typography variant="body2" sx={{ color: MUTED, mb: 1.5 }}>Each person approves after the one above; the last approval puts the budget in force.</Typography>
        <Stack gap={1.25}>
          {form.approvers.map((a, i) => (
            <Stack key={i} direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}>
              <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: '#0f766e', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{i + 1}</Box>
              <TextField size="small" label="Role on the document" value={a.role} onChange={(e) => setApprover(i, { role: e.target.value })} sx={{ width: { sm: 230 } }} />
              <TextField
                select size="small" label="Person" value={a.user || ''} onChange={(e) => setApprover(i, { user: e.target.value })} sx={{ flex: 1, minWidth: 220 }}
                error={!a.user} helperText={!a.user ? 'Choose who signs' : ''}
              >
                {candidates.map((c) => <MenuItem key={c._id} value={c._id}>{c.name}{c.designation ? ` — ${c.designation}` : ''}</MenuItem>)}
              </TextField>
              <Stack direction="row">
                <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}><UpIcon fontSize="small" /></IconButton>
                <IconButton size="small" disabled={i === form.approvers.length - 1} onClick={() => move(i, 1)}><DownIcon fontSize="small" /></IconButton>
                <IconButton size="small" color="error" disabled={form.approvers.length <= 1} onClick={() => setForm((f) => ({ ...f, approvers: f.approvers.filter((_, k) => k !== i) }))}><RemoveIcon fontSize="small" /></IconButton>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Panel>
    </Stack>
  );
};

/** Form state from the server view: saved request, or a fresh one pre-filled with every Sub Project and the default approvers */
const formFromView = (view) => {
  const r = view.request;
  const lines = view.subProjects.map((s) => {
    const saved = (r?.lines || []).find((l) => String(l.subProject) === String(s._id));
    return {
      subProject: String(s._id),
      scope: saved?.scope || '',
      utilized: saved ? String(saved.utilized || '') : (s.utilizedBudget ? String(s.utilizedBudget) : ''),
      amount: saved ? String(saved.amount || '') : (s.allocatedBudget ? String(s.allocatedBudget) : '')
    };
  });
  const approvers = r?.approvers?.length
    ? r.approvers.map((a) => ({ role: a.role, user: String(a.user || '') }))
    : (view.suggestedApprovers || []).map((a) => ({ role: a.role, user: a.user || '' }));
  return { purpose: r?.purpose || '', notes: r?.notes || '', lines, approvers };
};

export default function ProjectBudgetPanel({ project, onRefresh }) {
  const [view, setView] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const apply = useCallback((v) => {
    setView(v);
    setForm(formFromView(v));
    setEditing(v.status === 'Draft');
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await getBudgetRequest(project._id);
      apply(res.data?.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load the budget');
    }
  }, [project._id, apply]);
  useEffect(() => { load(); }, [load]);

  const payload = () => ({
    purpose: form.purpose,
    notes: form.notes,
    lines: form.lines.map((l) => ({ subProject: l.subProject, scope: l.scope, utilized: Number(l.utilized) || 0, amount: Number(l.amount) || 0 })),
    approvers: form.approvers.filter((a) => a.user)
  });

  const run = async (key, fn) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const res = await fn();
      if (res?.data?.data) {
        // The approvers' list from the save is complete; keep the picker list from the first load
        apply({ ...res.data.data, candidates: view?.candidates });
      }
      setNotice(res?.data?.message || 'Saved');
      onRefresh?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Something went wrong');
    } finally {
      setBusy('');
    }
  };

  if (!view || !form) {
    return error ? <Alert severity="error">{error}</Alert> : <Skeleton variant="rounded" height={320} sx={{ borderRadius: 3 }} />;
  }

  const inForce = Boolean(view.approved) || view.status === 'Approved';
  // With an approved budget in force, Draft / Submitted describe a revision of it
  const st = inForce && view.status === 'Submitted' ? { label: 'Revision in approval', color: 'warning' }
    : inForce && view.status === 'Draft' ? { label: 'Revision being prepared', color: 'info' }
      : STATUS[view.status] || STATUS.Draft;
  const discard = () => run('discard', () => discardBudgetRevision(project._id));
  const draftDoc = budgetDocFromView({ ...view, request: { ...(view.request || {}), ...payload(), approvers: form.approvers.filter((a) => a.user).map((a) => ({ ...a, ...(view.candidates || []).find((c) => c._id === a.user), status: 'Pending' })) } });
  const savedDoc = budgetDocFromView(view);
  const formTotal = round(form.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
  const formUtilized = round(form.lines.reduce((t, l) => t + (Number(l.utilized) || 0), 0));
  const headUtilized = editing ? formUtilized : Number(view.utilizedAmount) || 0;
  const headRemaining = editing ? formTotal : Number(view.amount) || 0;
  const missing = [
    form.purpose.trim().length < 10 && 'purpose and scope',
    formTotal <= 0 && 'budget for at least one sub project',
    (!form.approvers.length || form.approvers.some((a) => !a.user)) && 'a person for every approver'
  ].filter(Boolean);
  const subs = view.subProjects;
  const totalCommitted = subs.reduce((t, s) => t + s.committed, 0);

  return (
    <Stack gap={2}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}

      <Panel title="Project budget" action={<Chip label={st.label} color={st.color} sx={{ fontWeight: 800 }} />}>
        <Stack direction={{ xs: 'column', md: 'row' }} gap={2} justifyContent="space-between" alignItems={{ md: 'center' }}>
          <Box>
            {inForce && view.status !== 'Approved' && (
              <Typography variant="caption" sx={{ color: '#15803d', fontWeight: 800, display: 'block' }}>
                In force: {fmt((Number(view.approvedAmount) || 0) + (Number(view.approvedUtilized) || 0))}{view.approvedDocumentNo ? ` (${view.approvedDocumentNo})` : ''} — contracts continue within it. Revision:
              </Typography>
            )}
            <Typography sx={{ fontSize: 30, fontWeight: 900, color: INK, lineHeight: 1.1 }}>{fmt(headUtilized + headRemaining)}</Typography>
            {headUtilized > 0 && (
              <Typography variant="body2" sx={{ color: INK, fontWeight: 700, mt: 0.25 }}>
                {fmt(headUtilized)} already utilized + {fmt(headRemaining)} remaining for contracts
              </Typography>
            )}
            <Typography variant="body2" sx={{ color: MUTED, mt: 0.5 }}>
              {view.documentNo}
              {view.status === 'Approved' && view.approvedAt && ` · approved ${dayjs(view.approvedAt).format('DD MMM YYYY')}`}
              {view.status === 'Submitted' && view.currentApprover && ` · waiting for ${view.currentApprover.name} (${view.currentApprover.role})`}
              {view.status === 'Draft' && (inForce ? ' · revision not sent yet' : view.request?.revision ? ' · returned, not sent again yet' : ' · not sent yet')}
            </Typography>
          </Box>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => { if (!printBudgetDocument(editing ? draftDoc : savedDoc)) setError('Allow pop-ups to print'); }} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Print
            </Button>
            {view.status === 'Approved' && !editing && (
              <Tooltip title="Change the amounts or split. It goes through approval again and new contracts wait until then.">
                <Button variant="outlined" color="warning" startIcon={<EditIcon />} onClick={() => setEditing(true)} sx={{ textTransform: 'none', fontWeight: 700 }}>Revise budget</Button>
              </Tooltip>
            )}
            {inForce && view.status === 'Draft' && (
              <Tooltip title="Throw away this revision and keep the approved budget as it is">
                <Button variant="outlined" color="inherit" disabled={Boolean(busy)} onClick={discard} sx={{ textTransform: 'none', fontWeight: 700 }}>Discard revision</Button>
              </Tooltip>
            )}
            <BudgetApprovalActions projectId={project._id} view={view} onDone={(msg) => { setNotice(msg); load(); onRefresh?.(); }} onError={setError} />
          </Stack>
        </Stack>
        <ApprovalSteps view={view} />
        {view.request?.returned?.at && view.status === 'Draft' && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Returned by <b>{view.request.returned.name}</b> ({view.request.returned.role}) on {dayjs(view.request.returned.at).format('DD MMM YYYY')}: {view.request.returned.remarks}
          </Alert>
        )}
        {!inForce && (
          <Alert severity="warning" sx={{ mt: 2 }}>Until this budget is approved, no sublet contracts can be made in {project.name}&apos;s sub projects.</Alert>
        )}
        {view.newSubProjects?.length > 0 && !editing && (
          <Alert
            severity="info" sx={{ mt: 2 }}
            action={view.status === 'Approved' && (
              <Button color="inherit" size="small" startIcon={<AddIcon />} onClick={() => setEditing(true)} sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>Add to budget</Button>
            )}
          >
            <b>{view.newSubProjects.map((s) => s.name).join(', ')}</b> {view.newSubProjects.length === 1 ? 'is' : 'are'} not in the approved budget, so {view.newSubProjects.length === 1 ? 'it' : 'they'} cannot make contracts yet.
            {view.status === 'Approved'
              ? ' Add them with a budget revision — the current budget stays in force while the revision is approved.'
              : ' Give them an amount in the revision below and send it for approval.'}
          </Alert>
        )}
      </Panel>

      {editing ? (
        <>
          {inForce && <Alert severity="info">You are revising the approved budget. It stays in force — existing sub projects keep making contracts within their current share — until this revision is approved by everyone. New sub projects get their share when it is approved.</Alert>}
          <RequestForm view={view} form={form} setForm={setForm} />
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="flex-end" alignItems={{ sm: 'center' }} gap={1}>
            {missing.length > 0 && <Typography variant="body2" sx={{ color: '#b45309', mr: 'auto' }}>To send it, add: {missing.join(', ')}.</Typography>}
            {view.status === 'Approved' && <Button onClick={() => { setForm(formFromView(view)); setEditing(false); }} sx={{ textTransform: 'none' }}>Cancel revision</Button>}
            <Button variant="outlined" startIcon={<PreviewIcon />} onClick={() => setPreview(true)} sx={{ textTransform: 'none', fontWeight: 700 }}>Preview document</Button>
            <Button
              variant="outlined" startIcon={busy === 'save' ? <CircularProgress size={14} /> : <SaveIcon />} disabled={Boolean(busy)}
              onClick={() => run('save', () => saveBudgetRequest(project._id, payload()))} sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Save draft
            </Button>
            <Button
              variant="contained" startIcon={busy === 'submit' ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <SubmitIcon />}
              disabled={Boolean(busy) || missing.length > 0}
              onClick={() => run('submit', async () => { await saveBudgetRequest(project._id, payload()); return submitBudgetRequest(project._id); })}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Send for approval
            </Button>
          </Stack>
        </>
      ) : (
        <>
          <Panel title={inForce ? 'Budget in force per sub project' : 'Requested per sub project'} action={<Typography variant="caption" sx={{ color: MUTED }}>{fmt(totalCommitted)} of {fmt(inForce ? view.approvedAmount : view.amount)} in contracts</Typography>}>
            <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflowX: 'auto' }}>
              <Box component="table" sx={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: 14, '& th, & td': { px: 1.5, py: 1.1, borderTop: `1px solid ${BORDER}`, textAlign: 'left' } }}>
                <thead>
                  <tr>
                    {['Sub project', 'Already utilized', inForce ? 'Remaining budget' : 'Requested', 'Total budget', 'In contracts', 'Left for contracts', 'Used'].map((h) => (
                      <Box component="th" key={h} sx={{ bgcolor: '#f8fafc', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', borderTop: '0 !important' }}>{h}</Box>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => {
                    const line = (view.request?.lines || []).find((l) => String(l.subProject) === String(s._id));
                    const share = inForce ? s.allocatedBudget : Number(line?.amount) || 0;
                    const utilized = inForce ? Number(s.utilizedBudget) || 0 : Number(line?.utilized) || 0;
                    const left = round(share - s.committed);
                    return (
                      <tr key={s._id}>
                        <td>
                          <Typography variant="body2" fontWeight={800} sx={{ color: INK }}>{s.name}</Typography>
                          {line?.scope && <Typography variant="caption" sx={{ color: MUTED }}>{line.scope}</Typography>}
                        </td>
                        <td><Typography variant="body2" sx={{ color: utilized ? INK : MUTED }}>{utilized ? fmt(utilized) : '—'}</Typography></td>
                        <td><Typography variant="body2" fontWeight={800}>{fmt(share)}</Typography></td>
                        <td><Typography variant="body2" fontWeight={900}>{fmt(utilized + share)}</Typography></td>
                        <td>{fmt(s.committed)}</td>
                        <td>
                          <Typography variant="body2" fontWeight={800} sx={{ color: !inForce ? MUTED : !share ? '#b45309' : left <= 0 ? '#dc2626' : '#15803d' }}>
                            {!inForce ? 'After approval' : share ? fmt(left) : 'Not in budget — contracts blocked'}
                          </Typography>
                        </td>
                        <td style={{ width: 140 }}>
                          <LinearProgress variant="determinate" value={Math.min(100, pct(s.committed, share))} color={pct(s.committed, share) >= 90 ? 'error' : 'primary'} sx={{ height: 6, borderRadius: 3 }} />
                          <Typography variant="caption" sx={{ color: MUTED }}>{share ? `${pct(s.committed, share)}%` : '—'}</Typography>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            </Box>
          </Panel>
          <Panel title="Budget document" sx={{ p: 0, overflow: 'hidden' }}>
            <BudgetDocumentFrame doc={savedDoc} />
          </Panel>
        </>
      )}

      <Dialog open={preview} onClose={() => setPreview(false)} maxWidth="md" fullWidth PaperProps={{ sx: { height: '92vh' } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${BORDER}` }}>
          <Typography fontWeight={800}>Preview — this is what the approvers will see</Typography>
          <Stack direction="row" gap={1}>
            <Button size="small" startIcon={<PrintIcon />} onClick={() => printBudgetDocument(draftDoc)}>Print</Button>
            <Button size="small" onClick={() => setPreview(false)}>Close</Button>
          </Stack>
        </Stack>
        <Box sx={{ flex: 1, overflowY: 'auto' }}><BudgetDocumentFrame doc={draftDoc} /></Box>
      </Dialog>
    </Stack>
  );
}

/** Sub Project: its share of the Main Project budget and what is left for contracts */
export function SubBudgetStrip({ project }) {
  const b = project.budgetAllocation;
  const main = project.parentProject;
  if (!b || !main) return null;
  const mine = b.subProjects.find((s) => String(s._id) === String(project._id));
  const share = mine?.allocatedBudget || 0;
  const utilized = mine?.utilizedBudget || 0;
  const committed = mine?.committed || 0;
  const left = round(share - committed);
  const inForce = b.inForce ?? b.budgetStatus === 'Approved';
  const blocked = !inForce ? `${main.name || 'The Main Project'}'s budget is ${b.budgetStatus === 'Submitted' ? 'in approval' : 'not approved yet'}`
    : !share ? `${project.name} is not in ${main.name || 'the Main Project'}'s approved budget yet${b.budgetStatus === 'Submitted' ? ' (a revision is in approval)' : ''}` : null;
  return (
    <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, border: `1px solid ${blocked ? '#fcd34d' : BORDER}`, bgcolor: blocked ? '#fffbeb' : '#f8fafc' }}>
      {blocked ? (
        <Typography variant="body2" sx={{ color: '#92400e', fontWeight: 700 }}>
          {blocked} — new sublet contracts are blocked until it is. The budget is prepared on the Main Project&apos;s Budget page.
        </Typography>
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={{ xs: 1, sm: 3 }} alignItems={{ sm: 'center' }}>
          {[
            ...(utilized > 0 ? [['Total budget', utilized + share, INK], ['Already utilized', utilized, MUTED], ['Remaining budget', share, INK]] : [['Budget', share, INK]]),
            ['In contracts', committed, INK], ['Left for contracts', left, left > 0 ? '#15803d' : '#dc2626']
          ].map(([label, v, c]) => (
            <Box key={label}>
              <Typography variant="caption" sx={{ color: MUTED, fontWeight: 700, textTransform: 'uppercase' }}>{label}</Typography>
              <Typography sx={{ fontWeight: 900, color: c }}>{fmt(v)}</Typography>
            </Box>
          ))}
          <Box sx={{ flex: 1, minWidth: 160 }}>
            <LinearProgress variant="determinate" value={Math.min(100, pct(committed, share))} color={pct(committed, share) >= 90 ? 'error' : 'primary'} sx={{ height: 8, borderRadius: 4 }} />
            <Typography variant="caption" sx={{ color: MUTED }}>{pct(committed, share)}% of its budget is in contracts</Typography>
          </Box>
        </Stack>
      )}
    </Box>
  );
}
