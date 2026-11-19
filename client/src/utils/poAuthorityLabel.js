/**
 * Display label for a PO approval-authority slot.
 *
 * A PO can override a slot's title for that PO only (e.g. when someone other than the AVP Taj signs
 * the AVP Taj slot): `purchaseOrder.authorityLabelOverrides.avpTaj = 'Patron-In-Chief-Education'`.
 * `authorisedRep` is the same signature as `avpTaj`, so it uses the same override.
 */
export const poAuthorityLabel = (po, key, defaultLabel) => {
  const overrides = po?.authorityLabelOverrides || {};
  const slot = key === 'authorisedRep' ? 'avpTaj' : key;
  const custom = String(overrides[slot] || '').trim();
  return custom || defaultLabel;
};

export default poAuthorityLabel;
