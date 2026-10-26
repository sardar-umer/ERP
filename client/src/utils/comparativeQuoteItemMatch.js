/**
 * Match indent/requisition lines to quotation lines for Comparative Statement.
 *
 * Spec-only matching is unsafe when several lines share the same specification
 * (e.g. Keyboard + Mouse both "Branded") — that previously remapped prices and
 * made CS totals diverge from the quotation document.
 */

export const normalizeComparativeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['′’]/g, "'")
    .replace(/[″""]/g, '"')
    .replace(/\s+/g, ' ');

export const isBlankQuoteItem = (qi) =>
  (Number(qi?.quantity) || 0) === 0 && (Number(qi?.unitPrice) || 0) === 0;

/** Line amount consistent with Quotation detail view. */
export const getQuoteLineAmount = (quoteItem) => {
  if (!quoteItem || isBlankQuoteItem(quoteItem)) return 0;
  const baseTotal = (Number(quoteItem.quantity) || 0) * (Number(quoteItem.unitPrice) || 0);
  const discount = Number(quoteItem.discount) || 0;
  const taxRate = Number(quoteItem.taxRate) || 0;
  return baseTotal - discount + ((baseTotal - discount) * taxRate) / 100;
};

/**
 * Line amount before the line discount, for the CS grid. The CS shows
 * TOTAL → Discount → Grand Total, so lines must not already be net of discount
 * (otherwise the discount is deducted twice).
 */
export const getQuoteLineGrossAmount = (quoteItem) => {
  if (!quoteItem || isBlankQuoteItem(quoteItem)) return 0;
  return getQuoteLineAmount(quoteItem) + (Number(quoteItem.discount) || 0);
};

const pickNonBlank = (match) => {
  if (!match || isBlankQuoteItem(match)) return null;
  return match;
};

/**
 * @param {Object} quote - quotation with items[]
 * @param {Object} item - indent item
 * @param {number} itemIndex - indent row index
 * @param {Array} indentItems - full indent items list (for ordinal disambiguation)
 */
export const getQuoteItemForIndentItem = (quote, item, itemIndex, indentItems = []) => {
  if (!quote?.items?.length) return null;

  const items = quote.items;
  const indentName = normalizeComparativeText(item?.itemName);
  const indentSpec = normalizeComparativeText(item?.description);
  const indentLabel = indentName || indentSpec;

  const nameMatches = indentLabel
    ? items
        .map((qi, idx) => ({ qi, idx }))
        .filter(({ qi }) => {
          const qDesc = normalizeComparativeText(qi?.description);
          const qSpec = normalizeComparativeText(qi?.specification);
          return (
            (qDesc && (qDesc === indentLabel || (indentName && qDesc === indentName))) ||
            (qSpec && (qSpec === indentLabel || (indentName && qSpec === indentName)))
          );
        })
    : [];

  // 1) Prefer item-name match (unique, or disambiguated by index / same-name ordinal)
  if (nameMatches.length === 1) {
    return pickNonBlank(nameMatches[0].qi);
  }
  if (nameMatches.length > 1 && itemIndex != null) {
    const atSameIndex = nameMatches.find((m) => m.idx === itemIndex);
    if (atSameIndex) {
      const picked = pickNonBlank(atSameIndex.qi);
      if (picked) return picked;
    }

    const sameNameIndentOrdinal =
      indentItems.slice(0, itemIndex + 1).filter((it) => {
        const n = normalizeComparativeText(it?.itemName) || normalizeComparativeText(it?.description);
        return n && (n === indentLabel || (indentName && n === indentName));
      }).length - 1;
    if (sameNameIndentOrdinal >= 0 && sameNameIndentOrdinal < nameMatches.length) {
      const picked = pickNonBlank(nameMatches[sameNameIndentOrdinal].qi);
      if (picked) return picked;
    }
  }

  // 2) Name + specification together (handles renamed/partial descriptions)
  if (indentName && indentSpec) {
    const byNameAndSpec = items.find((qi) => {
      const qDesc = normalizeComparativeText(qi?.description);
      const qSpec = normalizeComparativeText(qi?.specification);
      const nameOk = qDesc === indentName || qSpec === indentName;
      const specOk = qSpec === indentSpec || qDesc === indentSpec;
      return nameOk && specOk;
    });
    const picked = pickNonBlank(byNameAndSpec);
    if (picked) return picked;
  }

  // 3) Specification-only ONLY when unique among quote lines.
  // Never remap a named indent line onto a differently named quote line
  // (e.g. Gutka + Chips both "Branded" must not share a price).
  if (indentSpec) {
    const specMatches = items
      .map((qi, idx) => ({ qi, idx }))
      .filter(({ qi }) => {
        const qDesc = normalizeComparativeText(qi?.description);
        const qSpec = normalizeComparativeText(qi?.specification);
        const specHit = (qDesc && qDesc === indentSpec) || (qSpec && qSpec === indentSpec);
        if (!specHit) return false;
        if (indentName && qDesc && qDesc !== indentName && qDesc !== indentSpec) {
          return false;
        }
        return true;
      });
    if (specMatches.length === 1) {
      return pickNonBlank(specMatches[0].qi);
    }
    if (specMatches.length > 1 && itemIndex != null) {
      const atSameIndex = specMatches.find((m) => m.idx === itemIndex);
      if (atSameIndex) {
        const picked = pickNonBlank(atSameIndex.qi);
        if (picked) return picked;
      }
      const sameSpecOrdinal =
        indentItems.slice(0, itemIndex + 1).filter((it) => {
          const spec = normalizeComparativeText(it?.description);
          return spec && spec === indentSpec;
        }).length - 1;
      if (sameSpecOrdinal >= 0 && sameSpecOrdinal < specMatches.length) {
        const picked = pickNonBlank(specMatches[sameSpecOrdinal].qi);
        if (picked) return picked;
      }
    }
  }

  // 4) Same index ONLY when that quote line is clearly the same item by name.
  // Do not treat a shared generic specification (e.g. "Branded") as identity —
  // that remaps Lot B lines onto Lot A indent rows (Gutka ← Chips).
  if (itemIndex != null && itemIndex < items.length && indentLabel) {
    const qi = items[itemIndex];
    const qDesc = normalizeComparativeText(qi?.description);
    const qSpec = normalizeComparativeText(qi?.specification);
    const sameItem =
      (qDesc && (qDesc === indentLabel || (indentName && qDesc === indentName))) ||
      (qSpec && (qSpec === indentLabel || (indentName && qSpec === indentName))) ||
      // Spec may be the only name when indent has no itemName
      (!indentName && indentSpec && ((qDesc && qDesc === indentSpec) || (qSpec && qSpec === indentSpec)));
    if (sameItem) {
      return pickNonBlank(qi);
    }
  }

  return null;
};

/**
 * Resolve indent line for a quotation line by name first.
 * Never use blind index alone — lot quotes are shorter / differently ordered than the indent.
 * Never treat a shared generic specification (e.g. "Branded") as the item identity.
 */
export const findIndentItemForQuoteLine = (indentItems = [], quoteItem, quoteItemIndex) => {
  const items = Array.isArray(indentItems) ? indentItems : [];
  if (!quoteItem || !items.length) return null;

  const qDesc = normalizeComparativeText(quoteItem?.description);
  const qSpec = normalizeComparativeText(quoteItem?.specification);

  // 1) Quote description is the item name on most quotations
  if (qDesc) {
    const byDesc = items.find((ii) => {
      const name = normalizeComparativeText(ii?.itemName);
      const desc = normalizeComparativeText(ii?.description);
      return name === qDesc || desc === qDesc;
    });
    if (byDesc) return byDesc;
  }

  // 2) Spec only as a name fallback (indent itemName === quote specification)
  if (qSpec) {
    const bySpecName = items.find((ii) => normalizeComparativeText(ii?.itemName) === qSpec);
    if (bySpecName) return bySpecName;
  }

  // 3) Index only when that indent row is the same named item
  if (quoteItemIndex != null && quoteItemIndex < items.length && qDesc) {
    const atIdx = items[quoteItemIndex];
    const name = normalizeComparativeText(atIdx?.itemName);
    const desc = normalizeComparativeText(atIdx?.description);
    if (name === qDesc || desc === qDesc) return atIdx;
  }

  return null;
};

/** True when this quote line should still appear on a new PO (not blank, not fully ordered). */
export const isQuoteLineStillOrderable = (indentItems = [], quoteItem, quoteItemIndex) => {
  if (isBlankQuoteItem(quoteItem)) return false;
  const indentItem = findIndentItemForQuoteLine(indentItems, quoteItem, quoteItemIndex);
  if (!indentItem) return true;
  return (Number(indentItem.orderedQuantity) || 0) < (Number(indentItem.quantity) || 0);
};

const getScopedQuotations = (quotations = [], selectedLot) => {
  if (!quotations?.length) return [];
  if (selectedLot != null && selectedLot !== '') {
    const lotQuotes = quotations.filter((q) => (q.lotNumber || 'A') === selectedLot);
    if (lotQuotes.length) return lotQuotes;
  } else {
    const lots = [...new Set(quotations.map((q) => q.lotNumber || 'A'))];
    if (lots.length === 1) {
      return quotations.filter((q) => (q.lotNumber || 'A') === lots[0]);
    }
  }
  return quotations;
};

/**
 * Dynamically scope indent rows to items actually quoted in the CS quotations.
 * Uses the same matcher as CS cells, and adds rows for quote-only lines so
 * every lot quotation item appears (and totals can match the quotation).
 */
export const getComparativeIndentItems = (indentItems = [], quotations = [], selectedLot) => {
  const items = Array.isArray(indentItems) ? indentItems : [];
  if (!quotations?.length) return items;

  const scopedQuotes = getScopedQuotations(quotations, selectedLot);
  if (!scopedQuotes.length) return items;

  const claimedQuoteItems = new Set();
  const matched = [];
  const matchedLabels = new Set();

  items.forEach((item, itemIndex) => {
    let hit = false;
    scopedQuotes.forEach((q) => {
      const qi = getQuoteItemForIndentItem(q, item, itemIndex, items);
      if (qi) {
        claimedQuoteItems.add(qi);
        hit = true;
      }
    });
    if (hit) {
      matched.push(item);
      const label =
        normalizeComparativeText(item?.itemName) || normalizeComparativeText(item?.description);
      if (label) matchedLabels.add(label);
    }
  });

  // Quote lines that never matched an indent row still belong on this lot's CS
  const synthetics = [];
  const seenSynthetic = new Set();
  scopedQuotes.forEach((q) => {
    (q.items || []).forEach((qi) => {
      if (isBlankQuoteItem(qi) || claimedQuoteItems.has(qi)) return;
      const label =
        normalizeComparativeText(qi?.description) || normalizeComparativeText(qi?.specification);
      if (!label || matchedLabels.has(label) || seenSynthetic.has(label)) return;
      seenSynthetic.add(label);
      matchedLabels.add(label);
      synthetics.push({
        itemName: qi.description || qi.specification || 'Item',
        description: qi.specification || qi.description || '',
        quantity: qi.quantity,
        unit: qi.unit || 'Nos',
        orderedQuantity: 0,
        _fromQuoteOnly: true
      });
    });
  });

  const result = [...matched, ...synthetics];
  return result.length ? result : items;
};

/**
 * Sum of pre-discount line amounts for one quotation on the CS.
 * Prefer the quotation's own non-blank lines so the column total equals the quote.
 * Fall back to matched indent rows, then stored subtotal/total.
 */
export const getComparativeQuoteVisibleTotal = (quote, indentItems = [], quotations = []) => {
  const lineSum = (quote?.items || []).reduce((sum, qi) => sum + getQuoteLineGrossAmount(qi), 0);
  if (lineSum > 0) return lineSum;

  const visibleTotal = (indentItems || []).reduce((sum, item, itemIndex) => {
    const isQuoted = (quotations || []).some(
      (q) => getQuoteItemForIndentItem(q, item, itemIndex, indentItems) != null
    );
    if (!isQuoted) return sum;
    const quoteItem = getQuoteItemForIndentItem(quote, item, itemIndex, indentItems);
    if (!quoteItem) return sum;
    return sum + getQuoteLineGrossAmount(quoteItem);
  }, 0);

  if (visibleTotal > 0) return visibleTotal;
  return Number(quote?.subtotal) || Number(quote?.totalAmount) || 0;
};

export const getComparativeQuoteGrandTotal = (quote, indentItems = [], quotations = []) => {
  const visibleTotal = getComparativeQuoteVisibleTotal(quote, indentItems, quotations);
  const hasLineMatch = (indentItems || []).some((item, itemIndex) =>
    getQuoteItemForIndentItem(quote, item, itemIndex, indentItems)
  );
  const discountAmount = Number(quote?.discountAmount) || 0;
  // visibleTotal / subtotal are pre-discount; stored totalAmount is usually post-discount
  const usedStoredTotalOnly = !hasLineMatch && !quote?.subtotal && Number(quote?.totalAmount);
  if (usedStoredTotalOnly) return Math.max(0, Number(quote.totalAmount) || 0);
  return Math.max(0, visibleTotal - discountAmount);
};
