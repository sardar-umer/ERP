/**
 * Centralized Permissions Configuration
 * Single source of truth for all roles and permissions
 */

// Role Definitions
const ROLES = {
  SUPER_ADMIN: 'super_admin',
  HIGHER_MANAGEMENT: 'higher_management',
  /** Full system access for engineering / Tovus development (same API bypass as super_admin). */
  DEVELOPER: 'developer',
  ADMIN: 'admin',
  HR_MANAGER: 'hr_manager',
  PAYROLL_MANAGER: 'payroll_manager',
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

// Permission Actions
const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  VIEW: 'view',
  MANAGE: 'manage'
};

// Module Definitions
const MODULES = {
  DASHBOARD: 'dashboard',
  HR: 'hr',
  FINANCE: 'finance',
  PROCUREMENT: 'procurement',
  SALES: 'sales',
  CRM: 'crm',
  AUDIT: 'audit',
  IT: 'it',
  TAJ_RESIDENCIA: 'taj_residencia',
  ADMIN: 'admin'
};

// Submodule Definitions for each module
const SUBMODULES = {
  [MODULES.ADMIN]: [
    'user_management',
    'sub_roles',
    'vehicle_management', 
    'house_inventory',
    'utility_bills_management',
    'rental_agreements',
    'rental_management',
    'payment_settlement'
  ],
  [MODULES.HR]: [
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
    'reports'
  ],
  [MODULES.FINANCE]: [
    'finance_dashboard',
    'chart_of_accounts',
    'journal_entries',
    'general_ledger',
    'accounts_receivable',
    'accounts_payable',
    'banking',
    'financial_reports',
    'recovery',
    'recovery_assignments',
    'recovery_members',
    'recovery_task_assignment',
    'recovery_completed_tasks',
    'recovery_campaigns',
    'recovery_my_tasks',
    'taj_utilities_charges',
    'taj_cam_charges',
    'taj_water_bills',
    'taj_electricity_bills',
    'taj_rental_agreements',
    'taj_rental_management',
    'taj_residents',
    'taj_properties',
    'taj_deposits',
    'taj_invoices'
  ],
  [MODULES.PROCUREMENT]: [
    'purchase_orders',
    'vendors',
    'inventory',
    'procurement_reports'
  ],
  [MODULES.SALES]: [
    'sales_orders',
    'customers',
    'products',
    'sales_reports'
  ],
  [MODULES.CRM]: [
    'leads',
    'contacts',
    'campaigns',
    'companies',
    'opportunities',
    'crm_reports',
    'crm_surveys'
  ],
  [MODULES.AUDIT]: [
    'audit_management',
    'audit_findings',
    'corrective_actions',
    'audit_trail',
    'audit_reports',
    'audit_schedules',
    'pre_audit'
  ],
  [MODULES.IT]: [
    'asset_management',
    'software_licenses',
    'network_devices',
    'it_vendors',
    'password_wallet',
    'it_reports'
  ],
  [MODULES.TAJ_RESIDENCIA]: [
    'complains_tickets',
    'land_acquisition',
    'land_acquisition_maps',
    'land_acquisition_moza',
    'land_acquisition_registry',
    'land_acquisition_possession',
    'land_acquisition_parties',
    'land_purchase'
  ],
  general: [
    'document_tracking',
    'indents',
    'centralized_store',
    'user_tracking',
    'ceo_secretariat',
    'president_secretariat'
  ]
};

