import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  CircularProgress,
  Chip,
  Tooltip,
  Grid,
  Alert,
  Autocomplete,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow
} from '@mui/material';
import { Print as PrintIcon, CheckCircle as CheckCircleIcon, Save as SaveIcon, CallSplit as SplitIcon } from '@mui/icons-material';
import { DigitalSignatureImage } from '../common/DigitalSignatureImage';
import StoreVettingNotice from './StoreVettingNotice';
import { comparativeAuthoritySelectionLocked } from '../../utils/comparativeStatementAuthority';
import {
  getQuoteItemForIndentItem as matchQuoteItemForIndentItem,
  getQuoteLineAmount,
  getComparativeIndentItems,
  getComparativeQuoteVisibleTotal,
  getComparativeQuoteGrandTotal,
  isBlankQuoteItem
} from '../../utils/comparativeQuoteItemMatch';

/**
 * Shared Comparative Statement view. Used in Procurement (Comparative Statements page) and Pre-Audit (PO view tab).
 * @param {Object} requisition - Indent/requisition (items, indentNumber, erpRef, title, notes)
 * @param {Array} quotations - List of quotations for comparison
 * @param {Object} approvalAuthority - { preparedBy, verifiedBy, authorisedRep, financeRep, managerProcurement }
 * @param {string} note - Note text (display only when readOnly; editable when !readOnly)
 * @param {boolean} readOnly - If true, no edit controls (approval as text, no Save, no Select buttons)
 * @param {function} formatNumber - (num) => string
 * @param {boolean} loadingQuotations - Show spinner instead of table
 * @param {function} onSaveApprovals - Called when Save approval authorities is clicked (optional)
 * @param {function} onSelectVendor - (quotation) => void — selects entire quotation as winner (optional)
 * @param {boolean} savingApprovals - Disable save button (optional)
 * @param {boolean} updating - Disable select buttons (optional)
 * @param {function} onNoteChange - (value) => void when note is edited (optional, for !readOnly)
 * @param {boolean} showPrintButton - Show Print button (default true when !readOnly)
 * @param {function} onCreateSplitPOs - ({ vendorAssignments }) => void — called when user clicks "Shortlist Vendors" (saves assignments; create POs from Quotations page) (optional)
 * @param {boolean} creatingSplitPOs - Disables the Shortlist button while in progress (optional)
 * @param {boolean} canSelectVendors - Enables Select/Shortlist actions only after comparative approvals are fully approved
 * @param {Array} authorityUserOptions - User options for approval authority dropdowns
 * @param {boolean} authorityUserLoading - Loading state for authority user search
 * @param {Object} authorityUserSelection - Selected users map by authority key
 * @param {function} onAuthorityUserChange - (key, userObject) => void
 * @param {function} onAuthorityUserSearchInput - (searchText) => void
 * @param {function} onSubmitComparative - Submit comparative for approvals
 * @param {boolean} submittingComparative - Submit in progress
 * @param {boolean} canSubmitComparative - Whether submit is currently allowed
 * @param {function} onApproveComparative - Approve comparative as pending authority
 * @param {function} onRejectComparative - Open reject flow as pending authority
 * @param {boolean} canApproveComparative - Whether current user can approve/reject now
 * @param {boolean} approvingComparative - Approve in progress
 * @param {boolean} canEditApprovalAuthorities - When false, authority user Autocompletes and Save are disabled (after lock)
 */
