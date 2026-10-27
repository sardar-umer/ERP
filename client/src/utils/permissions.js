// Import centralized permissions from server config
// Note: In production, this should be shared via a common package or API endpoint

// Role Definitions (matching server config)
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  HIGHER_MANAGEMENT: 'higher_management',
  /** Full access for Tovus / engineering (same behavior as super_admin in UI and API). */
  DEVELOPER: 'developer',
  ADMIN: 'admin',
  HR_MANAGER: 'hr_manager',
  FINANCE_MANAGER: 'finance_manager',
  PROCUREMENT_MANAGER: 'procurement_manager',
  SALES_MANAGER: 'sales_manager',
  CRM_MANAGER: 'crm_manager',
  AUDIT_MANAGER: 'audit_manager',
  AUDITOR: 'auditor',
  IT_MANAGER: 'it_manager',
  TAJ_RESIDENCIA_MANAGER: 'taj_residencia_manager',
  APPRAISAL_MANAGER: 'appraisal_manager',
  TCM_MANAGER: 'tcm_manager',
  EMPLOYEE: 'employee'
};

// Module Definitions (matching server config)
export const MODULE_KEYS = {
  DASHBOARD: 'dashboard',
  HR: 'hr',
  FINANCE: 'finance',
  PROCUREMENT: 'procurement',
  SALES: 'sales',
  CRM: 'crm',
  AUDIT: 'audit',
  IT: 'it',
  TAJ_RESIDENCIA: 'taj_residencia',
  GENERAL: 'general',
  ADMIN: 'admin',
  ASSET_TAGGING: 'asset_tagging',
  DEVELOPER_MODULE: 'developer_module'
};

// Role-based Module Access (matching server config)
export const PERMISSIONS = {
  // Super Admin has access to everything
  [ROLES.SUPER_ADMIN]: {
    canAccessAll: true,
    modules: Object.values(MODULE_KEYS),
    description: 'Full system access'
  },
  
  // Higher Management has access to all departments
  [ROLES.HIGHER_MANAGEMENT]: {
    canAccessAll: true,
    modules: Object.values(MODULE_KEYS),
    description: 'Access to all departments and modules'
  },

  [ROLES.DEVELOPER]: {
    canAccessAll: true,
    modules: Object.values(MODULE_KEYS),
    description: 'Full system access (developer / Tovus)'
  },
  
  // Admin has access to admin module and general module
  [ROLES.ADMIN]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.ADMIN, MODULE_KEYS.GENERAL, MODULE_KEYS.ASSET_TAGGING],
    description: 'Admin module and general module access'
  },
  
  // HR Manager has access to HR module, admin events, and general module
  [ROLES.HR_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.HR, MODULE_KEYS.ADMIN, MODULE_KEYS.GENERAL],
    description: 'HR module management, event management, and general module'
  },
  
  // HR General Manager has access to HR module only
  'Hr General Manager': {
    canAccessAll: false,
    modules: [MODULE_KEYS.HR],
    description: 'HR module access only'
  },
  // Also support lowercase/underscore variations
  'hr_general_manager': {
    canAccessAll: false,
    modules: [MODULE_KEYS.HR],
    description: 'HR module access only'
  },
  'hr general manager': {
    canAccessAll: false,
    modules: [MODULE_KEYS.HR],
    description: 'HR module access only'
  },
  
  // Finance Manager has access to Finance module
  [ROLES.FINANCE_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.FINANCE, MODULE_KEYS.ASSET_TAGGING],
    description: 'Finance module management'
  },
  
  // Procurement Manager has access to Procurement module
  [ROLES.PROCUREMENT_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.PROCUREMENT, MODULE_KEYS.ASSET_TAGGING],
    description: 'Procurement module management'
  },

  /** Legacy role: delivery challan QA only (API also allows roleRef with procurement + quality_assurance submodule). */
  store_qa: {
    canAccessAll: false,
    modules: [MODULE_KEYS.PROCUREMENT],
    description: 'Delivery challan QA (full-advance DC pass/fail)'
  },
  
  // Sales Manager has access to Sales and CRM modules
  [ROLES.SALES_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.CRM, MODULE_KEYS.SALES],
    description: 'Sales and CRM access'
  },
  
  // CRM Manager has access to CRM module
  [ROLES.CRM_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.CRM],
    description: 'CRM module management'
  },
  
  // Audit Manager has access to Audit module
  [ROLES.AUDIT_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.AUDIT, MODULE_KEYS.ASSET_TAGGING],
    description: 'Audit module management'
  },
  
  // Auditor has limited access to Audit module
  [ROLES.AUDITOR]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.AUDIT],
    description: 'Audit execution and reporting'
  },
  
  // Audit Director has full access to Audit module
  'Audit Director': {
    canAccessAll: false,
    modules: [MODULE_KEYS.AUDIT],
    description: 'Full audit module access with all permissions'
  },
  // Also support lowercase/underscore variations
  'audit_director': {
    canAccessAll: false,
    modules: [MODULE_KEYS.AUDIT],
    description: 'Full audit module access with all permissions'
  },
  'audit director': {
    canAccessAll: false,
    modules: [MODULE_KEYS.AUDIT],
    description: 'Full audit module access with all permissions'
  },
  
  // IT Manager has access to IT module
  [ROLES.IT_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.IT],
    description: 'IT module management'
  },
  
  // Taj Residencia Manager has access to Taj Residencia module
  [ROLES.TAJ_RESIDENCIA_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.TAJ_RESIDENCIA],
    description: 'Taj Residencia module management'
  },
  
  // Appraisal Manager has access to HR and Admin modules
  [ROLES.APPRAISAL_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.HR, MODULE_KEYS.ADMIN],
    description: 'Evaluation and Appraisal management with User Management access'
  },
  
  // TCM Manager has access to Finance module (restricted to specific submodules)
  [ROLES.TCM_MANAGER]: {
    canAccessAll: false,
    modules: [MODULE_KEYS.FINANCE],
    description: 'TCM Manager - Access to Rental Agreements, Taj Residents, and Taj Properties'
  },
  
  // Employee has limited access
  [ROLES.EMPLOYEE]: {
    canAccessAll: false,
    modules: [],
    description: 'Basic access'
  }
};

// Helper Functions
export const hasModuleAccess = (userRole, module) => {
  const roleAccess = PERMISSIONS[userRole];
  if (!roleAccess) return false;
  
  if (roleAccess.canAccessAll) return true;
  return roleAccess.modules.includes(module);
};

export const getUserModules = (userRole) => {
  const roleAccess = PERMISSIONS[userRole];
  if (!roleAccess) return [];
  
  if (roleAccess.canAccessAll) {
    return Object.values(MODULE_KEYS);
  }
  
  return roleAccess.modules;
};

// Submodule Definitions (matching server config)
export const SUBMODULES = {
  [MODULE_KEYS.ADMIN]: [
    'admin_dashboard',
    'admin_settings',
    'user_management',
    'sub_roles',
    'vehicle_management', 
    'house_inventory',
    'utility_bills_management',
    'rental_agreements',
    'rental_management',
    'payment_settlement'
  ],
  [MODULE_KEYS.HR]: [
    'employee_management',
    'attendance_management',
    'payroll_management',
    'leave_management',
    'loan_management',
    'settlement_management',
    'talent_acquisition',
    'learning_development',
    'organizational_development',
    'fbr_tax_management',
    'evaluation_appraisal',
    'kpi_management',
    'non_employee_onboarding',
    'reports'
  ],
  [MODULE_KEYS.FINANCE]: [
    'finance_dashboard',
    'chart_of_accounts',
    'journal_entries',
    'finance_journals',
    'fiscal_periods',
    'inventory_categories',
    'inventory_valuation',
    'general_ledger',
    // Customers (AR)
    'customers',
    'accounts_receivable',
    'credit_notes',
    'customer_payments',
    'customer_statement',
    'aged_receivables',
    // Vendors (AP)
    'accounts_payable',
    'banking',
    'financial_reports',
    'tax_management',
    'fixed_assets',
    'bank_reconciliation',
    'vendor_statement',
    'budget_vs_actual',
    'aged_payables',
    'payment_terms',
    'opening_balances',
    'financial_statements',
    'tax_summary',
    'year_end_closing',
    'payroll_management',
    'company_profile',
    'taj_utilities_charges',
    'taj_cam_charges',
    'taj_water_bills',
    'taj_electricity_bills',
    'taj_rental_agreements',
    'taj_rental_management',
    'taj_residents',
    'taj_properties',
    'taj_deposits',
    'taj_banks',
    'taj_suspense_account',
    'taj_invoices',
    'taj_open_invoices',
    'taj_utilities_reports',
    'recovery',
    'recovery_assignments',
    'recovery_members',
    'recovery_task_assignment',
    'recovery_completed_tasks',
    'recovery_campaigns',
    'recovery_my_tasks',
    'vouchers',
    'finance_companies',
    'legacy'
  ],
  [MODULE_KEYS.PROCUREMENT]: [
    'procurement_requisitions',
    'quotations',
    'comparative_statements',
    'purchase_orders',
    'vendors',
    'store',
    'store_management',
    'quality_assurance',
    'inventory',
    'goods_receive',
    'goods_issue',
    'cost_center',
    'procurement_reports',
    'purchase_returns'
  ],
  [MODULE_KEYS.SALES]: [
    'sales_orders',
    'customers',
    'products',
    'sales_reports'
  ],
  [MODULE_KEYS.CRM]: [
    'leads',
    'contacts',
    'campaigns',
    'companies',
    'opportunities',
    'crm_reports',
    'crm_surveys'
  ],
  [MODULE_KEYS.AUDIT]: [
    'audit_management',
    'audit_findings',
    'corrective_actions',
    'audit_trail',
    'audit_reports',
    'audit_schedules',
    'pre_audit'
  ],
  [MODULE_KEYS.IT]: [
    'asset_management',
    'software_licenses',
    'network_devices',
    'it_vendors',
    'password_wallet',
    'it_reports'
  ],
  [MODULE_KEYS.TAJ_RESIDENCIA]: [
    'complains_tickets',
    'land_acquisition',
    'land_acquisition_maps',
    'land_acquisition_moza',
    'land_acquisition_registry',
    'land_acquisition_possession',
    'land_acquisition_parties',
    'land_purchase',
    'land_transfer'
  ],
  [MODULE_KEYS.ASSET_TAGGING]: [
    'asset_tagging_dashboard',
    'asset_tagging_assets',
    'asset_tagging_verification',
    'asset_tagging_events',
    'asset_tagging_scan',
    'asset_tagging_label'
  ],
  [MODULE_KEYS.GENERAL]: [
    'document_tracking',
    'indents',
    'general_cash_approvals',
    'centralized_store',
    'user_tracking',
    'project_management',
    'ceo_secretariat',
    'president_secretariat'
  ]
};