// Role-based Module Access
const ROLE_MODULE_ACCESS = {
  [ROLES.SUPER_ADMIN]: {
    canAccessAll: true,
    modules: Object.values(MODULES),
    description: 'Full system access'
  },
  
  [ROLES.HIGHER_MANAGEMENT]: {
    canAccessAll: true,
    modules: Object.values(MODULES),
    description: 'Access to all departments and modules'
  },

  [ROLES.DEVELOPER]: {
    canAccessAll: true,
    modules: Object.values(MODULES),
    description: 'Full system access (developer / Tovus)'
  },
  
  [ROLES.ADMIN]: {
    canAccessAll: false,
    modules: [MODULES.ADMIN],
    description: 'Admin module access only'
  },
  
  [ROLES.HR_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.HR, MODULES.ADMIN],
    description: 'HR module management and event management'
  },
  
  // HR General Manager & Payroll Manager have access to HR module
  'Hr General Manager': {
    canAccessAll: false,
    modules: [MODULES.HR],
    description: 'HR module access only'
  },
  'hr_general_manager': {
    canAccessAll: false,
    modules: [MODULES.HR],
    description: 'HR module access only'
  },
  'hr general manager': {
    canAccessAll: false,
    modules: [MODULES.HR],
    description: 'HR module access only'
  },
  'Payroll Manager': {
    canAccessAll: false,
    modules: [MODULES.HR],
    description: 'Payroll & HR module access'
  },
  'payroll_manager': {
    canAccessAll: false,
    modules: [MODULES.HR],
    description: 'Payroll & HR module access'
  },
  [ROLES.PAYROLL_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.HR],
    description: 'Payroll & HR module access'
  },
  'payroll manager': {
    canAccessAll: false,
    modules: [MODULES.HR],
    description: 'Payroll & HR module access'
  },
  
  [ROLES.FINANCE_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.FINANCE],
    description: 'Finance module management'
  },
  
  [ROLES.PROCUREMENT_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.PROCUREMENT],
    description: 'Procurement module management'
  },
  
  [ROLES.SALES_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.CRM, MODULES.SALES],
    description: 'Sales and CRM access'
  },
  
  [ROLES.CRM_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.CRM],
    description: 'CRM module management'
  },
  
  [ROLES.AUDIT_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.AUDIT],
    description: 'Audit module management'
  },
  
  [ROLES.AUDITOR]: {
    canAccessAll: false,
    modules: [MODULES.AUDIT],
    description: 'Audit execution and reporting'
  },
  
  // Audit Director has full access to Audit module
  'Audit Director': {
    canAccessAll: false,
    modules: [MODULES.AUDIT],
    description: 'Full audit module access with all permissions'
  },
  // Also support lowercase/underscore variations
  'audit_director': {
    canAccessAll: false,
    modules: [MODULES.AUDIT],
    description: 'Full audit module access with all permissions'
  },
  'audit director': {
    canAccessAll: false,
    modules: [MODULES.AUDIT],
    description: 'Full audit module access with all permissions'
  },
  
  [ROLES.IT_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.IT],
    description: 'IT module management'
  },
  
  [ROLES.TAJ_RESIDENCIA_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.TAJ_RESIDENCIA],
    description: 'Taj Residencia module management'
  },
  
  [ROLES.APPRAISAL_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.HR, MODULES.ADMIN],
    description: 'Evaluation and Appraisal management with User Management access'
  },
  
  [ROLES.TCM_MANAGER]: {
    canAccessAll: false,
    modules: [MODULES.FINANCE],
    description: 'TCM Manager - Access to Rental Agreements, Taj Residents, and Taj Properties'
  },
  
  [ROLES.EMPLOYEE]: {
    canAccessAll: false,
    modules: [],
    description: 'Basic access'
  }
};

