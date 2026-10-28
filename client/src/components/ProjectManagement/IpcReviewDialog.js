import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, Grid, Link, Skeleton, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography
} from '@mui/material';
import dayjs from 'dayjs';
import { getIpcDossier } from '../../services/projectManagementService';
import { getImageUrl } from '../../utils/imageService';
import { DigitalSignatureImage } from '../common/DigitalSignatureImage';
import IpcApprovalTrail, { ipcStageText } from './IpcApprovalTrail';
import { certificateTitle, day, ipcCertificateHtml, money, pkr, printIpcCertificate } from './ipcCertificateDocument';

// Same quiet document style as the certificate: hairline rules, small uppercase labels, no colour
const INK = '#18181b';
const MUTED = '#71717a';
const RULE = '#e4e4e7';
const label = { fontSize: 10, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: MUTED };
const docTable = {
  '& th': { ...label, borderBottom: `1px solid ${INK}`, py: 0.75, px: 1, whiteSpace: 'nowrap' },
  '& td': { borderBottom: `1px solid ${RULE}`, py: 1, px: 1, fontSize: 13, color: INK, verticalAlign: 'top' },
  '& th:first-of-type, & td:first-of-type': { pl: 0 },
  '& th:last-of-type, & td:last-of-type': { pr: 0 },
  '& .MuiTableCell-alignRight': { fontVariantNumeric: 'tabular-nums' }
};

/** White page on the grey canvas, headed like the certificate */
const Sheet = ({ kicker, title, children }) => (
  <Box sx={{ bgcolor: '#fff', border: '1px solid #dcdfe4', maxWidth: 820, mx: 'auto', px: { xs: 3, sm: 7 }, py: { xs: 3, sm: 6 }, mb: 3 }}>
    <Box sx={{ borderBottom: `2px solid ${INK}`, pb: 2, mb: 1 }}>
      <Typography sx={label}>{kicker}</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 300, color: INK, lineHeight: 1.25, mt: 0.5 }}>{title}</Typography>
    </Box>
    {children}
  </Box>
);

const Heading = ({ children }) => (
  <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK, mt: 4, mb: 1 }}>
    {children}
  </Typography>
);

/** Label / value pairs in two columns, separated by hairlines */
const Facts = ({ rows }) => (
  <Grid container columnSpacing={5}>
    {rows.filter(Boolean).map(([k, v]) => (
      <Grid item xs={12} sm={6} key={k}>
        <Box sx={{ py: 1.25, borderBottom: `1px solid ${RULE}` }}>
          <Typography sx={label}>{k}</Typography>
          <Typography sx={{ fontSize: 13.5, color: INK, fontWeight: 500 }}>{v || '—'}</Typography>
        </Box>
      </Grid>
    ))}
  </Grid>
);

const Evidence = ({ attachments }) => {
  const images = attachments.filter((a) => a.kind === 'image');
  const videos = attachments.filter((a) => a.kind === 'video');
  if (!images.length && !videos.length) return <Typography sx={{ fontSize: 13, color: MUTED }}>No site evidence attached.</Typography>;
  return (
    <Grid container spacing={1}>
      {images.map((a, i) => (
        <Grid item xs={4} sm={3} key={a.url}>
          <Link href={getImageUrl(a.url)} target="_blank" rel="noopener">
            <Box component="img" src={getImageUrl(a.url)} alt={a.originalName || `Photograph ${i + 1}`}
              sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block', border: `1px solid ${RULE}` }} />
          </Link>
        </Grid>
      ))}
      {videos.map((a) => (
        <Grid item xs={12} sm={6} key={a.url}>
          <Box component="video" src={getImageUrl(a.url)} controls preload="metadata" sx={{ width: '100%', display: 'block', border: `1px solid ${RULE}` }} />
        </Grid>
      ))}
    </Grid>
  );
};

