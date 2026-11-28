/**
 * Notes the first (initial) pre-audit reviewer left on a document, from its workflow history
 * or stored initial comments. Shared by Pre-Audit (Audit Director view) and the CEO desk.
 */
const DEFAULT_TEXT = /^(initial pre-audit approval recorded|forwarded to audit director for approval)/i;

export const auditPersonName = (u) => (u && typeof u === 'object'
  ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email || ''
  : '');

export const getInitialAuditNotes = (doc) => {
  if (!doc) return { entries: [], observations: [] };
  const history = Array.isArray(doc.workflowHistory) ? doc.workflowHistory : [];
  const initialAt = doc.preAuditInitialApprovedAt || doc.initialAuditApprovedAt || doc.originalDocument?.preAuditInitialApprovedAt;
  const initialMs = initialAt ? new Date(initialAt).getTime() : null;
  const entries = [];
  history.forEach((h) => {
    const to = String(h?.toStatus || '').toLowerCase();
    const from = String(h?.fromStatus || '').toLowerCase();
    const isInitial = to === 'initial audit approval' || to === 'initial pre-audit approved'
      || (from === 'pending audit' && to === 'pending audit' && String(h?.module || '') === 'Pre-Audit'
        && initialMs && Math.abs(new Date(h.changedAt).getTime() - initialMs) < 60000);
    const isForward = to === 'forwarded to audit director' || to === 'forwarded_to_director';
    if (!isInitial && !isForward) return;
    const text = String(h?.comments || '').trim();
    if (!text || DEFAULT_TEXT.test(text)) return;
    // The same remark is often saved twice (initial approval, then "Dear sir, …" when forwarded): keep the longer one
    const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();
    const dup = entries.find((e) => norm(e.text).includes(norm(text)) || norm(text).includes(norm(e.text)));
    if (dup) {
      if (text.length > dup.text.length) Object.assign(dup, { text, by: auditPersonName(h.changedBy) || dup.by, at: h.changedAt });
      return;
    }
    entries.push({ label: isInitial ? 'Initial approval' : 'Forwarded', text, by: auditPersonName(h.changedBy), at: h.changedAt });
  });
  // Fall back to stored initial comments when the history entry is missing
  const stored = String(doc.preAuditInitialComments || doc.originalDocument?.preAuditInitialComments || doc.reviewComments || '').trim();
  const normStored = stored.toLowerCase().replace(/\s+/g, ' ');
  const storedDup = entries.some((e) => {
    const n = e.text.toLowerCase().replace(/\s+/g, ' ');
    return n.includes(normStored) || normStored.includes(n);
  });
  if (stored && !DEFAULT_TEXT.test(stored) && !storedDup) {
    entries.unshift({ label: 'Initial approval', text: stored, by: auditPersonName(doc.reviewedBy), at: initialAt || doc.reviewedAt });
  }
  const rawObs = [
    ...(Array.isArray(doc.auditObservations) ? doc.auditObservations : []),
    ...(Array.isArray(doc.observations) ? doc.observations : [])
  ];
  const observations = rawObs
    .map((o) => (typeof o === 'object' ? o : { observation: o }))
    .filter((o) => o?.observation && !o.resolved);
  return { entries, observations };
};
