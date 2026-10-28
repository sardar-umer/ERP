import React, { useState, useEffect, useCallback } from 'react';
import ChatService from '../../services/chatService';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
  Avatar,
  Collapse,
  useTheme,
  useMediaQuery,
  Badge,
  alpha,
  Tooltip,
  Snackbar,
  Alert,
  IconButton,
  TextField,
  InputAdornment
} from '@mui/material';
import {
  Dashboard,
  People,
  AccountBalance,
  ShoppingCart,
  PointOfSale,
  ContactSupport,
  ExpandLess,
  ExpandMore,
  Person,
  Settings,
  Logout,
  AdminPanelSettings,
  Analytics,
  Security,
  Computer,
  LocationCity,
  Description,
  Folder,
  QrCode2 as QrCodeIcon,
  Chat as ChatIcon,
  DeveloperMode as DeveloperModeIcon,
  MenuOpen as MenuOpenIcon,
  Search as SearchIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getModuleMenuItems, MODULES } from '../../utils/permissions';
import NotificationService from '../../services/notificationService';
import { useNotifications } from '../../contexts/NotificationContext';
import { getImageUrl, handleImageError } from '../../utils/imageService';
import { fetchTeamKpiWorksheets } from '../../services/kpiWorksheetService';
import { useSidebar } from '../../contexts/SidebarContext';

const drawerWidth = 280;

// Dynamic menu items based on user permissions
const getMenuItems = (userRole) => {
  return getModuleMenuItems(userRole).map(module => ({
    text: module.text,
    icon: getIconComponent(module.icon),
    path: module.path,
    subItems: module.subItems
  }));
};

// Icon mapping function
const getIconComponent = (iconName) => {
const iconMap = {
  Dashboard: <Dashboard />,
  People: <People />,
  AccountBalance: <AccountBalance />,
  ShoppingCart: <ShoppingCart />,
  PointOfSale: <PointOfSale />,
  ContactSupport: <ContactSupport />,
  AdminPanelSettings: <AdminPanelSettings />,
  Analytics: <Analytics />,
  Security: <Security />,
  Computer: <Computer />,
  LocationCity: <LocationCity />,
  Description: <Description />,
  Folder: <Folder />,
  QrCode: <QrCodeIcon />,
  DeveloperMode: <DeveloperModeIcon />
};
  return iconMap[iconName] || <Dashboard />;
};

/** Keep modules/groups whose label matches, or that contain a matching page/submodule. */
const filterMenuBySearch = (items, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items || [];

  const walk = (node) => {
    const selfMatch = String(node.text || '').toLowerCase().includes(q);
    const childResults = (node.subItems || []).map(walk).filter(Boolean);

    if (selfMatch) {
      // Module/group name matches — keep full subtree
      return { ...node };
    }
    if (childResults.length) {
      return { ...node, subItems: childResults };
    }
    return null;
  };

  return (items || []).map(walk).filter(Boolean);
};