/** The certificate page itself, in an iframe so it is exactly what prints */
const CertificateFrame = ({ dossier }) => {
  const ref = useRef(null);
  const html = useMemo(() => ipcCertificateHtml(dossier), [dossier]);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.documentElement) ref.current.style.height = `${doc.documentElement.scrollHeight}px`;
  };
  return (
    <Box component="iframe" ref={ref} title="Certificate" srcDoc={html} onLoad={() => { fit(); setTimeout(fit, 400); }}
      sx={{ width: '100%', border: 0, display: 'block', minHeight: 900, bgcolor: '#eceef1' }} />
  );
};

const position = (p) => p && [
  ['Contract value', money(p.contractValue)],
  ['Certified previously (approved)', money(p.certifiedApproved)],
  ['Certified previously (in approval)', money(p.certifiedInApproval)],
  ['This certificate', money(p.thisIpc)],
  [`Certified to date${p.percent != null ? ` (${p.percent}%)` : ''}`, money(p.certifiedToDate)],
  ['Balance of contract', money(p.remaining)]
];

/**
 * Review file of an IPC for every desk in the chain (Pre-Audit, Audit Director, CEO Secretariat, CEO, Finance):
 * the certificate plus the contract, check request, inspections with site evidence, payment history and project
 * documents. Each page keeps its own Approve / Reject buttons; `actions` renders them here.
 */