// Sub-role Helper Functions
export const getUserSubRoles = async () => {
  try {
    const response = await fetch('/api/user-sub-roles/user/me', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.data.userSubRoles || [];
  } catch (error) {
    console.error('Error fetching user sub-roles:', error);
    return [];
  }
};

export const getUserAllowedSubmodules = async (module) => {
  try {
    const userSubRoles = await getUserSubRoles();
    const allowedSubmodules = new Set();
    
    // Collect all submodules the user has permissions for
    userSubRoles.forEach(userSubRole => {
      const subRole = userSubRole.subRole;
      if (subRole.module === module) {
        subRole.permissions.forEach(permission => {
          allowedSubmodules.add(permission.submodule);
        });
      }
    });
    
    return Array.from(allowedSubmodules);
  } catch (error) {
    console.error('Error getting allowed submodules:', error);
    return [];
  }
};

export const hasSubRolePermission = async (module, submodule, action) => {
  try {
    const userSubRoles = await getUserSubRoles();
    
    // Check if user has the specific permission in their sub-roles
    for (const userSubRole of userSubRoles) {
      const subRole = userSubRole.subRole;
      if (subRole.module === module) {
        // If no specific submodule is provided, check if user has any permission for this module
        if (!submodule) {
          return subRole.permissions && subRole.permissions.length > 0;
        }
        
        const permission = subRole.permissions.find(p => p.submodule === submodule);
        if (permission && permission.actions.includes(action)) {
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking sub-role permission:', error);
    return false;
  }
};

// Legacy compatibility - keeping old structure for existing components
export const MODULES_LEGACY = {
  dashboard: {
    routes: ['/dashboard'],
    permissions: ['view']
  },
  hr: {
    routes: ['/hr/*'],
    permissions: ['view', 'create', 'update', 'delete']
  },
  finance: {
    routes: ['/finance/*'],
    permissions: ['view', 'create', 'update', 'delete']
  },
  procurement: {
    routes: ['/procurement/*'],
    permissions: ['view', 'create', 'update', 'delete']
  },
  sales: {
    routes: ['/sales/*'],
    permissions: ['view', 'create', 'update', 'delete']
  },
  crm: {
    routes: ['/crm/*'],
    permissions: ['view', 'create', 'update', 'delete']
  },
  audit: {
    routes: ['/audit/*'],
    permissions: ['view', 'create', 'update', 'delete']
  },
  it: {
    routes: ['/it/*'],
    permissions: ['view', 'create', 'update', 'delete']
  },
  admin: {
    routes: ['/admin/*'],
    permissions: ['view', 'create', 'update', 'delete']
  }
};

// Module configurations with their routes and permissions
export const MODULES = {
  dashboard: {
    name: 'Dashboard',
    path: '/dashboard',
    icon: 'Dashboard',
    description: 'Executive-level business intelligence dashboard',
    roles: ['super_admin', 'admin']
  },
  
  hr: {
    name: 'HR Module',
    path: '/hr',
    icon: 'People',
    description: 'Human Resources management',
    roles: ['super_admin', 'admin', 'hr_manager', 'Hr General Manager', 'hr_general_manager', 'hr general manager'],
    subItems: [
      { name: 'HR Dashboard', path: '/hr' },
      { name: 'Employees', path: '/hr/employees' },
      { name: 'Companies', path: '/hr/companies' },
      { name: 'Projects', path: '/hr/projects' },
      { name: 'Departments', path: '/hr/departments' },
      { name: 'Attendance', path: '/hr/attendance' },
      { name: 'Attendance Record', path: '/hr/attendance-record' },
      { name: 'Attendance Report', path: '/hr/attendance/report' },
      { name: 'Biometric Integration', path: '/hr/biometric' },
      { name: 'Payroll', path: '/hr/payroll' },
      { name: 'Payroll Taxes', path: '/hr/payroll-taxes' },
      { name: 'Loan Management', path: '/hr/loans' },
      { name: 'Final Settlement', path: '/hr/settlements' },
      { 
        name: 'Increment Management', 
        path: '/hr/increments',
        icon: 'TrendingUp',
        subItems: [
          { name: 'All Increments', path: '/hr/increments' },
          { name: 'Create Increment', path: '/hr/increments/create' },
          { name: 'Increment History', path: '/hr/increments/history' }
        ]
      },
      { 
        name: 'Leave Management', 
        path: '/hr/leaves',
        icon: 'EventNote',
        subItems: [
          { name: 'All Leaves', path: '/hr/leaves' },
          { name: 'Leave Approval', path: '/hr/leaves/approval' },
          { name: 'Leave Calendar', path: '/hr/leaves/calendar' },
          { name: 'Leave Reports', path: '/hr/leaves/reports' }
        ]
      },
      { 
        name: 'Talent Acquisition', 
        path: '/hr/talent-acquisition',
        subItems: [
          { name: 'Talent Dashboard', path: '/hr/talent-acquisition' },
          { name: 'Job Postings', path: '/hr/talent-acquisition/job-postings' },
          { name: 'Candidates', path: '/hr/talent-acquisition/candidates' },
          { name: 'Applications', path: '/hr/talent-acquisition/applications' },
          { name: 'Candidate Approvals', path: '/hr/candidate-approvals' },
          { name: 'Reports & Analytics', path: '/hr/talent-acquisition/reports' }
        ]
      },
      { 
        name: 'Learning & Development', 
        path: '/hr/learning',
        subItems: [
          { name: 'Learning Dashboard', path: '/hr/learning' },
          { name: 'Courses', path: '/hr/learning/courses' },
          { name: 'Enrollments', path: '/hr/learning/enrollments' },
          { name: 'Training Programs', path: '/hr/learning/programs' },
          { name: 'Reports & Analytics', path: '/hr/learning/reports' }
        ]
      },
      { 
        name: 'Organizational Development', 
        path: '/hr/organizational-development',
        subItems: [
          { name: 'OD Dashboard', path: '/hr/organizational-development' },
          { name: 'Organizational Chart', path: '/hr/organizational-development/org-chart' },
          { name: 'Org Chart Editor', path: '/hr/organizational-development/org-chart/edit' },
          { name: 'Job Analysis', path: '/hr/organizational-development/job-analysis' },
          { name: 'Succession Planning', path: '/hr/organizational-development/succession' },
          { name: 'Performance Management', path: '/hr/organizational-development/performance' },
          { name: 'Change Management', path: '/hr/organizational-development/change' },
          { name: 'Reports & Analytics', path: '/hr/organizational-development/reports' }
        ]
      },
      { name: 'FBR Tax Management', path: '/hr/fbr-tax' },
      { 
        name: 'Evaluation & Appraisal', 
        path: '/hr/evaluation-appraisal/dashboard',
        subItems: [
          { name: 'Dashboard', path: '/hr/evaluation-appraisal/dashboard' },
          { name: 'Documents', path: '/hr/evaluation-appraisal/documents' },
          { name: 'Authorities', path: '/hr/evaluation-appraisal/authorities' }
        ]
      },
      {
        name: 'KPI Management',
        path: '/hr/kpi/dashboard',
        subItems: [
          { name: 'Dashboard', path: '/hr/kpi/dashboard' },
          { name: 'Monthly KPI sheet', path: '/hr/kpi/sheet' },
          { name: 'KPI submissions', path: '/hr/kpi/submissions' },
          { name: 'KPI Reports', path: '/hr/kpi/reports' }
        ]
      },
      { name: 'New-Hiring Approval', path: '/hr/non-employee-onboarding' },
      { name: 'Reports', path: '/hr/reports' }
    ]
  },
  
  finance: {
    name: 'Finance Module',
    path: '/finance',
    icon: 'AccountBalance',
    description: 'Comprehensive financial management and accounting',
    roles: ['super_admin', 'admin', 'finance_manager', 'tcm_manager', 'developer'],
    subItems: [
      { name: 'Finance Dashboard', path: '/finance' },
      { name: 'Voucher Center', path: '/finance/vouchers', icon: 'ReceiptLong' },

      // ── CUSTOMERS (AR) ──────────────────────────────────────────────────────
      {
        name: 'Customers',
        path: '/finance/customers',
        subItems: [
          { name: 'Customer List',        path: '/finance/customers'           },
          { name: 'AR Invoices',          path: '/finance/accounts-receivable' },
          { name: 'Credit Notes',         path: '/finance/credit-notes'        },
          { name: 'Aged Receivables',     path: '/finance/aged-receivables'    },
        ]
      },

      // ── VENDORS (AP) ────────────────────────────────────────────────────────
      {
        name: 'Vendors',
        path: '/finance/accounts-payable',
        subItems: [
          { name: 'Payables – Bills, POs & Cash Approvals', path: '/finance/payables-hub' },
          { name: 'Payroll (Finance)',     path: '/finance/payroll-queue'        },
          { name: 'Vendor List',          path: '/finance/vendors'              },
          { name: 'Vendor Bills',         path: '/finance/accounts-payable'     },
          { name: 'Vendor Advance',       path: '/finance/vendor-advance'        },
          { name: 'Cash Approvals',       path: '/finance/cash-approvals'        },
          { name: 'Batch Payment',        path: '/finance/batch-payment'        },
          { name: 'Vendor Payments',      path: '/finance/vendor-payments'      },
          { name: 'Vendor Refunds',       path: '/finance/vendor-refunds'       },
          { name: 'Bill to Receive',      path: '/finance/bill-to-receive'      },
          { name: 'Billed Not Received',  path: '/finance/billed-not-received'  },
          { name: 'Vendor Statements',    path: '/finance/vendor-statement'     },
          { name: 'Aged Payables',        path: '/finance/aged-payables'        },
          { name: 'Payment Terms',        path: '/finance/payment-terms'        },
        ]
      },

      // ── ACCOUNTING ──────────────────────────────────────────────────────────
      {
        name: 'Accounting',
        path: '/finance/journal-entries',
        subItems: [
          { name: 'Journal Entries',       path: '/finance/journal-entries'       },
          { name: 'Recurring Journals',   path: '/finance/recurring-journals'   },
          { name: 'Deferred Entries',     path: '/finance/deferred-entries'     },
          { name: 'General Ledger',       path: '/finance/general-ledger'       },
          { name: 'Banking',              path: '/finance/banking'              },
          { name: 'Bank Statement Import',path: '/finance/bank-statement-import'},
          { name: 'Bank Reconciliation',  path: '/finance/bank-reconciliation'  },
          { name: 'Opening Balances',     path: '/finance/opening-balances'     },
          { name: 'Year-End Closing',     path: '/finance/year-end-closing'     }
        ]
      },

      // ── REVIEW ──────────────────────────────────────────────────────────────
      {
        name: 'Review',
        path: '/finance/inventory-valuation',
        subItems: [
          { name: 'Inventory Valuation', path: '/finance/inventory-valuation' },
          { name: 'Fixed Assets (FAR)',  path: '/finance/fixed-assets'        },
          { name: 'Budgets',             path: '/finance/budgets'             },
          { name: 'Budget vs Actual',    path: '/finance/budget-vs-actual'    },
        ]
      },

      // ── REPORTING ───────────────────────────────────────────────────────────
      {
        name: 'Reporting',
        path: '/finance/balance-sheet',
        subItems: [
          { name: 'Balance Sheet',         path: '/finance/balance-sheet'   },
          { name: 'Profit & Loss',         path: '/finance/profit-loss'     },
          { name: 'Comparative P&L',       path: '/finance/comparative-pl'  },
          { name: 'Cost Center P&L',       path: '/finance/cost-center-pl'  },
          { name: 'Cash Flow Statement',   path: '/finance/cash-flow'       },
          { name: 'Trial Balance',         path: '/finance/trial-balance'   },
          { name: 'Tax Summary (FBR)',     path: '/finance/tax-summary'     },
          { name: 'Customer Statements',   path: '/finance/customer-statement' },
          { name: 'Aged Receivables',      path: '/finance/aged-receivables'   },
        ]
      },

      // ── CONFIGURATION ───────────────────────────────────────────────────────
      {
        name: 'Configuration',
        path: '/finance/accounts',
        subItems: [
          { name: 'Chart of Accounts',    path: '/finance/accounts'               },
          { name: 'Cost Centers',         path: '/finance/cost-centers'           },
          { name: 'Tax Management',       path: '/finance/taxes'                  },
          { name: 'Finance Journals',     path: '/finance/journals'               },
          { name: 'Fiscal Periods',       path: '/finance/fiscal-periods'         },
          { name: 'Inventory Categories', path: '/finance/inventory-categories'   },
          { name: 'Companies & Banks',    path: '/finance/companies'              },
          { name: 'Company Profile',      path: '/finance/company-profile'        },
          { name: 'Banking Setup',        path: '/finance/banking-setup'          },
          { name: '⚙ Finance Setup Wizard', path: '/finance/setup'              },
        ]
      },
      {
        name: 'Taj Utilities & Charges',
        path: '/finance/taj-utilities-charges',
        subItems: [
          {
            name: 'Dashboard',
            path: '/finance/taj-utilities-charges/dashboard'
          },
          {
            name: 'CAM Charges',
            path: '/finance/taj-utilities-charges/cam-charges'
          },
          {
            name: 'Water Bills',
            path: '/finance/taj-utilities-charges/water-bills'
          },
          {
            name: 'Electricity Bills',
            path: '/finance/taj-utilities-charges/electricity-bills'
          },
          {
            name: 'Rental Agreements',
            path: '/finance/taj-utilities-charges/rental-agreements'
          },
          {
            name: 'Rental Management',
            path: '/finance/taj-utilities-charges/rental-management'
          },
          {
            name: 'Taj Residents',
            path: '/finance/taj-utilities-charges/taj-residents'
          },
          {
            name: 'Taj Properties',
            path: '/finance/taj-utilities-charges/taj-properties'
          },
          {
            name: 'Charges Slabs',
            path: '/finance/taj-utilities-charges/charges-slabs'
          },
          {
            name: 'Invoices',
            path: '/finance/taj-utilities-charges/invoices'
          },
          {
            name: 'Open Invoices',
            path: '/finance/taj-utilities-charges/open-invoices'
          },
          {
            name: 'Deposits',
            path: '/finance/taj-utilities-charges/deposits'
          },
          {
            name: 'Banks',
            path: '/finance/taj-utilities-charges/banks'
          },
          {
            name: 'Suspense Account',
            path: '/finance/taj-utilities-charges/suspense-account'
          },
          {
            name: 'Reports',
            path: '/finance/taj-utilities-charges/reports'
          },
          {
            name: 'Reconciliation',
            path: '/finance/taj-utilities-charges/reconciliation'
          }
        ]
      },
      {
        name: 'Recovery',
        path: '/finance/recovery',
        subItems: [
          {
            name: 'Recovery Assignments',
            path: '/finance/recovery/recovery-assignments'
          },
          {
            name: 'My Tasks',
            path: '/finance/recovery/my-tasks'
          },
          {
            name: 'Recovery Members',
            path: '/finance/recovery/recovery-members'
          },
          {
            name: 'Task Assignment',
            path: '/finance/recovery/task-assignment'
          },
          {
            name: 'Completed Tasks',
            path: '/finance/recovery/completed-tasks'
          },
          {
            name: 'Campaigns',
            path: '/finance/recovery/campaigns'
          }
        ]
      },
      { name: 'Financial Reports', path: '/finance/reports' },
      { name: 'Legacy', path: '/finance/legacy' }
    ]
  },
  
  procurement: {
    name: 'Procurement Module',
    path: '/procurement',
    icon: 'ShoppingCart',
    description: 'Procurement management',
    roles: ['super_admin', 'admin', 'developer', 'procurement_manager'],
    subItems: [
      { name: 'Procurement Dashboard', path: '/procurement' },
      { name: 'Procurement Requisitions', path: '/procurement/requisitions' },
      { name: 'Task Assignment', path: '/procurement/task-assignment' },
      { name: 'Quotations', path: '/procurement/quotations' },
      { name: 'Comparative Statements', path: '/procurement/comparative-statements' },
      { name: 'Purchase Orders', path: '/procurement/purchase-orders' },
      {
        name: 'Vendors',
        path: '/procurement/vendors',
        subItems: [
          { name: 'Approved vendor list', path: '/procurement/vendors' },
          { name: 'Subcontractors', path: '/procurement/subcontractors' }
        ]
      },
      { name: 'Subcontractors', path: '/procurement/subcontractors' },
      { name: "GRN's & Bills", path: '/procurement/vendor-bills' },
      { name: 'Reports', path: '/procurement/reports' },
      {
        name: 'Store',
        path: '/procurement/store',
        subItems: [
          { name: 'Store Dashboard', path: '/procurement/store' },
          { name: 'Store Management', path: '/procurement/store/manage' },
          { name: 'Item catalog', path: '/procurement/store/item-catalog' },
          { name: 'Inventory', path: '/procurement/store/inventory' },
          { name: 'GRN (Goods Received Note)', path: '/procurement/store/goods-receive' },
          { name: 'Delivery challans (DC QA)', path: '/procurement/store/delivery-challans' },
          { name: 'QA (delivery challans)', path: '/procurement/store/delivery-challan-qa' },
          { name: 'Store Issue Note', path: '/procurement/store/goods-issue' },
          { name: 'Cost Center', path: '/procurement/store/cost-center' },
          { name: 'Purchase Returns', path: '/procurement/purchase-returns' }
        ]
      }
    ]
  },
  
  sales: {
    name: 'Sales Module',
    path: '/sales',
    icon: 'PointOfSale',
    description: 'Sales management',
    roles: ['super_admin', 'admin', 'sales_manager'],
    subItems: [
      { name: 'Sales Dashboard', path: '/sales' },
      { name: 'Sales Orders', path: '/sales/orders' },
      { name: 'Customers', path: '/sales/customers' },
      { name: 'Products', path: '/sales/products' }
    ]
  },
  
  crm: {
    name: 'CRM Module',
    path: '/crm',
    icon: 'ContactSupport',
    description: 'Customer Relationship Management',
    roles: ['super_admin', 'admin', 'crm_manager', 'sales_manager'],
    subItems: [
      { name: 'CRM Dashboard', path: '/crm' },
      { name: 'Leads', path: '/crm/leads' },
      { name: 'Contacts', path: '/crm/contacts' },
      { name: 'Campaigns', path: '/crm/campaigns' },
      { name: 'Companies', path: '/crm/companies' },
      { name: 'Opportunities', path: '/crm/opportunities' },
      { name: 'Reports', path: '/crm/reports' },
      {
        name: 'Survey',
        path: '/crm/survey',
        subItems: [
          { name: 'Analytics & Reporting Dashboard', path: '/crm/survey/dashboard' },
          { name: 'Manage Surveys', path: '/crm/survey' },
          { name: 'My Surveys', path: '/crm/survey/mine' },
          { name: 'Create Market Intelligence Form', path: '/crm/survey/new' },
          { name: 'Create Poll', path: '/crm/survey/poll/new' }
        ]
      }
    ]
  },
  
  admin: {
    name: 'Admin Module',
    path: '/admin',
    icon: 'AdminPanelSettings',
    description: 'System administration',
    roles: ['super_admin', 'admin', 'hr_manager', 'appraisal_manager'],
    subItems: [
      { 
        name: 'Admin Dashboard', 
        path: '/admin/dashboard'
      },
      { 
        name: 'User Management', 
        path: '/admin/users',
        subItems: [
          { name: 'Users', path: '/admin/users' },
          { name: 'Roles', path: '/admin/roles' },
          { name: 'Online Users', path: '/admin/users/online' },
          { name: 'Mobile Approvals', path: '/admin/users/mobile-approvals' }
        ]
      },
      { 
        name: 'Vehicle Management', 
        path: '/admin/vehicle-management',
        subItems: [
          { name: 'Dashboard', path: '/admin/vehicle-management' },
          { name: 'Vehicles', path: '/admin/vehicle-management/vehicles' },
          { name: 'Vehicle Location', path: '/admin/vehicle-management/location' },
          { name: 'Maintenance', path: '/admin/vehicle-management/maintenance' },
          { name: 'Log Book', path: '/admin/vehicle-management/logbook' },
          { name: 'Reports', path: '/admin/vehicle-management/reports' }
        ]
      },
      { name: 'Houses Inventory', path: '/admin/houses-inventory' },
      {
        name: 'Centralized Store',
        path: '/admin/centralized-store',
        subItems: [
          { name: 'Store Setup', path: '/admin/centralized-store' },
          { name: 'Create Bill', path: '/admin/centralized-store/bill/new' },
          { name: 'Bills', path: '/admin/centralized-store/bills' }
        ]
      },
      { name: 'Rental Agreements', path: '/admin/rental-agreements' },
      { name: 'Rental Management', path: '/admin/rental-management' }
    ]
  },
  
  audit: {
    name: 'Audit Module',
    path: '/audit',
    icon: 'Security',
    description: 'Audit and compliance management',
    roles: ['super_admin', 'audit_manager', 'auditor', 'Audit Director', 'audit_director', 'audit director'],
    subItems: [
      { name: 'Audit Dashboard', path: '/audit' },
      { name: 'Audit Management', path: '/audit/list' },
      { name: 'Pre Audit', path: '/audit/pre-audit' },
      { name: 'Audit Findings', path: '/audit/findings' },
      { name: 'Corrective Actions', path: '/audit/corrective-actions' },
      { name: 'Audit Trail', path: '/audit/trail' },
      { name: 'Audit Reports', path: '/audit/reports' },
      { name: 'Audit Schedules', path: '/audit/schedules' }
    ]
  },

  it: {
    name: 'IT Module',
    path: '/it',
    icon: 'Computer',
    description: 'IT Asset and Infrastructure Management',
    roles: ['super_admin', 'admin', 'it_manager'],
    subItems: [
      { name: 'IT Dashboard', path: '/it' },
      { name: 'Asset Management', path: '/it/assets' },
      { name: 'Software & Licenses', path: '/it/software' },
      { name: 'Network Devices', path: '/it/network' },
      { name: 'IT Vendors', path: '/it/vendors' },
      { name: 'Password Wallet', path: '/it/passwords' },
      { name: 'Reports & Analytics', path: '/it/reports' }
    ]
  },

  taj_residencia: {
    name: 'Taj Residencia',
    path: '/taj-residencia',
    icon: 'LocationCity',
    description: 'Taj Residencia management module',
    roles: ['super_admin', 'taj_residencia_manager'],
    subItems: [
      {
        name: 'Complains & Tickets',
        path: '/taj-residencia/complains-tickets'
      },
      {
        name: 'Land Acquisition',
        path: '/taj-residencia/land-acquisition',
        subItems: [
          { name: 'Dashboard', path: '/taj-residencia/land-acquisition/dashboard' },
          { name: 'Maps', path: '/taj-residencia/land-acquisition/maps' },
          { name: 'Moza', path: '/taj-residencia/land-acquisition/moza' },
          { name: 'Registry', path: '/taj-residencia/land-acquisition/registry' },
          { name: 'Possession', path: '/taj-residencia/land-acquisition/possession' },
          {
            name: 'Parties',
            path: '/taj-residencia/land-acquisition/parties',
            subItems: [
              { name: 'Sellers', path: '/taj-residencia/land-acquisition/parties/sellers' },
              { name: 'Buyers', path: '/taj-residencia/land-acquisition/parties/buyers' },
              { name: 'Dealers', path: '/taj-residencia/land-acquisition/parties/dealers' }
            ]
          },
          { name: 'Land Purchase', path: '/taj-residencia/land-purchase' },
          { name: 'Land Transfers', path: '/taj-residencia/land-transfers' },
          { name: 'Reports', path: '/taj-residencia/land-acquisition/reports' }
        ]
      }
    ]
  },

  asset_tagging: {
    name: 'Asset Tagging',
    path: '/asset-tagging',
    icon: 'QrCode',
    description: 'Fixed asset QR labels, scans, custody, and physical verification',
    roles: ['super_admin', 'admin', 'finance_manager', 'procurement_manager', 'audit_manager', 'higher_management'],
    subItems: [
      { name: 'Dashboard', path: '/asset-tagging' },
      { name: 'Fixed Asset Register (FAR)', path: '/asset-tagging/register' },
      { name: 'Tagged Assets', path: '/asset-tagging/assets' },
      { name: 'Physical Verification', path: '/asset-tagging/verification' },
      { name: 'Tag Events', path: '/asset-tagging/events' }
    ]
  },

  general: {
    name: 'General Module',
    path: '/general',
    icon: 'Folder',
    description: 'General modules and utilities',
    roles: ['super_admin', 'admin', 'hr_manager'],
    subItems: [
      { 
        name: 'Documents Tracking', 
        path: '/documents-tracking',
        subItems: [
          { name: 'Dashboard', path: '/documents-tracking/dashboard' },
          { name: 'Documents List', path: '/documents-tracking' }
        ]
      },
      {
        name: 'Indents',
        path: '/general/indents',
        subItems: [
          { name: 'Dashboard', path: '/general/indents/dashboard' },
          { name: 'All Indents', path: '/general/indents' },
          { name: 'Create Indent', path: '/general/indents/create' },
          { name: 'Cost Centers', path: '/general/cost-centers' }
        ]
      },
      {
        name: 'Cash Approvals',
        path: '/general/cash-approvals',
        subItems: [
          { name: 'All requests', path: '/general/cash-approvals' },
          { name: 'New request', path: '/general/cash-approvals/create' }
        ]
      },
      {
        name: 'User Tracking',
        path: '/general/user-tracking'
      },
      {
        name: 'Project Management',
        path: '/general/project-management',
        subItems: [
          // Daily work: open a project; its BOQ → Contracts → Check Requests → IPCs live in tabs there
          { name: 'Overview', path: '/general/project-management/overview' },
          { name: 'Projects', path: '/general/project-management/projects' },
          { name: 'Approvals', path: '/general/project-management/approvals' },
          { name: 'Subcontractor Statement', path: '/general/project-management/subcontractor-statement' },
          // Setup / master data
          { name: 'Subcontractors', path: '/general/subcontractors' },
          { name: 'WBS Activities', path: '/general/project-management/wbs-activities' },
          { name: 'Slab Templates', path: '/general/project-management/slabs' }
        ]
      },
      {
        name: 'Centralized Store',
        path: '/general/centralized-store',
        subItems: [
          { name: 'Store Setup', path: '/general/centralized-store' },
          { name: 'Bills', path: '/general/centralized-store/bills' },
          { name: 'Create Bill', path: '/general/centralized-store/bill/new' }
        ]
      },
      {
        name: 'Ceo Secretariat',
        path: '/general/ceo-secretariat',
        subItems: [
          {
            name: 'Payments',
            path: '/general/ceo-secretariat/payments'
          }
        ]
      },
      {
        name: 'President Secretariat',
        path: '/general/president-secretariat',
        subItems: [
          {
            name: 'Dashboard',
            path: '/general/president-secretariat/dashboard'
          },
          {
            name: 'Meeting Request',
            path: '/general/president-secretariat/meetings'
          },
          {
            name: 'Meeting Schedule',
            path: '/general/president-secretariat/meetings?tab=schedule'
          },
          {
            name: 'Events',
            path: '/general/president-secretariat/events'
          }
        ]
      }
    ]
  },

  developer_module: {
    name: 'Developer',
    path: '/developer',
    icon: 'DeveloperMode',
    description: 'Server monitoring and ERP financial value reporting (superuser & developer only)',
    roles: ['super_admin', 'developer'],
    subItems: [
      { name: 'Server Monitor', path: '/developer/server-monitor' },
      { name: 'Financial Dashboard', path: '/developer/financials' }
    ]
  }
};

/**
 * Paths where the last URL segment is NOT the permission submodule key.
 * Used by getCatalogSubmodules so Role/User Management stays in sync with the menu.
 */
const CATALOG_PATH_OVERRIDES = {
  '/finance': 'finance_dashboard',
  '/finance/accounts': 'chart_of_accounts',
  '/finance/companies': 'finance_companies',
  '/finance/company-profile': 'company_profile',
  '/finance/vendors': 'accounts_payable',
  '/finance/vendor-advance': 'accounts_payable',
  '/finance/cash-approvals': 'accounts_payable',
  '/finance/utility-bills': 'accounts_payable',
  '/finance/payables-hub': 'accounts_payable',
  '/finance/batch-payment': 'accounts_payable',
  '/finance/vendor-payments': 'accounts_payable',
  '/finance/vendor-refunds': 'accounts_payable',
  '/finance/bill-to-receive': 'accounts_payable',
  '/finance/billed-not-received': 'accounts_payable',
  '/finance/payroll-queue': 'payroll_management',
  '/finance/recurring-journals': 'journal_entries',
  '/finance/deferred-entries': 'journal_entries',
  '/finance/bank-statement-import': 'banking',
  '/finance/balance-sheet': 'financial_statements',
  '/finance/profit-loss': 'financial_statements',
  '/finance/trial-balance': 'financial_statements',
  '/finance/cash-flow': 'financial_statements',
  '/finance/reports': 'financial_reports',
  '/admin/roles': 'sub_roles',
  '/settings': 'admin_settings',
  '/documents-tracking': 'document_tracking',
  '/general/cost-centers': 'indents',
  '/hr/companies': 'employee_management',
  '/hr/departments': 'employee_management',
  '/hr/increments': 'employee_management',
  '/hr/biometric': 'attendance_management',
  '/hr/attendance-record': 'attendance_management',
  '/asset-tagging': 'asset_tagging_dashboard',
  '/asset-tagging/register': 'asset_tagging_assets'
};

/** Last path segment → snake_case submodule key (e.g. /finance/credit-notes → credit_notes). */
export const pathToSubmoduleKey = (path) => {
  if (!path || typeof path !== 'string') return null;
  const normalized = path.split('?')[0].replace(/\/+$/, '');
  if (!normalized) return null;
  if (CATALOG_PATH_OVERRIDES[normalized]) return CATALOG_PATH_OVERRIDES[normalized];

  // Longest-prefix override (nested routes)
  let best = null;
  let bestLen = 0;
  for (const [mapped, key] of Object.entries(CATALOG_PATH_OVERRIDES)) {
    if (
      (normalized === mapped || normalized.startsWith(mapped + '/')) &&
      mapped.length > bestLen
    ) {
      best = key;
      bestLen = mapped.length;
    }
  }
  if (best) return best;

  const seg = normalized.split('/').filter(Boolean).pop();
  return seg ? seg.replace(/-/g, '_') : null;
};

/**
 * Catalog of assignable submodules for Role Management.
 * Merges static SUBMODULES with keys derived from MODULES menu paths,
 * so newly added menu tabs appear automatically for permission assignment.
 */
export const getCatalogSubmodules = (moduleKey) => {
  const ordered = [];
  const seen = new Set();
  const add = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };

  (SUBMODULES[moduleKey] || []).forEach(add);

  const walk = (items) => {
    (items || []).forEach((item) => {
      if (item.path) add(pathToSubmoduleKey(item.path));
      if (item.subItems) walk(item.subItems);
    });
  };
  walk(MODULES[moduleKey]?.subItems);

  return ordered;
};

// Utility functions for permission checking
export const hasPermission = (userRole, moduleName) => {
  if (!userRole || !moduleName) return false;
  
  const userPermissions = PERMISSIONS[userRole];
  if (!userPermissions) return false;
  
  // Admin has access to everything
  if (userPermissions.canAccessAll) return true;
  
  // Check if user has access to the specific module
  return userPermissions.modules.includes(moduleName);
};

export const canAccessModule = (userRole, moduleName) => {
  return hasPermission(userRole, moduleName);
};

export const getAccessibleModules = (userRole) => {
  if (!userRole) return [];
  
  // Try exact match first
  let userPermissions = PERMISSIONS[userRole];
  
  // If not found, try case-insensitive and normalized lookup
  if (!userPermissions) {
    const normalizedRole = String(userRole).toLowerCase().replace(/\s+/g, '_');
    const roleWithSpaces = String(userRole).toLowerCase();
    
    // Try normalized versions
    userPermissions = PERMISSIONS[normalizedRole] || PERMISSIONS[roleWithSpaces];
    
    // If still not found, try case-insensitive lookup
    if (!userPermissions) {
      const roleKeys = Object.keys(PERMISSIONS);
      const matchingKey = roleKeys.find(key => {
        const keyLower = key.toLowerCase();
        const keyNormalized = keyLower.replace(/\s+/g, '_');
        return keyLower === normalizedRole || 
               keyLower === roleWithSpaces ||
               keyNormalized === normalizedRole ||
               key.toLowerCase() === userRole.toLowerCase();
      });
      if (matchingKey) {
        userPermissions = PERMISSIONS[matchingKey];
      }
    }
    
    // If still not found and role contains "hr" and "general" and "manager", give HR access
    if (!userPermissions && normalizedRole.includes('hr') && normalizedRole.includes('general') && normalizedRole.includes('manager')) {
      return [MODULE_KEYS.HR];
    }
  }
  
  if (!userPermissions) {
    return [];
  }
  
  if (userPermissions.canAccessAll) {
    return Object.keys(MODULES);
  }
  
  return userPermissions.modules;
};

export const getModuleMenuItems = (userRole) => {
  const accessibleModules = getAccessibleModules(userRole);
  
  // Define allowed submodules for TCM Manager
    const tcmManagerAllowedSubmodules = [
      '/finance/taj-utilities-charges',
      '/finance/taj-utilities-charges/dashboard',
      '/finance/taj-utilities-charges/cam-charges',
      '/finance/taj-utilities-charges/water-bills',
      '/finance/taj-utilities-charges/electricity-bills',
      '/finance/taj-utilities-charges/rental-agreements',
      '/finance/taj-utilities-charges/rental-management',
      '/finance/taj-utilities-charges/taj-residents',
      '/finance/taj-utilities-charges/taj-properties',
      '/finance/taj-utilities-charges/charges-slabs',
      '/finance/taj-utilities-charges/invoices',
      '/finance/taj-utilities-charges/open-invoices',
      '/finance/taj-utilities-charges/deposits',
      '/finance/taj-utilities-charges/banks',
      '/finance/taj-utilities-charges/suspense-account',
      '/finance/taj-utilities-charges/reports',
      '/finance/taj-utilities-charges/reconciliation'
    ];
  
  return accessibleModules.map(moduleKey => {
    const module = MODULES[moduleKey];
    
    // Skip if module doesn't exist
    if (!module) {
      console.warn(`Module not found for key: ${moduleKey}`);
      return null;
    }
    
    // Filter subItems for TCM Manager
    // Note: For TCM Manager, we only show "Taj Utilities & Charges" and filter its nested subItems
    let filteredSubItems = module.subItems;
    if (userRole === ROLES.TCM_MANAGER && moduleKey === MODULE_KEYS.FINANCE && module.subItems) {
      // For TCM Manager, only show "Taj Utilities & Charges" subItem
      filteredSubItems = module.subItems.filter(subItem => 
        subItem.path === '/finance/taj-utilities-charges'
      );
    }
    
    return {
      text: module.name,
      icon: module.icon,
      path: module.path,
      subItems: filteredSubItems ? filteredSubItems.map(subItem => {
        // Filter sub-items within sub-items (e.g., Authorities in Evaluation & Appraisal)
        let filteredSubItems = subItem.subItems;
        
        // Special handling for TCM Manager - filter Taj Utilities & Charges subItems
        if (userRole === ROLES.TCM_MANAGER && 
            moduleKey === MODULE_KEYS.FINANCE && 
            subItem.path === '/finance/taj-utilities-charges' && 
            subItem.subItems) {
          filteredSubItems = subItem.subItems.filter(subSubItem => 
            tcmManagerAllowedSubmodules.includes(subSubItem.path)
          );
        } else if (subItem.subItems) {
          // Hide Authorities for non-super_admin users
          filteredSubItems = subItem.subItems.filter(subSubItem => {
            if (
              subSubItem.path === '/hr/evaluation-appraisal/authorities' &&
              userRole !== 'super_admin' &&
              userRole !== ROLES.DEVELOPER
            ) {
              return false;
            }
            return true;
          });
        }
        
        return {
          text: subItem.name,
          path: subItem.path,
          subItems: filteredSubItems ? filteredSubItems.map(subSubItem => ({
            text: subSubItem.name,
            path: subSubItem.path
          })) : undefined
        };
      }) : undefined,
      description: module.description
    };
  }).filter(module => {
    // Remove modules that have no subItems after filtering (for TCM Manager)
    if (userRole === ROLES.TCM_MANAGER && module.subItems && module.subItems.length === 0) {
      return false;
    }
    return true;
  }).filter(module => module !== null); // Remove any null modules
};

export const isRouteAccessible = (userRole, path, userSubRoles = [], userRoleRef = null, userRoles = null) => {
  if (!path) return false;
  
  // Profile is always accessible
  if (path === '/profile') return true;
  if (path === '/profile/kpi-sheet') return true;
  if (path === '/profile/team-kpi-reviews') return true;

  // Chat (1:1, groups, moderation UI) — any authenticated user; moderation page enforces admin API
  if (path === '/chat' || path.startsWith('/chat/')) return true;

  // CRM Survey — any authenticated user can open assigned surveys and submit responses
  if (path === '/crm/survey/mine' || /^\/crm\/survey\/[^/]+\/respond$/.test(path)) {
    return true;
  }

  // Purchase Orders route relies on backend assignment checks for visibility and actions.
  // Keep this route reachable for cross-module authority approvers (audit/hr/general/etc).
  if (path === '/procurement/purchase-orders' || path.startsWith('/procurement/purchase-orders/')) return true;

  // General cash approval document (shared view from audit, CEO, notifications).
  if (/^\/cash-approvals\/[^/]+\/view/.test(path)) return true;
  
  // Super Admin, Higher Management, and Developer have access to everything
  if (userRole === 'super_admin' || userRole === 'higher_management' || userRole === 'developer') {
    if (path === '/hr/evaluation-appraisal/authorities' || path.startsWith('/hr/evaluation-appraisal/authorities/')) {
      return userRole === 'super_admin' || userRole === 'developer';
    }
    return true;
  }
  
  // Authorities page in Evaluation & Appraisal is only accessible to super_admin / developer
  if (path === '/hr/evaluation-appraisal/authorities' || path.startsWith('/hr/evaluation-appraisal/authorities/')) {
    return false;
  }
  
  // Helper function to get module name from path
  const getModuleNameFromPathHelper = (pathToCheck) => {
    if (pathToCheck.startsWith('/admin')) return 'admin';
    if (pathToCheck.startsWith('/settings')) return 'admin';
    if (pathToCheck.startsWith('/hr')) return 'hr';
    if (pathToCheck.startsWith('/finance')) return 'finance';
    if (pathToCheck.startsWith('/procurement')) return 'procurement';
    if (pathToCheck.startsWith('/sales')) return 'sales';
    if (pathToCheck.startsWith('/crm')) return 'crm';
    if (pathToCheck.startsWith('/audit')) return 'audit';
    if (pathToCheck.startsWith('/it')) return 'it';
    if (pathToCheck.startsWith('/taj-residencia')) return 'taj_residencia';
    if (pathToCheck.startsWith('/documents-tracking')) return 'general';
    if (pathToCheck.startsWith('/general')) return 'general';
    if (pathToCheck.startsWith('/asset-tagging')) return 'asset_tagging';
    if (pathToCheck.startsWith('/developer')) return 'developer_module';
    return null;
  };
  
  // Helper function to map paths to submodule names
  const getSubmoduleFromPathHelper = (pathToCheck) => {
    const pathToSubmoduleMap = {
      // Admin Module
      '/admin/dashboard': 'admin_dashboard',
      '/admin/users': 'user_management',
      '/admin/users/online': 'user_management',
      '/admin/users/mobile-approvals': 'user_management',
      '/admin/sub-roles': 'sub_roles',
      '/admin/roles': 'sub_roles', // Role management uses same permission as sub-roles
      '/settings': 'admin_settings',
      '/admin/vehicle-management': 'vehicle_management',
      '/admin/houses-inventory': 'house_inventory',
      '/admin/centralized-store': 'utility_bills_management',
      '/admin/centralized-store/bills': 'utility_bills_management',
      '/admin/centralized-store/bill/new': 'utility_bills_management',
      '/admin/centralized-store/bill': 'utility_bills_management',
      '/admin/rental-agreements': 'rental_agreements',
      '/admin/rental-management': 'rental_management',
      
      // HR Module
      '/hr/employees': 'employee_management',
      '/hr/companies': 'employee_management',
      '/hr/departments': 'employee_management',
      '/hr/attendance': 'attendance_management',
      '/hr/attendance-record': 'attendance_management',
      '/hr/attendance/report': 'attendance_management',
      '/hr/biometric': 'attendance_management',
      '/hr/payroll': 'payroll_management',
      '/hr/payroll-taxes': 'payroll_management',
      '/hr/loans': 'loan_management',
      '/hr/settlements': 'settlement_management',
      '/hr/increments': 'employee_management',
      '/hr/leaves': 'leave_management',
      '/hr/talent-acquisition': 'talent_acquisition',
      '/hr/learning': 'learning_development',
      '/hr/organizational-development': 'organizational_development',
      '/hr/organizational-development/org-chart': 'organizational_development',
      '/hr/organizational-development/org-chart/edit': 'organizational_development',
      '/hr/fbr-tax': 'fbr_tax_management',
      '/hr/evaluation-appraisal': 'evaluation_appraisal',
      '/hr/evaluation-appraisal/documents': 'evaluation_appraisal',
      '/hr/evaluation-appraisal/authorities': 'evaluation_appraisal',
      '/hr/evaluation-appraisal/edit': 'evaluation_appraisal',
      '/hr/kpi/sheet': 'kpi_management',
      '/hr/kpi/submissions': 'kpi_management',
      '/hr/kpi/reports': 'kpi_management',
      '/hr/kpi/dashboard': 'kpi_management',
      '/hr/kpi/templates': 'kpi_management',
      '/hr/kpi/cycles': 'kpi_management',
      '/hr/kpi/review': 'kpi_management',
      '/hr/reports': 'reports',
      
      // General Module
      '/documents-tracking': 'document_tracking',
      '/general/indents': 'indents',
      '/general/indents/dashboard': 'indents',
      '/general/indents/create': 'indents',
      '/general/cost-centers': 'indents',
      '/general/centralized-store': 'centralized_store',
      '/general/centralized-store/bills': 'centralized_store',
      '/general/centralized-store/bill/new': 'centralized_store',
      '/general/centralized-store/bill': 'centralized_store',
      '/general/cash-approvals': 'general_cash_approvals',
      '/general/cash-approvals/create': 'general_cash_approvals',
      '/general/user-tracking': 'user_tracking',
      '/general/project-management': 'project_management',
      '/general/project-management/overview': 'project_management',
      '/general/project-management/projects': 'project_management',
      '/general/project-management/approvals': 'project_management',
      '/general/project-management/subcontractor-statement': 'project_management',
      '/general/project-management/workspace': 'project_management',
      '/general/project-management/wbs-activities': 'project_management',
      '/general/project-management/slabs': 'project_management',
      '/general/ceo-secretariat': 'ceo_secretariat',
      '/general/ceo-secretariat/payments': 'ceo_secretariat',
      '/general/president-secretariat': 'president_secretariat',
      '/general/president-secretariat/dashboard': 'president_secretariat',
      '/general/president-secretariat/meetings': 'president_secretariat',
      '/general/president-secretariat/events': 'president_secretariat',

      // Asset Tagging Module
      '/asset-tagging': 'asset_tagging_dashboard',
      '/asset-tagging/register': 'asset_tagging_assets',
      '/asset-tagging/assets': 'asset_tagging_assets',
      '/asset-tagging/verification': 'asset_tagging_verification',
      '/asset-tagging/events': 'asset_tagging_events',
      '/asset-tagging/scan': 'asset_tagging_scan',
      '/asset-tagging/label': 'asset_tagging_label',
      
      // Finance Module
      '/finance': 'finance_dashboard',
      '/finance/accounts': 'chart_of_accounts',
      '/finance/journal-entries': 'journal_entries',
      '/finance/journals': 'finance_journals',
      '/finance/fiscal-periods': 'fiscal_periods',
      '/finance/inventory-categories': 'inventory_categories',
      '/finance/companies': 'finance_companies',
      '/finance/company-profile': 'company_profile',
      '/finance/inventory-valuation': 'inventory_valuation',
      '/finance/general-ledger': 'general_ledger',
      '/finance/customers': 'customers',
      '/finance/accounts-receivable': 'accounts_receivable',
      '/finance/accounts-receivable/new': 'accounts_receivable',
      '/finance/credit-notes': 'credit_notes',
      '/finance/customer-payments': 'customer_payments',
      '/finance/vendors': 'accounts_payable',
      '/finance/accounts-payable': 'accounts_payable',
      '/finance/accounts-payable/new': 'accounts_payable',
      '/finance/accounts-payable/bill': 'accounts_payable',
      '/finance/utility-bills': 'accounts_payable',
      '/finance/cash-approvals': 'accounts_payable',
      '/finance/payroll-queue': 'payroll_management',
      '/finance/vendor-advance': 'accounts_payable',
      '/finance/banking': 'banking',
      '/finance/taxes': 'tax_management',
      '/finance/fixed-assets': 'fixed_assets',
      '/finance/bank-reconciliation': 'bank_reconciliation',
      '/finance/vendor-statement': 'vendor_statement',
      '/finance/budget-vs-actual': 'budget_vs_actual',
      '/finance/aged-payables': 'aged_payables',
      '/finance/payment-terms': 'payment_terms',
      '/finance/balance-sheet': 'financial_statements',
      '/finance/profit-loss': 'financial_statements',
      '/finance/tax-summary': 'tax_summary',
      '/finance/trial-balance': 'financial_statements',
      '/finance/cash-flow': 'financial_statements',
      '/finance/year-end-closing': 'year_end_closing',
      '/finance/opening-balances': 'opening_balances',
      '/finance/customer-statement': 'customer_statement',
      '/finance/aged-receivables': 'aged_receivables',
      '/procurement/purchase-returns': 'purchase_returns',
      '/finance/taj-utilities-charges': 'taj_utilities_charges',
      '/finance/taj-utilities-charges/dashboard': 'taj_utilities_charges',
      '/finance/taj-utilities-charges/cam-charges': 'taj_cam_charges',
      '/finance/taj-utilities-charges/water-bills': 'taj_water_bills',
      '/finance/taj-utilities-charges/electricity-bills': 'taj_electricity_bills',
      '/finance/taj-utilities-charges/rental-agreements': 'taj_rental_agreements',
      '/finance/taj-utilities-charges/rental-management': 'taj_rental_management',
      '/finance/taj-utilities-charges/taj-residents': 'taj_residents',
      '/finance/taj-utilities-charges/taj-properties': 'taj_properties',
      '/finance/taj-utilities-charges/charges-slabs': 'taj_utilities_charges',
      '/finance/taj-utilities-charges/invoices': 'taj_invoices',
      '/finance/taj-utilities-charges/open-invoices': 'taj_open_invoices',
      '/finance/taj-utilities-charges/banks': 'taj_deposits',
      '/finance/taj-utilities-charges/reports': 'taj_utilities_reports',
      '/finance/taj-utilities-charges/reconciliation': 'taj_utilities_reports',
      '/finance/recovery': 'recovery',
      '/finance/recovery/recovery-assignments': 'recovery_assignments',
      '/finance/recovery/recovery-members': 'recovery_members',
      '/finance/recovery/task-assignment': 'recovery_task_assignment',
      '/finance/recovery/completed-tasks': 'recovery_completed_tasks',
      '/finance/recovery/campaigns': 'recovery_campaigns',
      '/finance/recovery/my-tasks': 'recovery_my_tasks',
      '/finance/vouchers': 'vouchers',
      '/finance/reports': 'financial_reports',
      
      // Procurement Module
      '/procurement/requisitions': 'procurement_requisitions',
      '/procurement/quotations': 'quotations',
      '/procurement/comparative-statements': 'comparative_statements',
      '/procurement/purchase-orders': 'purchase_orders',
      '/procurement/vendor-bills': 'purchase_orders',
      '/procurement/vendor-bills/new': 'purchase_orders',
      '/procurement/vendor-bills/bill': 'purchase_orders',
      '/procurement/cash-approvals': 'cash_approvals',
      '/procurement/vendors': 'vendors',
      '/procurement/store': 'store',
      '/procurement/store/manage': 'store_management',
      '/procurement/store/item-catalog': 'inventory',
      '/procurement/store/quality-assurance': 'goods_receive',
      '/procurement/store/inventory': 'inventory',
      '/procurement/store/goods-receive': 'goods_receive',
      '/procurement/store/delivery-challans': 'goods_receive',
      '/procurement/store/delivery-challan-qa': 'quality_assurance',
      '/procurement/store/goods-issue': 'goods_issue',
      '/procurement/store/cost-center': 'cost_center',
      '/procurement/reports': 'procurement_reports',
      
      // Sales Module
      '/sales/orders': 'sales_orders',
      '/sales/customers': 'customers',
      '/sales/products': 'products',
      '/sales/reports': 'sales_reports',
      
      // CRM Module
      '/crm/leads': 'leads',
      '/crm/contacts': 'contacts',
      '/crm/campaigns': 'campaigns',
      '/crm/companies': 'companies',
      '/crm/opportunities': 'opportunities',
      '/crm/reports': 'crm_reports',
      '/crm/survey/poll/new': 'crm_surveys',
      '/crm/survey/dashboard': 'crm_surveys',
      '/crm/survey/new': 'crm_surveys',
      '/crm/survey/mine': 'crm_surveys',
      '/crm/survey': 'crm_surveys',
      
      // Audit Module
      '/audit/list': 'audit_management',
      '/audit/findings': 'audit_findings',
      '/audit/corrective-actions': 'corrective_actions',
      '/audit/trail': 'audit_trail',
      '/audit/reports': 'audit_reports',
      '/audit/schedules': 'audit_schedules',
      '/audit/pre-audit': 'pre_audit',
      
      // IT Module
      '/it/assets': 'asset_management',
      '/it/software': 'software_licenses',
      '/it/network': 'network_devices',
      '/it/vendors': 'it_vendors',
      '/it/passwords': 'password_wallet',
      '/it/reports': 'it_reports',
      
      // Taj Residencia Module
      '/taj-residencia/complains-tickets': 'complains_tickets',
      '/taj-residencia/land-acquisition/moza': 'land_acquisition_moza',
      '/taj-residencia/land-acquisition/registry': 'land_acquisition_registry',
      '/taj-residencia/land-acquisition/possession': 'land_acquisition_possession',
      '/taj-residencia/land-acquisition/exchange': 'land_acquisition',
      '/taj-residencia/land-acquisition/transfers': 'land_transfer',
      '/taj-residencia/land-acquisition/parties/sellers': 'land_acquisition_parties',
      '/taj-residencia/land-acquisition/parties/buyers': 'land_acquisition_parties',
      '/taj-residencia/land-acquisition/parties/dealers': 'land_acquisition_parties',
      '/taj-residencia/land-acquisition/parties': 'land_acquisition_parties',
      '/taj-residencia/land-acquisition/maps': 'land_acquisition_maps',
      '/taj-residencia/land-acquisition': 'land_acquisition',
      '/taj-residencia/land-purchase/new': 'land_purchase',
      '/taj-residencia/land-purchase': 'land_purchase',
      '/taj-residencia/land-transfers': 'land_transfer'
    };
    
    // First try exact match
    if (pathToSubmoduleMap[path]) {
      return pathToSubmoduleMap[path];
    }
    
    // Handle dynamic routes (with :id or other params)
    // Prefer the longest matching path (e.g. /crm/survey before /crm)
    const sortedEntries = Object.entries(pathToSubmoduleMap)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [mappedPath, submodule] of sortedEntries) {
      // Remove trailing slashes for comparison
      const normalizedPath = path.replace(/\/$/, '');
      const normalizedMappedPath = mappedPath.replace(/\/$/, '');
      
      // Check if path starts with mapped path (for dynamic routes like /edit/:id)
      if (normalizedPath.startsWith(normalizedMappedPath + '/') || normalizedPath === normalizedMappedPath) {
        return submodule;
      }
    }

    // Auto: new menu paths map to last-segment snake_case (e.g. /finance/foo-bar → foo_bar)
    return pathToSubmoduleKey(path);
  };
  
  // NEW: Check roleRef/roles permissions first (RBAC system)
  const isDev = process.env.NODE_ENV === 'development';
  
  // Helper function to check if role permissions allow access to a path
  const checkRolePermissions = (rolePermissions, pathToCheck, roleName = 'unknown') => {
    if (!rolePermissions || !Array.isArray(rolePermissions)) {
      if (isDev) console.log(`🔒 [${roleName}] No permissions array`);
      return false;
    }
    
    const moduleName = getModuleNameFromPathHelper(pathToCheck);
    if (!moduleName) {
      if (isDev) console.log(`🔒 [${roleName}] No module found for path: ${pathToCheck}`);
      return false;
    }
    
    const submoduleName = getSubmoduleFromPathHelper(pathToCheck);
    
    if (isDev) {
      console.log(`🔒 [${roleName}] Checking path: ${pathToCheck}, module: ${moduleName}, submodule: ${submoduleName || 'none'}`);
    }
    
    // Find permission for this module
    const modulePermission = rolePermissions.find(p => p.module === moduleName);
    if (!modulePermission) {
      if (isDev) console.log(`🔒 [${roleName}] No permission found for module: ${moduleName}`);
      return false;
    }
    
    const hasModuleLevelRead = modulePermission.actions && Array.isArray(modulePermission.actions) && modulePermission.actions.includes('read');
    
    // If no submodule specified, check module-level permission
    if (!submoduleName) {
      if (hasModuleLevelRead) {
        if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (module-level read, no submodule)`);
        return true;
      }

      // Some roles are configured with submodule permissions only (no module-level actions).
      // For module root pages like `/procurement`, allow access if the user has read access
      // to at least one submodule under this module.
      const anySubmoduleRead =
        modulePermission.submodules &&
        Array.isArray(modulePermission.submodules) &&
        modulePermission.submodules.some((sm) => {
          if (!sm) return false;
          if (typeof sm === 'string') return true; // legacy format implies access
          if (typeof sm === 'object') {
            const acts = Array.isArray(sm.actions) ? sm.actions : [];
            return acts.includes('read');
          }
          return false;
        });

      if (anySubmoduleRead) {
        if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (submodule read implies module root access)`);
        return true;
      }

      if (isDev) console.log(`🔒 [${roleName}] ❌ No module-level read and no readable submodule`);
      return false;
    }
    
    // Check submodule-level permissions
    if (modulePermission.submodules && Array.isArray(modulePermission.submodules) && modulePermission.submodules.length > 0) {
      const namesToMatch =
        moduleName === 'general' && submoduleName === 'centralized_store'
          ? ['centralized_store', 'indents']
          : [submoduleName];
      const submodule = modulePermission.submodules.find(sm => {
        const smName = typeof sm === 'object' ? sm.submodule : sm;
        return namesToMatch.includes(smName);
      });
      
      if (submodule) {
        // If it's an object with actions, check if it has 'read' action
        if (typeof submodule === 'object' && submodule.actions && Array.isArray(submodule.actions)) {
          const hasRead = submodule.actions.includes('read');
          if (hasRead) {
            if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (submodule-level read)`);
            return true;
          } else {
            // Submodule exists but doesn't have read - check if module-level read applies
            if (hasModuleLevelRead) {
              if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (module-level read, submodule has no explicit read)`);
              return true;
            } else {
              if (isDev) console.log(`🔒 [${roleName}] ❌ Submodule exists but no read permission (module or submodule)`);
              return false;
            }
          }
        } else if (typeof submodule === 'string') {
          // If it's a string (legacy), check module-level read permission
          if (hasModuleLevelRead) {
            if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (submodule as string, using module-level)`);
            return true;
          } else {
            if (isDev) console.log(`🔒 [${roleName}] ❌ Submodule as string but no module-level read`);
            return false;
          }
        } else {
          // Object without actions array - check module-level
          if (hasModuleLevelRead) {
            if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (submodule object without actions, using module-level)`);
            return true;
          } else {
            if (isDev) console.log(`🔒 [${roleName}] ❌ Submodule object without actions and no module-level read`);
            return false;
          }
        }
      } else {
        // Submodule not found in permissions array
        if (hasModuleLevelRead) {
          if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (module-level read, submodule ${submoduleName} not in permissions)`);
          return true;
        } else {
          // Dynamic fallback: if role has read on any submodule of this module,
          // allow access to sibling routes that belong to the same module.
          const anySubmoduleRead =
            modulePermission.submodules &&
            Array.isArray(modulePermission.submodules) &&
            modulePermission.submodules.some((sm) => {
              if (!sm) return false;
              if (typeof sm === 'string') return true;
              if (typeof sm === 'object') {
                const acts = Array.isArray(sm.actions) ? sm.actions : [];
                return acts.includes('read');
              }
              return false;
            });
          if (anySubmoduleRead) {
            if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (dynamic fallback: any readable submodule in module)`);
            return true;
          }
          if (isDev) console.log(`🔒 [${roleName}] ❌ Submodule ${submoduleName} not found and no readable module/submodule access`);
          return false;
        }
      }
    } else {
      // No submodules array or empty
      if (hasModuleLevelRead) {
        if (isDev) console.log(`🔒 [${roleName}] ✅ Access granted (module-level read, no submodules array)`);
        return true;
      } else {
        if (isDev) console.log(`🔒 [${roleName}] ❌ No submodules array and no module-level read`);
        return false;
      }
    }
  };
  
  // Check multiple roles first (if assigned)
  if (userRoles && Array.isArray(userRoles) && userRoles.length > 0) {
    if (isDev) console.log('🔒 Checking multiple roles:', userRoles.length);
    for (const role of userRoles) {
      if (role.isActive && role.permissions && Array.isArray(role.permissions)) {
        const roleName = role.name || role.displayName || 'role';
        if (checkRolePermissions(role.permissions, path, roleName)) {
          return true;
        }
      }
    }
  }
  
  // Check roleRef permissions (primary role - RBAC system)
  if (userRoleRef && userRoleRef.isActive && userRoleRef.permissions && Array.isArray(userRoleRef.permissions)) {
    const roleName = userRoleRef.name || userRoleRef.displayName || 'roleRef';
    if (isDev) console.log(`🔒 Checking roleRef: ${roleName}`);
    if (checkRolePermissions(userRoleRef.permissions, path, roleName)) {
      return true;
    }
  }
  
  if (isDev) console.log('🔒 No RBAC permissions matched, falling back to legacy checks');
  
  // Check if the path matches any module (legacy role-based check)
  for (const [moduleKey, module] of Object.entries(MODULES)) {
    // Check both main role AND sub-roles (users can have multiple roles/subroles)
    const hasMainRoleAccess = hasPermission(userRole, moduleKey);
    const hasSubRoleAccess = userSubRoles && userSubRoles.length > 0 && 
      userSubRoles.some(subRole => subRole.module === moduleKey);
    
    // If user has access via main role OR sub-role, check path access
    if (hasMainRoleAccess || hasSubRoleAccess) {
      // Special handling for TCM_MANAGER - restrict to specific submodules
      if (userRole === ROLES.TCM_MANAGER && moduleKey === MODULE_KEYS.FINANCE) {
        const allowedPaths = [
          '/finance/taj-utilities-charges',
          '/finance/taj-utilities-charges/dashboard',
          '/finance/taj-utilities-charges/cam-charges',
          '/finance/taj-utilities-charges/water-bills',
          '/finance/taj-utilities-charges/electricity-bills',
          '/finance/taj-utilities-charges/rental-agreements',
          '/finance/taj-utilities-charges/rental-management',
          '/finance/taj-utilities-charges/taj-residents',
          '/finance/taj-utilities-charges/taj-properties',
          '/finance/taj-utilities-charges/charges-slabs',
          '/finance/taj-utilities-charges/invoices',
          '/finance/taj-utilities-charges/open-invoices',
          '/finance/taj-utilities-charges/deposits',
          '/finance/taj-utilities-charges/banks',
          '/finance/taj-utilities-charges/suspense-account'
        ];
        
        // Check if path matches allowed paths or starts with them (for dynamic routes)
        if (allowedPaths.includes(path) || allowedPaths.some(allowedPath => path.startsWith(allowedPath + '/'))) {
          return true;
        }
        return false;
      }
      
      // If user has sub-roles, check specific sub-role permissions for the path
      if (hasSubRoleAccess && userSubRoles && userSubRoles.length > 0) {
        // Check if path matches the module or its sub-items
        if (path === module.path) {
          return true;
        }
        
        if (module.subItems) {
          for (const subItem of module.subItems) {
            if (path === subItem.path) {
              // Get the submodule name from the path
              const submoduleName = getSubmoduleFromPathHelper(path);
              const moduleName = getModuleNameFromPathHelper(path);
              
              // If no specific submodule mapping exists, allow if user has sub-role for this module
              if (!submoduleName) {
                return userSubRoles.some(subRole => subRole.module === moduleName);
              }
              
              // Check if user has sub-role permission for this specific submodule
              const hasSpecificSubRoleAccess = userSubRoles.some(subRole => {
                if (subRole.module === moduleName && subRole.permissions) {
                  return subRole.permissions.some(permission => 
                    permission.submodule === submoduleName
                  );
                }
                return false;
              });
              
              // If sub-role doesn't have specific permission, fall back to main role check
              if (!hasSpecificSubRoleAccess && hasMainRoleAccess) {
                return true;
              }
              
              return hasSpecificSubRoleAccess;
            }
          }
        }
        
        // Check if path starts with module path (for dynamic routes)
        if (path.startsWith(module.path + '/')) {
          return true;
        }
      }
      
      // If user has main role access (or no sub-roles), check main role permissions
      if (hasMainRoleAccess) {
        // Check if path matches the module or its sub-items
        if (path === module.path) return true;
        if (module.subItems) {
          for (const subItem of module.subItems) {
            if (path === subItem.path) return true;
          }
        }
        
        // Check if path starts with module path (for dynamic routes)
        if (path.startsWith(module.path + '/')) return true;
      }
    }
  }
  
  return false;
};

/**
 * Check if user has access to a module via roleRef or roles (RBAC), not legacy user.role.
 * Used by ProtectedRoute when requiredRole lists module-manager roles (e.g. finance_manager).
 */
export const hasModuleAccessViaRoleRef = (user, moduleKey) => {
  if (!user) return false;
  const checkPermissions = (permissions) => {
    if (!permissions || !Array.isArray(permissions)) return false;
    return permissions.some(p => p.module === moduleKey);
  };
  if (user.roleRef && user.roleRef.isActive && checkPermissions(user.roleRef.permissions)) return true;
  if (user.roles && Array.isArray(user.roles)) {
    for (const role of user.roles) {
      if (role.isActive && checkPermissions(role.permissions)) return true;
    }
  }
  return false;
}; 