const Sidebar = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { getModuleCount, markModuleAsRead } = useNotifications();
  const { sidebarOpen, setSidebarOpen } = useSidebar();

  useEffect(() => {
    let cancelled = false;
    const loadChatUnread = () => {
      ChatService.getUnreadSummary()
        .then((n) => {
          if (!cancelled) setChatUnread(typeof n === 'number' ? n : 0);
        })
        .catch(() => {
          if (!cancelled) setChatUnread(0);
        });
    };
    loadChatUnread();
    const interval = setInterval(loadChatUnread, 120000);
    const onChatRead = () => loadChatUnread();
    window.addEventListener('sgc:chat-unread-changed', onChatRead);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('sgc:chat-unread-changed', onChatRead);
    };
  }, [location.pathname]);
  const [openSubmenu, setOpenSubmenu] = useState({});
  const [menuSearch, setMenuSearch] = useState('');
  const [candidateHiredCount, setCandidateHiredCount] = useState(0);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [lastClearedCount, setLastClearedCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [pendingKpiReviews, setPendingKpiReviews] = useState(0);

  // Helper function to get allowed submodules from sub-role
  const getAllowedSubmodules = (subRole) => {
    if (!subRole.permissions) return [];
    return subRole.permissions.map(permission => permission.submodule);
  };

  // Helper function to map menu item paths to submodule names
  const getSubmoduleFromPath = (path) => {
    const pathToSubmoduleMap = {
      // Admin Module
      '/admin/dashboard': 'payment_settlement', // Dashboard uses payment_settlement permission
      '/admin/users': 'user_management',
      '/admin/users/online': 'user_management',
      '/admin/users/mobile-approvals': 'user_management',
      '/admin/sub-roles': 'sub_roles',
      '/admin/roles': 'sub_roles', // Role management uses same permission as sub-roles
      '/admin/vehicle-management': 'vehicle_management',
      '/admin/centralized-store': 'utility_bills_management',
      '/admin/centralized-store/bills': 'utility_bills_management',
      '/admin/centralized-store/bill/new': 'utility_bills_management',
      '/admin/centralized-store/bill': 'utility_bills_management',
      '/admin/rental-agreements': 'rental_agreements',
      '/admin/rental-management': 'rental_management',
      
      // HR Module
      '/hr/employees': 'employee_management',
      '/hr/companies': 'employee_management',
      '/hr/projects': 'employee_management',
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
      '/hr/evaluation-appraisal/dashboard': 'evaluation_appraisal',
      '/hr/evaluation-appraisal/documents': 'evaluation_appraisal',
      '/hr/evaluation-appraisal/authorities': 'evaluation_appraisal',
      '/hr/kpi/sheet': 'kpi_management',
      '/hr/kpi/dashboard': 'kpi_management',
      '/hr/kpi/templates': 'kpi_management',
      '/hr/kpi/cycles': 'kpi_management',
      '/hr/kpi/review': 'kpi_management',
      '/hr/kpi/submissions': 'kpi_management',
      '/hr/kpi/reports': 'kpi_management',
      '/hr/non-employee-onboarding': 'non_employee_onboarding',
      '/hr/reports': 'reports',
      
      // General Module - Documents Tracking
      '/documents-tracking': 'document_tracking',
      '/general/indents': 'indents',
      '/general/indents/dashboard': 'indents',
      '/general/indents/create': 'indents',
      '/general/cost-centers': 'indents',
      '/general/cash-approvals': 'general_cash_approvals',
      '/general/cash-approvals/create': 'general_cash_approvals',
      '/general/centralized-store': 'centralized_store',
      '/general/centralized-store/bills': 'centralized_store',
      '/general/centralized-store/bill/new': 'centralized_store',
      '/general/centralized-store/bill': 'centralized_store',
      '/general/project-management': 'project_management',
      '/general/project-management/overview': 'project_management',
      '/general/project-management/projects': 'project_management',
      '/general/project-management/workspace': 'project_management',
      '/general/project-management/approvals': 'project_management',
      '/general/project-management/subcontractor-statement': 'project_management',
      '/general/project-management/wbs-activities': 'project_management',
      '/general/project-management/slabs': 'project_management',
      '/general/subcontractors': 'project_management',
      '/general/ceo-secretariat': 'ceo_secretariat',
      '/general/ceo-secretariat/payments': 'ceo_secretariat',
      '/general/president-secretariat': 'president_secretariat',
      '/general/president-secretariat/dashboard': 'president_secretariat',
      '/general/president-secretariat/meetings': 'president_secretariat',
      '/general/president-secretariat/events': 'president_secretariat',

      '/asset-tagging': 'asset_tagging_dashboard',
      '/asset-tagging/register': 'asset_tagging_assets',
      '/asset-tagging/assets': 'asset_tagging_assets',
      '/asset-tagging/verification': 'asset_tagging_verification',
      '/asset-tagging/events': 'asset_tagging_events',
      
      // Finance Module
      '/finance': 'finance_dashboard',
      '/finance/accounts': 'chart_of_accounts',
      '/finance/cost-centers': 'chart_of_accounts',
      '/finance/journal-entries': 'journal_entries',
      '/finance/journals': 'finance_journals',
      '/finance/fiscal-periods': 'fiscal_periods',
      '/finance/inventory-categories': 'inventory_categories',
      '/finance/inventory-valuation': 'inventory_valuation',
      '/finance/general-ledger': 'general_ledger',
      '/finance/accounts-receivable': 'accounts_receivable',
      '/finance/accounts-receivable/new': 'accounts_receivable',
      '/finance/customers': 'customers',
      '/finance/vendors': 'accounts_payable',
      '/finance/accounts-payable': 'accounts_payable',
      '/finance/accounts-payable/new': 'accounts_payable',
      '/finance/accounts-payable/bill': 'accounts_payable',
      '/finance/vendor-advance': 'accounts_payable',
      '/finance/cash-approvals': 'accounts_payable',
      '/finance/banking': 'banking',
      '/finance/taxes': 'tax_management',
      '/finance/fixed-assets': 'fixed_assets',
      '/finance/bank-reconciliation': 'bank_reconciliation',
      '/finance/vendor-statement': 'vendor_statement',
      '/finance/budget-vs-actual': 'budget_vs_actual',
      '/finance/aged-payables': 'aged_payables',
      '/finance/payment-terms': 'payment_terms',
      '/finance/aged-receivables': 'aged_receivables',
      '/finance/customer-statement': 'customer_statement',
      '/finance/customer-payments': 'customer_payments',
      '/finance/credit-notes': 'credit_notes',
      '/finance/vendor-payments': 'vendor_payments',
      '/finance/vendor-refunds': 'vendor_refunds',
      '/finance/bill-to-receive': 'bill_to_receive',
      '/finance/billed-not-received': 'billed_not_received',
      '/finance/balance-sheet': 'financial_statements',
      '/finance/profit-loss': 'financial_statements',
      '/finance/cash-flow': 'financial_statements',
      '/finance/trial-balance': 'financial_statements',
      '/finance/tax-summary': 'tax_summary',
      '/finance/opening-balances': 'opening_balances',
      '/finance/year-end-closing': 'year_end_closing',
      '/finance/recurring-journals': 'recurring_journals',
      '/finance/payables-hub':           'accounts_payable',
      '/finance/batch-payment':           'batch_payment',
      '/finance/company-profile':         'company_profile',
      '/finance/companies':               'finance_companies',
      '/finance/comparative-pl':          'comparative_pl',
      '/finance/cost-center-pl':          'cost_center_pl',
      '/finance/budgets':                 'budgets',
      '/finance/deferred-entries':        'deferred_entries',
      '/finance/bank-statement-import':   'bank_statement_import',
      '/finance/vouchers':                'vouchers',
      '/finance/setup':                   'finance_setup',
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
      '/finance/taj-utilities-charges/deposits': 'taj_deposits',
      '/finance/taj-utilities-charges/banks': 'taj_deposits',
      '/finance/taj-utilities-charges/suspense-account': 'taj_suspense_account',
      '/finance/taj-utilities-charges/reports': 'taj_utilities_reports',
      '/finance/recovery': 'recovery',
      '/finance/recovery/recovery-assignments': 'recovery_assignments',
      '/finance/recovery/recovery-members': 'recovery_members',
      '/finance/recovery/task-assignment': 'recovery_task_assignment',
      '/finance/recovery/completed-tasks': 'recovery_completed_tasks',
      '/finance/recovery/campaigns': 'recovery_campaigns',
      '/finance/recovery/my-tasks': 'recovery_my_tasks',
      '/finance/reports': 'financial_reports',
      '/finance/legacy': 'legacy',
      
      // Procurement Module (must match permissions.js / Role Permission Matrix submodule keys)
      '/procurement': null, // dashboard - no submodule, allow if module allowed
      '/procurement/requisitions': 'procurement_requisitions',
      '/procurement/quotations': 'quotations',
      '/procurement/comparative-statements': 'comparative_statements',
      '/procurement/purchase-orders': 'purchase_orders',
      '/procurement/vendors': 'vendors',
      '/procurement/subcontractors': 'vendors',
      '/procurement/vendor-bills': 'purchase_orders',
      '/procurement/vendor-bills/new': 'purchase_orders',
      '/procurement/vendor-bills/bill': 'purchase_orders',
      '/procurement/store': 'store',
      '/procurement/store/quality-assurance': 'goods_receive',
      '/procurement/store/inventory': 'inventory',
      '/procurement/store/goods-receive': 'goods_receive',
      '/procurement/store/delivery-challans': 'goods_receive',
      '/procurement/store/delivery-challan-qa': 'quality_assurance',
      '/procurement/store/goods-issue': 'goods_issue',
      '/procurement/store/store-returns': 'goods_issue',
      '/procurement/store/stock-transfers': 'inventory',
      '/procurement/store/stock-reports': 'inventory',
      '/procurement/store/stock-check': 'inventory',
      '/procurement/store/cost-center': 'cost_center',
      '/procurement/store/manage': 'store_management',
      '/procurement/store/item-catalog': 'inventory',
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
      '/taj-residencia/land-transfers': 'land_transfer',
      '/taj-residencia/land-acquisition/dashboard': 'land_acquisition_reports',
      '/taj-residencia/land-acquisition/reports': 'land_acquisition_reports',

      // Developer Module
      '/developer/server-monitor': 'server_monitor',
      '/developer/financials': 'developer_financials'
    };
    return pathToSubmoduleMap[path];
  };

  // Helper function to get module name from path
  const getModuleNameFromPath = (path) => {
    if (!path) return '';
    if (path.startsWith('/asset-tagging')) return 'asset_tagging';
    const parts = path.split('/').filter(p => p);
    if (parts.length === 0) return '';
    
    // Map common paths to module names
    const pathToModuleMap = {
      '/dashboard': 'dashboard',
      '/hr': 'hr',
      '/finance': 'finance',
      '/procurement': 'procurement',
      '/sales': 'sales',
      '/crm': 'crm',
      '/audit': 'audit',
      '/it': 'it',
      '/taj-residencia': 'taj_residencia',
      '/admin': 'admin',
      '/documents-tracking': 'general',
      '/indents': 'general',
      '/user-tracking': 'general',
      '/ceo-secretariat': 'general',
      '/president-secretariat': 'general',
      '/developer': 'developer_module'
    };
    
    return pathToModuleMap[path] || parts[0];
  };

  // Helper function to check if user has permission for a submodule
  const hasSubmodulePermission = useCallback((rolePermissions, moduleName, submoduleName) => {
    if (!rolePermissions || !Array.isArray(rolePermissions)) return false;
    
    const modulePermission = rolePermissions.find(p => p.module === moduleName);
    if (!modulePermission) return false;

    const namesToMatch =
      moduleName === 'general' && submoduleName === 'centralized_store'
        ? ['centralized_store', 'indents']
        : [submoduleName];
    
    // Check if submodule has permissions (actions array)
    if (modulePermission.submodules && Array.isArray(modulePermission.submodules)) {
      const submodule = modulePermission.submodules.find(sm => {
        const smName = typeof sm === 'object' ? sm.submodule : sm;
        return namesToMatch.includes(smName);
      });
      
      if (submodule) {
        // If it's an object with actions, check if it has 'read' action
        if (typeof submodule === 'object' && submodule.actions) {
          return Array.isArray(submodule.actions) && submodule.actions.includes('read');
        }
        // If it's a string, check module-level actions
        if (modulePermission.actions && Array.isArray(modulePermission.actions)) {
          return modulePermission.actions.includes('read');
        }
      }
    }
    
    // Fallback: check module-level actions
    if (modulePermission.actions && Array.isArray(modulePermission.actions)) {
      return modulePermission.actions.includes('read');
    }
    
    return false;
  }, []);

  // Helper function to build menu items from MODULES object
  const buildMenuItemsFromModules = useCallback((moduleKeys) => {
    if (!moduleKeys || moduleKeys.length === 0) return [];
    
    return moduleKeys.map(moduleKey => {
      const module = MODULES[moduleKey];
      if (!module) return null;
      
      return {
        text: module.name,
        icon: getIconComponent(module.icon),
        path: module.path,
        subItems: module.subItems ? module.subItems.map(subItem => ({
          text: subItem.name,
          path: subItem.path,
          subItems: subItem.subItems ? subItem.subItems.map(subSubItem => ({
            text: subSubItem.name,
            path: subSubItem.path
          })) : undefined
        })) : undefined
      };
    }).filter(item => item !== null);
  }, []);

  // Filter menu items based on user's roleRef (RBAC) or sub-roles
  const getFilteredMenuItems = useCallback((userRole) => {
    const generateItems = () => {
      // Get ALL menu items first (use a role that has access to all modules)
      // We'll filter based on actual permissions, not the legacy role field
      let baseMenuItems = getMenuItems('super_admin') || [];

      // Super admin, higher management, and developer: full menu
      if (['super_admin', 'higher_management', 'developer'].includes(userRole)) {
        return baseMenuItems;
      }
    
    // If that doesn't work, build from MODULES directly
    if (baseMenuItems.length === 0) {
      const allModuleKeys = Object.keys(MODULES);
      baseMenuItems = buildMenuItemsFromModules(allModuleKeys);
    }
    
    // Debug logging (dev mode only)
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      console.log('🔍 Sidebar Filter Debug:', {
        user: user ? { id: user._id || user.id, email: user.email } : null,
        userRole: userRole,
        hasRoles: user?.roles && Array.isArray(user.roles) && user.roles.length > 0,
        hasRoleRef: !!user?.roleRef,
        roleRefName: user?.roleRef?.name || user?.roleRef?.displayName,
        hasSubRoles: user?.subRoles && user.subRoles.length > 0,
        baseMenuItemsCount: baseMenuItems.length
      });
    }
    
    // NEW: Check multiple roles first (if assigned)
    if (user?.roles && Array.isArray(user.roles) && user.roles.length > 0) {
      // Collect all permissions from all roles
      const allPermissions = [];
      user.roles.forEach(role => {
        if (role.isActive && role.permissions && Array.isArray(role.permissions)) {
          allPermissions.push(...role.permissions);
        }
      });
      
      if (isDev) {
        console.log('📋 Multiple Roles Permissions:', {
          rolesCount: user.roles.length,
          permissionsCount: allPermissions.length,
          permissions: allPermissions.map(p => ({ module: p.module, hasActions: !!p.actions, hasSubmodules: !!p.submodules }))
        });
      }
      
      // Get modules with read permission
      const allowedModules = new Set();
      allPermissions.forEach(p => {
        // Check module-level read permission
        if (p.actions && Array.isArray(p.actions) && p.actions.includes('read')) {
          allowedModules.add(p.module);
        }
        // Check submodule-level read permissions
        if (p.submodules && Array.isArray(p.submodules)) {
          p.submodules.forEach(sm => {
            if (typeof sm === 'object' && sm.actions && Array.isArray(sm.actions) && sm.actions.includes('read')) {
              allowedModules.add(p.module);
            }
          });
        }
      });
      
      if (isDev) console.log('✅ Allowed Modules from Roles:', Array.from(allowedModules));
      
      // Filter modules and their submenu items
      const filtered = baseMenuItems.map(module => {
        const moduleName = getModuleNameFromPath(module.path);
        const isAllowed = allowedModules.has(moduleName);
        
        if (isDev) console.log(`  Module: ${module.text} (${module.path}) -> ${moduleName} - ${isAllowed ? 'ALLOWED' : 'FILTERED'}`);
        
        if (!isAllowed) {
          return null;
        }
        
        // Filter submenu items (including nested) based on submodule permissions
        if (module.subItems) {
          const filterSubItems = (items, checkPermission) => {
            return items
              .map(subItem => {
                const submoduleName = getSubmoduleFromPath(subItem.path);
                if (!submoduleName) return { ...subItem, keep: true };
                const hasPermission = checkPermission(submoduleName);
                const nestedFiltered = subItem.subItems
                  ? filterSubItems(subItem.subItems, checkPermission)
                  : undefined;
                const hasNestedWithPermission = nestedFiltered && nestedFiltered.length > 0;
                return {
                  ...subItem,
                  keep: hasPermission || hasNestedWithPermission,
                  subItems: nestedFiltered
                };
              })
              .filter(s => s.keep)
              .map(({ keep, subItems, ...rest }) => ({ ...rest, subItems: subItems?.length ? subItems : undefined }));
          };
          const checkPermission = (submoduleName) =>
            user.roles.some(role => {
              if (!role.isActive || !role.permissions) return false;
              return hasSubmodulePermission(role.permissions, moduleName, submoduleName);
            });
          const filteredSubItems = filterSubItems(module.subItems, checkPermission);
          return {
            ...module,
            subItems: filteredSubItems
          };
        }
        
        return module;
      }).filter(module => module !== null && (!module.subItems || module.subItems.length > 0));
      
      if (isDev) console.log('📊 Filtered Menu Items Count:', filtered.length);
      
      // If no modules matched, fall back to base menu items
      if (filtered.length === 0) {
        if (isDev) console.warn('⚠️ No modules matched role permissions, falling back to base menu items');
        return baseMenuItems;
      }
      
      return filtered;
    }
    
    // NEW: Check roleRef permissions (primary role - RBAC system)
    if (user?.roleRef && user.roleRef.isActive && user.roleRef.permissions) {
      const rolePermissions = user.roleRef.permissions;
      
      if (isDev) {
        console.log('📋 RoleRef Permissions:', {
          roleName: user.roleRef.name || user.roleRef.displayName,
          permissionsCount: rolePermissions.length,
          permissions: rolePermissions.map(p => ({ module: p.module, hasActions: !!p.actions, hasSubmodules: !!p.submodules }))
        });
      }
      
      // Get modules with read permission
      const allowedModules = new Set();
      rolePermissions.forEach(p => {
        // Check module-level read permission
        if (p.actions && Array.isArray(p.actions) && p.actions.includes('read')) {
          allowedModules.add(p.module);
        }
        // Check submodule-level read permissions
        if (p.submodules && Array.isArray(p.submodules)) {
          p.submodules.forEach(sm => {
            if (typeof sm === 'object' && sm.actions && Array.isArray(sm.actions) && sm.actions.includes('read')) {
              allowedModules.add(p.module);
            }
          });
        }
      });
      
      if (isDev) console.log('✅ Allowed Modules from RoleRef:', Array.from(allowedModules));
      
      // Filter modules and their submenu items
      const filtered = baseMenuItems.map(module => {
        const moduleName = getModuleNameFromPath(module.path);
        const isAllowed = allowedModules.has(moduleName);
        
        if (isDev) console.log(`  Module: ${module.text} (${module.path}) -> ${moduleName} - ${isAllowed ? 'ALLOWED' : 'FILTERED'}`);
        
        if (!isAllowed) {
          return null;
        }
        
        // Filter submenu items (including nested) based on submodule permissions
        if (module.subItems) {
          const filterSubItems = (items, checkPermission) => {
            return items
              .map(subItem => {
                const submoduleName = getSubmoduleFromPath(subItem.path);
                if (!submoduleName) return { ...subItem, keep: true };
                const hasPermission = checkPermission(submoduleName);
                const nestedFiltered = subItem.subItems
                  ? filterSubItems(subItem.subItems, checkPermission)
                  : undefined;
                const hasNestedWithPermission = nestedFiltered && nestedFiltered.length > 0;
                return {
                  ...subItem,
                  keep: hasPermission || hasNestedWithPermission,
                  subItems: nestedFiltered
                };
              })
              .filter(s => s.keep)
              .map(({ keep, subItems, ...rest }) => ({ ...rest, subItems: subItems?.length ? subItems : undefined }));
          };
          const checkPermission = (submoduleName) =>
            hasSubmodulePermission(rolePermissions, moduleName, submoduleName);
          const filteredSubItems = filterSubItems(module.subItems, checkPermission);
          return {
            ...module,
            subItems: filteredSubItems
          };
        }
        
        return module;
      }).filter(module => module !== null && (!module.subItems || module.subItems.length > 0));
      
      if (isDev) console.log('📊 Filtered Menu Items Count:', filtered.length);
      
      // If no modules matched, fall back to base menu items
      if (filtered.length === 0) {
        if (isDev) console.warn('⚠️ No modules matched roleRef permissions, falling back to base menu items');
        return baseMenuItems;
      }
      
      return filtered;
    }
    
    // If user has sub-roles, show only items they have permissions for
    if (user?.subRoles && user.subRoles.length > 0) {
      // Get modules that user has sub-roles for
      const userSubRoleModules = new Set();
      user.subRoles.forEach(subRole => {
        if (subRole && subRole.module) {
          userSubRoleModules.add(subRole.module);
        }
      });
      
      return baseMenuItems.map(module => {
        const moduleName = getModuleNameFromPath(module.path);
        
        // If user has sub-roles, only show modules that match their sub-role modules
        // This ensures users with only HR sub-roles don't see Admin/General modules
        // BUT: If user has sub-roles for multiple modules (e.g., admin + hr), show all those modules
        if (userSubRoleModules.size > 0 && !userSubRoleModules.has(moduleName)) {
          // Check if main role has access to this module (for users with mixed access)
          const mainRoleHasAccess = baseMenuItems.some(m => m.path === module.path);
          if (!mainRoleHasAccess) {
            return null; // Filter out this module
          }
          // If main role has access, continue to check sub-role permissions below
        }
        
        if (module.subItems) {
          // Filter submenu items based on sub-role permissions
          const allowedSubmenuItems = module.subItems.filter(submenuItem => {
            // Get the submodule name from the path
            const submoduleName = getSubmoduleFromPath(submenuItem.path);
            
            // Check if user has sub-role permission for this submenu
            const hasPermission = user.subRoles.some(subRole => {
              if (!subRole || subRole.module !== moduleName) {
                return false;
              }
              
              const allowedSubmodules = getAllowedSubmodules(subRole);
              
              // If no specific submodule mapping exists, allow if user has sub-role for this module
              if (!submoduleName) {
                return true;
              }
              
              // Check if subRole has permission for this submodule
              return allowedSubmodules.includes(submoduleName);
            });
            
            return hasPermission;
          });
          
          return {
            ...module,
            subItems: allowedSubmenuItems
          };
        }
        return module;
      }).filter(module => {
        // Remove null modules (filtered out)
        if (!module) {
          return false;
        }
        
        // Remove modules that have no allowed submenu items
        if (module.subItems) {
          return module.subItems.length > 0;
        }
        return true;
      });
    }
    
    // If user has NO roles/roleRef/subRoles, return base menu items (fallback)
    // But filter HR module for hr_manager to only show Evaluation & Appraisal
    if (isDev) console.log('⚠️ No roles found, using base menu items (fallback)');
    return baseMenuItems.map(module => {
      if (module.subItems && module.path === '/hr' && userRole === 'hr_manager') {
        const filteredSubItems = module.subItems.filter(subItem => {
          // Only show Evaluation & Appraisal submodule
          return subItem.path === '/hr/evaluation-appraisal/dashboard' || 
                 subItem.path?.startsWith('/hr/evaluation-appraisal');
        });
        return {
          ...module,
          subItems: filteredSubItems
        };
      }
      return module;
    });
    };

    const items = generateItems();
    
    // Restrict Payroll (Finance)
    const allowedForFinancePayroll = ['ceo@sgc.com', 'developer@tovus.net', 'iftikharrashid@tovus.net', 'faisalfarooq@tovus.net'];
    const canSeeFinancePayroll = user && (
      allowedForFinancePayroll.includes(user.email?.toLowerCase()) || 
      ['2197', '5898'].includes(String(user.employeeId))
    );

    return items.map(module => {
      if (module.path === '/finance' && module.subItems && !canSeeFinancePayroll) {
        return {
          ...module,
          subItems: module.subItems.map(subGroup => {
            if (subGroup.subItems) {
              return {
                ...subGroup,
                subItems: subGroup.subItems.filter(item => item.path !== '/finance/payroll-queue')
              };
            }
            return subGroup;
          }).filter(subGroup => subGroup.subItems ? subGroup.subItems.length > 0 : true)
        };
      }
      return module;
    });
  }, [user, hasSubmodulePermission, buildMenuItemsFromModules]);

  // Fetch candidate hired notification count for Employee submodule badge
  const fetchCandidateHiredCount = useCallback(async () => {
    if (user) {
      try {
        const count = await NotificationService.getCandidateHiredNotificationCount();
        setCandidateHiredCount(count);
      } catch (error) {
        setCandidateHiredCount(0);
      }
    }
  }, [user]);

  useEffect(() => {
    fetchCandidateHiredCount();
    
    // Set up interval to refresh count every 5 minutes (reduced from 30 seconds)
    const interval = setInterval(fetchCandidateHiredCount, 300000);
    
    return () => clearInterval(interval);
  }, [fetchCandidateHiredCount]);

  useEffect(() => {
    let mounted = true;
    const loadPendingKpiReviews = async () => {
      try {
        const now = new Date();
        const res = await fetchTeamKpiWorksheets({ year: now.getFullYear(), month: now.getMonth() + 1 });
        const teamRows = res.data?.data || [];
        const pending = teamRows.filter((t) => !t.worksheet || !t.worksheet.managerScored).length;
        if (mounted) setPendingKpiReviews(pending);
      } catch {
        if (mounted) setPendingKpiReviews(0);
      }
    };
    loadPendingKpiReviews();
    const interval = setInterval(loadPendingKpiReviews, 120000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Auto-clear module notifications when user visits that module page.
  useEffect(() => {
    const path = location.pathname || '';
    let moduleToClear = null;

    if (path.startsWith('/procurement') || path.startsWith('/general/indents')) {
      moduleToClear = 'procurement';
    } else if (path.startsWith('/hr')) {
      moduleToClear = 'hr';
    } else if (path.startsWith('/finance')) {
      moduleToClear = 'finance';
    } else if (path.startsWith('/crm')) {
      moduleToClear = 'crm';
    } else if (path.startsWith('/sales')) {
      moduleToClear = 'sales';
    }

    if (moduleToClear && getModuleCount(moduleToClear) > 0) {
      markModuleAsRead(moduleToClear);
    }
  }, [location.pathname, getModuleCount, markModuleAsRead]);

  const handleSubmenuToggle = (key, subItems) => {
    setOpenSubmenu(prev => {
      const currentState = prev[key] !== undefined ? prev[key] : (subItems ? isSubmenuActive(subItems) : false);
      return {
        ...prev,
        [key]: !currentState
      };
    });
  };

  const handleNavigation = (path) => {
    navigate(path);
    if (isMobile) {
      // Close drawer on mobile after navigation
    }
  };

  const isActive = (path) => {
    const raw = String(path || '');
    const [pathname, query = ''] = raw.split('?');
    const pathMatches =
      location.pathname === pathname || location.pathname.startsWith(`${pathname}/`);
    if (!pathMatches) return false;

    // Support menu items with query (e.g. Meeting Schedule ?tab=schedule)
    if (query) {
      const wanted = new URLSearchParams(query);
      const current = new URLSearchParams(location.search);
      return [...wanted.entries()].every(([k, v]) => current.get(k) === v);
    }

    // Bare /meetings should not stay highlighted when ?tab=schedule is open
    if (pathname === '/general/president-secretariat/meetings') {
      return new URLSearchParams(location.search).get('tab') !== 'schedule';
    }

    return true;
  };

  const isSubmenuActive = (subItems) => {
    return subItems?.some((item) => isActive(item.path) || (item.subItems && isSubmenuActive(item.subItems)));
  };

  const getSubmenuKey = (item, parentKey = '') => item.path || `${parentKey}/${item.text}`;

  const isSearchingMenu = Boolean(String(menuSearch || '').trim());

  const isSubmenuOpen = (key, subItems) => {
    // While searching, keep matching branches expanded so pages are visible
    if (isSearchingMenu) return true;
    return openSubmenu[key] !== undefined ? openSubmenu[key] : isSubmenuActive(subItems);
  };

  return (
    <Drawer
      variant={isMobile ? 'temporary' : 'persistent'}
      open={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      className="app-print-hide"
      sx={{
        width: sidebarOpen ? drawerWidth : 0,
        flexShrink: 0,
        height: '100vh',
        transition: theme.transitions.create(['width', 'margin'], {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          height: '100vh',
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: theme.transitions.create('transform', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 700 }}>
          SGC ERP System
        </Typography>
        <IconButton
          size="small"
          onClick={() => setSidebarOpen(false)}
          sx={{ color: 'primary.contrastText' }}
          aria-label="collapse sidebar"
        >
          <MenuOpenIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* User Info - Fixed Position */}
      <Box sx={{ 
        p: 3, 
        borderBottom: '1px solid', 
        borderColor: 'divider',
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.primary.main, 0.02)} 100%)`,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${alpha(theme.palette.primary.main, 0.7)})`,
          borderRadius: '0 0 8px 8px'
        }
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Avatar 
            src={getImageUrl(user?.profileImage)}
            onError={(e) => handleImageError(e)}
            sx={{ 
              mr: 2.5, 
              bgcolor: 'secondary.main',
              width: 56,
              height: 56,
              border: '3px solid',
              borderColor: 'primary.main',
              boxShadow: `0 8px 25px ${alpha(theme.palette.primary.main, 0.25)}`,
              transition: 'all 0.3s ease',
              '&:hover': {
                transform: 'scale(1.05)',
                boxShadow: `0 12px 35px ${alpha(theme.palette.primary.main, 0.35)}`
              }
            }}
          >
            <Person />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography 
              variant="subtitle1" 
              noWrap
              sx={{ 
                fontWeight: 'bold',
                color: 'text.primary',
                fontSize: '1rem',
                mb: 0.5
              }}
            >
              {user?.fullName || 'User'}
            </Typography>
            <Typography 
              variant="body2" 
              sx={{ 
                color: 'primary.main',
                fontWeight: 600,
                fontSize: '0.875rem',
                textTransform: 'none',
                letterSpacing: '0.2px'
              }}
              title={user?.designation || user?.position || undefined}
            >
              {user?.designation || user?.position || '—'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1,
          px: 1,
          py: 0.5,
          borderRadius: 2,
          background: alpha(theme.palette.primary.main, 0.08),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`
        }}>
          <Box sx={{ 
            width: 8, 
            height: 8, 
            borderRadius: '50%', 
            bgcolor: 'success.main',
            boxShadow: `0 0 8px ${alpha(theme.palette.success.main, 0.6)}`
          }} />
          <Typography 
            variant="caption" 
            sx={{ 
              color: 'text.secondary',
              fontWeight: 500,
              fontSize: '0.75rem'
            }}
          >
            {typeof user?.department === 'object' ? user?.department?.name : user?.department || 'Department'}
          </Typography>
        </Box>
      </Box>

      {/* Menu search */}
      <Box sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search modules & pages…"
          value={menuSearch}
          onChange={(e) => setMenuSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
            endAdornment: menuSearch ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label="Clear menu search"
                  onClick={() => setMenuSearch('')}
                  edge="end"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: alpha(theme.palette.background.paper, 0.9),
              borderRadius: 2
            }
          }}
        />
      </Box>

      {/* Navigation Menu - Scrollable */}
      <Box sx={{ 
        flexGrow: 1, 
        overflow: 'auto',
        '&::-webkit-scrollbar': {
          width: '6px',
        },
        '&::-webkit-scrollbar-track': {
          background: alpha(theme.palette.grey[300], 0.1),
        },
        '&::-webkit-scrollbar-thumb': {
          background: alpha(theme.palette.primary.main, 0.3),
          borderRadius: '3px',
          '&:hover': {
            background: alpha(theme.palette.primary.main, 0.5),
          },
        },
      }}>
        <List sx={{ pt: 1 }}>
        {(() => {
          const menuItems = filterMenuBySearch(getFilteredMenuItems(user?.role), menuSearch);
          if (!menuItems || menuItems.length === 0) {
            if (isSearchingMenu) {
              return (
                <ListItem>
                  <ListItemText
                    primary="No matching pages"
                    secondary="Try another search term"
                  />
                </ListItem>
              );
            }
            console.warn('⚠️ No menu items found for user:', user?.email);
            return (
              <ListItem>
                <ListItemText 
                  primary="No modules available" 
                  secondary="Please contact administrator to assign roles"
                />
              </ListItem>
            );
          }
          return menuItems.map((item) => (
          <Box key={item.text}>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => {
                  if (item.subItems) {
                    handleSubmenuToggle(item.path || item.text, item.subItems);
                  } else {
                    handleNavigation(item.path);
                  }
                }}
                selected={item.subItems ? isSubmenuActive(item.subItems) : isActive(item.path)}
                sx={{
                  '&.Mui-selected': {
                    bgcolor: 'primary.light',
                    color: 'primary.contrastText',
                    '&:hover': {
                      bgcolor: 'primary.light',
                    },
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    color: isActive(item.path) ? 'primary.contrastText' : 'inherit',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText primary={item.text} />
                {item.subItems && (
                  (isSubmenuOpen(item.path || item.text, item.subItems)) ? <ExpandLess /> : <ExpandMore />
                )}
              </ListItemButton>
            </ListItem>

            {/* Submenu */}
            {item.subItems && (
              <Collapse in={isSubmenuOpen(item.path || item.text, item.subItems)} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                  {item.subItems.map((subItem) => (
                    <Box key={subItem.path}>
                                              <ListItemButton
                          sx={{ pl: 4 }}
                          onClick={async () => {
                            // Special handling for Employees section - mark notifications as read
                            if (subItem.text === 'Employees' && candidateHiredCount > 0) {
                              try {
                                setIsMarkingRead(true);
                                const countToClear = candidateHiredCount; // Store count before clearing
                                // Mark all candidate_hired notifications as read
                                await NotificationService.markAllCandidateHiredAsRead();
                                // Store the count that was cleared for success message
                                setLastClearedCount(countToClear);
                                // Refresh the count
                                setCandidateHiredCount(0);
                                // Show success message
                                setShowSuccessMessage(true);
                                
                                // Trigger a refresh of the top notification count
                                // This will update the header notification badge
                                window.dispatchEvent(new CustomEvent('refreshNotifications'));
                              } catch (error) {
                                // Error handling - could add user notification here if needed
                              } finally {
                                setIsMarkingRead(false);
                              }
                            }
                            
                            // Handle navigation
                            if (subItem.subItems) {
                              handleSubmenuToggle(getSubmenuKey(subItem, item.path), subItem.subItems);
                            } else {
                              handleNavigation(subItem.path);
                            }
                          }}
                          selected={subItem.subItems ? isSubmenuActive(subItem.subItems) : isActive(subItem.path)}
                        >
                        <ListItemText 
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              {subItem.path === '/hr/kpi/sheet' ? (
                                <Badge
                                  color="error"
                                  badgeContent={pendingKpiReviews}
                                  invisible={!pendingKpiReviews}
                                  max={99}
                                >
                                  {subItem.text}
                                </Badge>
                              ) : (
                                subItem.text
                              )}
                              {/* Show notification badge for Employees submenu item */}
                              {subItem.text === 'Employees' && candidateHiredCount > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Tooltip title={`${candidateHiredCount} new employee(s) hired - requires onboarding`} arrow>
                                    <Badge 
                                      badgeContent={isMarkingRead ? '...' : candidateHiredCount} 
                                      color={isMarkingRead ? "default" : "error"}
                                      sx={{ 
                                        ml: 1,
                                        '& .MuiBadge-badge': {
                                          fontSize: '0.75rem',
                                          height: '20px',
                                          minWidth: '20px',
                                          borderRadius: '10px'
                                        }
                                      }}
                                    />
                                  </Tooltip>
                                </Box>
                              )}
                              
                              {/* Show module-specific notification badges */}
                              {subItem.text === 'Employees' && getModuleCount('employees') > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Tooltip title={`${getModuleCount('employees')} employee notifications`} arrow>
                                    <Badge 
                                      badgeContent={getModuleCount('employees')} 
                                      color="error"
                                      sx={{ 
                                        ml: 1,
                                        '& .MuiBadge-badge': {
                                          fontSize: '0.75rem',
                                          height: '20px',
                                          minWidth: '20px',
                                          borderRadius: '10px'
                                        }
                                      }}
                                    />
                                  </Tooltip>
                                </Box>
                              )}
                              
                              {subItem.text === 'Departments' && getModuleCount('hr') > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Tooltip title={`${getModuleCount('hr')} HR notifications`} arrow>
                                    <Badge 
                                      badgeContent={getModuleCount('hr')} 
                                      color="error"
                                      sx={{ 
                                        ml: 1,
                                        '& .MuiBadge-badge': {
                                          fontSize: '0.75rem',
                                          height: '20px',
                                          minWidth: '20px',
                                          borderRadius: '10px'
                                        }
                                      }}
                                    />
                                  </Tooltip>
                                </Box>
                              )}
                              
                              {subItem.text === 'Payroll' && getModuleCount('finance') > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Tooltip title={`${getModuleCount('finance')} finance notifications`} arrow>
                                    <Badge 
                                      badgeContent={getModuleCount('finance')} 
                                      color="error"
                                      sx={{ 
                                        ml: 1,
                                        '& .MuiBadge-badge': {
                                          fontSize: '0.75rem',
                                          height: '20px',
                                          minWidth: '20px',
                                          borderRadius: '10px'
                                        }
                                      }}
                                    />
                                  </Tooltip>
                                </Box>
                              )}
                            </Box>
                          } 
                        />
                        {subItem.subItems && (
                          isSubmenuOpen(getSubmenuKey(subItem, item.path), subItem.subItems) ? <ExpandLess /> : <ExpandMore />
                        )}
                      </ListItemButton>

                      {/* Sub-submenu */}
                      {subItem.subItems && (
                        <Collapse in={isSubmenuOpen(getSubmenuKey(subItem, item.path), subItem.subItems)} timeout="auto" unmountOnExit>
                          <List component="div" disablePadding>
                            {subItem.subItems.map((subSubItem) => {
                              const subSubKey = getSubmenuKey(subSubItem, getSubmenuKey(subItem, item.path));
                              return (
                              <Box key={subSubItem.path}>
                              <ListItemButton
                                sx={{ pl: 6 }}
                                onClick={() => {
                                  if (subSubItem.subItems) {
                                    handleSubmenuToggle(subSubKey, subSubItem.subItems);
                                  } else {
                                    handleNavigation(subSubItem.path);
                                  }
                                }}
                                selected={subSubItem.subItems ? isSubmenuActive(subSubItem.subItems) : isActive(subSubItem.path)}
                              >
                                <ListItemText primary={subSubItem.text} />
                                {subSubItem.subItems && (
                                  isSubmenuOpen(subSubKey, subSubItem.subItems) ? <ExpandLess /> : <ExpandMore />
                                )}
                              </ListItemButton>

                              {subSubItem.subItems && (
                                <Collapse in={isSubmenuOpen(subSubKey, subSubItem.subItems)} timeout="auto" unmountOnExit>
                                  <List component="div" disablePadding>
                                    {subSubItem.subItems.map((nestedItem) => (
                                      <ListItemButton
                                        key={nestedItem.path}
                                        sx={{ pl: 8 }}
                                        onClick={() => handleNavigation(nestedItem.path)}
                                        selected={isActive(nestedItem.path)}
                                      >
                                        <ListItemText primary={nestedItem.text} />
                                      </ListItemButton>
                                    ))}
                                  </List>
                                </Collapse>
                              )}
                              </Box>
                              );
                            })}
                          </List>
                        </Collapse>
                      )}
                    </Box>
                  ))}
                </List>
              </Collapse>
            )}
          </Box>
          ));
        })()}
        </List>
      </Box>

      {/* Footer Actions - Fixed at Bottom */}
      <Box sx={{ 
        p: 2, 
        borderTop: '1px solid', 
        borderColor: 'divider',
        flexShrink: 0,
        bgcolor: 'background.paper'
      }}>
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={() => navigate('/chat')}>
              <ListItemIcon>
                <Badge badgeContent={chatUnread > 0 ? chatUnread : 0} color="primary" max={99} invisible={!chatUnread}>
                  <ChatIcon />
                </Badge>
              </ListItemIcon>
              <ListItemText primary="Chat" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => navigate('/profile')}>
              <ListItemIcon>
                <Settings />
              </ListItemIcon>
              <ListItemText primary="Settings" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={logout}>
              <ListItemIcon>
                <Logout />
              </ListItemIcon>
              <ListItemText primary="Logout" />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>

      {/* Success Message Snackbar */}
      <Snackbar
        open={showSuccessMessage}
        autoHideDuration={3000}
        onClose={() => setShowSuccessMessage(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setShowSuccessMessage(false)} 
          severity="success" 
          sx={{ width: '100%' }}
        >
          ✅ {lastClearedCount} employee notification(s) cleared! Top notification count updated.
        </Alert>
      </Snackbar>
    </Drawer>
  );
};

export default Sidebar; 