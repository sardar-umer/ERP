import React from 'react';
import { AuditReturnFeedbackSection } from './AuditReturnFeedbackSection';
import {
  findLatestWorkflowFeedbackEntry,
  getWorkflowAuditStatusLabel,
  getWorkflowFeedbackObservations
} from './workflowAuditReturnUtils';

/**
 * Read-only rejection/return observations for document view dialogs (Pre-Audit, lists, etc.).
 */
export function WorkflowAuditFeedbackPanel({
  document,
  formatDateTime,
  userDisplayName,
  visualVariant = 'settlement',
  returnedAuditStatus = 'Returned from Audit',
  answerTitle = 'Administration response:',
  answeredIntro = (
    <>
      The initiating department has replied to the observation(s) below. Review their response before approving or
      returning the document again.
    </>
  ),
  returnedIntro = (
    <>
      This document was returned or rejected with the observations below. Review them before taking further action.
    </>
  )
}) {
  if (!document) return null;

  const observations = getWorkflowFeedbackObservations(document);
  const latestReturnHistory = findLatestWorkflowFeedbackEntry(document.workflowHistory);
  const auditStatus = getWorkflowAuditStatusLabel(document);
  const hasFeedback =
    observations.length > 0 ||
    latestReturnHistory ||
    auditStatus === returnedAuditStatus ||
    /rejected/i.test(auditStatus);

  if (!hasFeedback) return null;

  const hasAnswers = observations.some((obs) => String(obs?.answer || '').trim());

  return (
    <AuditReturnFeedbackSection
      documentId={document._id}
      visualVariant={visualVariant}
      auditStatus={auditStatus}
      returnedAuditStatus={returnedAuditStatus}
      latestReturnHistory={latestReturnHistory}
      observations={observations}
      formatDateTime={formatDateTime}
      userDisplayName={userDisplayName}
      answerTitle={answerTitle}
      answeredIntro={hasAnswers ? answeredIntro : null}
      returnedIntro={returnedIntro}
    />
  );
}
