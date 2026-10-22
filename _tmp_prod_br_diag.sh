#!/bin/bash
set -e
cd /var/www/sgc-erp
echo "HEAD=$(git rev-parse --short HEAD)"
echo "=== GeneralLedger markers ==="
grep -n "attachGlClearanceToJeLedgerRows\|JE.reference is often blank\|row.reference = refs" server/models/finance/GeneralLedger.js | head -20
echo "=== BankReconciliation markers ==="
grep -n "BankReconSkeleton\|unpresentedHasMore\|LEDGER_FROM_BEGINNING\|Load more" client/src/pages/Finance/BankReconciliation.js | head -25
echo "=== financeAdvanced pagination ==="
grep -n "unpresentedHasMore\|ledgerFromDate\|bankStatementBalance = statementTotal" server/routes/financeAdvanced.js | head -20
echo "=== built JS contains Load more? ==="
grep -Rla "unpresentedHasMore\|BankReconSkeleton" /var/www/html/static/js/ 2>/dev/null | head -8 || echo "NOT FOUND in /var/www/html"
echo "=== client/build vs html main hash ==="
ls client/build/static/js/main.*.js 2>/dev/null
ls /var/www/html/static/js/main.*.js 2>/dev/null
echo "=== index.html script tags ==="
grep -oE 'static/js/[^" ]+' /var/www/html/index.html | head -15
echo "=== PM2 ==="
pm2 list | head -8