// Specific Permission Mappings
const PERMISSION_MAPPINGS = {
  // HR Module Permissions
  'hr.employee.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.employee.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.employee.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.employee.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'hr.payroll.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.payroll.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.FINANCE_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.payroll.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.payroll.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  
  'hr.attendance.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.attendance.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.attendance.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  
  'hr.leave.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.EMPLOYEE, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.leave.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.leave.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  
  'hr.loan.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.EMPLOYEE, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.loan.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.loan.disburse': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.FINANCE_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.loan.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.loan.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  
  'hr.settlement.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.settlement.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'hr.settlement.process': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.FINANCE_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  // Aliases used by finalSettlements routes
  'settlement_create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'settlement_management': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'settlement_approval': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  'settlement_processing': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.FINANCE_MANAGER, ROLES.PAYROLL_MANAGER, 'Hr General Manager', 'hr_general_manager', 'hr general manager', 'Payroll Manager', 'payroll_manager', 'payroll manager'],
  
  // Finance Module Permissions
  'finance.invoice.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE_MANAGER],
  'finance.invoice.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE_MANAGER],
  'finance.invoice.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE_MANAGER],
  'finance.invoice.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE_MANAGER],
  
  'finance.payment.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE_MANAGER],
  'finance.payment.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE_MANAGER],
  'finance.payment.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE_MANAGER],
  
  // Procurement Module Permissions
  'procurement.purchase.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROCUREMENT_MANAGER],
  'procurement.purchase.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROCUREMENT_MANAGER],
  'procurement.purchase.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROCUREMENT_MANAGER],
  
  'procurement.supplier.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROCUREMENT_MANAGER],
  'procurement.supplier.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROCUREMENT_MANAGER],
  'procurement.supplier.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROCUREMENT_MANAGER],
  
  // CRM Module Permissions
  'crm.lead.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CRM_MANAGER, ROLES.SALES_MANAGER],
  'crm.lead.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CRM_MANAGER, ROLES.SALES_MANAGER],
  'crm.lead.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CRM_MANAGER, ROLES.SALES_MANAGER],
  
  'crm.customer.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CRM_MANAGER, ROLES.SALES_MANAGER],
  'crm.customer.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CRM_MANAGER, ROLES.SALES_MANAGER],
  'crm.customer.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CRM_MANAGER, ROLES.SALES_MANAGER],
  
  // IT Module Permissions
  'it.assets.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.assets.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.assets.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.assets.assign': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.assets.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'it.software.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.software.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.software.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.software.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'it.network.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.network.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.network.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.network.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'it.vendors.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.vendors.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.vendors.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.vendors.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'it.passwords.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.passwords.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.passwords.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.IT_MANAGER],
  'it.passwords.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  // Admin Module Permissions
  'admin.users.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.APPRAISAL_MANAGER],
  'admin.users.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.APPRAISAL_MANAGER],
  'admin.users.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.APPRAISAL_MANAGER],
  'admin.users.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.sub_roles.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.sub_roles.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.sub_roles.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.sub_roles.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.vehicles.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.vehicles.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.vehicles.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.vehicles.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  // Vehicle maintenance permissions (aliases for vehicle routes)
  'vehicle_create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.EMPLOYEE],
  'vehicle_update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'vehicle_delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.house_inventory.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.house_inventory.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.house_inventory.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.house_inventory.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.suppliers.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.suppliers.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.suppliers.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.suppliers.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'supplier_create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PROCUREMENT_MANAGER, 'general', 'centralized_store'],
  'supplier_read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PROCUREMENT_MANAGER, 'general', 'centralized_store'],
  'supplier_update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER, ROLES.PROCUREMENT_MANAGER, 'general', 'centralized_store'],
  'supplier_delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  
  'admin.locations.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.locations.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.locations.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.locations.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.utility.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.utility.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.utility.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.utility.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.rental.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.rental_agreement.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental_agreement.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental_agreement.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental_agreement.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.rental_management.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental_management.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental_management.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.rental_management.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  
  'admin.payment_settlement.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.payment_settlement.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.payment_settlement.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'admin.payment_settlement.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  'admin.payment_settlement.approve': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],

  // Audit Module Permissions
  'audit.schedule.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, 'Audit Director', 'audit_director'],
  'audit.schedule.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, ROLES.AUDITOR, 'Audit Director', 'audit_director'],
  'audit.schedule.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, 'Audit Director', 'audit_director'],
  'audit.schedule.delete': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, 'Audit Director', 'audit_director'],
  
  'audit.findings.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, ROLES.AUDITOR, 'Audit Director', 'audit_director'],
  'audit.findings.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, ROLES.AUDITOR, 'Audit Director', 'audit_director'],
  'audit.findings.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, ROLES.AUDITOR, 'Audit Director', 'audit_director'],
  
  'audit.reports.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, ROLES.AUDITOR, 'Audit Director', 'audit_director'],
  'audit.reports.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, ROLES.AUDITOR, 'Audit Director', 'audit_director'],
  
  'audit.corrective_actions.create': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, 'Audit Director', 'audit_director'],
  'audit.corrective_actions.read': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, ROLES.AUDITOR, 'Audit Director', 'audit_director'],
  'audit.corrective_actions.update': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AUDIT_MANAGER, 'Audit Director', 'audit_director'],
  
  // Talent Acquisition Permissions
  'hr.talent_acquisition': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'hr.job_postings': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'hr.candidates': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER],
  'hr.applications': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR_MANAGER]
};

