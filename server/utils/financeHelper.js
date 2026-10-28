const mongoose = require('mongoose');
const JournalEntry = require('../models/finance/JournalEntry');
const GeneralLedger = require('../models/finance/GeneralLedger');
const Account = require('../models/finance/Account');
const AccountsPayable = require('../models/finance/AccountsPayable');
const AccountsReceivable = require('../models/finance/AccountsReceivable');
const VendorAdvance = require('../models/finance/VendorAdvance');
const CashApproval = require('../models/procurement/CashApproval');
const Employee = require('../models/hr/Employee');
const Department = require('../models/hr/Department');
const FiscalPeriod = require('../models/finance/FiscalPeriod');
const FinanceJournal = require('../models/finance/FinanceJournal');
const { ensureStaffAdvanceAccount } = require('./staffAdvanceAccount');
const {
  getBillNarration,
  getCashApprovalNarration,
  getGrnNarration,
  getSinNarration,
  getArInvoiceNarration,
  getVendorAdvanceNarration,
  withVoucherNarration
} = require('./documentNarration');
const { co, acct, withCompany } = require('./financePosting');
const { resolveDocumentCompanyId } = require('./financeCompanyContext');

/**
 * Finance Helper Utility
 * Centralizes AR/AP creation and GL posting logic
 */
