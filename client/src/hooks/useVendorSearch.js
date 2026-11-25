import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';

const INITIAL_LIMIT = 500;
const SEARCH_LIMIT = 50;
const DEBOUNCE_MS = 300;

const pickList = (res) => {
  const d = res?.data?.data;
  if (Array.isArray(d?.vendors)) return d.vendors;
  if (Array.isArray(d)) return d;
  if (Array.isArray(res?.data?.vendors)) return res.data.vendors;
  return [];
};

const mergeById = (base, extra) => {
  if (!extra.length) return base;
  const seen = new Set(base.map((v) => String(v._id)));
  const fresh = extra.filter((v) => v?._id && !seen.has(String(v._id)));
  if (!fresh.length) return base;
  return [...base, ...fresh].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
};

/**
 * Vendor list for dropdowns that never misses a vendor, however many there are.
 * Loads the first INITIAL_LIMIT vendors (A–Z) for browsing, and when the user types it asks
 * the server and merges the matches in, so vendors beyond the first page can still be found.
 *
 * @param {object} opts
 * @param {string} [opts.status]  e.g. 'Active'
 * @param {boolean} [opts.enabled=true] load on mount
 * @returns {{ vendors, setVendors, loading, searching, onVendorInputChange, reload, addVendor }}
 */
export default function useVendorSearch({ status, enabled = true } = {}) {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(enabled); // true until the first load finishes when auto-loading
  const [searching, setSearching] = useState(false);
  const timerRef = useRef(null);
  const lastTermRef = useRef('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/procurement/vendors', { params: { limit: INITIAL_LIMIT, ...(status ? { status } : {}) } });
      const list = pickList(res);
      setVendors((prev) => mergeById(list, prev));
      return list;
    } catch (err) {
      console.error('Error loading vendors:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  /** Pass as Autocomplete onInputChange. Ignores the text MUI sets when an option is picked. */
  const onVendorInputChange = useCallback((_e, value, reason) => {
    if (reason === 'reset') return;
    const term = String(value || '').trim();
    clearTimeout(timerRef.current);
    if (term.length < 2 || term === lastTermRef.current) return;
    timerRef.current = setTimeout(async () => {
      lastTermRef.current = term;
      setSearching(true);
      try {
        const res = await api.get('/procurement/vendors', {
          params: { search: term, limit: SEARCH_LIMIT, ...(status ? { status } : {}) }
        });
        setVendors((prev) => mergeById(prev, pickList(res)));
      } catch (err) {
        console.error('Vendor search failed:', err);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
  }, [status]);

  /** Add a vendor (e.g. one just created) to the list. */
  const addVendor = useCallback((vendor) => {
    if (vendor?._id) setVendors((prev) => mergeById(prev, [vendor]));
  }, []);

  return { vendors, setVendors, loading, searching, onVendorInputChange, reload, addVendor };
}