const hasPermission = (userRole, permission) => {
  if (!userRole) return false;
  const normalized = String(userRole).toLowerCase().replace(/\s+/g, '_');
  
  // Super admin, higher management, and developer have all permissions
  if (
    normalized === ROLES.SUPER_ADMIN ||
    normalized === ROLES.HIGHER_MANAGEMENT ||
    normalized === ROLES.DEVELOPER
  ) {
    return true;
  }
  
  const allowedRoles = PERMISSION_MAPPINGS[permission];
  if (!allowedRoles) return false;

  return allowedRoles.some((role) => {
    if (!role) return false;
    const normAllowed = String(role).toLowerCase().replace(/\s+/g, '_');
    return normAllowed === normalized || role === userRole;
  });
};

const hasModuleAccess = (userRole, module) => {
  const roleAccess = ROLE_MODULE_ACCESS[userRole];
  if (!roleAccess) return false;
  
  if (roleAccess.canAccessAll) return true;
  return roleAccess.modules.includes(module);
};

// New function to check module access with Role object
const hasModuleAccessWithRole = (roleObj, module) => {
  if (!roleObj) return false;
  
  // If it's a Role object with permissions
  if (roleObj.permissions && Array.isArray(roleObj.permissions)) {
    return roleObj.permissions.some(permission => permission.module === module);
  }
  
  // Fallback to string role
  return hasModuleAccess(roleObj.name || roleObj, module);
};

const getUserPermissions = (userRole) => {
  const roleAccess = ROLE_MODULE_ACCESS[userRole];
  if (!roleAccess) return [];
  
  if (roleAccess.canAccessAll) {
    return Object.keys(PERMISSION_MAPPINGS);
  }
  
  return Object.keys(PERMISSION_MAPPINGS).filter(permission => {
    const allowedRoles = PERMISSION_MAPPINGS[permission];
    return allowedRoles ? allowedRoles.includes(userRole) : false;
  });
};

// Export all role values for validation
const ROLE_VALUES = Object.values(ROLES);

// Export all module values for validation
const MODULE_VALUES = Object.values(MODULES);

// Export all action values for validation
const ACTION_VALUES = Object.values(ACTIONS);

// Sub-role Helper Functions
const getUserSubRoles = async (userId) => {
  const UserSubRole = require('../models/UserSubRole');
  return await UserSubRole.findActiveByUser(userId);
};

const hasSubRolePermission = async (userId, module, submodule, action) => {
  const UserSubRole = require('../models/UserSubRole');
  
  // Get user's active sub-role assignments
  const userSubRoles = await UserSubRole.findActiveByUser(userId);
  
  if (!userSubRoles || userSubRoles.length === 0) return false;
  
  // Check if user has the specific permission in their sub-roles
  for (const userSubRole of userSubRoles) {
    const subRole = userSubRole.subRole;
    if (subRole && subRole.module === module && subRole.hasPermission(submodule, action)) {
      return true;
    }
  }
  
  return false;
};