const FinanceHelper = {
  // Account Mapping Constants (matching actual database accounts)
  ACCOUNTS: {
    CASH: '1001',
    BANK: '1002',
    INVENTORY: '1200',       // Stock Valuation Asset — DR on GRN
    VENDOR_ADVANCE: '1110',  // Advance to Suppliers (asset) — vendor prepayments
    STAFF_ADVANCE: '1120',   // Cash Advance to Staff — petty cash / cash purchase advances
    EMPLOYEE_LOAN: '1125',
    RECEIVABLE: '1100',
    PAYABLE: '2001',
    WHT_PAYABLE: '2004',
    GRNI: '2140',            // Goods Received Not Invoiced — CR on GRN, DR on AP Bill (THE KEY CLEARING ACCOUNT)
    SALARIES_PAYABLE: '2200',
    PF_PAYABLE: '2210',
    EOBI_PAYABLE: '2211',
    EOBI_PAYABLE_EMP: '2211-01',
    EOBI_PAYABLE_ER: '2211-02',
    EOBI_EXPENSE: '5015',
    OTHER_PAYROLL_DED: '2212',
    REVENUE_CAM: '4010',
    REVENUE_ELECTRICITY: '4020',
    REVENUE_RENT: '4030',
    COGS: '5000',            // Cost of Goods Sold — DR on SIN
    EXPENSE_GENERAL: '5001',
    EXPENSE_SALARIES: '5002',
    UTILITIES: '6200'
  },

  /**
   * Resolve finance accounts for a given inventory item.
   * Priority: item-level field → category defaults → global account number defaults.
   * Returns { inventoryAccountId, grniAccountId, cogsAccountId }
   */
  resolveInventoryAccounts: async (inventoryItem, companyId = null) => {
    const InventoryCategory = mongoose.model('InventoryCategory');
    const A = acct(companyId);
    const cid = co(companyId);
    const scoped = (query) => (cid ? { ...query, companyId: cid } : query);
    const mapRef = async (id) => {
      if (!id) return null;
      const mapped = await A.map(id);
      return mapped?._id || id;
    };
    const findGrniFallback = async () => {
      let acc = await Account.findOne(scoped({
        type: 'Liability',
        name: { $regex: 'goods\\s*received\\s*not\\s*invoiced|\\bgrni\\b', $options: 'i' }
      }));
      if (!acc) acc = await A.resolve(FinanceHelper.ACCOUNTS.GRNI);
      const looksLikeAp = /\baccounts?\s*payable\b|\bap\b/i.test(String(acc?.name || ''));
      if (acc && (String(acc.type || '').toLowerCase() !== 'liability' || looksLikeAp)) return null;
      return acc;
    };
    const findInventoryFallback = async () => {
      let acc = await A.resolve(FinanceHelper.ACCOUNTS.INVENTORY);
      const looksLikeReceivable = /\baccounts?\s*receivable\b|\bar\b/i.test(String(acc?.name || ''));
      if (acc && String(acc.type || '').toLowerCase() === 'asset' && !looksLikeReceivable) return acc;
      return Account.findOne(scoped({
        type: 'Asset',
        name: { $regex: 'inventory|stock|raw material', $options: 'i' }
      }));
    };

    let inventoryAccountId = inventoryItem.inventoryAccount;
    let grniAccountId = inventoryItem.grniAccount;
    let cogsAccountId = inventoryItem.cogsAccount;

    // Try category-level defaults for any missing account (item without a category → the default category)
    if (!inventoryAccountId || !grniAccountId || !cogsAccountId) {
      const catId = inventoryItem.inventoryCategory?._id || inventoryItem.inventoryCategory;
      const cat = catId
        ? await InventoryCategory.findById(catId).lean()
        : await require('./itemCatalog').defaultFinanceCategory()
          .then((d) => (d ? InventoryCategory.findById(d._id).lean() : null));
      if (cat) {
        if (!inventoryAccountId) inventoryAccountId = cat.stockValuationAccount;
        if (!grniAccountId) grniAccountId = cat.stockInputAccount;
        if (!cogsAccountId) cogsAccountId = cat.stockOutputAccount;
      }
    }

    // Final fallback: find by well-known account numbers
    if (!inventoryAccountId) {
      const acc = await findInventoryFallback();
      inventoryAccountId = acc?._id;
    }
    if (!grniAccountId) {
      const acc = await findGrniFallback();
      grniAccountId = acc?._id;
    }
    if (!cogsAccountId) {
      const acc = await A.resolve(FinanceHelper.ACCOUNTS.COGS);
      cogsAccountId = acc?._id;
    }

    inventoryAccountId = await mapRef(inventoryAccountId);
    grniAccountId = await mapRef(grniAccountId);
    cogsAccountId = await mapRef(cogsAccountId);

    // Safety guards: if item/category has wrong account head linked, auto-correct at posting time.
    if (inventoryAccountId) {
      const invAcc = await Account.findById(inventoryAccountId).select('type name');
      const looksLikeAr = /\baccounts?\s*receivable\b|\bar\b/i.test(String(invAcc?.name || ''));
      if (!invAcc || String(invAcc.type || '').toLowerCase() !== 'asset' || looksLikeAr) {
        const fallback = await findInventoryFallback();
        inventoryAccountId = fallback?._id || null;
      }
    }
    if (grniAccountId) {
      const grniAcc = await Account.findById(grniAccountId).select('type name');
      const looksLikeAr = /\baccounts?\s*receivable\b|\bar\b/i.test(String(grniAcc?.name || ''));
      const looksLikeAp = /\baccounts?\s*payable\b|\bap\b/i.test(String(grniAcc?.name || ''));
      if (!grniAcc || String(grniAcc.type || '').toLowerCase() !== 'liability' || looksLikeAr || looksLikeAp) {
        const fallback = await findGrniFallback();
        grniAccountId = fallback?._id || null;
      }
    }

    return { inventoryAccountId, grniAccountId, cogsAccountId };
  },

  /**
   * Resolve GRNI account for AP bill clearing based on linked GRN/PO item mapping.
   * Priority:
   *   1) GRN lines → inventory (linked id, then code/name match) → item/category GRNI
   *   2) When no GRN yet (AP is often created at PO approval before GRN): PO lines →
   *      inventory by productCode / description (same idea as GRN stock sync)
   *   3) Global GRNI account number fallback (ACCOUNTS.GRNI, often 2100)
   */
  resolveGrniAccountForBill: async ({ referenceType, referenceId, companyId = null } = {}) => {
    const GoodsReceive = mongoose.model('GoodsReceive');
    const Inventory = mongoose.model('Inventory');
    const PurchaseOrder = mongoose.model('PurchaseOrder');

    const cid = co({ companyId }) || await resolveDocumentCompanyId({
      grnId: referenceType === 'grn' ? referenceId : null,
      purchaseOrderId: referenceType === 'purchase_order' ? referenceId : null
    });

    const grniFromInventoryDoc = async (inv) => {
      if (!inv) return null;
      const { grniAccountId } = await FinanceHelper.resolveInventoryAccounts(inv, cid);
      if (!grniAccountId) return null;
      const acc = await Account.findById(grniAccountId);
      const looksLikeAp = /\baccounts?\s*payable\b|\bap\b/i.test(String(acc?.name || ''));
      if (looksLikeAp) return null;
      return acc || null;
    };

    const resolveInventoryFromGrnLine = async (item) => {
      let inv = null;
      const linkedId = item.inventoryItem?._id || item.inventoryItem;
      if (linkedId) {
        inv = await Inventory.findById(linkedId).lean();
      }
      if (!inv) {
        const code = String(item.itemCode || item.productCode || '').trim();
        const name = String(item.itemName || '').trim();
        if (code && code !== '—') inv = await Inventory.findOne({ itemCode: code }).lean();
        if (!inv && name && name !== '—') {
          inv = await Inventory.findOne({ name }).sort({ createdAt: -1 }).lean();
        }
      }
      return inv;
    };

    const resolveInventoryFromPoLine = async (line) => {
      let inv = null;
      const code = String(line.productCode || '').trim();
      const desc = String(line.description || '').trim();
      if (code && code !== '—') inv = await Inventory.findOne({ itemCode: code }).lean();
      if (!inv && desc && desc !== '—') {
        inv = await Inventory.findOne({ name: desc }).sort({ createdAt: -1 }).lean();
      }
      return inv;
    };

    let grnDoc = null;
    if (referenceType === 'grn' && referenceId) {
      grnDoc = await GoodsReceive.findById(referenceId).lean();
    } else if (referenceType === 'purchase_order' && referenceId) {
      grnDoc = await GoodsReceive.findOne({
        purchaseOrder: referenceId,
        status: { $in: ['Received', 'Complete', 'Partial'] }
      })
        .sort({ receiveDate: -1, createdAt: -1 })
        .lean();
    }

    if (grnDoc?.items?.length) {
      for (const item of grnDoc.items) {
        const inv = await resolveInventoryFromGrnLine(item);
        const acc = await grniFromInventoryDoc(inv);
        if (acc) return acc;
      }
    }

    // AP bill is often posted when the PO is approved — before any GRN exists.
    // Match PO lines to inventory master so GRNI matches GRN posting later (e.g. 2140).
    if (referenceType === 'purchase_order' && referenceId) {
      const po = await PurchaseOrder.findById(referenceId).lean();
      if (po?.items?.length) {
        for (const line of po.items) {
          const inv = await resolveInventoryFromPoLine(line);
          const acc = await grniFromInventoryDoc(inv);
          if (acc) return acc;
        }
      }
    }

    return (await acct(cid).resolve(FinanceHelper.ACCOUNTS.GRNI)) || null;
  },

  /**
   * Resolve the Journal document ID for a given journal code.
   * Returns the journal _id or null if not found.
   */
  resolveJournal: async (code) => {
    try {
      const FinanceJournal = mongoose.model('FinanceJournal');
      const j = await FinanceJournal.findOne({ code: code.toUpperCase(), isActive: true }).lean();
      return j?._id || null;
    } catch {
      return null;
    }
  },

  /**
   * Helper to find an account by number (optionally scoped to a company).
   * Usage: getAccountByNumber('1002') OR getAccountByNumber(companyId, '1002')
   */
  getAccountByNumber: async (accountNumberOrCompanyId, accountNumberMaybe) => {
    const AccountResolver = require('./accountResolver');
    if (accountNumberMaybe !== undefined) {
      return AccountResolver.resolveSystemAccount(accountNumberOrCompanyId, accountNumberMaybe);
    }
    return AccountResolver.resolveSystemAccount(null, accountNumberOrCompanyId);
  },

  /** @see staffAdvanceAccount.js */
  ensureStaffAdvanceAccount,

  /**
   * Post a Journal Entry to the General Ledger
   */
  postToGeneralLedger: async (journalEntryId) => {
    try {
      const entry = await JournalEntry.findById(journalEntryId).populate('lines.account');
      if (!entry || entry.status !== 'posted') {
        throw new Error('Journal entry not found or not posted');
      }

      const ledgerEntries = [];
      for (const line of entry.lines) {
        const accountRef = (line.account && line.account._id) ? line.account._id : line.account;
        if (!accountRef) {
          throw new Error('Journal line is missing account for GL posting');
        }
        // Fetch the latest account balance to ensure running balance is accurate
        const currentAccount = await Account.findById(accountRef).lean();
        if (!currentAccount) {
          throw new Error(`Account not found for GL posting: ${accountRef}`);
        }

        const rawDept = line.department || entry.department;
        const resolvedDeptString = await FinanceHelper.resolveDepartmentStringFromId(rawDept);

        ledgerEntries.push({
          companyId: entry.companyId || currentAccount.companyId || null,
          journalEntry: entry._id,
          account: accountRef,
          date: entry.date,
          entryNumber: entry.entryNumber,
          reference: line.reference || entry.reference,
          description: line.description || entry.description,
          debit: line.debit,
          credit: line.credit,
          department: resolvedDeptString,
          module: entry.module || 'general',
          referenceId: entry.referenceId,
          referenceType: entry.referenceType,
          costCenter: line.costCenter || entry.costCenter || null,
          partyType: line.partyType || null,
          party: line.party || null,
          status: 'posted',
          createdBy: entry.createdBy,
          runningBalance: currentAccount.balance
        });
      }

      await GeneralLedger.insertMany(ledgerEntries);
      return true;
    } catch (error) {
      console.error('❌ Error posting to General Ledger:', error);
      throw error;
    }
  },

  /**
   * Create a balanced journal entry in **draft** (no GL, no account balance update).
   */
  createDraftJournalEntry: async (data) => {
    const postingDate = data.date || new Date();
    try {
      await FiscalPeriod.validatePostingDate(postingDate, data.companyId || null);
    } catch (periodErr) {
      throw periodErr;
    }

    let journalId = data.journal || null;
    if (!journalId && data.journalCode) {
      journalId = await FinanceHelper.resolveJournal(data.journalCode);
    }

    const journalEntry = new JournalEntry({
      ...data,
      journal: journalId,
      date: postingDate,
      status: 'draft',
      isAutoGenerated: true
    });

    await journalEntry.save();
    return journalEntry;
  },

  resolveDepartment: async (deptInput) => {
    if (!deptInput) return null;
    if (mongoose.Types.ObjectId.isValid(String(deptInput))) {
      return new mongoose.Types.ObjectId(String(deptInput));
    }
    try {
      const Department = mongoose.model('Department');
      const inputStr = String(deptInput).trim();

      const mapping = {
        'finance': 'Finance',
        'procurement': 'Procurement',
        'hr': 'Human Resources',
        'human resources': 'Human Resources',
        'admin': 'Administration',
        'administration': 'Administration',
        'sales': 'Sales',
        'marketing': 'Marketing',
        'operations': 'Operations',
        'customer service': 'Customer Service',
        'crm': 'CRM'
      };

      const targetName = mapping[inputStr.toLowerCase()] || inputStr;
      const dept = await Department.findOne({
        name: { $regex: new RegExp(`^${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).select('_id').lean();

      if (dept) return dept._id;

      const anyDept = await Department.findOne({
        name: { $regex: new RegExp(`^${inputStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).select('_id').lean();

      if (anyDept) return anyDept._id;

      // Fallback to first active department
      const firstDept = await Department.findOne({ isActive: true }).select('_id').lean();
      return firstDept ? firstDept._id : null;
    } catch (e) {
      console.warn('Failed to resolve department:', e);
      return null;
    }
  },

  resolveDepartmentStringFromId: async (deptId) => {
    if (!deptId) return 'general';
    try {
      const Department = mongoose.model('Department');
      const dept = await Department.findById(deptId).select('name').lean();
      if (!dept) return 'general';
      const name = String(dept.name).trim().toLowerCase();

      const mapping = {
        'finance': 'finance',
        'procurement': 'procurement',
        'human resources': 'hr',
        'hr': 'hr',
        'administration': 'admin',
        'admin': 'admin',
        'sales': 'sales',
        'audit': 'audit',
        'general': 'general'
      };

      return mapping[name] || name;
    } catch (e) {
      console.warn('Failed to resolve department string from ID:', e);
      return 'general';
    }
  },

  /**
   * Create a balanced Journal Entry and post it.
   * Validates that the posting date falls within an open fiscal period (if periods are defined).
   * Attaches journal (folder) if provided or resolved from journalCode.
   */
  /**
   * Refuse a second live bill for the same vendor invoice (same company, same vendor, same invoice no.).
   * Vendor is matched by vendorId when known, otherwise by name. Blank invoice numbers are not checked.
   */
  /**
   * Advance / deposit bill lines all debit the company's Vendor Advance account — the account the advance is
   * credited from when it is applied to the real bill — whatever category was picked.
   */
  advanceBillLineItems: async (lineItems, companyId) => {
    const advAccount = await acct(companyId).resolve(FinanceHelper.ACCOUNTS.VENDOR_ADVANCE);
    if (!advAccount) {
      const err = new Error('This company has no Vendor Advance (Advance to Suppliers) account in its Chart of Accounts — add one before entering an advance bill');
      err.statusCode = 400;
      throw err;
    }
    return (lineItems || []).map((li) => {
      const plain = typeof li?.toObject === 'function' ? li.toObject() : { ...li };
      return { ...plain, account: advAccount._id, accountNumber: advAccount.accountNumber || '' };
    });
  },

  /**
   * A payment of an advance bill (final authority approval) becomes an open vendor advance for the paid amount.
   * The bill journal (DR Vendor Advance / CR AP) and the payment (DR AP / CR Bank) already moved the money, so the
   * advance carries the payment voucher as its journal and never posts one of its own.
   */
  createAdvanceFromAdvanceBillPayment: async ({ bill, amount, journalEntry, meta = {}, createdBy }) => {
    const value = Math.round((Number(amount) || 0) * 100) / 100;
    if (!bill?.isAdvanceBill || value <= 0) return null;
    const methods = ['cash', 'check', 'cheque', 'credit_card', 'bank_transfer', 'bank', 'ach', 'other'];
    const advAccount = await acct(co(bill)).resolve(FinanceHelper.ACCOUNTS.VENDOR_ADVANCE);
    const advance = await VendorAdvance.create({
      vendor: {
        name: bill.vendor?.name || 'Vendor',
        email: bill.vendor?.email || '',
        vendorId: bill.vendor?.vendorId || null
      },
      amount: value,
      categoryLines: [{
        account: advAccount?._id,
        accountNumber: advAccount?.accountNumber || '',
        description: `Advance paid via bill ${bill.billNumber}`,
        amount: value,
        project: bill.project || ''
      }],
      paymentMethod: methods.includes(meta.paymentMethod) ? meta.paymentMethod : 'other',
      bankAccountId: meta.bankAccountId || null,
      reference: `${bill.billNumber}${meta.reference ? ` — ${meta.reference}` : ''}`,
      paymentDate: journalEntry?.date || new Date(),
      department: bill.department || 'finance',
      module: bill.module || 'finance',
      referenceType: 'advance_bill',
      referenceId: bill._id,
      journalEntryId: journalEntry?._id || null,
      voucherWorkflowStatus: 'fully_approved',
      status: 'open',
      createdBy: createdBy || bill.createdBy,
      companyId: co(bill),
      payingCompanyId: meta.payingCompanyId || null
    });
    if (!Array.isArray(bill.generatedAdvances)) bill.generatedAdvances = [];
    bill.generatedAdvances.push({ vendorAdvance: advance._id, amount: value, createdAt: new Date() });
    return advance;
  },

  assertUniqueVendorInvoice: async ({ companyId = null, vendorId = null, vendorName = '', vendorInvoiceNumber = '', excludeId = null } = {}) => {
    const invoiceNo = String(vendorInvoiceNumber || '').trim();
    if (!invoiceNo) return;
    const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const vendorMatch = vendorId
      ? { 'vendor.vendorId': vendorId }
      : { 'vendor.name': { $regex: `^${escape(String(vendorName || '').trim())}$`, $options: 'i' } };
    const dup = await AccountsPayable.findOne({
      ...vendorMatch,
      ...(companyId ? { companyId } : {}),
      vendorInvoiceNumber: { $regex: `^${escape(invoiceNo)}$`, $options: 'i' },
      status: { $ne: 'cancelled' },
      ...(excludeId ? { _id: { $ne: excludeId } } : {})
    }).select('billNumber').lean();
    if (dup) {
      const err = new Error(`Vendor invoice "${invoiceNo}" is already entered as bill ${dup.billNumber} — duplicate bills are not allowed`);
      err.statusCode = 400;
      throw err;
    }
  },

  /**
   * Reverse a posted journal entry with a mirror entry (debit ↔ credit) and mark the original reversed.
   * Posted entries are never deleted — this keeps the ledger, balances and audit trail consistent.
   */
  reverseJournalEntry: async (entryOrId, { reason = '', createdBy, date } = {}) => {
    const original = entryOrId && entryOrId.lines
      ? entryOrId
      : await JournalEntry.findById(entryOrId);
    if (!original) throw new Error('Journal entry not found');
    if (original.status !== 'posted') throw new Error('Only posted entries can be reversed');
    if (original.isReversed) throw new Error(`Entry ${original.entryNumber || original._id} has already been reversed`);

    const reversal = await FinanceHelper.createAndPostJournalEntry(withCompany({
      date: date ? new Date(date) : new Date(),
      reference: `REV-${original.entryNumber || original.reference || original._id}`,
      description: reason || `Reversal of ${original.entryNumber || original.reference}`,
      department: original.department,
      module: original.module,
      referenceId: original._id,
      referenceType: original.referenceType,
      journalCode: 'GEN',
      createdBy,
      lines: original.lines.map((line) => ({
        account: line.account?._id || line.account,
        description: `Reversal: ${line.description || ''}`.slice(0, 200),
        debit: line.credit,
        credit: line.debit,
        department: line.department,
        costCenter: line.costCenter
      }))
    }, original.companyId || null));

    // The original stays POSTED (flagged + linked): reports count posted entries, so original + mirror net to zero.
    // Marking it 'reversed' would drop it from every report and leave only the negative mirror.
    original.isReversed = true;
    original.reversalEntry = reversal._id;
    await original.save();
    return reversal;
  },

  createAndPostJournalEntry: async (data) => {
    try {
      // Validate fiscal period (lenient: skips if no periods configured)
      const postingDate = data.date || new Date();
      try {
        await FiscalPeriod.validatePostingDate(postingDate, data.companyId || null);
      } catch (periodErr) {
        throw periodErr; // Re-throw period validation errors
      }

      // Resolve journal (folder) from code if not supplied as ID
      let journalId = data.journal || null;
      if (!journalId && data.journalCode) {
        journalId = await FinanceHelper.resolveJournal(data.journalCode);
      }

      // Resolve department to ObjectId
      const resolvedDeptId = await FinanceHelper.resolveDepartment(data.department);

      // Resolve line departments to ObjectIds
      const resolvedLines = [];
      if (Array.isArray(data.lines)) {
        for (const line of data.lines) {
          const lineDeptId = await FinanceHelper.resolveDepartment(line.department || data.department);
          resolvedLines.push({
            ...line,
            department: lineDeptId
          });
        }
      }

      const journalEntry = new JournalEntry({
        ...data,
        journal: journalId,
        department: resolvedDeptId,
        lines: resolvedLines,
        date: postingDate,
        status: 'posted',
        postedBy: data.createdBy,
        postedDate: new Date(),
        isAutoGenerated: true
      });

      // Save triggers pre-save validation and post-save balance updates
      await journalEntry.save();

      // Post to GL after balances have been updated
      await FinanceHelper.postToGeneralLedger(journalEntry._id);

      return journalEntry;
    } catch (error) {
      console.error('❌ Error creating/posting Journal Entry:', error);
      throw error;
    }
  },

  /**
   * Internal helper to update AR/AP status based on paid amount
   */
  _updateDocumentStatus: (doc) => {
    const settled = (doc.amountPaid || 0) + (doc.advanceApplied || 0);
    const modelName = doc?.constructor?.modelName;
    let target = Number(doc.totalAmount) || 0;
    if (modelName === 'AccountsPayable') {
      target = FinanceHelper.getAPPayableBase(doc);
    } else if (modelName !== 'AccountsReceivable' && doc?.billNumber && doc?.duePaymentAmount != null) {
      target = FinanceHelper.getAPPayableBase(doc);
    }
    if (settled >= target) {
      doc.status = 'paid';
    } else if (settled > 0) {
      doc.status = 'partial';
    } else {
      doc.status = modelName === 'AccountsReceivable' ? 'sent' : 'approved';
    }
  },

  /**
   * Amount that must be settled after due date for utility / store bills.
   * Keeps totalAmount as original; switches payable base to duePaymentAmount once due date has passed.
   */
  getAPPayableBase: (bill) => {
    const total = Math.round((Number(bill?.totalAmount) || 0) * 100) / 100;
    const duePay = Math.round((Number(bill?.duePaymentAmount) || 0) * 100) / 100;
    if (!(duePay > total + 0.009)) return total;
    const dueRaw = bill?.dueDate;
    if (!dueRaw) return total;
    const due = new Date(dueRaw);
    if (Number.isNaN(due.getTime())) return total;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    // Same rule as utility overdue cron: payable after the due calendar day ends
    if (due >= startOfToday) return total;
    return duePay;
  },

  /** Remaining AP liability still on books (original totalAmount basis). */
  getAPBookedOutstanding: (bill) => {
    return Math.round(
      ((Number(bill?.totalAmount) || 0)
        - (Number(bill?.amountPaid) || 0)
        - (Number(bill?.advanceApplied) || 0)) * 100
    ) / 100;
  },

  getAPOutstanding: (bill) => {
    return Math.round(
      (FinanceHelper.getAPPayableBase(bill)
        - (Number(bill?.amountPaid) || 0)
        - (Number(bill?.advanceApplied) || 0)) * 100
    ) / 100;
  },

  /**
   * Create Accounts Receivable from a source
   * If AR with same invoiceNumber exists (e.g. from deleted/recreated invoice), updates it instead of creating duplicate
   */
  createARFromInvoice: async (options) => {
    try {
      const {
        customerName, customerEmail, customerId,
        invoiceNumber, invoiceDate, dueDate,
        amount, department, costCenter, module, referenceId,
        charges, createdBy
      } = options;
      const companyId = co(options);
      const A = acct(companyId);

      // Check if AR already exists (e.g. orphaned from deleted invoice - avoid E11000 duplicate key)
      let arEntry = await AccountsReceivable.findOne({ invoiceNumber });
      if (arEntry) {
        // Re-used invoice number: update it, and post the DIFFERENCE so the AR sub-ledger and GL stay equal
        const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
        if (arEntry.status === 'cancelled') {
          const err = new Error(`Invoice number ${invoiceNumber} belongs to a cancelled invoice — use a new number`);
          err.statusCode = 400;
          throw err;
        }
        const newAmount = r2(amount);
        if (newAmount < r2(arEntry.amountPaid) - 0.009) {
          const err = new Error(`Invoice ${invoiceNumber} has ${arEntry.amountPaid} received — its amount cannot go below that`);
          err.statusCode = 400;
          throw err;
        }
        const postedJe = await JournalEntry.findOne({ referenceId: arEntry._id, referenceType: 'invoice', status: 'posted' }).sort({ createdAt: 1 }).lean();
        const alreadyInGl = postedJe ? r2(arEntry.totalAmount) : 0;

        arEntry.customer = { name: customerName, email: customerEmail, customerId: customerId };
        arEntry.invoiceDate = invoiceDate || new Date();
        arEntry.dueDate = dueDate;
        arEntry.totalAmount = amount;
        arEntry.subtotal = amount;
        arEntry.referenceId = referenceId;
        arEntry.referenceType = 'invoice';
        arEntry.costCenter = costCenter || arEntry.costCenter;
        if (companyId && !arEntry.companyId) arEntry.companyId = companyId;
        if (createdBy) arEntry.updatedBy = createdBy;
        await arEntry.save();

        const diff = r2(newAmount - alreadyInGl);
        if (Math.abs(diff) > 0.009) {
          const A2 = acct(companyId || arEntry.companyId);
          const arAcc = postedJe?.lines?.find((l) => Number(l.debit) > 0)?.account
            || (await A2.resolve(FinanceHelper.ACCOUNTS.RECEIVABLE))?._id;
          const revAcc = postedJe?.lines?.find((l) => Number(l.credit) > 0)?.account
            || (await A2.resolve(options.revenueAccountNum || '4001'))?._id
            || (await A2.resolve('4000'))?._id;
          if (!arAcc || !revAcc) {
            const err = new Error('Receivable / revenue account missing — invoice amount changed but could not be posted');
            err.statusCode = 400;
            throw err;
          }
          const up = diff > 0;
          await FinanceHelper.createAndPostJournalEntry(withCompany({
            date: new Date(),
            reference: `${invoiceNumber}-ADJ`,
            description: postedJe
              ? `AR adjustment: ${invoiceNumber} ${r2(alreadyInGl)} → ${newAmount}`
              : `AR Invoice: ${invoiceNumber} for ${customerName} (journal was missing)`,
            department,
            costCenter,
            module,
            referenceId: arEntry._id,
            referenceType: 'invoice',
            createdBy,
            lines: [
              { account: arAcc, description: `Receivable from ${customerName}`, debit: up ? diff : 0, credit: up ? 0 : -diff, department },
              { account: revAcc, description: `Revenue — ${invoiceNumber}`, debit: up ? 0 : -diff, credit: up ? diff : 0, department }
            ]
          }, companyId || arEntry.companyId));
        }
        return arEntry;
      }

      arEntry = new AccountsReceivable({
        companyId: companyId || undefined,
        customer: { name: customerName, email: customerEmail, customerId: customerId },
        invoiceNumber,
        invoiceDate: invoiceDate || new Date(),
        dueDate,
        totalAmount: amount,
        subtotal: amount,
        lineItems: Array.isArray(options.lineItems) ? options.lineItems : (charges || []).map(c => ({
          description: c.description || 'Line Item',
          quantity: c.quantity || 1,
          unitPrice: c.amount || amount,
          amount: c.total || c.amount || amount
        })),
        status: 'draft',
        department,
        costCenter,
        module,
        referenceId,
        referenceType: 'invoice',
        createdBy
      });

      await arEntry.save();

      const arAccount = await A.resolve(FinanceHelper.ACCOUNTS.RECEIVABLE);
      if (arAccount) {
        const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
        const amountRounded = round2(amount);
        const customerParty = customerId
          ? { partyType: 'Customer', party: customerId }
          : {};
        const lines = [{
          account: arAccount._id,
          description: `Receivable from ${customerName}`,
          debit: amountRounded,
          department,
          ...customerParty
        }];

        if (charges && charges.length > 0) {
          const fallbackRev = (await A.resolve('4001')) || (await A.resolve(FinanceHelper.ACCOUNTS.REVENUE_CAM)) || (await A.resolve('4000'));
          let sumCredits = 0;
          const creditLines = [];

          for (const charge of charges) {
            const chargeAmt = round2(charge.total ?? charge.amount ?? 0);
            if (chargeAmt <= 0) continue;

            let revAccount = null;
            if (charge.account) {
              revAccount = await A.map(charge.account);
            }
            if (!revAccount && charge.accountNumber) {
              revAccount = await A.resolve(String(charge.accountNumber));
            }
            if (!revAccount) {
              const revAccountNum = {
                'CAM': FinanceHelper.ACCOUNTS.REVENUE_CAM,
                'ELECTRICITY': FinanceHelper.ACCOUNTS.REVENUE_ELECTRICITY,
                'RENT': FinanceHelper.ACCOUNTS.REVENUE_RENT,
                'SALES': '4001',
                'SERVICE': '4100'
              }[String(charge.type || '').toUpperCase()] || null;

              if (revAccountNum) revAccount = await A.resolve(revAccountNum);
            }
            if (!revAccount) revAccount = fallbackRev;
            if (!revAccount) continue;

            creditLines.push({
              account: revAccount._id,
              description: charge.description || `Revenue from ${charge.type || 'charges'}`,
              credit: chargeAmt,
              department
            });
            sumCredits += chargeAmt;
          }

          if (creditLines.length > 0) {
            const diff = round2(amountRounded - sumCredits);
            if (Math.abs(diff) > 0.01) {
              const lastLine = creditLines[creditLines.length - 1];
              const adjusted = round2(lastLine.credit + diff);
              if (adjusted > 0) {
                lastLine.credit = adjusted;
              } else {
                creditLines.length = 0;
              }
            }
            if (creditLines.length > 0) {
              lines.push(...creditLines);
            }
          }
        }

        if (lines.length === 1) {
          const revAccountNum = options.revenueAccountNum || '4001';
          let revAccount = await A.resolve(revAccountNum);
          if (!revAccount) revAccount = await A.resolve(FinanceHelper.ACCOUNTS.REVENUE_CAM);
          if (!revAccount) revAccount = await A.resolve('4000');
          if (revAccount) {
            lines.push({ account: revAccount._id, description: `Revenue from ${invoiceNumber}`, credit: amountRounded, department });
          }
        }

        if (lines.length < 2) {
          throw new Error('Could not build balanced journal entry: missing revenue account(s)');
        }

        await FinanceHelper.createAndPostJournalEntry(withCompany({
          date: dueDate || invoiceDate || new Date(),
          reference: invoiceNumber,
          description: `AR Invoice: ${invoiceNumber} for ${customerName}`,
          department,
          costCenter,
          module,
          referenceId: arEntry._id,
          referenceType: 'invoice',
          createdBy,
          lines
        }, companyId));
      }

      return arEntry;
    } catch (error) {
      console.error('❌ Error creating AR from Invoice:', error);
      throw error;
    }
  },

  /**
   * Create Accounts Payable from a source (CEO-approved indent, PO, or manual).
   * Matches REF-FINAL-001 style: creates bill with lineItems, posts to GL, so it shows in AP and impacts other finance modules.
   */
  createAPFromBill: async (options) => {
    let apEntry = null;
    try {
      const {
        vendorName, vendorEmail, vendorId,
        billNumber, vendorInvoiceNumber, billDate, dueDate,
        amount, department, module, referenceId,
        createdBy, notes,
        referenceType = 'manual',
        lineItems: optsLineItems,
        lineDescription,
        paymentTerms,
        linkedGRNs,
        debitAccountNumber,
        multiLineExpenseJournal = false,
        expenseJournalLines = null,
        attachments = [],
        skipJournal = false,
        status: statusOverride = null,
        approvalStatus = null,
        approvalChain = null,
        workflowHistory = null,
        duePaymentAmount = 0
      } = options;
      const companyId = co(options);
      const A = acct(companyId);

      // Normalize billDate to start of day so the bill appears in default date filters (e.g. current month)
      let billDateNorm = billDate ? new Date(billDate) : new Date();
      if (isNaN(billDateNorm.getTime())) billDateNorm = new Date();
      billDateNorm.setHours(0, 0, 0, 0);

      // Default line item so the bill matches working bills (e.g. REF-FINAL-001) and flows through finance modules
      const lineItems = optsLineItems && optsLineItems.length > 0
        ? optsLineItems
        : [{ description: lineDescription || `Amount as per approved document`, quantity: 1, unitPrice: amount }];

      await FinanceHelper.assertUniqueVendorInvoice({
        companyId, vendorId, vendorName, vendorInvoiceNumber
      });

      apEntry = new AccountsPayable({
        companyId: companyId || undefined,
        company: options.company || '',
        project: options.project || '',
        vendor: { name: vendorName, email: vendorEmail, vendorId: vendorId },
        payeeEmployee: options.payeeEmployeeId || options.payeeEmployee || null,
        billNumber,
        vendorInvoiceNumber: vendorInvoiceNumber || '',
        billDate: billDateNorm,
        dueDate,
        totalAmount: amount,
        subtotal: amount,
        duePaymentAmount: Math.round((Number(duePaymentAmount) || lineItems.reduce((s, li) => s + (Number(li.duePaymentAmount) || 0), 0)) * 100) / 100,
        status: statusOverride || 'approved',
        department,
        module,
        referenceId,
        referenceType: referenceType,
        paymentTerms: paymentTerms || undefined,
        lineItems,
        linkedGRNs: Array.isArray(linkedGRNs) ? linkedGRNs : [],
        notes: notes || '',
        attachments: Array.isArray(attachments) ? attachments : [],
        createdBy,
        ...(approvalStatus ? { approvalStatus } : {}),
        ...(Array.isArray(approvalChain) ? { approvalChain } : {}),
        ...(Array.isArray(workflowHistory) ? { workflowHistory } : {})
      });

      await apEntry.save();

      if (skipJournal) {
        return apEntry;
      }

      const { ensureSystemAccount } = require('./companyChartOfAccounts');
      const apAccount = await ensureSystemAccount(companyId, FinanceHelper.ACCOUNTS.PAYABLE, { createdBy });
      // A bill without its journal would put the AP sub-ledger out of step with the GL — refuse instead
      if (!apAccount) {
        const err = new Error('No Accounts Payable account on this company\'s chart of accounts — bill not created');
        err.statusCode = 400;
        throw err;
      }

      if (apAccount) {
        // ─── CORRECT ODOO-STYLE AP JOURNAL ────────────────────────────────────────
        // When AP bill is backed by a GRN/PO:
        //   DR GRNI (clears the accrual created at GRN time)
        //   CR Accounts Payable (records what we owe the specific vendor)
        //
        // When AP bill is a direct expense (no GRN):
        //   DR Expense Account
        //   CR Accounts Payable
        // ─────────────────────────────────────────────────────────────────────────
        const isGrnBacked = ['purchase_order', 'grn'].includes(referenceType);
        let debitAccount = null;

        if (isGrnBacked) {
          debitAccount = await FinanceHelper.resolveGrniAccountForBill({ referenceType, referenceId, companyId });
        }
        if (!debitAccount && debitAccountNumber) {
          // Standard heads (e.g. 6200 Utilities) are added to the company's chart when missing
          debitAccount = await require('./companyChartOfAccounts').ensureSystemAccount(companyId, String(debitAccountNumber), { createdBy });
          // An explicitly requested expense account must exist — never park the cost in General Expenses silently
          if (!debitAccount && !(Array.isArray(expenseJournalLines) && expenseJournalLines.length)) {
            const err = new Error(`Account ${debitAccountNumber} is not on this company's chart of accounts — bill not created`);
            err.statusCode = 400;
            throw err;
          }
        }
        if (!debitAccount && !isGrnBacked && !debitAccountNumber) {
          debitAccount = await A.resolve(FinanceHelper.ACCOUNTS.EXPENSE_GENERAL);
        }
        if (!debitAccount && isGrnBacked) {
          debitAccount = await A.resolve(FinanceHelper.ACCOUNTS.GRNI);
        }
        if (!debitAccount && isGrnBacked) {
          const err = new Error('No GRNI (Goods Received Not Invoiced) account for this company — bill not created');
          err.statusCode = 400;
          throw err;
        }

        if (debitAccount || (Array.isArray(expenseJournalLines) && expenseJournalLines.length > 0)) {
          let useCustomDebits = Array.isArray(expenseJournalLines) && expenseJournalLines.length > 0 && !isGrnBacked;
          let journalLines;

          if (useCustomDebits) {
            journalLines = [];
            for (const row of expenseJournalLines) {
              let accRef = row.account;
              if (!accRef && row.accountNumber) {
                accRef = (await A.resolve(String(row.accountNumber)))?._id;
                if (!accRef) {
                  accRef = (await ensureSystemAccount(companyId, String(row.accountNumber), { createdBy }))?._id;
                }
              }
              // Never drop a debit line — fall back to the bill's default expense account
              // so DR total still equals the AP credit.
              if (!accRef && debitAccount) {
                accRef = debitAccount._id;
              }
              if (!accRef) continue;
              journalLines.push({
                account: accRef,
                description: (row.description || `Expense — ${billNumber}`).slice(0, 200),
                debit: Math.round(Number(row.debit) * 100) / 100,
                department
              });
            }
            const creditAmount = Math.round(Number(amount) * 100) / 100;
            if (journalLines.length === 0) {
              useCustomDebits = false;
            } else {
              const debitSum = journalLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
              if (Math.abs(debitSum - creditAmount) > 0.01 && debitAccount) {
                const gap = Math.round((creditAmount - debitSum) * 100) / 100;
                if (gap > 0) {
                  journalLines.push({
                    account: debitAccount._id,
                    description: `Expense — ${billNumber} (balance)`,
                    debit: gap,
                    department
                  });
                } else if (journalLines.length > 0) {
                  journalLines[journalLines.length - 1].debit =
                    Math.round((journalLines[journalLines.length - 1].debit + gap) * 100) / 100;
                }
              }
              journalLines.push({
                account: apAccount._id,
                description: `Payable to ${vendorName}`,
                credit: creditAmount,
                department
              });
            }
          }

          if (!useCustomDebits) {
            const useSplitDebits = multiLineExpenseJournal && lineItems.length > 1 && !isGrnBacked;
            if (useSplitDebits) {
              journalLines = lineItems.map((li) => ({
                account: debitAccount._id,
                description: (li.description || lineDescription || `Expense — ${billNumber}`).slice(0, 200),
                debit: Math.round((Number(li.quantity) || 1) * (Number(li.unitPrice) || 0) * 100) / 100,
                department
              }));
              const debitSum = journalLines.reduce((s, l) => s + l.debit, 0);
              const creditAmount = Math.round(Number(amount) * 100) / 100;
              if (Math.abs(debitSum - creditAmount) > 0.01 && journalLines.length > 0) {
                journalLines[journalLines.length - 1].debit += creditAmount - debitSum;
                journalLines[journalLines.length - 1].debit =
                  Math.round(journalLines[journalLines.length - 1].debit * 100) / 100;
              }
              journalLines.push({
                account: apAccount._id,
                description: `Payable to ${vendorName}`,
                credit: creditAmount,
                department
              });
            } else {
              const debitDescription = isGrnBacked
                ? `GRNI cleared – ${billNumber} (matched to GRN/PO)`
                : `Expense for ${billNumber}`;
              journalLines = [
                { account: debitAccount._id, description: debitDescription, debit: amount, department },
                { account: apAccount._id, description: `Payable to ${vendorName}`, credit: amount, department }
              ];
            }
          }

          await FinanceHelper.createAndPostJournalEntry(
            withVoucherNarration(withCompany({
              date: billDateNorm,
              reference: billNumber,
              description: `AP Bill: ${billNumber} from ${vendorName}`,
              department,
              module,
              referenceId: apEntry._id,
              referenceType: 'bill',
              journalCode: 'PURCH',
              voucherSeries: 'BILL',
              createdBy,
              lines: journalLines
            }, companyId), getBillNarration(apEntry))
          );
        }
      }

      return apEntry;
    } catch (error) {
      if (apEntry?._id) {
        try {
          await AccountsPayable.findByIdAndDelete(apEntry._id);
        } catch (deleteErr) {
          console.error('Failed to roll back AP after journal error:', deleteErr.message);
        }
      }
      console.error('❌ Error creating AP from Bill:', error);
      throw error;
    }
  },

  /**
   * Post DR expense / CR AP journal for an existing bill that was created with skipJournal
   * (Chart of Accounts bills after department + audit approval).
   */
  postAPBillJournalIfMissing: async (apBill, createdByUserId) => {
    if (!apBill?._id) return { posted: false, skipped: true, reason: 'invalid_bill' };

    const JournalEntry = require('../models/finance/JournalEntry');
    const existing = await JournalEntry.findOne({
      referenceId: apBill._id,
      referenceType: 'bill',
      status: { $ne: 'voided' }
    }).select('_id entryNumber').lean();
    if (existing) {
      return { posted: false, skipped: true, reason: 'already_posted', journalId: existing._id };
    }

    const companyId = co({ companyId: apBill.companyId });
    const A = acct(companyId);
    const apAccount = await A.resolve(FinanceHelper.ACCOUNTS.PAYABLE);
    if (!apAccount) {
      return { posted: false, error: 'Accounts Payable account not found' };
    }

    const amount = Math.round(Number(apBill.totalAmount || 0) * 100) / 100;
    if (amount <= 0) {
      return { posted: false, skipped: true, reason: 'zero_amount' };
    }

    const lineItems = Array.isArray(apBill.lineItems) ? apBill.lineItems : [];
    const expenseJournalLines = [];
    for (const li of lineItems) {
      const debit = Math.round((Number(li.amount) || (Number(li.quantity) || 1) * (Number(li.unitPrice) || 0)) * 100) / 100;
      if (debit <= 0) continue;
      let accRef = li.account || null;
      if (!accRef && li.accountNumber) {
        accRef = (await A.resolve(String(li.accountNumber)))?._id;
      }
      if (!accRef) continue;
      expenseJournalLines.push({
        account: accRef,
        description: (li.description || `Expense — ${apBill.billNumber}`).slice(0, 200),
        debit,
        department: apBill.department
      });
    }

    let journalLines;
    if (expenseJournalLines.length > 0) {
      journalLines = [
        ...expenseJournalLines,
        {
          account: apAccount._id,
          description: `Payable to ${apBill.vendor?.name || 'Vendor'}`,
          credit: amount,
          department: apBill.department
        }
      ];
    } else {
      const debitAccount = await A.resolve(FinanceHelper.ACCOUNTS.EXPENSE_GENERAL);
      if (!debitAccount) {
        return { posted: false, error: 'Expense account not found for bill journal' };
      }
      journalLines = [
        {
          account: debitAccount._id,
          description: `Expense for ${apBill.billNumber}`,
          debit: amount,
          department: apBill.department
        },
        {
          account: apAccount._id,
          description: `Payable to ${apBill.vendor?.name || 'Vendor'}`,
          credit: amount,
          department: apBill.department
        }
      ];
    }

    const billDateNorm = apBill.billDate ? new Date(apBill.billDate) : new Date();
    await FinanceHelper.createAndPostJournalEntry(
      withVoucherNarration(withCompany({
        date: billDateNorm,
        reference: apBill.billNumber,
        description: `AP Bill: ${apBill.billNumber} from ${apBill.vendor?.name || 'Vendor'}`,
        department: apBill.department,
        module: apBill.module || 'finance',
        referenceId: apBill._id,
        referenceType: 'bill',
        journalCode: 'PURCH',
        voucherSeries: 'BILL',
        createdBy: createdByUserId,
        lines: journalLines
      }, companyId), getBillNarration(apBill))
    );

    return { posted: true };
  },

  /**
   * Record payment for an AR Invoice
   * Optional installmentId links the receipt to a scheduled installment (still one voucher per receipt).
   */
  /**
   * Keep invoice header amountPaid aligned with payment rows (prevents statement drift).
   */
  _syncARAmountPaid(invoice) {
    if (!invoice) return 0;
    const sum = Math.round(
      (invoice.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100
    ) / 100;
    invoice.amountPaid = sum;
    FinanceHelper._updateDocumentStatus(invoice);
    return sum;
  },

  /**
   * Record receipt for one invoice / installment.
   * Always goes through batch path so: one RV, JE created before invoice mutation, no orphan payments.
   */
  recordARPayment: async (invoiceId, paymentData) => {
    try {
      const result = await FinanceHelper.recordARPaymentBatch({
        lines: [{
          invoiceId,
          amount: paymentData.amount,
          installmentId: paymentData.installmentId || null
        }],
        paymentMethod: paymentData.paymentMethod,
        reference: paymentData.reference,
        date: paymentData.date,
        createdBy: paymentData.createdBy,
        bankAccountId: paymentData.bankAccountId,
        payingCompanyId: paymentData.payingCompanyId || null,
        narration: paymentData.narration || '',
        description: paymentData.description || '',
        costCenter: paymentData.costCenter || null
      });
      return result.invoices?.[0] || null;
    } catch (error) {
      console.error('❌ Error recording AR payment:', error);
      throw error;
    }
  },

  /**
   * Record one consolidated receipt (single RV) against multiple invoices / installments.
   * Used when Receive Payment selects several installment parts in one action.
   *
   * @param {{ lines: Array<{ invoiceId, amount, installmentId? }>, paymentMethod, reference?, date?, bankAccountId?, narration?, description?, createdBy, payingCompanyId? }} paymentData
   */
  recordARPaymentBatch: async (paymentData) => {
    const {
      lines: rawLines = [],
      paymentMethod,
      reference,
      date,
      createdBy,
      bankAccountId,
      payingCompanyId: optsPayingCompanyId = null,
      narration = '',
      description = '',
      costCenter = null
    } = paymentData || {};

    const linesIn = (Array.isArray(rawLines) ? rawLines : [])
      .map((l) => ({
        invoiceId: l.invoiceId || l.billId || l.id,
        amount: Math.round((Number(l.amount) || 0) * 100) / 100,
        installmentId: l.installmentId || null
      }))
      .filter((l) => l.invoiceId && l.amount > 0);

    if (!linesIn.length) throw new Error('Select at least one invoice or installment to receive payment against');

    const invoiceIds = [...new Set(linesIn.map((l) => String(l.invoiceId)))];
    const invoices = await AccountsReceivable.find({ _id: { $in: invoiceIds } });
    if (invoices.length !== invoiceIds.length) {
      throw new Error('One or more invoices were not found');
    }

    const byId = new Map(invoices.map((inv) => [String(inv._id), inv]));
    const companyIds = [...new Set(invoices.map((inv) => String(co(inv) || '')).filter(Boolean))];
    if (companyIds.length > 1) {
      throw new Error('All selected invoices must belong to the same company for one receipt voucher');
    }

    const companyId = co(invoices[0]);
    const receivingCompanyId = co({ companyId: optsPayingCompanyId }) || companyId;
    const isIntercompany = receivingCompanyId && companyId && String(receivingCompanyId) !== String(companyId);

    // Validate each line against live invoice / installment balances
    const applied = [];
    for (const line of linesIn) {
      const invoice = byId.get(String(line.invoiceId));
      if (!invoice) throw new Error('Invoice not found');
      if (invoice.status === 'cancelled') {
        throw new Error(`Invoice ${invoice.invoiceNumber} is cancelled`);
      }

      const balance = Math.round((invoice.totalAmount - invoice.amountPaid) * 100) / 100;
      // Sum other lines already queued for this invoice in this batch
      const queuedForInvoice = applied
        .filter((a) => String(a.invoice._id) === String(invoice._id))
        .reduce((s, a) => s + a.amount, 0);
      if (line.amount > balance - queuedForInvoice + 0.01) {
        throw new Error(
          `Receipt amount exceeds outstanding on ${invoice.invoiceNumber} (open PKR ${Math.max(0, balance - queuedForInvoice)})`
        );
      }

      let installment = null;
      if (line.installmentId) {
        installment = invoice.installments?.id?.(line.installmentId)
          || (invoice.installments || []).find((i) => String(i._id) === String(line.installmentId));
        if (!installment) {
          throw new Error(`Installment not found on invoice ${invoice.invoiceNumber}`);
        }
        if (installment.status === 'paid' || installment.status === 'cancelled') {
          throw new Error(
            `Installment #${installment.sequence || ''} on ${invoice.invoiceNumber} is already paid or cancelled`
          );
        }
        const instBalance = Math.round(((installment.amount || 0) - (installment.paidAmount || 0)) * 100) / 100;
        const queuedForInst = applied
          .filter((a) => a.installment && String(a.installment._id) === String(installment._id))
          .reduce((s, a) => s + a.amount, 0);
        if (line.amount > instBalance - queuedForInst + 0.01) {
          throw new Error(
            `Amount exceeds balance on installment #${installment.sequence || ''} of ${invoice.invoiceNumber}`
          );
        }
      }

      applied.push({ invoice, installment, amount: line.amount });
    }

    const totalAmount = Math.round(applied.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    if (totalAmount <= 0) throw new Error('Receipt amount must be greater than zero');

    const A_target = acct(companyId);
    const A_receiving = acct(receivingCompanyId);
    const arAccount = await A_target.resolve(FinanceHelper.ACCOUNTS.RECEIVABLE);
    let bankAccount = bankAccountId ? await A_receiving.map(bankAccountId) : null;
    if (!bankAccount) {
      bankAccount = await A_receiving.resolve(
        paymentMethod === 'cash' ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK
      );
    }
    if (!arAccount || !bankAccount) {
      throw new Error('Accounts Receivable or Bank/Cash account not found');
    }

    const paymentDate = date ? new Date(date) : new Date();
    const instLabels = applied
      .filter((a) => a.installment)
      .map((a) => `#${a.installment.sequence || ''}`)
      .filter(Boolean);
    const invoiceLabels = [...new Set(applied.map((a) => a.invoice.invoiceNumber))].join(', ');
    const instSuffix = instLabels.length
      ? ` (Installment${instLabels.length > 1 ? 's' : ''} ${instLabels.join(', ')})`
      : '';
    const customerName = invoices[0].customer?.name || invoices[0].customerName || 'Customer';
    const userNarration = String(narration || description || '').trim();
    const voucherNarration =
      userNarration
      || `Receipt: ${invoiceLabels} from ${customerName}${instSuffix}${isIntercompany ? ' (Intercompany Receipt)' : ''}`;

    // Build journal lines — one DR bank, then CR AR per allocation (still one RV)
    const jeLines = [];
    const customerParty = invoices[0].customer?.customerId
      ? { partyType: 'Customer', party: invoices[0].customer.customerId }
      : {};
    const department = invoices[0].department;

    if (isIntercompany) {
      const { resolveIntercompanyAccounts } = require('./financePosting');
      const { icTargetAcc, icPayingAcc: icReceivingAcc } = await resolveIntercompanyAccounts({
        targetCompanyId: companyId,
        payingCompanyId: receivingCompanyId,
        createdBy
      });
      jeLines.push({
        account: icTargetAcc._id,
        description: 'Intercompany Receipt via receiving bank account',
        debit: totalAmount,
        department
      });
      for (const row of applied) {
        const label = row.installment
          ? `${row.invoice.invoiceNumber} Inst #${row.installment.sequence || ''}`
          : row.invoice.invoiceNumber;
        jeLines.push({
          account: arAccount._id,
          description: `Clear AR – ${label}`,
          credit: row.amount,
          department,
          ...customerParty
        });
      }
      jeLines.push({
        account: bankAccount._id,
        description: `Receipt – ${invoiceLabels}${instSuffix}`,
        debit: totalAmount,
        department
      });
      jeLines.push({
        account: icReceivingAcc._id,
        description: 'Intercompany Payable for receipt collected on behalf of subsidiary',
        credit: totalAmount,
        department
      });
    } else {
      jeLines.push({
        account: bankAccount._id,
        description: `Receipt – ${invoiceLabels}${instSuffix}`,
        debit: totalAmount,
        department
      });
      for (const row of applied) {
        const label = row.installment
          ? `${row.invoice.invoiceNumber} Inst #${row.installment.sequence || ''}`
          : row.invoice.invoiceNumber;
        jeLines.push({
          account: arAccount._id,
          description: `Clear AR – ${label}`,
          credit: row.amount,
          department,
          ...customerParty
        });
      }
    }

    const firstDue = applied.find((a) => a.installment?.dueDate)?.installment?.dueDate
      || applied[0].invoice.dueDate
      || paymentDate;

    const je = await FinanceHelper.createAndPostJournalEntry(
      withVoucherNarration(withCompany({
        date: paymentDate || firstDue,
        reference: reference || '',
        description: voucherNarration,
        department,
        costCenter: costCenter || invoices[0].costCenter?._id || invoices[0].costCenter || null,
        vendorOrEmployeeName: customerName,
        module: invoices[0].module || 'finance',
        referenceId: invoices.length === 1 ? invoices[0]._id : null,
        referenceType: 'receipt',
        journalCode: 'BANK',
        voucherSeries: 'RV',
        createdBy,
        lines: jeLines
      }, companyId), voucherNarration)
    );

    if (!je?._id) {
      throw new Error('Failed to create receipt voucher — invoice was not updated');
    }

    // Apply amounts only AFTER RV exists (never leave orphan payment rows without JE)
    const touched = new Map();
    for (const row of applied) {
      const invoice = row.invoice;
      invoice.payments.push({
        amount: row.amount,
        paymentDate,
        paymentMethod: paymentMethod || 'bank_transfer',
        reference: reference || '',
        createdBy,
        installmentId: row.installment?._id || null,
        journalEntry: je._id
      });

      if (row.installment) {
        const liveInst = invoice.installments.id(row.installment._id)
          || (invoice.installments || []).find((i) => String(i._id) === String(row.installment._id));
        if (liveInst) {
          liveInst.paidAmount = Math.round(((liveInst.paidAmount || 0) + row.amount) * 100) / 100;
          liveInst.lastPaymentDate = paymentDate;
          liveInst.lastJournalEntry = je._id;
          if (liveInst.paidAmount >= (liveInst.amount || 0) - 0.01) {
            liveInst.status = 'paid';
            liveInst.paidAmount = liveInst.amount;
          } else {
            liveInst.status = 'partial';
          }
        }
      }
      touched.set(String(invoice._id), invoice);
    }

    for (const invoice of touched.values()) {
      FinanceHelper._syncARAmountPaid(invoice);
      await invoice.save();
      // Project Management client invoices mirror receipts recorded here
      try {
        await require('./projectClientInvoiceFinance').syncClientInvoiceFromAr(invoice);
      } catch (syncErr) {
        console.error('[recordARPaymentBatch] client invoice sync failed:', syncErr.message);
      }
    }

    return {
      journalEntryId: je._id,
      entryNumber: je.entryNumber || null,
      totalAmount,
      invoiceCount: invoices.length,
      lineCount: applied.length,
      invoices
    };
  },

  /**
   * Record payment for an AP Bill
   */
  recordAPPayment: async (billId, paymentData) => {
    try {
      const ApPayment = require('./apPaymentApplication');
      const bill = await AccountsPayable.findById(billId);
      if (!bill) throw new Error('Bill not found');

      const {
        amount,
        paymentMethod,
        reference,
        date,
        createdBy,
        whtRate = 0,
        bankAccountId,
        allocations,
        financeApprovalAuthorities,
        batchId
      } = paymentData;

      const amount_ = Math.round((Number(amount) || 0) * 100) / 100;
      const balance = FinanceHelper.getAPOutstanding(bill);
      if (amount_ > balance + 0.01) {
        throw new Error(`Payment amount PKR ${amount_} exceeds outstanding balance PKR ${balance}`);
      }

      // Check for Reference/Cheque uniqueness
      if (reference) {
        // 1. Check already fully paid bills
        const query1 = {
          payments: {
            $elemMatch: {
              reference: reference,
              ...(batchId ? { batchId: { $ne: batchId } } : {})
            }
          }
        };
        const existingRef1 = await AccountsPayable.findOne(query1).select('billNumber');
        if (existingRef1) {
          throw new Error(`Cheque / TT / Reference number '${reference}' has already been used in bill ${existingRef1.billNumber}. It cannot be reused.`);
        }

        // 2. Check pending payment applications
        const query2 = {
          'paymentMeta.reference': reference,
          workflowStatus: { $ne: 'rejected' },
          ...(batchId ? { 'paymentMeta.batchId': { $ne: batchId } } : {})
        };
        const ApPaymentAppModel = mongoose.model('ApPaymentApplication');
        const existingRef2 = await ApPaymentAppModel.findOne(query2).select('billNumber');
        if (existingRef2) {
          throw new Error(`Cheque / TT / Reference number '${reference}' is already pending for bill ${existingRef2.billNumber}.`);
        }
      }

      const whtAmount = whtRate > 0 ? Math.round(amount_ * (whtRate / 100) * 100) / 100 : 0;
      const netBankAmount = Math.round((amount_ - whtAmount) * 100) / 100;

      const normalizedAllocations = Array.isArray(allocations)
        ? allocations
          .map((a) => ({
            grnId: a?.grnId || null,
            amount: Math.round((Number(a?.amount) || 0) * 100) / 100
          }))
          .filter((a) => a.grnId && a.amount > 0)
        : [];

      const companyId = co(bill);
      if (companyId) {
        const { seedChartOfAccountsForCompany } = require('./companyChartOfAccounts');
        await seedChartOfAccountsForCompany(companyId, { skipExisting: true });
      }

      const A = acct(companyId);
      const apAccount = await A.resolve(FinanceHelper.ACCOUNTS.PAYABLE);
      let bankAccount = bankAccountId ? await A.map(bankAccountId) : null;
      if (!bankAccount) {
        bankAccount = await A.resolve(
          paymentMethod === 'cash' ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK
        );
      }

      if (!apAccount || !bankAccount) {
        const missing = [];
        if (!apAccount) missing.push('AP account (2001)');
        if (!bankAccount) {
          if (bankAccountId) missing.push(`Bank/Cash account (ID: ${bankAccountId})`);
          else missing.push(`Bank/Cash account (${paymentMethod === 'cash' ? '1001' : '1002'})`);
        }
        throw new Error(`${missing.join(' and ')} not found. Please ensure these accounts exist in the Chart of Accounts.`);
      }

      // After-due utility payments may exceed booked AP liability (totalAmount).
      // Debit AP only up to booked remaining; surcharge → utility expense (6200).
      const bookedRem = Math.max(0, FinanceHelper.getAPBookedOutstanding(bill));
      const apDebit = Math.min(amount_, bookedRem);
      const surcharge = Math.round((amount_ - apDebit) * 100) / 100;

      const lines = [];
      if (apDebit > 0.009) {
        lines.push({
          account: apAccount._id,
          description: `Payment to ${bill.vendor.name} – ${bill.billNumber}`,
          debit: apDebit,
          department: bill.department
        });
      }
      if (surcharge > 0.009) {
        const surchargeAccount = await A.resolve('6200');
        if (!surchargeAccount) {
          throw new Error('Utility expense account (6200) not found — required for after-due payment surcharge.');
        }
        lines.push({
          account: surchargeAccount._id,
          description: `After-due surcharge – ${bill.billNumber}`,
          debit: surcharge,
          department: bill.department
        });
      }
      lines.push({
        account: bankAccount._id,
        description: `Bank payment – ${bill.billNumber} (pending signatures)`,
        credit: netBankAmount,
        department: bill.department
      });
      if (whtAmount > 0) {
        const whtAccount = await A.resolve('2004');
        if (whtAccount) {
          lines.push({ account: whtAccount._id, description: `WHT @ ${whtRate}% on ${bill.vendor.name}`, credit: whtAmount, department: bill.department });
        } else {
          lines[lines.length - 1].credit = amount_;
        }
      }

      const authorities = await ApPayment.resolvePaymentFinanceAuthorities(
        bill,
        financeApprovalAuthorities,
        createdBy
      );

      const { application, journalEntry } = await ApPayment.submitSettlement({
        bill,
        amount: amount_,
        sourceType: 'bank_payment',
        createdBy,
        financeApprovalAuthorities: authorities,
        journalPayload: withVoucherNarration(withCompany({
          date: date || new Date(),
          reference: reference || '',
          description: `Payment: ${bill.billNumber} – ${bill.vendor.name} (pending finance signatures)`,
          department: bill.department,
          module: bill.module,
          referenceType: 'payment',
          journalCode: 'BANK',
          voucherSeries: paymentMethod === 'cash' ? 'CPV' : 'BPV',
          lines
        }, companyId), getBillNarration(bill)),
        paymentMeta: {
          paymentMethod,
          reference: reference || '',
          batchId: batchId || null,
          whtRate,
          bankAccountId: bankAccount ? bankAccount._id : null,
          allocations: normalizedAllocations
        }
      });

      const fresh = await AccountsPayable.findById(bill._id);
      fresh._pendingSettlement = {
        applicationId: application._id,
        journalEntryId: journalEntry._id,
        amount: amount_,
        workflowStatus: 'pending_authority'
      };
      return fresh;
    } catch (error) {
      throw error;
    }
  },

  recordAPBatchPayment: async (paymentData) => {
    try {
      const AccountsPayable = mongoose.model('AccountsPayable');
      const ApPayment = require('./apPaymentApplication');

      const {
        bills, // Array of { billId, amount }
        paymentMethod,
        reference,
        date,
        createdBy,
        whtRate = 0,
        bankAccountId,
        relatedPartyAccountId = null,
        payingCompanyId: optsPayingCompanyId = null,
        financeApprovalAuthorities,
        batchId,
        costCenter,
        narration
      } = paymentData;

      if (!Array.isArray(bills) || bills.length === 0) {
        throw new Error('No bills provided for batch payment');
      }

      const billObjects = [];
      let totalAmount = 0;
      let companyId = null;
      let departmentId = null;
      let vendorName = '';

      // Validate all bills and calculate total
      for (const item of bills) {
        const bill = await AccountsPayable.findById(item.billId).populate('vendor');
        if (!bill) throw new Error(`Bill not found: ${item.billId}`);

        const amount_ = Math.round((Number(item.amount) || 0) * 100) / 100;
        const balance = FinanceHelper.getAPOutstanding(bill);
        if (amount_ > balance + 0.01) {
          throw new Error(`Payment amount PKR ${amount_} exceeds outstanding balance PKR ${balance} for bill ${bill.billNumber}`);
        }

        totalAmount += amount_;
        billObjects.push({ bill, amount: amount_ });

        // Grab company/department from the first bill to group them
        if (!companyId) companyId = co(bill);
        if (!departmentId) departmentId = bill.department;
        if (!vendorName) vendorName = bill.vendor?.name || 'Vendor';
      }

      totalAmount = Math.round(totalAmount * 100) / 100;
      const payingCompanyId = co({ companyId: optsPayingCompanyId }) || companyId;
      const isIntercompany = payingCompanyId && companyId && String(payingCompanyId) !== String(companyId);

      // Check for Reference/Cheque uniqueness
      if (reference) {
        const query1 = {
          payments: {
            $elemMatch: {
              reference: reference,
              ...(batchId ? { batchId: { $ne: batchId } } : {})
            }
          }
        };
        const existingRef1 = await AccountsPayable.findOne(query1).select('billNumber');
        if (existingRef1) {
          throw new Error(`Cheque / TT / Reference number '${reference}' has already been used in bill ${existingRef1.billNumber}. It cannot be reused.`);
        }

        const query2 = {
          'paymentMeta.reference': reference,
          workflowStatus: { $ne: 'rejected' },
          ...(batchId ? { 'paymentMeta.batchId': { $ne: batchId } } : {})
        };
        const ApPaymentAppModel = mongoose.model('ApPaymentApplication');
        const existingRef2 = await ApPaymentAppModel.findOne(query2).select('billNumber');
        if (existingRef2) {
          throw new Error(`Cheque / TT / Reference number '${reference}' is already pending for bill ${existingRef2.billNumber || 'in another batch'}.`);
        }
      }

      const whtAmount = whtRate > 0 ? Math.round(totalAmount * (whtRate / 100) * 100) / 100 : 0;
      const netBankAmount = Math.round((totalAmount - whtAmount) * 100) / 100;

      if (companyId) {
        const { seedChartOfAccountsForCompany } = require('./companyChartOfAccounts');
        await seedChartOfAccountsForCompany(companyId, { skipExisting: true });
      }
      if (payingCompanyId) {
        const { seedChartOfAccountsForCompany } = require('./companyChartOfAccounts');
        await seedChartOfAccountsForCompany(payingCompanyId, { skipExisting: true });
      }

      const A_target = acct(companyId);
      const A_paying = acct(payingCompanyId);

      const apAccount = await A_target.resolve(FinanceHelper.ACCOUNTS.PAYABLE);

      // Bank/cash always from Paying company (exact id — no cross-company remap by number)
      let bankAccount = null;
      if (bankAccountId) {
        bankAccount = await Account.findById(bankAccountId).lean();
        if (!bankAccount) throw new Error('Selected Pay From (bank/cash) account was not found.');
        if (bankAccount.companyId && String(bankAccount.companyId) !== String(payingCompanyId)) {
          throw new Error('Pay From Account must be a bank/cash account on the Paying company.');
        }
      } else if (!isIntercompany) {
        bankAccount = await A_paying.resolve(
          paymentMethod === 'cash' ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK
        );
      }

      // Related party always from original (bill) company when IC
      let relatedPartyAccount = null;
      if (relatedPartyAccountId) {
        relatedPartyAccount = await Account.findById(relatedPartyAccountId).lean();
        if (!relatedPartyAccount) {
          throw new Error('Selected Related Party Account was not found.');
        }
      }

      const { isRelatedPartyPayFromAccount, findExistingRelatedPartyAccount } = require('./financePosting');

      if (isIntercompany) {
        if (!bankAccountId || !bankAccount) {
          throw new Error('Select Pay From Account (bank/cash on the Paying company).');
        }
        if (!relatedPartyAccountId || !relatedPartyAccount) {
          throw new Error('Select Related Party Account on the original (bill) company.');
        }
        if (String(relatedPartyAccount.companyId) !== String(companyId)) {
          throw new Error('Related Party Account must belong to the original (bill) company.');
        }
        if (!(await isRelatedPartyPayFromAccount(relatedPartyAccount))) {
          throw new Error('Related Party Account must be under Payable to Related Parties on the original company.');
        }
      }

      if (!apAccount || !bankAccount) {
        const missing = [];
        if (!apAccount) missing.push('AP account (2001)');
        if (!bankAccount) {
          if (bankAccountId) missing.push(`Pay From account (ID: ${bankAccountId})`);
          else missing.push(`Bank/Cash account (${paymentMethod === 'cash' ? '1001' : '1002'})`);
        }
        throw new Error(`${missing.join(' and ')} not found. Please ensure these accounts exist in the Chart of Accounts.`);
      }

      if (isIntercompany) {
        // Dual vouchers (no auto-create COA):
        // 1) Original/bill company JV: DR AP · CR Related Party (user-selected)
        // 2) Paying company BPV/CPV: DR Related Party (existing for bill co) · CR Bank
        const PlacementCompany = mongoose.model('PlacementCompany');
        const [billCoDoc, payingCoDoc] = await Promise.all([
          PlacementCompany.findById(companyId).select('name').lean(),
          PlacementCompany.findById(payingCompanyId).select('name').lean()
        ]);
        const billName = billCoDoc?.name || 'Bill company';
        const payingName = payingCoDoc?.name || 'Paying company';

        const payingRelatedParty = await findExistingRelatedPartyAccount(
          payingCompanyId,
          billName
        );
        if (!payingRelatedParty) {
          throw new Error(
            'Paying company needs an existing Payable to Related Parties account for the bill company. Set it up in Chart of Accounts — nothing is auto-created.'
          );
        }

        const billCompanyLines = [];
        let surchargeAccount = null;
        for (const item of billObjects) {
          const bookedRem = Math.max(0, FinanceHelper.getAPBookedOutstanding(item.bill));
          const apDebit = Math.min(item.amount, bookedRem);
          const surcharge = Math.round((item.amount - apDebit) * 100) / 100;
          if (apDebit > 0.009) {
            billCompanyLines.push({
              account: apAccount._id,
              description: `Payment to ${item.bill.vendor?.name || 'Vendor'} – ${item.bill.billNumber}`,
              debit: apDebit,
              department: item.bill.department
            });
          }
          if (surcharge > 0.009) {
            if (!surchargeAccount) {
              surchargeAccount = await A_target.resolve('6200');
              if (!surchargeAccount) {
                throw new Error('Utility expense account (6200) not found — required for after-due payment surcharge.');
              }
            }
            billCompanyLines.push({
              account: surchargeAccount._id,
              description: `After-due surcharge – ${item.bill.billNumber}`,
              debit: surcharge,
              department: item.bill.department
            });
          }
        }
        billCompanyLines.push({
          account: relatedPartyAccount._id,
          description: `Due to ${payingName} — intercompany bill settlement for ${vendorName}`,
          credit: totalAmount,
          department: departmentId
        });

        const payingCompanyLines = [
          {
            account: payingRelatedParty._id,
            description: `Due from ${billName} — bill payment paid on their behalf for ${vendorName}`,
            debit: totalAmount,
            department: departmentId
          },
          {
            account: bankAccount._id,
            description: `Bank payment – intercompany for ${billName} / ${vendorName}`,
            credit: netBankAmount,
            department: departmentId
          }
        ];

        if (whtAmount > 0) {
          const whtAccount = await A_paying.resolve('2004') || await A_target.resolve('2004');
          if (whtAccount) {
            payingCompanyLines.push({
              account: whtAccount._id,
              description: `WHT @ ${whtRate}% on ${vendorName}`,
              credit: whtAmount,
              department: departmentId
            });
          } else {
            payingCompanyLines[payingCompanyLines.length - 1].credit = totalAmount;
          }
        }

        const authorities = await ApPayment.resolvePaymentFinanceAuthorities(
          billObjects[0].bill,
          financeApprovalAuthorities,
          createdBy
        );

        const narrationText = narration || `Batch Payment – ${vendorName} (Intercompany Settlement)`;

        const { application, journalEntry, payingJournalEntry } = await ApPayment.submitBatchSettlement({
          bills: billObjects,
          sourceType: 'bank_payment',
          createdBy,
          financeApprovalAuthorities: authorities,
          // Voucher 1 — ONLY original/bill company (do not set payingCompanyId or it appears under paying co. list)
          journalPayload: withVoucherNarration({
            companyId,
            date: date || new Date(),
            reference: reference || '',
            description: `${narrationText} — original company (paid by ${payingName})`,
            department: departmentId,
            costCenter: costCenter || null,
            module: billObjects[0].bill.module,
            referenceType: 'payment',
            journalCode: 'BANK',
            voucherSeries: 'JV',
            lines: billCompanyLines
          }, narrationText),
          // Voucher 2 — ONLY paying company
          payingJournalPayload: withVoucherNarration({
            companyId: payingCompanyId,
            date: date || new Date(),
            reference: reference || '',
            description: `${narrationText} — paying company for ${billName}`,
            department: departmentId,
            costCenter: costCenter || null,
            module: billObjects[0].bill.module,
            referenceType: 'payment',
            journalCode: 'BANK',
            voucherSeries: paymentMethod === 'cash' ? 'CPV' : 'BPV',
            lines: payingCompanyLines
          }, narrationText),
          paymentMeta: {
            paymentMethod,
            reference: reference || '',
            batchId: batchId || null,
            whtRate,
            bankAccountId: bankAccount._id,
            relatedPartyAccountId: relatedPartyAccount._id,
            payingCompanyId
          }
        });

        // Hard-pin each voucher to its company (never let both land on paying company)
        if (!journalEntry.companyId || String(journalEntry.companyId) !== String(companyId)) {
          journalEntry.companyId = companyId;
          journalEntry.payingCompanyId = undefined;
          await journalEntry.save();
        } else if (journalEntry.payingCompanyId) {
          journalEntry.payingCompanyId = undefined;
          await journalEntry.save();
        }
        if (
          payingJournalEntry
          && (!payingJournalEntry.companyId || String(payingJournalEntry.companyId) !== String(payingCompanyId))
        ) {
          payingJournalEntry.companyId = payingCompanyId;
          await payingJournalEntry.save();
        }

        return {
          success: true,
          applicationId: application._id,
          journalEntryId: journalEntry._id,
          payingJournalEntryId: payingJournalEntry?._id || null
        };
      }

      const lines = [];
      // Debit AP for each bill on target company ledger (surcharge for after-due excess)
      let batchSurchargeAccount = null;
      for (const item of billObjects) {
        const bookedRem = Math.max(0, FinanceHelper.getAPBookedOutstanding(item.bill));
        const apDebit = Math.min(item.amount, bookedRem);
        const surcharge = Math.round((item.amount - apDebit) * 100) / 100;
        if (apDebit > 0.009) {
          lines.push({
            account: apAccount._id,
            description: `Payment to ${item.bill.vendor?.name || 'Vendor'} – ${item.bill.billNumber}`,
            debit: apDebit,
            department: item.bill.department
          });
        }
        if (surcharge > 0.009) {
          if (!batchSurchargeAccount) {
            batchSurchargeAccount = await A_target.resolve('6200');
            if (!batchSurchargeAccount) {
              throw new Error('Utility expense account (6200) not found — required for after-due payment surcharge.');
            }
          }
          lines.push({
            account: batchSurchargeAccount._id,
            description: `After-due surcharge – ${item.bill.billNumber}`,
            debit: surcharge,
            department: item.bill.department
          });
        }
      }

      // Standard Same-Company Payment
      lines.push({
        account: bankAccount._id,
        description: `Bank payment – Batch Payment (pending signatures)`,
        credit: netBankAmount,
        department: departmentId
      });

      if (whtAmount > 0) {
        const whtAccount = await A_target.resolve('2004');
        if (whtAccount) {
          lines.push({ account: whtAccount._id, description: `WHT @ ${whtRate}% on ${vendorName}`, credit: whtAmount, department: departmentId });
        } else {
          lines[lines.length - 1].credit = totalAmount;
        }
      }

      const authorities = await ApPayment.resolvePaymentFinanceAuthorities(
        billObjects[0].bill,
        financeApprovalAuthorities,
        createdBy
      );

      const { application, journalEntry } = await ApPayment.submitBatchSettlement({
        bills: billObjects,
        sourceType: 'bank_payment',
        createdBy,
        financeApprovalAuthorities: authorities,
        journalPayload: withVoucherNarration(withCompany({
          date: date || new Date(),
          reference: reference || '',
          description: narration || `Batch Payment – ${vendorName} (pending finance signatures)`,
          department: departmentId,
          costCenter: costCenter || null,
          module: billObjects[0].bill.module,
          referenceType: 'payment',
          journalCode: 'BANK',
          voucherSeries: paymentMethod === 'cash' ? 'CPV' : 'BPV',
          lines,
          payingCompanyId: payingCompanyId || null
        }, companyId), narration || `Batch Payment for ${billObjects.length} bills`),
        paymentMeta: {
          paymentMethod,
          reference: reference || '',
          batchId: batchId || null,
          whtRate,
          bankAccountId: bankAccount ? bankAccount._id : null,
          relatedPartyAccountId: relatedPartyAccount ? relatedPartyAccount._id : null,
          payingCompanyId: payingCompanyId || null
        }
      });

      return { success: true, applicationId: application._id, journalEntryId: journalEntry._id };
    } catch (error) {
      console.error('❌ Error recording AP Batch payment:', error);
      throw error;
    }
  },

  recordVendorAdvance: async ({
    vendorName,
    vendorEmail,
    vendorId,
    amount,
    paymentMethod,
    reference,
    chequeNumber,
    date,
    createdBy,
    department = 'procurement',
    module = 'procurement',
    bankAccountId = null,
    referenceType = 'advance',
    referenceId = null,
    financeApprovalAuthorities = null,
    companyId: optsCompanyId = null,
    payingCompanyId: optsPayingCompanyId = null,
    categoryLines = [],
    costCenter = null
  }) => {
    const amount_ = Math.round((Number(amount) || 0) * 100) / 100;
    if (amount_ <= 0) throw new Error('Advance amount must be greater than zero');

    const cleanChequeNo = (chequeNumber || '').trim();
    if (cleanChequeNo) {
      const existingCheque = await VendorAdvance.findOne({ chequeNumber: cleanChequeNo }).lean();
      if (existingCheque) {
        throw new Error(`Cheque number "${cleanChequeNo}" already exists on another Vendor Advance.`);
      }
    }

    const { normalizeCompanyId } = require('./financeCompanyContext');
    // "all" is a UI filter only — never a real posting company
    const rawCompany = optsCompanyId && String(optsCompanyId).toLowerCase() !== 'all' ? optsCompanyId : null;
    const rawPaying = optsPayingCompanyId && String(optsPayingCompanyId).toLowerCase() !== 'all' ? optsPayingCompanyId : null;
    let companyId = normalizeCompanyId(rawCompany) || normalizeCompanyId(rawPaying);
    let payingCompanyId = normalizeCompanyId(rawPaying) || companyId;
    if (!companyId) {
      throw new Error(
        'Select a specific finance company (not All Companies) before recording a vendor advance, or choose a Paying company.'
      );
    }

    const isIntercompany = payingCompanyId && companyId && String(payingCompanyId) !== String(companyId);

    const A_target = acct(companyId);
    const A_paying = acct(payingCompanyId);

    const fa = financeApprovalAuthorities || {};
    const am = fa.accountsManagerUser || fa.accountsManager;
    const fc = fa.financeControllerUser || fa.financeController;
    if (!am || !fc) {
      throw new Error('Sr Manager Accounts and GM Finance approvers are required for every vendor advance.');
    }
    const nowPreparer = new Date();

    let advAccount = await A_target.resolve(FinanceHelper.ACCOUNTS.VENDOR_ADVANCE);
    if (!advAccount) {
      advAccount = await Account.create({
        accountNumber: FinanceHelper.ACCOUNTS.VENDOR_ADVANCE,
        name: 'Advance to Suppliers',
        type: 'Asset',
        category: 'Current Asset',
        detailType: 'Other Current Assets',
        description: 'Vendor advances paid before bill settlement',
        isSystem: true,
        companyId: companyId || undefined,
        createdBy
      });
    }
    let bankAccount = bankAccountId ? await A_paying.map(bankAccountId) : null;
    if (bankAccountId && !bankAccount) {
      throw new Error('Selected bank or cash account was not found on the Paying company chart of accounts.');
    }
    if (!bankAccount) {
      bankAccount = await A_paying.resolve(
        (paymentMethod || 'bank_transfer') === 'cash' ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK
      );
    }
    if (!advAccount || !bankAccount) throw new Error('Advance or Bank/Cash account not found');
    if (bankAccount.companyId && String(bankAccount.companyId) !== String(payingCompanyId)) {
      throw new Error('Pay from account must belong to the selected Paying company.');
    }

    const validCategoryLines = Array.isArray(categoryLines)
      ? categoryLines.filter((l) => Number(l.amount) > 0)
      : [];
    if (validCategoryLines.length > 0) {
      const catSum = Math.round(
        validCategoryLines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100
      ) / 100;
      if (Math.abs(catSum - amount_) > 0.01) {
        throw new Error(
          `Category line amounts (PKR ${catSum.toLocaleString('en-PK')}) must equal the advance total (PKR ${amount_.toLocaleString('en-PK')}).`
        );
      }
    }

    const advance = await VendorAdvance.create({
      vendor: { name: vendorName || 'Vendor', email: vendorEmail || '', vendorId: vendorId || null },
      amount: amount_,
      paymentMethod: paymentMethod || 'bank_transfer',
      bankAccountId: bankAccount._id,
      reference: reference || '',
      chequeNumber: cleanChequeNo || undefined,
      paymentDate: date || new Date(),
      createdBy,
      department,
      module,
      costCenter: costCenter || null,
      referenceType,
      referenceId,
      categoryLines: Array.isArray(categoryLines) ? categoryLines : [],
      companyId,
      payingCompanyId: payingCompanyId || companyId,
      voucherWorkflowStatus: 'pending_authority',
      financeApprovalAuthorities: {
        accountsOfficerUser: createdBy,
        accountsManagerUser: am,
        financeControllerUser: fc
      },
      financeAuthorityApprovals: [{
        authorityKey: 'accountsOfficerUser',
        authorityLabel: 'Accounts Officer / AM',
        approver: createdBy,
        decision: 'approved',
        approvedAt: nowPreparer,
        comments: 'Preparer — recorded vendor advance'
      }]
    });

    // Party tag on advance debit = vendor sub-ledger (required for TB / vendor statements)
    const vendorParty = vendorId
      ? { partyType: 'Vendor', party: vendorId }
      : {};

    let debitLines = [];
    if (validCategoryLines.length > 0) {
      for (const cl of validCategoryLines) {
        let lineAcc = cl.account ? await A_target.map(cl.account) : null;
        if (!lineAcc && cl.accountNumber) {
          lineAcc = await A_target.resolve(cl.accountNumber);
        }
        if (!lineAcc) {
          lineAcc = advAccount;
        }
        debitLines.push({
          account: lineAcc._id,
          description: cl.description || `Advance / ${lineAcc.name || 'Expense'} - ${vendorName || 'Vendor'}`,
          debit: Math.round((Number(cl.amount) || 0) * 100) / 100,
          department,
          ...vendorParty
        });
      }
    } else {
      debitLines.push({
        account: advAccount._id,
        description: `Advance to ${vendorName || 'Vendor'}`,
        debit: amount_,
        department,
        ...vendorParty
      });
    }

    const PlacementCompany = require('../models/hr/Company');
    const [targetCo, payingCo] = await Promise.all([
      PlacementCompany.findById(companyId).select('name').lean(),
      PlacementCompany.findById(payingCompanyId).select('name').lean()
    ]);
    const targetName = targetCo?.name || 'Target company';
    const payingName = payingCo?.name || 'Paying company';
    const narration = getVendorAdvanceNarration(advance) || reference;
    const payRef = cleanChequeNo || advance.reference || '';

    try {
      if (isIntercompany) {
        const { resolveIntercompanyAccounts } = require('./financePosting');
        const { seedChartOfAccountsForCompany } = require('./companyChartOfAccounts');
        await seedChartOfAccountsForCompany(companyId, { skipExisting: true });
        await seedChartOfAccountsForCompany(payingCompanyId, { skipExisting: true });
        const { icTargetAcc, icPayingAcc } = await resolveIntercompanyAccounts({
          targetCompanyId: companyId,
          payingCompanyId,
          createdBy
        });

        // Voucher 1 — original company (e.g. Taj): DR Vendor Advance, CR Intercompany Payable (paying co.)
        const targetJournal = await FinanceHelper.createDraftJournalEntry(
          withVoucherNarration(
            withCompany({
              date: date || new Date(),
              reference: payRef,
              description: `Vendor Advance: ${vendorName || 'Vendor'} (paid by ${payingName})`,
              department,
              module,
              costCenter: costCenter || null,
              referenceId: advance._id,
              referenceType: 'payment',
              journalCode: 'BANK',
              voucherSeries: 'JV',
              createdBy,
              payingCompanyId,
              lines: [
                ...debitLines,
                {
                  account: icTargetAcc._id,
                  description: `Due to ${payingName} — intercompany vendor advance`,
                  credit: amount_,
                  department
                }
              ]
            }, companyId),
            narration
          )
        );

        // Voucher 2 — paying company: DR Intercompany Receivable (original), CR Bank
        const payingJournal = await FinanceHelper.createDraftJournalEntry(
          withVoucherNarration(
            {
              companyId: payingCompanyId,
              date: date || new Date(),
              reference: payRef,
              description: `Vendor Advance payment for ${targetName}: ${vendorName || 'Vendor'}`,
              department,
              module,
              costCenter: costCenter || null,
              referenceId: advance._id,
              referenceType: 'payment',
              journalCode: 'BANK',
              voucherSeries: (paymentMethod || 'bank_transfer') === 'cash' ? 'CPV' : 'BPV',
              createdBy,
              lines: [
                {
                  account: icPayingAcc._id,
                  description: `Due from ${targetName} — vendor advance paid on their behalf`,
                  debit: amount_,
                  department
                },
                {
                  account: bankAccount._id,
                  description: `Advance payment to ${vendorName || 'Vendor'} (${payRef})`,
                  credit: amount_,
                  department
                }
              ]
            },
            narration
          )
        );

        if (!payingJournal.companyId || String(payingJournal.companyId) !== String(payingCompanyId)) {
          payingJournal.companyId = payingCompanyId;
          await payingJournal.save();
        }

        advance.journalEntryId = targetJournal._id;
        advance.payingJournalEntryId = payingJournal._id;
        await advance.save();
      } else {
        const journalEntry = await FinanceHelper.createDraftJournalEntry(
          withVoucherNarration(
            withCompany({
              date: date || new Date(),
              reference: payRef,
              description: `Vendor Advance: ${vendorName || 'Vendor'} (pending finance signatures)`,
              department,
              module,
              costCenter: costCenter || null,
              referenceId: advance._id,
              referenceType: 'payment',
              journalCode: 'BANK',
              voucherSeries: (paymentMethod || 'bank_transfer') === 'cash' ? 'CPV' : 'BPV',
              createdBy,
              payingCompanyId: payingCompanyId || null,
              lines: [
                ...debitLines,
                {
                  account: bankAccount._id,
                  description: `Advance payment to ${vendorName || 'Vendor'} (${payRef})`,
                  credit: amount_,
                  department
                }
              ]
            }, companyId),
            narration
          )
        );
        advance.journalEntryId = journalEntry._id;
        await advance.save();
      }
    } catch (jeErr) {
      // Do not leave an advance row without vouchers — remove the orphan and surface the real error
      try {
        if (advance.journalEntryId) {
          await JournalEntry.findByIdAndDelete(advance.journalEntryId);
        }
        if (advance.payingJournalEntryId) {
          await JournalEntry.findByIdAndDelete(advance.payingJournalEntryId);
        }
        await VendorAdvance.findByIdAndDelete(advance._id);
      } catch (_) { /* ignore cleanup failure */ }
      throw jeErr;
    }
    return advance;
  },

  /**
   * Attach draft voucher(s) when an advance was saved without journalEntryId
   * (legacy bug when companyId was "all").
   * Intercompany: creates original-company JE + paying-company bank JE.
   */
  ensureVendorAdvanceVoucher: async (advanceId, { companyId: optsCompanyId = null, payingCompanyId: optsPayingCompanyId = null, createdBy = null } = {}) => {
    const { normalizeCompanyId } = require('./financeCompanyContext');
    const advance = await VendorAdvance.findById(advanceId);
    if (!advance) throw new Error('Vendor advance not found');
    if (advance.journalEntryId) return advance;
    if (advance.voucherWorkflowStatus === 'rejected') {
      throw new Error('Cannot create voucher for a rejected vendor advance');
    }

    const amount_ = Math.round((Number(advance.amount) || 0) * 100) / 100;
    if (amount_ <= 0) throw new Error('Advance amount must be greater than zero');

    let companyId =
      normalizeCompanyId(optsCompanyId)
      || normalizeCompanyId(advance.companyId);
    let payingCompanyId =
      normalizeCompanyId(optsPayingCompanyId)
      || normalizeCompanyId(advance.payingCompanyId)
      || companyId;
    if (!companyId && advance.bankAccountId) {
      const bank = await Account.findById(advance.bankAccountId).select('companyId').lean();
      companyId = normalizeCompanyId(bank?.companyId);
      if (!payingCompanyId) payingCompanyId = companyId;
    }
    if (!companyId) {
      throw new Error('Select a finance company to create the missing voucher for this advance.');
    }
    if (!payingCompanyId) payingCompanyId = companyId;

    const isIntercompany = String(payingCompanyId) !== String(companyId);
    const A_target = acct(companyId);
    const A_paying = acct(payingCompanyId);

    let advAccount = await A_target.resolve(FinanceHelper.ACCOUNTS.VENDOR_ADVANCE);
    if (!advAccount) throw new Error('Advance to Suppliers account (1110) not found for this company');
    let bankAccount = advance.bankAccountId ? await A_paying.map(advance.bankAccountId) : null;
    if (!bankAccount) {
      bankAccount = await A_paying.resolve(
        (advance.paymentMethod || 'bank_transfer') === 'cash'
          ? FinanceHelper.ACCOUNTS.CASH
          : FinanceHelper.ACCOUNTS.BANK
      );
    }
    if (!bankAccount) throw new Error('Pay-from bank/cash account not found');

    const department = advance.department || 'procurement';
    const vendorName = advance.vendor?.name || 'Vendor';
    const vendorId = advance.vendor?.vendorId || null;
    const vendorParty = vendorId
      ? { partyType: 'Vendor', party: vendorId }
      : {};
    const categoryLines = Array.isArray(advance.categoryLines)
      ? advance.categoryLines.filter((l) => Number(l.amount) > 0)
      : [];

    let debitLines = [];
    if (categoryLines.length > 0) {
      for (const cl of categoryLines) {
        let lineAcc = cl.account ? await A_target.map(cl.account) : null;
        if (!lineAcc && cl.accountNumber) lineAcc = await A_target.resolve(cl.accountNumber);
        if (!lineAcc) lineAcc = advAccount;
        debitLines.push({
          account: lineAcc._id,
          description: cl.description || `Advance / ${lineAcc.name || 'Expense'} - ${vendorName}`,
          debit: Math.round((Number(cl.amount) || 0) * 100) / 100,
          department,
          ...vendorParty
        });
      }
    } else {
      debitLines.push({
        account: advAccount._id,
        description: `Advance to ${vendorName}`,
        debit: amount_,
        department,
        ...vendorParty
      });
    }

    const PlacementCompany = require('../models/hr/Company');
    const [targetCo, payingCo] = await Promise.all([
      PlacementCompany.findById(companyId).select('name').lean(),
      PlacementCompany.findById(payingCompanyId).select('name').lean()
    ]);
    const targetName = targetCo?.name || 'Target company';
    const payingName = payingCo?.name || 'Paying company';
    const payRef = advance.chequeNumber || advance.reference || '';
    const narration = getVendorAdvanceNarration(advance) || advance.reference;
    const createdById = createdBy || advance.createdBy;

    if (isIntercompany) {
      const { resolveIntercompanyAccounts } = require('./financePosting');
      const { seedChartOfAccountsForCompany } = require('./companyChartOfAccounts');
      await seedChartOfAccountsForCompany(companyId, { skipExisting: true });
      await seedChartOfAccountsForCompany(payingCompanyId, { skipExisting: true });
      const { icTargetAcc, icPayingAcc } = await resolveIntercompanyAccounts({
        targetCompanyId: companyId,
        payingCompanyId,
        createdBy: createdById
      });

      const targetJournal = await FinanceHelper.createDraftJournalEntry(
        withVoucherNarration(
          withCompany({
            date: advance.paymentDate || new Date(),
            reference: payRef,
            description: `Vendor Advance: ${vendorName} (paid by ${payingName})`,
            department,
            module: advance.module || 'procurement',
            referenceId: advance._id,
            referenceType: 'payment',
            journalCode: 'BANK',
            voucherSeries: 'JV',
            createdBy: createdById,
            payingCompanyId,
            lines: [
              ...debitLines,
              {
                account: icTargetAcc._id,
                description: `Due to ${payingName} — intercompany vendor advance`,
                credit: amount_,
                department
              }
            ]
          }, companyId),
          narration
        )
      );

      const payingJournal = await FinanceHelper.createDraftJournalEntry(
        withVoucherNarration(
          {
            companyId: payingCompanyId,
            date: advance.paymentDate || new Date(),
            reference: payRef,
            description: `Vendor Advance payment for ${targetName}: ${vendorName}`,
            department,
            module: advance.module || 'procurement',
            referenceId: advance._id,
            referenceType: 'payment',
            journalCode: 'BANK',
            voucherSeries: (advance.paymentMethod || 'bank_transfer') === 'cash' ? 'CPV' : 'BPV',
            createdBy: createdById,
            lines: [
              {
                account: icPayingAcc._id,
                description: `Due from ${targetName} — vendor advance paid on their behalf`,
                debit: amount_,
                department
              },
              {
                account: bankAccount._id,
                description: `Advance payment to ${vendorName} (${payRef})`,
                credit: amount_,
                department
              }
            ]
          },
          narration
        )
      );

      if (!payingJournal.companyId || String(payingJournal.companyId) !== String(payingCompanyId)) {
        payingJournal.companyId = payingCompanyId;
        await payingJournal.save();
      }

      advance.journalEntryId = targetJournal._id;
      advance.payingJournalEntryId = payingJournal._id;
    } else {
      const journalEntry = await FinanceHelper.createDraftJournalEntry(
        withVoucherNarration(
          withCompany({
            date: advance.paymentDate || new Date(),
            reference: payRef,
            description: `Vendor Advance: ${vendorName} (pending finance signatures)`,
            department,
            module: advance.module || 'procurement',
            referenceId: advance._id,
            referenceType: 'payment',
            journalCode: 'BANK',
            voucherSeries: (advance.paymentMethod || 'bank_transfer') === 'cash' ? 'CPV' : 'BPV',
            createdBy: createdById,
            lines: [
              ...debitLines,
              {
                account: bankAccount._id,
                description: `Advance payment to ${vendorName} (${payRef})`,
                credit: amount_,
                department
              }
            ]
          }, companyId),
          narration
        )
      );
      advance.journalEntryId = journalEntry._id;
    }

    advance.companyId = advance.companyId || companyId;
    advance.payingCompanyId = advance.payingCompanyId || payingCompanyId;
    advance.voucherWorkflowStatus = advance.voucherWorkflowStatus === 'immediate'
      ? 'pending_authority'
      : (advance.voucherWorkflowStatus || 'pending_authority');
    await advance.save();
    return advance;
  },

  /**
   * Backfill Vendor party tags on existing advance vouchers (debit lines).
   * Does not change amounts — only party metadata for vendor sub-ledger / TB.
   */
  tagVendorAdvanceJournalParties: async (advanceId = null) => {
    const GeneralLedger = require('../models/finance/GeneralLedger');
    const filter = {
      'vendor.vendorId': { $ne: null },
      $or: [
        { journalEntryId: { $ne: null } },
        { payingJournalEntryId: { $ne: null } }
      ]
    };
    if (advanceId) filter._id = advanceId;

    const advances = await VendorAdvance.find(filter)
      .select('_id vendor journalEntryId payingJournalEntryId amount')
      .lean();

    let updatedJes = 0;
    let updatedLines = 0;
    let skipped = 0;
    const details = [];

    for (const adv of advances) {
      const vendorId = adv.vendor?.vendorId;
      if (!vendorId) {
        skipped += 1;
        continue;
      }
      const jeIds = [adv.journalEntryId, adv.payingJournalEntryId].filter(Boolean);
      for (const jeId of jeIds) {
        const je = await JournalEntry.findById(jeId);
        if (!je) {
          skipped += 1;
          continue;
        }
        let changed = false;
        for (const line of je.lines || []) {
          // Tag debit (advance / IC receivable) lines that lack vendor party
          if ((Number(line.debit) || 0) > 0 && !(line.partyType && line.party)) {
            line.partyType = 'Vendor';
            line.party = vendorId;
            changed = true;
            updatedLines += 1;
          }
        }
        if (!changed) {
          skipped += 1;
          continue;
        }
        await je.save();
        updatedJes += 1;

        // Keep posted GL in sync for party reports
        if (je.status === 'posted') {
          await GeneralLedger.updateMany(
            {
              journalEntry: je._id,
              debit: { $gt: 0 },
              $or: [{ partyType: null }, { partyType: { $exists: false } }, { party: null }]
            },
            { $set: { partyType: 'Vendor', party: vendorId } }
          );
        }
        details.push({
          advanceId: adv._id,
          vendorId,
          entryNumber: je.entryNumber,
          status: je.status
        });
      }
    }

    return { updatedJes, updatedLines, skipped, count: advances.length, details };
  },

  applyVendorAdvanceToBill: async (billId, requestedAmount = null, createdBy = null, options = {}) => {
    const ApPayment = require('./apPaymentApplication');
    const bill = await AccountsPayable.findById(billId);
    if (!bill) throw new Error('Bill not found');
    if (bill.isAdvanceBill) throw new Error(`${bill.billNumber} is an advance bill — pay it from the bank; advances are applied to the vendor's real bill`);

    let remainingBill = FinanceHelper.getAPOutstanding(bill);
    if (remainingBill <= 0) return { bill, applied: 0, pending: 0, adjustments: [], applications: [] };

    let remainingRequest = requestedAmount == null ? remainingBill : Math.round((Number(requestedAmount) || 0) * 100) / 100;
    if (remainingRequest <= 0) throw new Error('Apply amount must be greater than zero');

    const companyId = co(bill);
    const A = acct(companyId);
    const advAccount = await A.resolve(FinanceHelper.ACCOUNTS.VENDOR_ADVANCE);
    const apAccount = await A.resolve(FinanceHelper.ACCOUNTS.PAYABLE);
    if (!advAccount || !apAccount) throw new Error('AP or Vendor Advance account not found');

    const query = bill.vendor?.vendorId
      ? { 'vendor.vendorId': bill.vendor.vendorId, status: { $in: ['open', 'partially_applied'] } }
      : { 'vendor.name': bill.vendor?.name || '', status: { $in: ['open', 'partially_applied'] } };
    // Chosen advances (in the order picked, each capped at its amount) or, by default, oldest first
    const chosen = Array.isArray(options.advanceAllocations) && options.advanceAllocations.length
      ? options.advanceAllocations
        .map((a) => ({ id: String(a.vendorAdvanceId || ''), amount: Math.round((Number(a.amount) || 0) * 100) / 100 }))
        .filter((a) => a.id && a.amount > 0)
      : null;
    let advances;
    if (chosen) {
      const found = await VendorAdvance.find({ ...query, _id: { $in: chosen.map((a) => a.id) } });
      const byId = new Map(found.map((a) => [String(a._id), a]));
      const missing = chosen.find((a) => !byId.has(a.id));
      if (missing) throw new Error('A selected advance is not open for this vendor any more — refresh and select again');
      advances = chosen.map((a) => byId.get(a.id));
      remainingRequest = Math.round(chosen.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    } else {
      advances = await VendorAdvance.find(query).sort({ paymentDate: 1, createdAt: 1 });
    }
    const capById = chosen ? new Map(chosen.map((a) => [a.id, a.amount])) : null;

    const adjustments = [];
    const applications = [];
    let totalPending = 0;

    for (const adv of advances) {
      if (remainingBill <= 0 || remainingRequest <= 0) break;
      const wf = adv.voucherWorkflowStatus || 'immediate';
      if (wf === 'pending_authority' || wf === 'rejected') continue;
      const advRemaining = Math.round(((Number(adv.amount) || 0) - (Number(adv.appliedAmount) || 0)) * 100) / 100;
      const pendingOnAdv = await ApPayment.sumPendingForVendorAdvance(adv._id);
      const openAdv = Math.max(0, Math.round((advRemaining - pendingOnAdv) * 100) / 100);
      const cap = capById ? capById.get(String(adv._id)) : Infinity;
      if (capById && cap > openAdv + 0.009) {
        throw new Error(`Advance ${adv.reference || adv._id} has only PKR ${openAdv.toLocaleString('en-PK')} open (asked ${cap.toLocaleString('en-PK')})`);
      }
      if (openAdv <= 0) continue;
      const applyAmount = Math.min(remainingBill, remainingRequest, openAdv, cap);
      if (applyAmount <= 0) continue;

      const { application, journalEntry } = await ApPayment.submitSettlement({
        bill,
        amount: applyAmount,
        sourceType: 'vendor_advance',
        createdBy: createdBy || bill.createdBy,
        financeApprovalAuthorities: options.financeApprovalAuthorities,
        authoritySourceDoc: adv,
        vendorAdvanceId: adv._id,
        journalPayload: withVoucherNarration(withCompany({
          date: new Date(),
          reference: `ADV-ADJ-${bill.billNumber}`,
          description: `Vendor advance adjusted against ${bill.billNumber} (pending finance signatures)`,
          department: bill.department,
          module: bill.module,
          referenceType: 'adjustment',
          journalCode: 'ADJUSTMENT',
          voucherSeries: 'JV',
          lines: [
            { account: apAccount._id, description: `Advance adjusted – ${bill.billNumber}`, debit: applyAmount, department: bill.department },
            { account: advAccount._id, description: `Advance utilization – ${adv.reference || adv._id}`, credit: applyAmount, department: bill.department }
          ]
        }, companyId), getBillNarration(bill)),
      });

      adjustments.push({ advanceId: adv._id, reference: adv.reference, amount: applyAmount, pending: true });
      applications.push({
        applicationId: application._id,
        journalEntryId: journalEntry._id,
        advanceId: adv._id
      });
      totalPending += applyAmount;
      remainingBill = FinanceHelper.getAPOutstanding(bill);
      remainingRequest = Math.round((remainingRequest - applyAmount) * 100) / 100;
    }

    const fresh = await AccountsPayable.findById(bill._id);
    return {
      bill: fresh,
      applied: 0,
      pending: totalPending,
      adjustments,
      applications
    };
  },

  _getCaOpenAdvanceForAp: async (ca) => {
    const ApPayment = require('./apPaymentApplication');
    return ApPayment.getCaOpenForAp(ca);
  },

  _applyOneCashApprovalToBill: async (ca, bill, applyAmount, employee, createdBy, options = {}) => {
    const ApPayment = require('./apPaymentApplication');
    const companyId = co(bill);
    const A = acct(companyId);
    const apAccount = await A.resolve(FinanceHelper.ACCOUNTS.PAYABLE);
    if (!apAccount) throw new Error('Accounts Payable account not found');

    const caRemaining = await FinanceHelper._getCaOpenAdvanceForAp(ca);
    const amount = Math.round((Number(applyAmount) || 0) * 100) / 100;
    if (amount <= 0) throw new Error('Apply amount must be greater than zero');
    if (amount > caRemaining + 0.009) {
      throw new Error(`Amount exceeds open balance on ${ca.caNumber} (open: ${caRemaining})`);
    }

    let advAccount = null;
    if (ca.advanceGlAccount) {
      advAccount = await Account.findById(ca.advanceGlAccount);
    }
    if (!advAccount) {
      const { resolveEmployeeAdvanceAccount, ensureEmployeeAdvanceAccount } = require('./employeeAdvanceAccount');
      advAccount = await resolveEmployeeAdvanceAccount(employee, { createdBy, companyId });
      if (!advAccount) {
        advAccount = await ensureEmployeeAdvanceAccount(employee, createdBy, companyId);
      }
    }
    if (!advAccount) throw new Error(`No advance account for ${ca.caNumber}`);

    const { application, journalEntry } = await ApPayment.submitSettlement({
      bill,
      amount,
      sourceType: 'cash_approval',
      createdBy: createdBy || bill.createdBy,
      financeApprovalAuthorities: options.financeApprovalAuthorities,
      authoritySourceDoc: ca,
      cashApprovalId: ca._id,
      journalPayload: withVoucherNarration(withCompany({
        date: new Date(),
        reference: `CA-ADJ-${bill.billNumber}`,
        description: `Cash approval ${ca.caNumber} applied to bill ${bill.billNumber} (pending finance signatures)`,
        department: bill.department || 'general',
        module: bill.module || 'general',
        referenceType: 'adjustment',
        journalCode: 'ADJUSTMENT',
        voucherSeries: 'JV',
        lines: [
          { account: apAccount._id, description: `Advance applied – ${bill.billNumber}`, debit: amount, department: bill.department },
          { account: advAccount._id, description: `CA ${ca.caNumber} utilized`, credit: amount, department: bill.department || 'general' }
        ]
      }, companyId), getBillNarration(bill))
    });

    return {
      cashApprovalId: ca._id,
      caNumber: ca.caNumber,
      amount,
      pending: true,
      applicationId: application._id,
      journalEntryId: journalEntry._id
    };
  },

  applyEmployeeAdvanceToBill: async (billId, requestedAmount = null, employeeId = null, createdBy = null, options = {}) => {
    const bill = await AccountsPayable.findById(billId);
    if (!bill) throw new Error('Bill not found');

    const empId = employeeId || bill.payeeEmployee;
    if (!empId) throw new Error('Employee is required to apply cash approval advance');

    const employee = await Employee.findById(empId);
    if (!employee) throw new Error('Employee not found');

    let remainingBill = FinanceHelper.getAPOutstanding(bill);
    if (remainingBill <= 0) return { bill, applied: 0, pending: 0, adjustments: [] };

    const adjustments = [];
    const explicitAllocations = Array.isArray(options.allocations)
      ? options.allocations
        .map((row) => ({
          cashApprovalId: String(row?.cashApprovalId || row?.caId || '').trim(),
          amount: Math.round((Number(row?.amount) || 0) * 100) / 100
        }))
        .filter((row) => row.cashApprovalId && row.amount > 0)
      : [];

    if (explicitAllocations.length > 0) {
      for (const row of explicitAllocations) {
        if (remainingBill <= 0) break;

        const ca = await CashApproval.findById(row.cashApprovalId);
        if (!ca) throw new Error('Cash approval not found');
        if (!ca.advanceIssuedAt) {
          throw new Error(`${ca.caNumber || 'Cash approval'}: advance has not been issued yet`);
        }
        if (String(ca.advanceToEmployee || '') !== String(empId)) {
          throw new Error(`${ca.caNumber || 'Cash approval'} is not for this employee`);
        }

        const applyAmount = Math.min(row.amount, remainingBill);
        const adj = await FinanceHelper._applyOneCashApprovalToBill(ca, bill, applyAmount, employee, createdBy, options);
        if (!bill.payeeEmployee) bill.payeeEmployee = empId;
        adjustments.push(adj);
        remainingBill = FinanceHelper.getAPOutstanding(bill);
      }
    } else {
      let remainingRequest = requestedAmount == null
        ? remainingBill
        : Math.round((Number(requestedAmount) || 0) * 100) / 100;
      if (remainingRequest <= 0) throw new Error('Apply amount must be greater than zero');

      const cas = await CashApproval.find({
        advanceToEmployee: empId,
        advanceIssuedAt: { $ne: null },
        status: { $nin: ['Draft', 'Cancelled', 'Rejected'] }
      }).sort({ advanceIssuedAt: 1, createdAt: 1 });

      for (const ca of cas) {
        if (remainingBill <= 0 || remainingRequest <= 0) break;

        const caRemaining = await FinanceHelper._getCaOpenAdvanceForAp(ca);
        if (caRemaining <= 0) continue;

        const applyAmount = Math.min(remainingBill, remainingRequest, caRemaining);
        if (applyAmount <= 0) continue;

        const adj = await FinanceHelper._applyOneCashApprovalToBill(ca, bill, applyAmount, employee, createdBy, options);
        if (!bill.payeeEmployee) bill.payeeEmployee = empId;
        adjustments.push(adj);
        remainingBill = FinanceHelper.getAPOutstanding(bill);
        remainingRequest = Math.round((remainingRequest - applyAmount) * 100) / 100;
      }
    }

    const pending = adjustments.reduce((s, a) => s + a.amount, 0);
    if (pending <= 0) {
      throw new Error('No open cash approval advance balance for this employee');
    }
    const fresh = await AccountsPayable.findById(bill._id);
    return { bill: fresh, applied: 0, pending, adjustments };
  },

  /**
   * Apply one or more cash approval advances to one or more AP bills (Taj deposit-style reconciliation).
   * Total from cashApprovalUsages must equal total from billAllocations.
   */
  applyEmployeeAdvanceBatch: async (employeeId, cashApprovalUsages = [], billAllocations = [], createdBy = null, options = {}) => {
    const empId = employeeId;
    if (!empId) throw new Error('Employee is required');

    const caRows = (cashApprovalUsages || [])
      .map((r) => ({
        cashApprovalId: String(r?.cashApprovalId || '').trim(),
        amount: Math.round((Number(r?.amount) || 0) * 100) / 100
      }))
      .filter((r) => r.cashApprovalId && r.amount > 0);

    const billRows = (billAllocations || [])
      .map((r) => ({
        billId: String(r?.billId || '').trim(),
        amount: Math.round((Number(r?.amount) || 0) * 100) / 100
      }))
      .filter((r) => r.billId && r.amount > 0);

    if (!caRows.length) throw new Error('Enter amount to use on at least one cash approval');
    if (!billRows.length) throw new Error('Allocate advance to at least one bill');

    const totalCa = Math.round(caRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const totalBills = Math.round(billRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (Math.abs(totalCa - totalBills) > 0.009) {
      throw new Error(
        `Total from cash approvals (${totalCa}) must equal total applied to bills (${totalBills})`
      );
    }

    const employee = await Employee.findById(empId);
    if (!employee) throw new Error('Employee not found');

    const pool = caRows.map((r) => ({ ...r, remaining: r.amount }));
    const adjustments = [];

    for (const billAlloc of billRows) {
      const bill = await AccountsPayable.findById(billAlloc.billId);
      if (!bill) throw new Error('Bill not found');

      let billNeed = billAlloc.amount;
      const billOutstanding = FinanceHelper.getAPOutstanding(bill);
      if (billAlloc.amount > billOutstanding + 0.009) {
        throw new Error(`Amount for ${bill.billNumber} exceeds open balance (${billOutstanding})`);
      }

      for (const p of pool) {
        if (billNeed <= 0) break;
        if (p.remaining <= 0) continue;

        const ca = await CashApproval.findById(p.cashApprovalId);
        if (!ca) throw new Error('Cash approval not found');
        if (String(ca.advanceToEmployee || '') !== String(empId)) {
          throw new Error(`${ca.caNumber || 'CA'} is not for this employee`);
        }

        const caOpen = await FinanceHelper._getCaOpenAdvanceForAp(ca);
        const applyAmt = Math.min(billNeed, p.remaining, caOpen);
        if (applyAmt <= 0) continue;

        const adj = await FinanceHelper._applyOneCashApprovalToBill(ca, bill, applyAmt, employee, createdBy, options);
        if (!bill.payeeEmployee) bill.payeeEmployee = empId;
        adjustments.push({ ...adj, billId: String(bill._id), billNumber: bill.billNumber });
        p.remaining = Math.round((p.remaining - applyAmt) * 100) / 100;
        billNeed = Math.round((billNeed - applyAmt) * 100) / 100;
      }

      if (billNeed > 0.009) {
        throw new Error(`Could not apply full amount to bill ${bill.billNumber}. Reduce bill allocation or add cash approval balance.`);
      }
    }

    const pending = Math.round(adjustments.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    return { applied: 0, pending, adjustments };
  },

  /**
   * Post COGS journal for goods issued from store.
   * DR Cost of Goods Sold / CR Inventory
   */
  postCOGSJournal: async ({ items, sinDoc, createdBy, companyId }) => {
    const cid = await resolveDocumentCompanyId({
      companyId,
      userId: createdBy,
      grnId: sinDoc?.goodsReceive || sinDoc?.grn,
      purchaseOrderId: sinDoc?.purchaseOrder
    });
    const lineGroups = [];
    for (const item of items) {
      try {
        const inv = item.inventoryItem;
        if (!inv) continue;
        const qty = Number(item.qtyIssued || item.quantity) || 0;
        if (qty <= 0) continue;
        const unitCost = Number(inv.averageCost) > 0 ? Number(inv.averageCost) : Number(inv.unitPrice) || 0;
        if (unitCost <= 0) {
          console.warn(`[COGS] Skipped ${inv.name || inv._id}: no WAC or unit price set`);
          continue;
        }
        const cost = Math.round(qty * unitCost * 100) / 100;
        const { inventoryAccountId, cogsAccountId } = await FinanceHelper.resolveInventoryAccounts(inv, cid);
        if (inventoryAccountId && cogsAccountId) {
          lineGroups.push({ inventoryAccountId, cogsAccountId, cost, itemName: inv.name || item.itemName });
        } else {
          console.warn(`[COGS] Skipped ${inv.name || inv._id}: could not resolve inventory/COGS accounts`);
        }
      } catch (itemErr) {
        console.warn('[COGS] Item error:', itemErr.message);
      }
    }

    if (lineGroups.length === 0) return;

    const lines = [];
    for (const g of lineGroups) {
      lines.push({ account: g.cogsAccountId, description: `COGS – ${g.itemName}`, debit: g.cost, department: sinDoc.department || 'procurement' });
      lines.push({ account: g.inventoryAccountId, description: `Inventory out – ${g.itemName}`, credit: g.cost, department: sinDoc.department || 'procurement' });
    }

    try {
      await FinanceHelper.createAndPostJournalEntry(
        withVoucherNarration(withCompany({
          date: sinDoc.issueDate || new Date(),
          reference: sinDoc.issueNumber || 'SIN',
          description: `COGS – Store Issue ${sinDoc.issueNumber || ''}`,
          department: sinDoc.department || 'procurement',
          module: 'procurement',
          referenceId: sinDoc._id,
          referenceType: 'expense',
          journalCode: 'INV',
          createdBy,
          lines
        }, cid), getSinNarration(sinDoc))
      );
    } catch (cogsErr) {
      console.warn('[COGS] GL posting skipped:', cogsErr.message);
    }
  },

  /**
   * Post journal entry for a Goods Received Note (GRN).
   *
   * CORRECT ODOO-STYLE ENTRY:
   *   DR  Stock Valuation / Inventory Account   (Asset ↑)
   *   CR  Stock Input / GRNI Account            (Liability ↑)  ← cleared later by AP bill
   *
   * Also updates the Weighted Average Cost (WAC) on the inventory item.
   * WAC = (existingQty × existingWAC + receivedQty × receiptPrice) / (existingQty + receivedQty)
   *
   * Safe to call – silently skips if accounts cannot be resolved or amount is zero.
   */
  postGRNJournal: async ({ inventoryItem, grnDoc, qty, unitPrice, createdBy, companyId }) => {
    try {
      const qty_ = Number(qty) || 0;
      const unitPrice_ = Number(unitPrice) || 0;
      if (qty_ <= 0 || unitPrice_ <= 0) return;

      const cid = await resolveDocumentCompanyId({
        companyId,
        grnId: grnDoc?._id,
        purchaseOrderId: grnDoc?.purchaseOrder?._id || grnDoc?.purchaseOrder
      });
      const { inventoryAccountId, grniAccountId } = await FinanceHelper.resolveInventoryAccounts(inventoryItem, cid);
      if (!inventoryAccountId || !grniAccountId) {
        console.warn(`[GRN Journal] Skipped – no inventory/GRNI accounts for item: ${inventoryItem.name || inventoryItem._id}`);
        return;
      }

      const amount = Math.round(qty_ * unitPrice_ * 100) / 100;

      // ─── Update Weighted Average Cost ─────────────────────────────────────
      try {
        const Inventory = mongoose.model('Inventory');
        const inv = await Inventory.findById(inventoryItem._id || inventoryItem);
        if (inv) {
          const existingQty = inv.quantity || 0;
          const existingWAC = inv.averageCost || inv.unitPrice || 0;
          const newTotalQty = existingQty + qty_;
          const newWAC = newTotalQty > 0
            ? ((existingQty * existingWAC) + (qty_ * unitPrice_)) / newTotalQty
            : unitPrice_;
          inv.averageCost = Math.round(newWAC * 100) / 100;
          await inv.save();
        }
      } catch (wacErr) {
        console.warn('[GRN Journal] WAC update failed:', wacErr.message);
      }
      // ──────────────────────────────────────────────────────────────────────

      const referenceNumber = grnDoc.receiveNumber || grnDoc._id?.toString() || 'GRN';
      await FinanceHelper.createAndPostJournalEntry(
        withVoucherNarration(withCompany({
          date: grnDoc.receiveDate || new Date(),
          reference: referenceNumber,
          description: `GRN ${referenceNumber}: Stock received – ${inventoryItem.name}`,
          department: 'procurement',
          module: 'procurement',
          referenceId: grnDoc._id,
          referenceType: 'grn',
          journalCode: 'INV',
          voucherSeries: 'GRN',
          createdBy,
          lines: [
            {
              account: inventoryAccountId,
              description: `Inventory in – ${inventoryItem.name} (${qty_} × ${unitPrice_})`,
              debit: amount,
              department: 'procurement'
            },
            {
              account: grniAccountId,
              description: `GRNI – ${inventoryItem.name} via GRN ${referenceNumber}`,
              credit: amount,
              department: 'procurement'
            }
          ]
        }, cid), getGrnNarration(grnDoc))
      );

      console.log(`[GRN Journal] Posted: DR Inventory ${amount} / CR GRNI ${amount} for ${inventoryItem.name}`);
    } catch (err) {
      console.error('❌ FinanceHelper.postGRNJournal error:', err.message);
    }
  },

  /**
   * Post journal entry for a Store Issue Note (SIN).
   *
   * CORRECT ODOO-STYLE ENTRY:
   *   DR  COGS / Project Expense Account    (Expense ↑)
   *   CR  Stock Valuation / Inventory       (Asset ↓)
   *
   * Uses Weighted Average Cost for the issued qty.
   * Safe to call – silently skips if accounts cannot be resolved or amount is zero.
   */
  /**
   * DR COGS / CR Inventory for one store-issue line.
   * Returns { status: 'posted' | 'skipped' | 'failed', reason?, journalEntry?, amount? } — the caller records it,
   * so a store issue never silently leaves stock without a ledger entry.
   */
  postSINJournal: async ({ inventoryItem, sinDoc, qty, createdBy, companyId }) => {
    try {
      const qty_ = Number(qty) || 0;
      if (qty_ <= 0) return { status: 'skipped', reason: 'Zero quantity' };

      const cid = await resolveDocumentCompanyId({
        companyId,
        userId: createdBy,
        grnId: sinDoc?.goodsReceive || sinDoc?.grn,
        purchaseOrderId: sinDoc?.purchaseOrder
      });
      const { inventoryAccountId, cogsAccountId } = await FinanceHelper.resolveInventoryAccounts(inventoryItem, cid);
      if (!cogsAccountId || !inventoryAccountId) {
        console.warn(`[SIN Journal] Skipped – no COGS/inventory accounts for item: ${inventoryItem.name || inventoryItem._id}`);
        return { status: 'skipped', reason: 'Item has no COGS / inventory accounts for this company' };
      }

      // Use WAC (averageCost) first; fall back to unitPrice for newly created items
      const unitCost = Number(inventoryItem.averageCost) > 0
        ? Number(inventoryItem.averageCost)
        : Number(inventoryItem.unitPrice) || 0;
      const amount = Math.round(qty_ * unitCost * 100) / 100;
      if (amount <= 0) {
        console.warn(`[SIN Journal] Skipped ${inventoryItem.name || inventoryItem._id}: unitCost is 0`);
        return { status: 'skipped', reason: 'Item has no cost (average cost and unit price are 0)' };
      }

      const referenceNumber = sinDoc.issueNumber || sinDoc.sinNumber || sinDoc._id?.toString() || 'SIN';
      const je = await FinanceHelper.createAndPostJournalEntry(
        withVoucherNarration(withCompany({
          date: sinDoc.issueDate || new Date(),
          reference: referenceNumber,
          description: `SIN ${referenceNumber}: Stock issued – ${inventoryItem.name}`,
          department: 'procurement',
          module: 'procurement',
          referenceId: sinDoc._id,
          referenceType: 'sin',
          journalCode: 'INV',
          voucherSeries: 'SIN',
          createdBy,
          lines: [
            {
              account: cogsAccountId,
              description: `COGS – ${inventoryItem.name} (${qty_} × WAC ${unitCost})`,
              debit: amount,
              department: 'procurement'
            },
            {
              account: inventoryAccountId,
              description: `Inventory out – ${inventoryItem.name} via SIN ${referenceNumber}`,
              credit: amount,
              department: 'procurement'
            }
          ]
        }, cid), getSinNarration(sinDoc))
      );

      console.log(`[SIN Journal] Posted: DR COGS ${amount} / CR Inventory ${amount} for ${inventoryItem.name}`);
      return { status: 'posted', journalEntry: je?._id, amount };
    } catch (err) {
      console.error('❌ FinanceHelper.postSINJournal error:', err.message);
      return { status: 'failed', reason: err.message };
    }
  },

  /**
   * Per-employee PAYAC is skipped — the company payroll BPV posts gross expense,
   * EOBI expense, all deduction liabilities (EOBI sub-accounts, loans, advances), and bank.
   */
  recordPayrollAccrual: async () => null,

  /**
   * Record Payroll Payment
   */
  recordPayrollPayment: async (payroll, paymentMethod, createdBy) => {
    try {
      const companyId = await resolveDocumentCompanyId({ employeeId: payroll.employee });
      const A = acct(companyId);
      const payableAccount = await A.resolve(FinanceHelper.ACCOUNTS.SALARIES_PAYABLE);
      const bankAccount = await A.resolve(
        paymentMethod === 'cash' ? FinanceHelper.ACCOUNTS.CASH : FinanceHelper.ACCOUNTS.BANK
      );

      if (payableAccount && bankAccount) {
        const isCash = paymentMethod === 'cash';
        await FinanceHelper.createAndPostJournalEntry(withCompany({
          date: new Date(),
          reference: `SAL-PAY-${payroll.month}-${payroll.year}`,
          description: `Salary Payment to ${payroll.employeeName}`,
          department: 'hr',
          module: 'payroll',
          referenceId: payroll._id,
          referenceType: 'payment',
          journalCode: 'BANK',
          voucherSeries: isCash ? 'CPV' : 'BPV',
          createdBy,
          lines: [
            { account: payableAccount._id, description: `Debit Salaries Payable`, debit: payroll.netSalary, department: 'hr' },
            { account: bankAccount._id, description: `Credit Bank/Cash`, credit: payroll.netSalary, department: 'hr' }
          ]
        }, companyId));
      }
    } catch (error) {
      console.error('❌ Error recording payroll payment:', error);
    }
  }
};

module.exports = FinanceHelper;