export default function IpcReviewDialog({ ipcId, open, onClose, actions = null }) {
  const [dossier, setDossier] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('certificate');

  useEffect(() => {
    if (!open || !ipcId) return;
    setDossier(null);
    setError('');
    setTab('certificate');
    getIpcDossier(ipcId)
      .then((res) => setDossier(res.data?.data || null))
      .catch((err) => setError(err.response?.data?.message || 'Could not load the IPC'));
  }, [open, ipcId]);

  const ipc = dossier?.ipc;
  const evidenceCount = useMemo(
    () => (dossier?.inspections || []).reduce((t, r) => t + r.inspectors.reduce((u, i) => u + i.attachments.length, 0), 0),
    [dossier]
  );
  const documents = dossier ? [
    ...(dossier.mainProject?.documents || []).map((d) => ({ ...d, owner: dossier.mainProject.name })),
    ...(dossier.subProject?.documents || []).map((d) => ({ ...d, owner: dossier.subProject.name }))
  ] : [];
  const tabs = dossier ? [
    { key: 'certificate', label: 'Certificate' },
    { key: 'contract', label: 'Contract', hide: !dossier.contract },
    { key: 'check', label: 'Check Request', hide: !dossier.checkRequest },
    { key: 'inspection', label: `Inspection${evidenceCount ? ` · ${evidenceCount} files` : ''}`, hide: !dossier.inspections.length },
    { key: 'history', label: `Payment history · ${dossier.previousIpcs.length}` },
    { key: 'project', label: `Project & documents${documents.length ? ` · ${documents.length}` : ''}` },
    { key: 'approvals', label: 'Approvals' }
  ].filter((t) => !t.hide) : [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '94vh', borderRadius: 1 } }}>
      {/* Top bar */}
      <Stack direction="row" alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" sx={{ px: { xs: 2, sm: 3 }, py: 1.75, borderBottom: `1px solid ${RULE}` }}>
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: INK }} noWrap>
            {ipc ? `${certificateTitle(ipc)}${ipc.invoiceType === 'Client_Invoice' ? '' : ` No. ${String(ipc.ipcNumber || 1).padStart(2, '0')}`}` : 'Loading'}
          </Typography>
          {ipc && (
            <Typography sx={{ fontSize: 12.5, color: MUTED }} noWrap>
              {ipc.invoiceNumber} · {[dossier.mainProject?.name, dossier.subProject?.name].filter(Boolean).join(' / ')} · {ipcStageText(ipc)}
            </Typography>
          )}
        </Box>
        {ipc && (
          <Box sx={{ textAlign: 'right', pr: 1, display: { xs: 'none', sm: 'block' } }}>
            <Typography sx={label}>{ipc.invoiceType === 'Client_Invoice' ? 'Receivable' : 'Net payable'}</Typography>
            <Typography noWrap sx={{ fontSize: 18, fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums' }}>{pkr(ipc.netPayableAmount || ipc.invoiceAmount)}</Typography>
          </Box>
        )}
        {dossier && (
          <Button variant="outlined" color="inherit" size="small"
            onClick={() => { if (!printIpcCertificate(dossier)) setError('Allow pop-ups for this site to print the certificate'); }}>
            Print
          </Button>
        )}
        <Button color="inherit" size="small" onClick={onClose}>Close</Button>
      </Stack>

      {dossier && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
          TabIndicatorProps={{ sx: { bgcolor: INK, height: 2 } }}
          sx={{ px: 2, minHeight: 42, borderBottom: `1px solid ${RULE}`,
            '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontSize: 13.5, color: MUTED, px: 1.5, minWidth: 0 },
            '& .Mui-selected': { color: `${INK} !important`, fontWeight: 600 } }}>
          {tabs.map((t) => <Tab key={t.key} value={t.key} label={t.label} disableRipple />)}
        </Tabs>
      )}

      {/* Grey canvas with the document pages */}
      <Box sx={{ flex: 1, overflowY: 'auto', bgcolor: '#eceef1', p: tab === 'certificate' ? 0 : { xs: 1.5, sm: 3.5 } }}>
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        {!dossier && !error && (
          <Box sx={{ maxWidth: 820, mx: 'auto', mt: 4, bgcolor: '#fff', p: 6 }}><Skeleton height={40} /><Skeleton height={160} /><Skeleton height={220} /></Box>
        )}

        {dossier && tab === 'certificate' && <CertificateFrame dossier={dossier} />}

        {dossier && tab === 'contract' && dossier.contract && (
          <Sheet kicker="Sublet contract" title={`${dossier.contract.contractNumber} · ${dossier.contract.title}`}>
            <Facts rows={[
              ['Subcontractor', dossier.contractor?.name],
              ['Contract type', `${dossier.contract.contractType}-wise`],
              ['Contract value', pkr(dossier.contract.totalAmount)],
              ['Status', dossier.contract.status],
              ['Period', `${day(dossier.contract.startDate)} to ${day(dossier.contract.endDate)}`],
              ['Prepared by', dossier.contract.createdBy]
            ]} />
            {dossier.contract.notes && (<><Heading>Terms and notes</Heading><Typography sx={{ fontSize: 13.5, color: INK, whiteSpace: 'pre-wrap' }}>{dossier.contract.notes}</Typography></>)}
            {dossier.contractProgress && (
              <>
                <Heading>Contract position (PKR)</Heading>
                <Table size="small" sx={docTable}><TableBody>
                  {position(dossier.contractProgress).map(([k, v]) => <TableRow key={k}><TableCell>{k}</TableCell><TableCell align="right">{v}</TableCell></TableRow>)}
                </TableBody></Table>
              </>
            )}
            <Heading>{dossier.contract.contractType === 'Slab' ? 'Payment stages' : 'Bill of quantities'}</Heading>
            {dossier.contract.contractType === 'Slab' ? (
              <Table size="small" sx={docTable}>
                <TableHead><TableRow><TableCell>Stage</TableCell><TableCell>Activities covered</TableCell><TableCell align="right">Share</TableCell><TableCell align="right">Amount</TableCell></TableRow></TableHead>
                <TableBody>
                  {dossier.contract.slabs.map((s) => {
                    const current = s.name === ipc.checkRequest?.slab?.name;
                    return (
                      <TableRow key={s.name} sx={current ? { '& td': { fontWeight: 600 } } : undefined}>
                        <TableCell>{s.name}{current ? ' (this certificate)' : ''}</TableCell>
                        <TableCell>{s.activities.join(', ') || '—'}</TableCell>
                        <TableCell align="right">{s.percentage}%</TableCell>
                        <TableCell align="right">{money(s.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <Table size="small" sx={docTable}>
                <TableHead><TableRow><TableCell>Item</TableCell><TableCell>Unit</TableCell><TableCell align="right">Quantity</TableCell><TableCell align="right">Rate</TableCell><TableCell align="right">Amount</TableCell></TableRow></TableHead>
                <TableBody>
                  {dossier.contract.items.map((i, idx) => (
                    <TableRow key={idx}><TableCell>{i.title}</TableCell><TableCell>{i.unit}</TableCell><TableCell align="right">{money(i.quantity)}</TableCell><TableCell align="right">{money(i.unitPrice)}</TableCell><TableCell align="right">{money(i.amount)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Sheet>
        )}

        {dossier && tab === 'check' && dossier.checkRequest && (() => {
          const cr = dossier.checkRequest;
          return (
            <Sheet kicker="Check request" title={`${cr.checkRequestNumber} · ${cr.title}`}>
              <Facts rows={[
                ['Claim', cr.claimType === 'Slab' ? `Payment stage “${cr.slab?.name || ''}”, ${cr.slab?.percentage || 0}%` : 'BOQ quantities'],
                ['Status', cr.status],
                cr.activity && ['Activity', cr.activity],
                ['Submitted', `${day(cr.submittedAt)}${cr.submittedBy ? `, ${cr.submittedBy}` : ''}`],
                ['Verified', `${day(cr.verifiedAt)}${cr.verifiedBy ? `, ${cr.verifiedBy}` : ''}`],
                ['Amount claimed', pkr(cr.claimedTotal)],
                ['Amount verified', pkr(cr.verifiedTotal)]
              ]} />
              {cr.verificationNotes && (<><Heading>Verification notes</Heading><Typography sx={{ fontSize: 13.5, color: INK }}>{cr.verificationNotes}</Typography></>)}
              {cr.items.length > 0 && (
                <>
                  <Heading>Quantities</Heading>
                  <Table size="small" sx={docTable}>
                    <TableHead><TableRow><TableCell>Item</TableCell><TableCell>Unit</TableCell><TableCell align="right">Claimed</TableCell><TableCell align="right">Verified</TableCell><TableCell align="right">Rate</TableCell><TableCell align="right">Verified amount</TableCell></TableRow></TableHead>
                    <TableBody>
                      {cr.items.map((i, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{i.title}</TableCell><TableCell>{i.unit}</TableCell>
                          <TableCell align="right">{money(i.claimedQuantity)}</TableCell><TableCell align="right">{money(i.verifiedQuantity)}</TableCell>
                          <TableCell align="right">{money(i.unitPrice)}</TableCell><TableCell align="right">{money(i.verifiedAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
              {cr.verificationPhotoUrl && (
                <>
                  <Heading>Verification photograph</Heading>
                  <Link href={getImageUrl(cr.verificationPhotoUrl)} target="_blank" rel="noopener">
                    <Box component="img" src={getImageUrl(cr.verificationPhotoUrl)} alt="Verification" sx={{ maxWidth: '100%', maxHeight: 260, border: `1px solid ${RULE}` }} />
                  </Link>
                </>
              )}
            </Sheet>
          );
        })()}

        {dossier && tab === 'inspection' && dossier.inspections.map((r) => (
          <Sheet key={r._id} kicker="Inspection report" title={`${r.reportNumber} · ${r.status}`}>
            <Facts rows={[
              ['Date of inspection', day(r.inspectionDate)],
              ['Location', r.location],
              r.claimType === 'Slab' && ['Stage inspected', `${r.slab?.name}, ${r.slab?.percentage}% (${pkr(r.slab?.amount)})`],
              r.claimType !== 'Slab' && ['Value inspected', pkr(r.inspectedTotal)]
            ]} />
            {r.remarks && (<><Heading>Remarks</Heading><Typography sx={{ fontSize: 13.5, color: INK }}>{r.remarks}</Typography></>)}
            {r.claimType !== 'Slab' && r.items.length > 0 && (
              <>
                <Heading>Measured quantities</Heading>
                <Table size="small" sx={docTable}>
                  <TableHead><TableRow><TableCell>Item</TableCell><TableCell align="right">Claimed</TableCell><TableCell align="right">Inspected</TableCell><TableCell align="right">Rate</TableCell></TableRow></TableHead>
                  <TableBody>
                    {r.items.map((i, idx) => (
                      <TableRow key={idx}><TableCell>{i.title}</TableCell><TableCell align="right">{money(i.claimedQuantity)} {i.unit}</TableCell><TableCell align="right">{money(i.inspectedQuantity)}</TableCell><TableCell align="right">{money(i.unitPrice)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
            {r.inspectors.map((i, idx) => (
              <Box key={idx}>
                <Heading>Inspector {idx + 1}</Heading>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-end" spacing={2} sx={{ pb: 1.5, mb: 1.5, borderBottom: `1px solid ${RULE}` }}>
                  <Box>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: INK }}>{i.name}</Typography>
                    <Typography sx={{ fontSize: 12.5, color: MUTED }}>
                      {[i.designation, `${i.status}${i.actedAt ? ` on ${dayjs(i.actedAt).format('DD MMM YYYY, hh:mm A')}` : ''}`].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  {i.signature && <DigitalSignatureImage userOrPath={i.signature} alt={`${i.name} signature`} sx={{ maxHeight: 44, maxWidth: 150, mx: 0 }} />}
                </Stack>
                {i.observations && <Typography sx={{ fontSize: 13.5, color: INK, mb: 1.5 }}>{i.observations}</Typography>}
                <Evidence attachments={i.attachments} />
              </Box>
            ))}
          </Sheet>
        ))}

        {dossier && tab === 'history' && (
          <Sheet kicker="Payment history" title={`${dossier.contractor?.name || 'Subcontractor'} · ${dossier.subProject?.name || ''}`}>
            {dossier.previousIpcs.length ? (
              <Table size="small" sx={{ ...docTable, mt: 2 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Certificate</TableCell><TableCell>Type</TableCell><TableCell>Date</TableCell>
                    <TableCell align="right">Gross</TableCell><TableCell align="right">Retention</TableCell><TableCell align="right">Net</TableCell>
                    <TableCell>Status</TableCell><TableCell align="right">Paid</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dossier.previousIpcs.map((h) => (
                    <TableRow key={h._id} sx={h.status === 'Cancelled' ? { '& td': { color: `${MUTED} !important`, textDecoration: 'line-through' } } : undefined}>
                      <TableCell>No. {String(h.ipcNumber || 1).padStart(2, '0')}<Typography component="div" sx={{ fontSize: 11.5, color: MUTED }}>{h.invoiceNumber}{h.sameContract ? ' · same contract' : ''}</Typography></TableCell>
                      <TableCell>{h.ipcKind || 'Work'}</TableCell>
                      <TableCell>{day(h.issueDate)}</TableCell>
                      <TableCell align="right">{money(h.grossAmount)}</TableCell>
                      <TableCell align="right">{money(h.retentionAmount)}</TableCell>
                      <TableCell align="right">{money(h.netPayableAmount)}</TableCell>
                      <TableCell>{h.status === 'Cancelled' ? 'Cancelled' : (h.approvalStatus || 'Draft')}</TableCell>
                      <TableCell align="right">{money(h.paidAmount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ '& td': { fontWeight: 600, borderTop: `2px solid ${INK}`, borderBottom: 0 } }}>
                    <TableCell colSpan={3}>Total, excluding cancelled</TableCell>
                    {['grossAmount', 'retentionAmount', 'netPayableAmount'].map((k) => (
                      <TableCell key={k} align="right">{money(dossier.previousIpcs.filter((h) => h.status !== 'Cancelled').reduce((t, h) => t + (h[k] || 0), 0))}</TableCell>
                    ))}
                    <TableCell />
                    <TableCell align="right">{money(dossier.previousIpcs.reduce((t, h) => t + (h.paidAmount || 0), 0))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : <Typography sx={{ fontSize: 13.5, color: MUTED, mt: 2 }}>This is the first certificate to this subcontractor on {dossier.subProject?.name}.</Typography>}
            {dossier.balances && (
              <>
                <Heading>Subcontractor account (PKR)</Heading>
                <Table size="small" sx={docTable}><TableBody>
                  {[
                    ['Retention held on approved certificates', dossier.balances.retentionHeld],
                    ['Retention released', dossier.balances.retentionReleased],
                    ['Advance paid', dossier.balances.advancePaid],
                    ['Advance outstanding', dossier.balances.advanceOutstanding]
                  ].map(([k, v]) => <TableRow key={k}><TableCell>{k}</TableCell><TableCell align="right">{money(v)}</TableCell></TableRow>)}
                  {dossier.finance && <TableRow><TableCell>Finance bill {dossier.finance.billNumber}, paid</TableCell><TableCell align="right">{money(dossier.finance.paid)}</TableCell></TableRow>}
                </TableBody></Table>
              </>
            )}
          </Sheet>
        )}

        {dossier && tab === 'project' && (
          <>
            {[['Main project', dossier.mainProject], ['Sub project', dossier.subProject]].filter(([, p]) => p).map(([k, p]) => (
              <Sheet key={k} kicker={k} title={p.name}>
                <Facts rows={[
                  ['Project number', p.projectNumber],
                  ['Status', p.status],
                  p.projectType && ['Type', p.projectType],
                  ['Location', [p.street && (/^\d/.test(String(p.street)) ? `Street ${p.street}` : p.street), p.sector, p.society].filter(Boolean).join(', ')],
                  ['Schedule', `${day(p.startDate)} to ${day(p.expectedEndDate)}`],
                  p.overallProgress != null && ['Progress', `${p.overallProgress}%`],
                  p.contractValue > 0 && ['Contract value', pkr(p.contractValue)],
                  p.clientName && ['Client', p.clientName]
                ]} />
              </Sheet>
            ))}
            <Sheet kicker="Project documents" title={documents.length ? `${documents.length} document(s)` : 'No documents'}>
              {documents.length ? (
                <Table size="small" sx={{ ...docTable, mt: 2 }}>
                  <TableHead><TableRow><TableCell>Document</TableCell><TableCell>Category</TableCell><TableCell>Project</TableCell><TableCell>Uploaded</TableCell></TableRow></TableHead>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc._id}>
                        <TableCell><Link href={getImageUrl(doc.url)} target="_blank" rel="noopener" color="inherit" underline="always">{doc.name}</Link></TableCell>
                        <TableCell>{doc.category}</TableCell><TableCell>{doc.owner}</TableCell>
                        <TableCell>{day(doc.uploadedAt)}{doc.uploadedBy ? `, ${doc.uploadedBy}` : ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <Typography sx={{ fontSize: 13.5, color: MUTED, mt: 2 }}>Nothing has been uploaded on the Main or Sub Project yet.</Typography>}
            </Sheet>
          </>
        )}

        {dossier && tab === 'approvals' && (
          <Sheet kicker="Approvals" title={ipcStageText(ipc)}>
            <Box sx={{ mt: 3 }}><IpcApprovalTrail ipc={ipc} /></Box>
          </Sheet>
        )}
      </Box>

      {ipc && actions && (
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ px: 3, py: 1.5, borderTop: `1px solid ${RULE}` }}>
          {actions(ipc)}
        </Stack>
      )}
    </Dialog>
  );
}