const getUserAllowedSubmodules = async (userId, module) => {
  const User = require('../models/User');
  const UserSubRole = require('../models/UserSubRole');
  
  const user = await User.findById(userId);
  if (!user) return [];
  
  // Super admin, higher management, and developer have access to everything
  if (
    user.role === ROLES.SUPER_ADMIN ||
    user.role === ROLES.HIGHER_MANAGEMENT ||
    user.role === ROLES.DEVELOPER
  ) {
    return SUBMODULES[module] || [];
  }
  
  // Get user's active sub-role assignments
  const userSubRoles = await UserSubRole.findActiveByUser(userId);
  
  // If user has sub-roles, return only the submodules they have permissions for
  if (userSubRoles && userSubRoles.length > 0) {
    const allowedSubmodules = new Set();
    
    for (const userSubRole of userSubRoles) {
      const subRole = userSubRole.subRole;
      if (subRole && subRole.module === module) {
        subRole.getAllowedSubmodules().forEach(submodule => {
          allowedSubmodules.add(submodule);
        });
      }
    }

    const userDept = typeof user.department === 'string'
      ? user.department
      : (user.department?.name || user.department?.dept_name || '');
    const isFinanceDept = /finance/i.test(userDept) ||
                          user.role === ROLES.FINANCE_MANAGER ||
                          /finance/i.test(String(user.role));

    if (isFinanceDept) {
      if (module === MODULES.ADMIN) allowedSubmodules.add('utility_bills_management');
      if (module === 'general') allowedSubmodules.add('centralized_store');
    }

    // General Indent access also unlocks Centralized Store bills under General
    if (module === 'general' && allowedSubmodules.has('indents')) {
      allowedSubmodules.add('centralized_store');
    }
    
    return Array.from(allowedSubmodules);
  }
  
  // If user has NO sub-roles, return all submodules for their main role
  if (hasModuleAccess(user.role, module)) {
    const allSubmodules = SUBMODULES[module] || [];
    
    // Special handling for TCM_MANAGER - restrict to specific submodules
    if (user.role === ROLES.TCM_MANAGER && module === MODULES.FINANCE) {
      return allSubmodules.filter(submodule => 
        submodule === 'taj_utilities_charges' ||
        submodule === 'taj_cam_charges' ||
        submodule === 'taj_water_bills' ||
        submodule === 'taj_electricity_bills' ||
        submodule === 'taj_rental_agreements' || 
        submodule === 'taj_rental_management' ||
        submodule === 'taj_residents' || 
        submodule === 'taj_properties' ||
        submodule === 'taj_invoices' ||
        submodule === 'taj_deposits'
      );
    }
    
    return allSubmodules;
  }
  
  return [];
};

const submoduleMatches = (sm, submodule) => {
  if (typeof sm === 'string') return sm === submodule;
  if (sm && typeof sm === 'object') return sm.submodule === submodule;
  return false;
};

const modulePermissionAllowsAction = (modulePermission, submodule, action) => {
  if (!modulePermission) return false;
  if (submodule && modulePermission.submodules && modulePermission.submodules.length > 0) {
    const candidates = [submodule];
    // General Indent role covers Centralized Store bill workflows
    if (modulePermission.module === 'general' && submodule === 'centralized_store') {
      candidates.push('indents');
    }
    for (const candidate of candidates) {
      const submoduleEntry = modulePermission.submodules.find((sm) => submoduleMatches(sm, candidate));
      if (!submoduleEntry) continue;
      if (typeof submoduleEntry === 'object' && Array.isArray(submoduleEntry.actions)) {
        if (submoduleEntry.actions.includes(action)) return true;
      }
      if (typeof submoduleEntry === 'string' && Array.isArray(modulePermission.actions) && modulePermission.actions.includes(action)) {
        return true;
      }
    }
    return false;
  }
  return Array.isArray(modulePermission.actions) && modulePermission.actions.includes(action);
};