const ComparativeStatementView = ({
  requisition,
  quotations = [],
  approvalAuthority = {},
  note = '',
  readOnly = false,
  formatNumber = (n) => (n == null ? '0.00' : parseFloat(n).toFixed(2)),
  loadingQuotations = false,
  onSaveApprovals,
  onSelectVendor,
  savingApprovals = false,
  updating = false,
  onNoteChange,
  showPrintButton = !readOnly,
  onCreateSplitPOs,
  creatingSplitPOs = false,
  canSelectVendors = true,
  authorityUserOptions = [],
  authorityUserLoading = false,
  authorityUserSelection = {},
  onAuthorityUserChange,
  onAuthorityUserSearchInput,
  onSubmitComparative,
  submittingComparative = false,
  canSubmitComparative = false,
  onApproveComparative,
  onRejectComparative,
  canApproveComparative = false,
  approvingComparative = false,
  canEditApprovalAuthorities = true,
  selectedLot = 'A'
}) => {
  const pickText = (...values) => {
    for (const value of values) {
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return '—';
  };
  const selectedRequisition = requisition;
  const comparativeNote = note;
  const keys = ['preparedBy', 'managerProcurement'];
  const lotComparativeApproval = Array.isArray(selectedRequisition?.comparativeApprovals)
    ? selectedRequisition.comparativeApprovals.find((a) => a.lotNumber === selectedLot)
    : null;
  const comparativeApproval = lotComparativeApproval || selectedRequisition?.comparativeApproval;
  const comparativeSteps = Array.isArray(comparativeApproval?.approvers) ? comparativeApproval.approvers : [];
  const comparativeAuthorityUserMap = (() => {
    const csa = selectedRequisition?.comparativeStatementApprovals || {};
    const slots = [
      { key: 'preparedByUser', label: 'Prepared By' },
      { key: 'managerProcurementUser', label: 'Manager Procurement' }
    ];
    const map = new Map();
    slots.forEach((slot) => {
      const id = csa?.[slot.key]?._id || csa?.[slot.key];
      if (!id) return;
      map.set(String(id), slot.label);
    });
    return map;
  })();

  // Per-item vendor assignment: { itemIndex: quotationId }
  const [vendorAssignments, setVendorAssignments] = useState({});

  // One dynamic scope for EVERY CS consumer (Procurement CS, Pre-Audit, PO, Payments, etc.):
  // always start from the full indent so lot CS can include every quoted line
  // (do not trust a pre-filtered csItems list — exact string filters drop valid rows).
  const indentItems = React.useMemo(() => {
    const sourceItems = selectedRequisition?.items || [];
    return getComparativeIndentItems(sourceItems, quotations, selectedLot);
  }, [selectedRequisition?.items, quotations, selectedLot]);

  React.useEffect(() => {
    const saved = selectedRequisition?.splitPOAssignments;
    if (saved && typeof saved === 'object') {
      setVendorAssignments(saved);
    } else {
      setVendorAssignments({});
    }
  }, [selectedRequisition?._id, selectedRequisition?.splitPOAssignments, selectedLot]);

  const handleAssignVendorToItem = useCallback((itemIndex, quotationId) => {
    setVendorAssignments(prev => {
      // Toggle off if already assigned to same vendor
      if (prev[itemIndex] === quotationId) {
        const next = { ...prev };
        delete next[itemIndex];
        return next;
      }
      return { ...prev, [itemIndex]: quotationId };
    });
  }, []);

  const pendingItems = indentItems.filter(item => (item.orderedQuantity || 0) < item.quantity);
  const totalPendingItems = pendingItems.length;
  const assignedPendingCount = indentItems.reduce((count, item, idx) => {
    if ((item.orderedQuantity || 0) < item.quantity && vendorAssignments[idx]) {
      return count + 1;
    }
    return count;
  }, 0);

  const allItemsAssigned =
    totalPendingItems > 0 && assignedPendingCount === totalPendingItems;

  const assignedCount = Object.keys(vendorAssignments).length;
  const totalItems = totalPendingItems;

  const handleCreateSplitPOs = () => {
    if (onCreateSplitPOs) {
      onCreateSplitPOs({ vendorAssignments });
    }
  };

  const getQuoteItemForIndentItem = (quote, item, itemIndex) =>
    matchQuoteItemForIndentItem(quote, item, itemIndex, indentItems);

  return (
    <Paper
      sx={{
        p: { xs: 3, sm: 3.5, md: 4 },
        maxWidth: '297mm',
        mx: 'auto',
        backgroundColor: '#fff',
        boxShadow: 'none',
        width: '100%',
        fontFamily: 'Arial, sans-serif',
        '@media print': {
          boxShadow: 'none',
          p: 1.5,
          maxWidth: '100%',
          mx: 0,
          width: '100%',
          pageBreakInside: 'avoid'
        }
      }}
      className="print-content comparative-statement-view"
    >
      {/* Header */}
      <Box sx={{ mb: 3, position: 'relative', '@media print': { mb: 1.5 } }}>
        <Typography variant="h4" fontWeight={700} align="center" sx={{ textTransform: 'uppercase', mb: { xs: 3, print: 1 }, fontSize: { xs: '1.8rem', print: '1.3rem' }, letterSpacing: 1 }}>
          Comparative Statement
        </Typography>
        <Typography variant="h6" align="center" sx={{ mb: { xs: 2, print: 0.5 }, fontSize: { xs: '1.2rem', print: '0.9rem' }, fontWeight: 500 }}>
          {selectedRequisition?.companyId?.name || '—'}
        </Typography>
        <Box sx={{ position: 'absolute', top: 0, right: 0, textAlign: 'right', fontSize: { xs: '0.9rem', print: '0.75rem' } }}>
          <Typography sx={{ mb: 0.5 }}>POR {selectedRequisition?.erpRef?.split('#').pop() || selectedRequisition?.indentNumber || 'N/A'}</Typography>
          <Typography>Indent {selectedRequisition?.indentNumber || 'N/A'}</Typography>
        </Box>
      </Box>

      {showPrintButton && (
        <Box sx={{ mb: 2, textAlign: 'right', '@media print': { display: 'none' } }}>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
        </Box>
      )}


      {/* Comparative Table */}
      {loadingQuotations ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : !quotations || quotations.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center' }}><Typography>No quotations available for comparison</Typography></Box>
      ) : (
        <>
          {/* Per-item vendor assignment info bar */}
          {!readOnly && onCreateSplitPOs && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: '#f0f4ff', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', '@media print': { display: 'none' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Split PO selection:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Click a vendor cell in any item row to assign that item to that vendor. Then click &quot;Shortlist Vendors&quot;. Create the actual Split POs from the Quotations page.
              </Typography>
              <Chip
                size="small"
                label={`${assignedCount} / ${totalItems} items assigned`}
                color={allItemsAssigned ? 'success' : assignedCount > 0 ? 'warning' : 'default'}
              />
              <Button
                variant="contained"
                color="success"
                size="small"
                startIcon={creatingSplitPOs ? <CircularProgress size={16} color="inherit" /> : <SplitIcon />}
                onClick={handleCreateSplitPOs}
                disabled={creatingSplitPOs || assignedCount === 0 || !canSelectVendors}
                sx={{ ml: 'auto' }}
              >
                {creatingSplitPOs ? 'Shortlisting…' : 'Shortlist Vendors'}
              </Button>
            </Box>
          )}

          <Box sx={{ mb: 3, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', fontSize: '0.85rem', fontFamily: 'Arial, sans-serif', minWidth: '1000px' }} className="comparative-table">
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                  <th colSpan={4} style={{ border: '1px solid #000', padding: '8px 6px', fontWeight: 700, textAlign: 'center', fontSize: '0.85rem' }}>Vendor</th>
                  {quotations.map((quote, idx) => (
                    <th key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '8px 6px', fontWeight: 700, textAlign: 'center', fontSize: '0.85rem', backgroundColor: quote.status === 'Finalized' ? '#c8e6c9' : quote.status === 'Shortlisted' ? '#ffe0b2' : '#f5f5f5', verticalAlign: 'top' }}>
                      {!readOnly && onSelectVendor && (
                        <Box sx={{ mb: 1, '@media print': { display: 'none' } }}>
                          <Button
                            variant={quote.status === 'Finalized' || quote.status === 'Shortlisted' ? 'contained' : 'outlined'}
                            color={quote.status === 'Finalized' ? 'success' : quote.status === 'Shortlisted' ? 'warning' : 'primary'}
                            startIcon={quote.status === 'Finalized' ? <CheckCircleIcon /> : null}
                            onClick={() => onSelectVendor(quote)}
                            disabled={updating || quote.status === 'Finalized' || !canSelectVendors}
                            size="small"
                            sx={{ fontSize: '0.7rem', padding: '4px 8px', minWidth: 'auto' }}
                          >
                            {quote.status === 'Finalized' ? 'Finalized' : quote.status === 'Shortlisted' ? 'Shortlisted' : 'Select All'}
                          </Button>
                        </Box>
                      )}
                      {quote.vendor?.name || `Vendor ${idx + 1}`}
                      {quote.status === 'Finalized' && <Box component="span" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5, color: '#2e7d32', fontWeight: 600 }}>(Finalized)</Box>}
                      {quote.status === 'Shortlisted' && <Box component="span" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5, color: '#ed6c02', fontWeight: 600 }}>(Shortlisted)</Box>}
                    </th>
                  ))}
                </tr>
                <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                  <th style={{ border: '1px solid #000', padding: '8px 6px', textAlign: 'center', fontWeight: 700, width: '4%', fontSize: '0.8rem' }}>Sr no</th>
                  <th style={{ border: '1px solid #000', padding: '8px 6px', fontWeight: 700, textAlign: 'left', width: '35%', fontSize: '0.8rem' }}>Item Description</th>
                  <th style={{ border: '1px solid #000', padding: '8px 6px', fontWeight: 700, textAlign: 'center', width: '8%', fontSize: '0.8rem' }}>Unit</th>
                  <th style={{ border: '1px solid #000', padding: '8px 6px', textAlign: 'center', fontWeight: 700, width: '6%', fontSize: '0.8rem' }}>Qty</th>
                  {quotations.map((_, idx) => (
                    <React.Fragment key={idx}>
                      <th style={{ border: '1px solid #000', padding: '8px 6px', fontWeight: 700, textAlign: 'center', fontSize: '0.8rem' }}>Rate</th>
                      <th style={{ border: '1px solid #000', padding: '8px 6px', fontWeight: 700, textAlign: 'center', fontSize: '0.8rem' }}>Total</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let visibleItemCounter = 0;
                  return indentItems.length > 0 ? indentItems.map((item, itemIndex) => {
                    // Lot-scoped indentItems already only contains quoted rows; keep guard for safety
                    const isQuoted = quotations.some(quote => getQuoteItemForIndentItem(quote, item, itemIndex) != null);
                    if (!isQuoted) return null;

                    visibleItemCounter += 1;
                    const assignedQuotationId = vendorAssignments[itemIndex];
                    const isAlreadyOrdered = (item.orderedQuantity || 0) >= item.quantity;
                    return (
                      <React.Fragment key={`${item.itemName || item.description || 'item'}-${itemIndex}`}>
                        <tr style={{ border: '1px solid #000', backgroundColor: isAlreadyOrdered ? '#fafafa' : assignedQuotationId ? '#f0fff0' : undefined }}>
                          <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', verticalAlign: 'top', fontSize: '0.8rem' }}>{visibleItemCounter}</td>
                          <td style={{ border: '1px solid #000', padding: '6px 6px', verticalAlign: 'top', fontSize: '0.8rem' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 0.5 }}>
                              <span>{item.itemName || item.description || '___________'}</span>
                              {isAlreadyOrdered && (
                                <Chip size="small" label="PO Created" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                              )}
                            </Box>
                            {assignedQuotationId && !readOnly && !isAlreadyOrdered && (
                              <Box component="span" sx={{ display: 'block', fontSize: '0.7rem', color: '#2e7d32', fontWeight: 600, '@media print': { display: 'none' } }}>
                                → {quotations.find(q => q._id === assignedQuotationId)?.vendor?.name || 'Vendor'}
                              </Box>
                            )}
                          </td>
                          <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', verticalAlign: 'top', fontSize: '0.8rem' }}>{item.unit || 'Nos'}</td>
                          <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', verticalAlign: 'top', fontSize: '0.8rem' }}>{item.quantity ?? '___'}</td>
                          {quotations.map((quote, quoteIdx) => {
                            const quoteItem = getQuoteItemForIndentItem(quote, item, itemIndex);
                            const isNotQuoted = !quoteItem || isBlankQuoteItem(quoteItem);
                            const itemTotal = !isNotQuoted ? getQuoteLineAmount(quoteItem) : 0;
                            const isAssignedToThis = vendorAssignments[itemIndex] === quote._id;
                            const cellBg = isAssignedToThis ? '#c8e6c9' : undefined;
                            const canAssign = !isAlreadyOrdered && !isNotQuoted && !readOnly && onCreateSplitPOs;
                            return (
                              <React.Fragment key={quoteIdx}>
                                <td
                                  style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', verticalAlign: 'top', fontSize: '0.8rem', backgroundColor: cellBg, cursor: canAssign ? 'pointer' : undefined, opacity: isAlreadyOrdered ? 0.6 : 1 }}
                                  onClick={canAssign ? () => handleAssignVendorToItem(itemIndex, quote._id) : undefined}
                                >
                                  {!isNotQuoted ? formatNumber(quoteItem.unitPrice) : '___________'}
                                </td>
                                <Tooltip
                                  title={isAlreadyOrdered ? 'Item already ordered / PO created' : canAssign ? (isAssignedToThis ? 'Click to unassign' : 'Click to assign this item to this vendor') : isNotQuoted ? 'Vendor did not quote for this item' : ''}
                                  placement="top"
                                >
                                  <td
                                    style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', verticalAlign: 'top', fontSize: '0.8rem', backgroundColor: cellBg, cursor: canAssign ? 'pointer' : undefined, opacity: isAlreadyOrdered ? 0.6 : 1 }}
                                    onClick={canAssign ? () => handleAssignVendorToItem(itemIndex, quote._id) : undefined}
                                  >
                                    {!isNotQuoted ? formatNumber(itemTotal) : '___________'}
                                    {isAssignedToThis && !readOnly && !isAlreadyOrdered && (
                                      <CheckCircleIcon sx={{ fontSize: '0.8rem', ml: 0.5, color: '#2e7d32', verticalAlign: 'middle', '@media print': { display: 'none' } }} />
                                    )}
                                  </td>
                                </Tooltip>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                        <tr style={{ border: '1px solid #000', backgroundColor: '#fafafa' }}>
                          <td colSpan={4} style={{ border: '1px solid #000', padding: '5px 6px', verticalAlign: 'top', fontSize: '0.75rem', fontWeight: 600 }}>
                            Technical Comparison
                          </td>
                          {quotations.map((quote, quoteIdx) => {
                            const quoteItem = getQuoteItemForIndentItem(quote, item, itemIndex);
                            const isNotQuoted = !quoteItem || isBlankQuoteItem(quoteItem);
                            return (
                              <td key={`tech-${quoteIdx}`} colSpan={2} style={{ border: '1px solid #000', padding: '5px 6px', verticalAlign: 'top', fontSize: '0.75rem', textAlign: 'left' }}>
                                {isNotQuoted ? (
                                  <span style={{ color: '#888' }}>Not quoted</span>
                                ) : (
                                  <>
                                    <div><strong>Description:</strong> {quoteItem.description || '—'}</div>
                                    <div><strong>Specification:</strong> {quoteItem.specification || '—'}</div>
                                    <div><strong>Brand:</strong> {quoteItem.brand || '—'}</div>
                                    <div><strong>Unit:</strong> {quoteItem.unit || '—'}</div>
                                  </>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  }) : (
                    <tr>
                      <td colSpan={4 + quotations.length * 2} style={{ border: '1px solid #000', padding: '10px 8px', textAlign: 'center' }}>No items</td>
                    </tr>
                  );
                })()}
                <tr style={{ borderTop: '2px solid #000', borderBottom: '1px solid #000', backgroundColor: '#e8e8e8', fontWeight: 700 }}>
                  <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.8rem' }}>TOTAL</td>
                  {quotations.map((quote, idx) => {
                    const visibleTotal = getComparativeQuoteVisibleTotal(quote, indentItems, quotations);
                    return (
                      <td key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.8rem' }}>
                        {formatNumber(visibleTotal)}
                      </td>
                    );
                  })}
                </tr>
                <tr style={{ border: '1px solid #000', fontWeight: 600 }}>
                  <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.8rem' }}>Discount</td>
                  {quotations.map((quote, idx) => (
                    <td key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.8rem' }}>
                      {formatNumber(quote.discountAmount || 0)}
                    </td>
                  ))}
                </tr>
                <tr style={{ border: '1px solid #000', fontWeight: 600 }}>
                  <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.8rem' }}>Income Tax</td>
                  {quotations.map((_, idx) => <td key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: '0.8rem' }}>Not Included</td>)}
                </tr>
                <tr style={{ border: '1px solid #000', fontWeight: 600 }}>
                  <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.8rem' }}>Transportation</td>
                  {quotations.map((_, idx) => <td key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: '0.8rem' }}>Not Included</td>)}
                </tr>
                <tr style={{ borderTop: '2px solid #000', borderBottom: '1px solid #000', backgroundColor: '#d0d0d0', fontWeight: 700 }}>
                  <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.85rem' }}>Grand Total</td>
                  {quotations.map((quote, idx) => {
                    const grand = getComparativeQuoteGrandTotal(quote, indentItems, quotations);
                    return (
                      <td key={idx} colSpan={2} style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: '0.85rem' }}>
                        {formatNumber(grand)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </Box>
        </>
      )}

      {/* Terms & Conditions */}
      {quotations?.length > 0 && (
        <Box sx={{ mb: 3, mt: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2, fontSize: '1rem', textDecoration: 'underline' }}>Term & Condition</Typography>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', fontSize: '0.85rem', fontFamily: 'Arial, sans-serif' }} className="terms-table">
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', border: '1px solid #000' }}>
                <th style={{ border: '1px solid #000', padding: '6px', textAlign: 'left', fontWeight: 700, width: '20%', fontSize: '0.8rem' }}>Delivery Time</th>
                {quotations.map((_, idx) => <th key={idx} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontWeight: 700, fontSize: '0.8rem' }}>{idx + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr style={{ border: '1px solid #000' }}>
                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 600, fontSize: '0.8rem' }}></td>
                {quotations.map((quote, idx) => <td key={idx} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '0.8rem' }}>{quote.deliveryTime || '—'}</td>)}
              </tr>
              <tr style={{ border: '1px solid #000' }}>
                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 600, fontSize: '0.8rem' }}>Payment Term</td>
                {quotations.map((quote, idx) => <td key={idx} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '0.8rem' }}>{pickText(quote.paymentTerms)}</td>)}
              </tr>
              <tr style={{ border: '1px solid #000' }}>
                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 600, fontSize: '0.8rem' }}>Delivery Place</td>
                {quotations.map((quote, idx) => <td key={idx} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '0.8rem' }}>{pickText(quote.deliveryPlace, quote.delivery_location, quote.deliveryLocation, quote.terms?.deliveryPlace, quote.quotationTerms?.deliveryPlace)}</td>)}
              </tr>
              <tr style={{ border: '1px solid #000' }}>
                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 600, fontSize: '0.8rem' }}>Carriage</td>
                {quotations.map((quote, idx) => <td key={idx} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '0.8rem' }}>{pickText(quote.freightCarriage, quote.freight_carriage, quote.carriage, quote.terms?.freightCarriage, quote.terms?.freight_carriage, quote.terms?.carriage, quote.quotationTerms?.freightCarriage, quote.quotationTerms?.carriage)}</td>)}
              </tr>
              <tr style={{ border: '1px solid #000' }}>
                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 600, fontSize: '0.8rem' }}>Installation</td>
                {quotations.map((quote, idx) => <td key={idx} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '0.8rem' }}>{pickText(quote.installation, quote.installationDetails, quote.terms?.installation, quote.terms?.installationDetails, quote.quotationTerms?.installation)}</td>)}
              </tr>
              <tr style={{ border: '1px solid #000' }}>
                <td style={{ border: '1px solid #000', padding: '6px', fontWeight: 600, fontSize: '0.8rem' }}>Freight</td>
                {quotations.map((quote, idx) => <td key={idx} style={{ border: '1px solid #000', padding: '6px', textAlign: 'center', fontSize: '0.8rem' }}>{pickText(quote.freight, quote.terms?.freight, quote.quotationTerms?.freight)}</td>)}
              </tr>
            </tbody>
          </table>
        </Box>
      )}

      {/* Vendor Quotation Documents */}
      {quotations?.length > 0 && (
        <Box sx={{ mb: 3, mt: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, fontSize: '1rem', textDecoration: 'underline' }}>
            Quotation Documents
          </Typography>
          <Table size="small" sx={{ border: '1px solid', borderColor: 'divider', maxWidth: 980 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ fontWeight: 700 }}>Vendor</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Documents</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {quotations.map((quote, idx) => {
                const docs = Array.isArray(quote?.attachments) ? quote.attachments : [];
                return (
                  <TableRow key={quote?._id || idx}>
                    <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {quote?.vendor?.name || `Vendor ${idx + 1}`}
                    </TableCell>
                    <TableCell>
                      {docs.length ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {docs.map((doc, i) => (
                            <Button
                              key={`${quote?._id || idx}-doc-${i}`}
                              size="small"
                              variant="outlined"
                              onClick={() => window.open(doc?.url, '_blank', 'noopener,noreferrer')}
                            >
                              {doc?.filename || doc?.originalName || `Document ${i + 1}`}
                            </Button>
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">No documents uploaded</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* Note */}
      <Box sx={{ mb: 3, fontSize: '0.9rem' }}>
        <Typography component="span" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>Note:</Typography>
        {readOnly ? (
          <Typography component="span">{comparativeNote || '—'}</Typography>
        ) : onNoteChange ? (
          <TextField fullWidth multiline minRows={2} placeholder="Add note (save with approval authorities above)" value={comparativeNote} onChange={(e) => onNoteChange(e.target.value)} variant="outlined" size="small" sx={{ '& .MuiInputBase-input': { fontSize: '0.9rem' } }} />
        ) : (
          <Typography component="span">{comparativeNote || '—'}</Typography>
        )}
      </Box>

      {/* Approval authorities moved below Note */}
      <Box sx={{ mb: 3, '@media print': { pageBreakInside: 'avoid' } }}>
        <StoreVettingNotice indent={selectedRequisition} />
        {!readOnly ? (
          <Box sx={{ '@media print': { display: 'none' } }}>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>
              Approval Authorities
            </Typography>
            {canApproveComparative ? (
              <Alert severity="success" sx={{ mb: 2 }}>
                You are a pending approver for this comparative statement.
              </Alert>
            ) : null}
            <Alert severity="info" sx={{ mb: 2 }}>
              Select employees for each authority. These selected users become comparative approvers.
            </Alert>
            {!readOnly &&
              comparativeAuthoritySelectionLocked(selectedRequisition) &&
              !canEditApprovalAuthorities && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Only Prepared By, Procurement Manager (GM), or Super Admin can change approval authority users after
                  they have been assigned.
                </Alert>
              )}
            <Grid container spacing={2}>
              {[
                { key: 'preparedBy', label: 'Prepared By' },
                { key: 'managerProcurement', label: 'Manager Procurement' }
              ].map((field) => {
                const sel = authorityUserSelection?.[field.key] || null;
                return (
                  <Grid item xs={12} md={6} key={field.key}>
                    {field.key === 'preparedBy' ? (
                      <TextField
                        fullWidth
                        size="small"
                        label={field.label}
                        value={
                          sel
                            ? ([sel.firstName, sel.lastName].filter(Boolean).join(' ').trim() || sel.email || '')
                            : (approvalAuthority.preparedBy || '')
                        }
                        helperText="Auto-filled from the logged-in user"
                        InputProps={{ readOnly: true }}
                      />
                    ) : (
                      <Autocomplete
                        disabled={!canEditApprovalAuthorities}
                        options={authorityUserOptions}
                        loading={authorityUserLoading}
                        value={sel}
                        onChange={(_, next) => onAuthorityUserChange && onAuthorityUserChange(field.key, next)}
                        onInputChange={(_, input, reason) => {
                          if (reason === 'input' && onAuthorityUserSearchInput) {
                            onAuthorityUserSearchInput(input);
                          }
                        }}
                        getOptionLabel={(option) => {
                          const n = [option.firstName, option.lastName].filter(Boolean).join(' ').trim();
                          return n || option.email || option.employeeId || '';
                        }}
                        isOptionEqualToValue={(a, b) => a?._id === b?._id}
                        renderInput={(params) => (
                          <TextField {...params} label={field.label} size="small" placeholder="Select employee" />
                        )}
                      />
                    )}
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        ) : null}
        {(onApproveComparative || onRejectComparative || (!readOnly && (onSaveApprovals || onSubmitComparative))) && (
          <Box sx={{ mt: 2, mb: 1, display: 'flex', justifyContent: 'flex-end', gap: 1, '@media print': { display: 'none' } }}>
            {onApproveComparative && (
              <Button
                variant="contained"
                color="success"
                size="small"
                onClick={onApproveComparative}
                disabled={!canApproveComparative || approvingComparative}
              >
                {approvingComparative ? 'Approving…' : 'Approve'}
              </Button>
            )}
            {onRejectComparative && (
              <Button
                variant="contained"
                color="error"
                size="small"
                onClick={onRejectComparative}
                disabled={!canApproveComparative}
              >
                Reject
              </Button>
            )}
            {!readOnly && onSubmitComparative && (
              <Button
                variant="contained"
                color="primary"
                size="small"
                onClick={onSubmitComparative}
                disabled={!canSubmitComparative || submittingComparative}
              >
                {submittingComparative ? 'Submitting…' : 'Send to Approval Authorities'}
              </Button>
            )}
            {!readOnly && onSaveApprovals ? (
              <Button
                variant="contained"
                color="primary"
                size="small"
                startIcon={savingApprovals ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                onClick={onSaveApprovals}
                disabled={savingApprovals || !canEditApprovalAuthorities}
              >
                {savingApprovals ? 'Saving…' : 'Save approval authorities'}
              </Button>
            ) : null}
          </Box>
        )}
        {/* Comparative approval progress inside Approval Authorities */}
        {selectedRequisition ? (
          <Box sx={{ mt: 3 }} className="comparative-approval-progress">
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Comparative approval progress
            </Typography>
            {comparativeSteps.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {readOnly
                  ? 'No comparative approval chain is recorded for this requisition.'
                  : 'Save approval authorities to configure the approval chain.'}
              </Typography>
            ) : (
              <>
                <Table size="small" sx={{ border: '1px solid', borderColor: 'divider', maxWidth: 720 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      <TableCell sx={{ fontWeight: 700 }}>Authority / approver</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Date &amp; time</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">
                        Digital signature
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {comparativeSteps.map((step, idx) => {
                      const approver = step.approver;
                      const aid = approver?._id || approver;
                      const name =
                        [approver?.firstName, approver?.lastName].filter(Boolean).join(' ').trim() ||
                        approver?.email ||
                        (aid ? `User ${String(aid).slice(-6)}` : `Approver ${idx + 1}`);
                      const authorityLabel = comparativeAuthorityUserMap.get(String(aid || ''));
                      const status = step.status || 'pending';
                      const statusColor =
                        status === 'approved' ? 'success' : status === 'rejected' ? 'error' : 'warning';
                      const statusLabel =
                        status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending approval';
                      return (
                        <TableRow key={String(aid || idx)}>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {authorityLabel || 'Approver'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {name}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={statusLabel}
                              color={statusColor}
                              variant={status === 'pending' ? 'outlined' : 'filled'}
                            />
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {step.actedAt ? new Date(step.actedAt).toLocaleString() : '—'}
                          </TableCell>
                          <TableCell align="center" sx={{ verticalAlign: 'middle' }}>
                            {status === 'approved' && approver?.digitalSignature ? (
                              <DigitalSignatureImage userOrPath={approver} alt={`Signature ${name}`} />
                            ) : status === 'approved' ? (
                              <Typography variant="caption" color="text.secondary">
                                No signature on file
                              </Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                —
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {comparativeApproval?.status === 'approved' ? (
                  <Typography variant="caption" color="success.main" display="block" sx={{ mt: 1 }}>
                    All required approvers have approved. Related quotation(s) should be finalized for PO creation.
                  </Typography>
                ) : null}
                {comparativeApproval?.status === 'rejected' && comparativeApproval?.rejectionObservation ? (
                  <Typography variant="caption" color="error.main" display="block" sx={{ mt: 1 }}>
                    Observation: {comparativeApproval.rejectionObservation}
                  </Typography>
                ) : null}
              </>
            )}
          </Box>
        ) : null}
      </Box>
    </Paper>
  );
};

export default ComparativeStatementView;
