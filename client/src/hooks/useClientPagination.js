import React, { useMemo, useState } from 'react';
import { TablePagination } from '@mui/material';

export const DEFAULT_ROWS_PER_PAGE = 100;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 250, 500];

/**
 * Pages a list that is already loaded in the browser (100 rows per page by default).
 *
 *   const pg = useClientPagination(list);
 *   ...{pg.rows.map((row, i) => ...)}   // pg.offset + i is the row's position in the full list
 *   ...</Table>{pg.bar}
 *
 * Totals, exports and "select all" should keep using the full list, not pg.rows.
 */
export default function useClientPagination(list, { defaultRowsPerPage = DEFAULT_ROWS_PER_PAGE } = {}) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage);
  const total = Array.isArray(list) ? list.length : 0;
  // A filter can shrink the list under the current page — fall back to the last page that exists
  const safePage = Math.min(page, Math.max(0, Math.ceil(total / rowsPerPage) - 1));
  const offset = safePage * rowsPerPage;
  const rows = useMemo(
    () => (Array.isArray(list) ? list.slice(offset, offset + rowsPerPage) : []),
    [list, offset, rowsPerPage]
  );

  const bar = total > 0 ? (
    <TablePagination
      component="div"
      count={total}
      page={safePage}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
      onPageChange={(_, next) => setPage(next)}
      onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
    />
  ) : null;

  return { rows, offset, page: safePage, rowsPerPage, total, bar, setPage };
}