const checkSubRoleAccess = async (userId, module, submodule, action) => {
  const User = require('../models/User');
  const UserSubRole = require('../models/UserSubRole');
  const Role = require('../models/Role');
  
  const user = await User.findById(userId).populate('roleRef').populate('roles');
  if (!user) return false;
  
  // Super admin, higher management, and developer have access to everything
  if (
    user.role === ROLES.SUPER_ADMIN ||
    user.role === ROLES.HIGHER_MANAGEMENT ||
    user.role === ROLES.DEVELOPER
  ) {
    return true;
  }
  
  // Grant access for Centralized Store & Utility Bills Management if user belongs to Finance department or has Finance role
  const userDept = typeof user.department === 'string'
    ? user.department
    : (user.department?.name || user.department?.dept_name || '');
  const isFinanceDept = /finance/i.test(userDept) ||
                        user.role === ROLES.FINANCE_MANAGER ||
                        /finance/i.test(String(user.role));

  if (isFinanceDept) {
    if (
      (module === MODULES.ADMIN && submodule === 'utility_bills_management') ||
      (module === 'general' && submodule === 'centralized_store') ||
      submodule === 'centralized_store' ||
      submodule === 'utility_bills_management'
    ) {
      return true;
    }
  }
  
  // NEW: Check multiple roles first (if assigned)
  if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
    for (const roleRef of user.roles) {
      const role = await Role.findById(roleRef._id || roleRef);
      if (role && role.isActive) {
        const modulePermission = role.permissions.find(p => p.module === module);
        if (modulePermissionAllowsAction(modulePermission, submodule, action)) {
          return true;
        }
      }
    }
  }
  
  // NEW: Check roleRef permissions (primary role - RBAC system)
  if (user.roleRef && user.roleRef.isActive) {
    const role = await Role.findById(user.roleRef._id || user.roleRef);
    if (role && role.isActive) {
      const modulePermission = role.permissions.find(p => p.module === module);
      if (modulePermissionAllowsAction(modulePermission, submodule, action)) {
        return true;
      }
    }
  }
  
  // Get user's active sub-role assignments (legacy system)
  const userSubRoles = await UserSubRole.findActiveByUser(userId);
  
  // If user has sub-roles, check specific sub-role permissions
  if (userSubRoles && userSubRoles.length > 0) {
    const direct = await hasSubRolePermission(userId, module, submodule, action);
    if (direct) return true;
    if (module === 'general' && submodule === 'centralized_store') {
      return await hasSubRolePermission(userId, 'general', 'indents', action);
    }
    return false;
  }
  
  // If user has NO sub-roles, check if they have module access
  if (hasModuleAccess(user.role, module)) {
    // Special handling for TCM_MANAGER - restrict to specific submodules
    if (user.role === ROLES.TCM_MANAGER && module === MODULES.FINANCE) {
      const allowedSubmodules = [
        'taj_utilities_charges',
        'taj_cam_charges',
        'taj_water_bills',
        'taj_electricity_bills',
        'taj_rental_agreements',
        'taj_rental_management',
        'taj_residents',
        'taj_properties',
        'taj_invoices',
        'taj_deposits'
      ];
      return allowedSubmodules.includes(submodule);
    }
    
    // Check specific permission mapping (e.g., 'admin.payment_settlement.read')
    const permissionKey = `${module}.${submodule}.${action}`;
    if (PERMISSION_MAPPINGS[permissionKey]) {
      return PERMISSION_MAPPINGS[permissionKey].includes(user.role);
    }
    
    // If no specific permission mapping exists, allow access if user has module access
    return true;
  }
  
  return false;
};

module.exports = {
  ROLES,
  ACTIONS,
  MODULES,
  SUBMODULES,
  ROLE_MODULE_ACCESS,
  PERMISSION_MAPPINGS,
  hasPermission,
  hasModuleAccess,
  hasModuleAccessWithRole,
  getUserPermissions,
  getUserSubRoles,
  hasSubRolePermission,
  getUserAllowedSubmodules,
  checkSubRoleAccess,
  ROLE_VALUES,
  MODULE_VALUES,
  ACTION_VALUES
};
