import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography, Button } from '@mui/material';
import { useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { FinanceCompanyProvider } from './context/FinanceCompanyContext';
import { SidebarProvider } from './contexts/SidebarContext';
import ProtectedRoute from './components/ProtectedRoute';

// Layout Components
import Layout from './components/Layout/Layout';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import NoChromeLayout from './components/NoChromeLayout';

// Pages
import Login from './pages/Auth/Login';
import Dashboard from './pages/Dashboard/Dashboard';
import HRDashboard from './pages/HR/HRDashboard';
import EmployeeList from './pages/HR/EmployeeList';
import NonEmployeeOnboarding from './pages/HR/NonEmployeeOnboarding';
import EmployeeForm from './pages/HR/EmployeeForm';
import EmployeeView from './pages/HR/EmployeeView';
import HRReports from './pages/HR/Reports/HRReports';
import PayrollReport from './pages/HR/Reports/PayrollReport';
import AttendanceReports from './pages/HR/Reports/AttendanceReports';
import Departments from './pages/HR/Departments';
import Projects from './pages/HR/Projects';
import HRCompanies from './pages/HR/Companies';
import Payroll from './pages/HR/Payroll';
import PayrollForm from './pages/HR/PayrollForm';
import PayrollDetail from './pages/HR/PayrollDetail';
import EmployeePayrollDetails from './pages/HR/EmployeePayrollDetails';
import AttendanceList from './pages/HR/AttendanceList';
import AttendanceRecord from './pages/HR/AttendanceRecord';
import AttendanceRecordDetail from './pages/HR/AttendanceRecordDetail';
import AttendanceDetail from './pages/HR/AttendanceDetail';
import AttendanceForm from './pages/HR/AttendanceForm';
import AttendanceReport from './pages/HR/AttendanceReport';
import BiometricIntegration from './pages/HR/BiometricIntegration';
import FinanceDashboard from './pages/Finance/FinanceDashboard';
import ChartOfAccounts from './pages/Finance/ChartOfAccounts';
import FinanceCostCenters from './pages/Finance/Setup/CostCenters';
import BankingSetup from './pages/Finance/BankingSetup';
import GeneralLedger from './pages/Finance/GeneralLedger';
import AccountsReceivable from './pages/Finance/AccountsReceivable';
import AccountsPayable from './pages/Finance/AccountsPayable';
import Banking from './pages/Finance/Banking';
import FinancialReports from './pages/Finance/FinancialReports';
import ChargesSlabs from './pages/Finance/TajUtilities/ChargesSlabs';
import JournalEntryForm from './pages/Finance/JournalEntryForm';
import JournalEntriesList from './pages/Finance/JournalEntriesList';
import FinanceJournals from './pages/Finance/FinanceJournals';
import FiscalPeriods from './pages/Finance/FiscalPeriods';
import InventoryCategories from './pages/Finance/InventoryCategories';
import InventoryValuation from './pages/Finance/InventoryValuation';
import TaxManagement from './pages/Finance/TaxManagement';
import FixedAssets from './pages/Finance/FixedAssets';
import AssetTaggingDashboard from './pages/AssetTagging/AssetTaggingDashboard';
import TaggedAssetsPage from './pages/AssetTagging/TaggedAssetsPage';
import FixedAssetRegisterPage from './pages/AssetTagging/FixedAssetRegisterPage';
import VerificationPage from './pages/AssetTagging/VerificationPage';
import TagEventsPage from './pages/AssetTagging/TagEventsPage';
import ScanAssetPage from './pages/AssetTagging/ScanAssetPage';
import LabelPrintPage from './pages/AssetTagging/LabelPrintPage';
import BulkLabelPrintPage from './pages/AssetTagging/BulkLabelPrintPage';
import BankReconciliation from './pages/Finance/BankReconciliation';
import VendorStatement from './pages/Finance/VendorStatement';
import FinanceVendorsList from './pages/Finance/FinanceVendorsList';
import FinanceCustomersList from './pages/Finance/FinanceCustomersList';
import FinancePayroll from './pages/Finance/FinancePayroll';
import BudgetVsActual from './pages/Finance/BudgetVsActual';
import AgedPayables from './pages/Finance/AgedPayables';
import PaymentTerms from './pages/Finance/PaymentTerms';
import BalanceSheet from './pages/Finance/BalanceSheet';
import ProfitLoss from './pages/Finance/ProfitLoss';
import TaxSummary from './pages/Finance/TaxSummary';
import OpeningBalances from './pages/Finance/OpeningBalances';
import TrialBalance from './pages/Finance/TrialBalance';
import CashFlow from './pages/Finance/CashFlow';
import YearEndClosing from './pages/Finance/YearEndClosing';
import CustomerStatement from './pages/Finance/CustomerStatement';
import AgedReceivables from './pages/Finance/AgedReceivables';
import CustomerPayments from './pages/Finance/CustomerPayments';
import CreditNotes from './pages/Finance/CreditNotes';
import VendorPayments from './pages/Finance/VendorPayments';
import VendorAdvance from './pages/Finance/VendorAdvance';
import VendorRefunds from './pages/Finance/VendorRefunds';
import BillToReceive from './pages/Finance/BillToReceive';
import BilledNotReceived from './pages/Finance/BilledNotReceived';
import RecurringJournals from './pages/Finance/RecurringJournals';
import BatchPayment from './pages/Finance/BatchPayment';
import PayablesHub from './pages/Finance/PayablesHub';
import CompanyProfile from './pages/Finance/CompanyProfile';
import FinanceCompanies from './pages/Finance/FinanceCompanies';
import BudgetList from './pages/Finance/BudgetList';
import BudgetForm from './pages/Finance/BudgetForm';
import DeferredEntries from './pages/Finance/DeferredEntries';
import BankStatementImport from './pages/Finance/BankStatementImport';
import FinanceSetup from './pages/Finance/FinanceSetup';
import Vouchers from './pages/Finance/Vouchers';
import VoucherView from './pages/Finance/VoucherView';
import Legacy from './pages/Finance/Legacy';
import PurchaseReturns from './pages/Procurement/PurchaseReturns';
import ProcurementDashboard from './pages/Procurement/ProcurementDashboard';
import ProcurementReports from './pages/Procurement/ProcurementReports';
import Requisitions from './pages/Procurement/Requisitions';
import ProcurementTaskAssignment from './pages/Procurement/ProcurementTaskAssignment';
import RequisitionPrintView from './pages/Procurement/RequisitionPrintView';
import Quotations from './pages/Procurement/Quotations';
import PurchaseOrders from './pages/Procurement/PurchaseOrders';
import ComparativeStatements from './pages/Procurement/ComparativeStatements';
import Vendors from './pages/Procurement/Vendors';
import Inventory from './pages/Procurement/Inventory';
import GoodsReceive from './pages/Procurement/GoodsReceive';
import DeliveryChallans from './pages/Procurement/Store/DeliveryChallans';
import DeliveryChallanQA from './pages/Procurement/Store/DeliveryChallanQA';
import GoodsIssue from './pages/Procurement/GoodsIssue';
import CostCenters from './pages/Procurement/CostCenters';
import VendorBills from './pages/Procurement/VendorBills';
import StoreDashboard from './pages/Procurement/Store/StoreDashboard';
import StoreManagement from './pages/Procurement/Store/StoreManagement';
import StoreItemCatalog from './pages/Procurement/Store/StoreItemCatalog';
import SalesDashboard from './pages/Sales/SalesDashboard';
import SalesOrders from './pages/Sales/SalesOrders';
import SalesCustomers from './pages/Sales/SalesCustomers';
import SalesProducts from './pages/Sales/SalesProducts';
import SalesReports from './pages/Sales/SalesReports';
import CRMDashboard from './pages/CRM/CRMDashboard';
import Leads from './pages/CRM/Leads';
import Contacts from './pages/CRM/Contacts';
import Companies from './pages/CRM/Companies';
import Campaigns from './pages/CRM/Campaigns';
import Opportunities from './pages/CRM/Opportunities';
import Reports from './pages/CRM/Reports';
import SurveyList from './pages/CRM/Survey/SurveyList';
import SurveyBuilder from './pages/CRM/Survey/SurveyBuilder';
import SurveyRespond from './pages/CRM/Survey/SurveyRespond';
import SurveyAnalytics from './pages/CRM/Survey/SurveyAnalytics';
import SurveyExecutiveDashboard from './pages/CRM/Survey/SurveyExecutiveDashboard';
import PollBuilder from './pages/CRM/Survey/PollBuilder';
import Profile from './pages/Profile/Profile';
import MyKPIs from './pages/Profile/MyKPIs';
import ChatPage from './pages/Chat/ChatPage';
import ChatModerationPage from './pages/Chat/ChatModerationPage';
import ChatFloatingButton from './components/ChatFloatingButton';
import UserManagement from './pages/Admin/UserManagement';
import OnlineUsers from './pages/Admin/OnlineUsers';
import MobileApprovalNotifications from './pages/Admin/MobileApprovalNotifications';
import VehicleList from './pages/Admin/VehicleManagement/VehicleList';
import VehicleForm from './pages/Admin/VehicleManagement/VehicleForm';
import VehicleDetails from './pages/Admin/VehicleManagement/VehicleDetails';
import VehicleDetailsView from './pages/Admin/VehicleManagement/VehicleDetailsView';
import VehicleMaintenanceForm from './pages/Admin/VehicleManagement/VehicleMaintenanceForm';
import VehicleLogBookForm from './pages/Admin/VehicleManagement/VehicleLogBookForm';
import VehicleDashboard from './pages/Admin/VehicleManagement/VehicleDashboard';
import VehicleReports from './pages/Admin/VehicleManagement/VehicleReports';
import VehicleMaintenanceList from './pages/Admin/VehicleManagement/VehicleMaintenanceList';
import VehicleLogBookList from './pages/Admin/VehicleManagement/VehicleLogBookList';
import VehicleLogBookDetailsView from './pages/Admin/VehicleManagement/VehicleLogBookDetailsView';
import VehicleLocationList from './pages/Admin/VehicleManagement/VehicleLocationList';
import HouseInventoryDashboard from './pages/Admin/HouseInventory/HouseInventoryDashboard';
import UtilityBillForm from './pages/Admin/UtilityBillManagement/UtilityBillForm';
import StandardVendorBillForm from './pages/Finance/StandardVendorBillForm';
import StandardCustomerInvoiceForm from './pages/Finance/StandardCustomerInvoiceForm';
import UtilityBillDetails from './pages/Admin/UtilityBillManagement/UtilityBillDetails';
import CentralizedStoreManagement from './pages/Admin/UtilityBillManagement/CentralizedStoreManagement';
import CentralizedStoreBills from './pages/Admin/UtilityBillManagement/CentralizedStoreBills';
import RentalAgreementList from './pages/Admin/RentalAgreements/RentalAgreementList';
import RentalAgreementDetail from './pages/Admin/RentalAgreements/RentalAgreementDetail';
import RentalManagementDashboard from './pages/Admin/RentalManagement/RentalManagementDashboard';
import RentalManagementDetail from './pages/Admin/RentalManagement/RentalManagementDetail';
import RoleManagement from './pages/Admin/RoleManagement';
import AdminDashboard from './pages/Admin/AdminDashboard';
import SettingsPage from './pages/Settings/SettingsPage';

// IT Module Components
import ITDashboard from './pages/IT/ITDashboard';
import AssetList from './pages/IT/AssetList';
import AssetForm from './pages/IT/AssetForm';
import AssetAssignment from './pages/IT/AssetAssignment';
import SoftwareList from './pages/IT/SoftwareList';
import SoftwareForm from './pages/IT/SoftwareForm';
import NetworkList from './pages/IT/NetworkList';
import NetworkForm from './pages/IT/NetworkForm';
import VendorList from './pages/IT/VendorList';
import VendorForm from './pages/IT/VendorForm';
import VendorContracts from './pages/IT/VendorContracts';
import PasswordWallet from './pages/IT/PasswordWallet';
import PasswordWalletDashboard from './pages/IT/PasswordWalletDashboard';
import PasswordForm from './pages/IT/PasswordForm';
import ITReports from './pages/IT/Reports';
import TajResidenciaDashboard from './pages/TajResidencia/TajResidenciaDashboard';

import ComplainsTickets from './pages/TajResidencia/ComplainsTickets';
import LandAcquisition from './pages/TajResidencia/LandAcquisition';
import LandParties from './pages/TajResidencia/LandParties';
import LandPurchaseViewer from './pages/TajResidencia/LandPurchaseViewer';
import LandPurchaseFormPage from './pages/TajResidencia/LandPurchaseFormPage';
import LandPurchaseDetailPage from './pages/TajResidencia/LandPurchaseDetailPage';
import LandTransferViewer from './pages/TajResidencia/LandTransferViewer';

// Audit Module Components
import AuditDashboard from './pages/Audit/AuditDashboard';
import AuditList from './pages/Audit/AuditList';
import AuditFindings from './pages/Audit/AuditFindings';
import AddAuditFinding from './pages/Audit/AddAuditFinding';
import CorrectiveActions from './pages/Audit/CorrectiveActions';
import AuditTrail from './pages/Audit/AuditTrail';
import AuditReports from './pages/Audit/AuditReports';
import AuditSchedules from './pages/Audit/AuditSchedules';
import AuditForm from './pages/Audit/AuditForm';
import CorrectiveActionForm from './pages/Audit/CorrectiveActionForm';
import PreAudit from './pages/Audit/PreAudit';

import DepartmentManagement from './pages/HR/DepartmentManagement';
import PositionManagement from './pages/HR/PositionManagement';
import BankManagement from './pages/HR/BankManagement';
import NotFound from './pages/NotFound/NotFound';

import FBRTaxManagement from './pages/HR/FBRTaxManagement';
import PayrollTaxes from './pages/HR/PayrollTaxes';
import EvaluationDocuments from './pages/HR/EvaluationAppraisal/EvaluationDocuments';
import EvaluationAuthorities from './pages/HR/EvaluationAppraisal/EvaluationAuthorities';
import EvaluationDashboard from './pages/HR/EvaluationAppraisal/EvaluationDashboard';
import DocumentsTracking from './pages/HR/DocumentsTracking';
import DocumentsTrackingDashboard from './pages/DocumentsTracking/DocumentsTrackingDashboard';
import EvaluationTracking from './pages/DocumentsTracking/EvaluationTracking';
import UserTracking from './pages/General/UserTracking';
import IndentsDashboard from './pages/General/Indents/IndentsDashboard';
import IndentsList from './pages/General/Indents/IndentsList';
import IndentForm from './pages/General/Indents/IndentForm';
import GeneralCashApprovalsList from './pages/General/CashApprovals/GeneralCashApprovalsList';
import GeneralCashApprovalForm from './pages/General/CashApprovals/GeneralCashApprovalForm';
import GeneralCashApprovalDetail from './pages/General/CashApprovals/GeneralCashApprovalDetail';
import CashApprovalGeneralViewPage from './pages/CashApprovals/CashApprovalGeneralViewPage';
import IndentDetail from './pages/General/Indents/IndentDetail';
import IndentPrintView from './pages/General/Indents/IndentPrintView';
import Payments from './pages/General/Payments';
import ProjectManagement from './pages/General/ProjectManagement';
import ProjectDetail from './pages/General/ProjectDetail';
import ProjectWorkspaceRedirect from './pages/General/ProjectWorkspaceRedirect';
import WbsActivities from './pages/General/WbsActivities';
import SlabSchedules from './pages/General/SlabSchedules';
import ProjectApprovals from './pages/General/ProjectApprovals';
import SubcontractorStatement from './pages/General/SubcontractorStatement';
import GeneralCostCenters from './pages/General/CostCenters/GeneralCostCenters';
import PresidentSecretariatDashboard from './pages/General/PresidentSecretariat/Dashboard';
import PresidentMeetings from './pages/General/PresidentSecretariat/Meetings';
import PresidentMeetingDetail from './pages/General/PresidentSecretariat/MeetingDetail';
import PresidentMeetingPrintView from './pages/General/PresidentSecretariat/MeetingPrintView';
import PresidentMeetingsListPrintView from './pages/General/PresidentSecretariat/MeetingsListPrintView';
import PresidentEvents from './pages/General/PresidentSecretariat/Events';
import PresidentEventDetail from './pages/General/PresidentSecretariat/EventDetail';
import PresidentEventPrintView from './pages/General/PresidentSecretariat/EventPrintView';
import PresidentEventsListPrintView from './pages/General/PresidentSecretariat/EventsListPrintView';
import ServerMonitor from './pages/Developer/ServerMonitor';
import FinancialsDashboard from './pages/Developer/FinancialsDashboard';
import LoanManagement from './pages/HR/LoanManagement';
import LoanForm from './pages/HR/LoanForm';
import LoanDetail from './pages/HR/LoanDetail';
import LoanStatistics from './pages/HR/LoanStatistics';
import FinalSettlementManagement from './pages/HR/FinalSettlementManagement';
import FinalSettlementForm from './pages/HR/FinalSettlementForm';
import FinalSettlementStatistics from './pages/HR/FinalSettlementStatistics';
import FinalSettlementDetail from './pages/HR/FinalSettlementDetail';
import TalentAcquisition from './pages/HR/TalentAcquisition';
import JobPostings from './pages/HR/JobPostings';
import JobPostingForm from './pages/HR/JobPostingForm';
import Candidates from './pages/HR/Candidates';
import CandidateForm from './pages/HR/CandidateForm';
import ApplicationForm from './pages/HR/ApplicationForm';
import Applications from './pages/HR/Applications';
import CandidateApprovals from './pages/HR/CandidateApprovals';
import ApprovalDetail from './pages/HR/ApprovalDetail';
import TalentAcquisitionReports from './pages/HR/TalentAcquisitionReports';
import LearningManagement from './pages/HR/LearningManagement';
import Courses from './pages/HR/Courses';
import CourseForm from './pages/HR/CourseForm';
import Enrollments from './pages/HR/Enrollments';
import EnrollmentForm from './pages/HR/EnrollmentForm';
import EnrollmentDetail from './pages/HR/EnrollmentDetail';
import LearningReports from './pages/HR/LearningReports';
import TrainingPrograms from './pages/HR/TrainingPrograms';
import TrainingProgramForm from './pages/HR/TrainingProgramForm';
import TrainingProgramDetail from './pages/HR/TrainingProgramDetail';
import OrganizationalDevelopment from './pages/HR/OrganizationalDevelopment';
import OrganizationalChart from './pages/HR/OrganizationalChart';
import OrganizationalChartEditor from './pages/HR/OrganizationalChartEditor';
import JobAnalysis from './pages/HR/JobAnalysis';
import SuccessionPlanning from './pages/HR/SuccessionPlanning';
import JobApplication from './pages/Public/JobApplication';
import PublicApproval from './pages/Public/PublicApproval';
import OfferAcceptance from './pages/Public/OfferAcceptance';
import PublicJoiningDocument from './pages/Public/PublicJoiningDocument';
import PublicEmployeeOnboarding from './pages/Public/PublicEmployeeOnboarding';
import PublicEvaluationForm from './pages/Public/PublicEvaluationForm';
import PublicQuotationForm from './pages/Public/PublicQuotationForm';
import RegisterComplaint from './pages/Public/RegisterComplaint';
import MyComplaints from './pages/Public/MyComplaints';
import TajComplaintsPortal from './pages/Public/TajComplaintsPortal';

// Increment Management Pages
import IncrementList from './pages/Increments/IncrementList';
import CreateIncrement from './pages/Increments/CreateIncrement';
import IncrementHistory from './pages/Increments/IncrementHistory';
import IncrementDetail from './pages/Increments/IncrementDetail';

// KPI Management
import KPIDashboard from './pages/HR/KPI/KPIDashboard';
import KPITemplates from './pages/HR/KPI/KPITemplates';
import KPICycles from './pages/HR/KPI/KPICycles';
import ReviewKPIs from './pages/HR/KPI/ReviewKPIs';
import KPIMonthlySheet from './pages/HR/KPI/KPIMonthlySheet';
import KPISubmissionsOverview from './pages/HR/KPI/KPISubmissionsOverview';
import KPIReports from './pages/HR/KPI/KPIReports';

// Leave Management Pages
import LeaveManagement from './pages/HR/Leaves/LeaveManagement';
import LeaveApproval from './pages/HR/Leaves/LeaveApproval';
import LeaveCalendar from './pages/HR/Leaves/LeaveCalendar';
import LeaveReports from './pages/HR/Leaves/LeaveReports';
import EmployeeLeaveHistory from './pages/HR/Leaves/EmployeeLeaveHistory';

// Recovery module - lazy loaded for faster initial load (must be after all imports for eslint import/first)
const RecoveryAssignments = lazy(() => import('./pages/Finance/Recovery/RecoveryAssignments'));
const RecoveryMembers = lazy(() => import('./pages/Finance/Recovery/RecoveryMembers'));
const RecoveryTaskAssignment = lazy(() => import('./pages/Finance/Recovery/RecoveryTaskAssignment'));
const CompletedTasks = lazy(() => import('./pages/Finance/Recovery/CompletedTasks'));
const RecoveryCampaigns = lazy(() => import('./pages/Finance/Recovery/RecoveryCampaigns'));
const MyTasks = lazy(() => import('./pages/Finance/Recovery/MyTasks'));
const CashApprovals = lazy(() => import('./pages/Procurement/CashApprovals'));
const CashApprovalDocumentView = lazy(() => import('./pages/Procurement/CashApprovalDocumentView'));

// Taj Utilities Lazy Loaded Pages
const RentalAgreementsFinance = lazy(() => import('./pages/Finance/TajUtilities/RentalAgreements'));
const RentalAgreementDetailFinance = lazy(() => import('./pages/Finance/TajUtilities/RentalAgreementDetail'));
const RentalManagementFinance = lazy(() => import('./pages/Finance/TajUtilities/RentalManagement'));
const TajProperties = lazy(() => import('./pages/Finance/TajUtilities/TajProperties'));
const TajPropertyDetail = lazy(() => import('./pages/Finance/TajUtilities/TajPropertyDetail'));
const RentalManagementDetailFinance = lazy(() => import('./pages/Finance/TajUtilities/RentalManagementDetail'));
const TajUtilitiesDashboard = lazy(() => import('./pages/Finance/TajUtilities/Dashboard'));
const CAMCharges = lazy(() => import('./pages/Finance/TajUtilities/CAMCharges'));
const WaterBills = lazy(() => import('./pages/Finance/TajUtilities/WaterBills'));
const Electricity = lazy(() => import('./pages/Finance/TajUtilities/Electricity'));
const Invoices = lazy(() => import('./pages/Finance/TajUtilities/Invoices'));
const OpenInvoices = lazy(() => import('./pages/Finance/TajUtilities/OpenInvoices'));
const TajResidents = lazy(() => import('./pages/Finance/TajUtilities/TajResidents'));
const Deposits = lazy(() => import('./pages/Finance/TajUtilities/Deposits'));
const TajUtilityBanks = lazy(() => import('./pages/Finance/TajUtilities/Banks'));
const SuspenseAccount = lazy(() => import('./pages/Finance/TajUtilities/SuspenseAccount'));
const TajResidentDetail = lazy(() => import('./pages/Finance/TajUtilities/TajResidentDetail'));
const TajUtilitiesReports = lazy(() => import('./pages/Finance/TajUtilities/Reports'));
const TajUtilitiesReconciliation = lazy(() => import('./pages/Finance/TajUtilities/Reconciliation'));

// Printing / PDF & Excel Export Heavy Pages
const InvoicePrint = lazy(() => import('./pages/Finance/InvoicePrint'));
const BillPrint = lazy(() => import('./pages/Finance/BillPrint'));
const ComparativePL = lazy(() => import('./pages/Finance/ComparativePL'));
const CostCenterPL = lazy(() => import('./pages/Finance/CostCenterPL'));

const lazyPageFallback = (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
    <CircularProgress />
  </Box>
);

// Component to handle role-based redirects
const RoleBasedRedirect = () => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Get appropriate redirect path based on user role
  const getRedirectPath = (userRole) => {
    switch (userRole) {
      case 'super_admin':
      case 'developer':
        return '/dashboard';
      case 'admin':
        return '/admin/users';
      case 'hr_manager':
        return '/hr';
      case 'finance_manager':
        return '/finance';
      case 'procurement_manager':
        return '/procurement';
      case 'sales_manager':
        return '/sales';
      case 'crm_manager':
        return '/crm';
      case 'employee':
        return '/profile';
      default:
        return '/profile';
    }
  };

  const redirectPath = getRedirectPath(user.role);
  return <Navigate to={redirectPath} replace />;
};

// Public Route Component (redirects to role-appropriate page if already logged in)
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        Loading...
      </Box>
    );
  }

  if (user) {
    // Get appropriate redirect path based on user role
    const getRedirectPath = (userRole) => {
      switch (userRole) {
        case 'super_admin':
        case 'developer':
          return '/dashboard';
        case 'admin':
          return '/admin/users';
        case 'hr_manager':
          return '/hr';
        case 'finance_manager':
          return '/finance';
        case 'procurement_manager':
          return '/procurement';
        case 'sales_manager':
          return '/sales';
        case 'crm_manager':
          return '/crm';
        case 'employee':
          return '/profile';
        default:
          return '/profile';
      }
    };

    const redirectPath = getRedirectPath(user.role);
    return <Navigate to={redirectPath} replace />;
  }

  return children;
};

// Shared loading screen component
const LoadingScreen = ({ message = 'Loading SGC ERP System...' }) => (
  <Box
    display="flex"
    justifyContent="center"
    alignItems="center"
    minHeight="100vh"
    sx={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
  >
    <Box sx={{ textAlign: 'center', color: 'white' }}>
      <CircularProgress size={60} sx={{ color: 'white', mb: 2 }} />
      <Typography variant="h6">{message}</Typography>
    </Box>
  </Box>
);

// Network error screen component
const NetworkErrorScreen = ({ error, onRetry }) => (
  <Box
    display="flex"
    justifyContent="center"
    alignItems="center"
    minHeight="100vh"
    sx={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
  >
    <Box sx={{ textAlign: 'center', color: 'white', maxWidth: 500, p: 4 }}>
      <Typography variant="h5" gutterBottom>Connection Issue</Typography>
      <Typography variant="body1" sx={{ mb: 3, opacity: 0.9 }}>{error}</Typography>
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
        <Button
          variant="contained"
          onClick={onRetry}
          sx={{ bgcolor: 'white', color: 'primary.main', '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' } }}
        >
          Retry Connection
        </Button>
        <Button
          variant="outlined"
          onClick={() => window.location.reload()}
          sx={{ borderColor: 'white', color: 'white', '&:hover': { borderColor: 'rgba(255,255,255,0.9)', bgcolor: 'rgba(255,255,255,0.1)' } }}
        >
          Refresh Page
        </Button>
      </Box>
    </Box>
  </Box>
);

function App() {
  const { user, loading, token, error, retryAuth } = useAuth();
  const location = useLocation();
  const isScanOnlyPath = /^\/(?:asset-tagging\/scan|at)\/[^/]+/.test(location.pathname);

  // Scan-only mode: always render this route without ERP chrome/sidebar,
  // regardless of auth state, for mobile-friendly QR access.
  if (isScanOnlyPath) {
    return (
      <NoChromeLayout>
        <Routes>
          <Route path="/asset-tagging/scan/:tagCode" element={<ScanAssetPage />} />
          <Route path="/at/:tagCode" element={<ScanAssetPage />} />
          <Route path="*" element={<Navigate to={location.pathname} replace />} />
        </Routes>
      </NoChromeLayout>
    );
  }

  if (loading) return <LoadingScreen />;

  if (!user && token && error?.includes('Connection issue')) {
    return <NetworkErrorScreen error={error} onRetry={retryAuth} />;
  }

  // If user is not authenticated, show login page and public routes
  if (!user) {
    return (
      <NoChromeLayout>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/apply/:affiliateCode" element={<JobApplication />} />
          <Route path="/public-approval/:id" element={<PublicApproval />} />
          <Route path="/candidates/offer/:candidateId" element={<OfferAcceptance />} />
          <Route path="/public-joining-document/:approvalId" element={<PublicJoiningDocument />} />
          <Route path="/public-employee-onboarding/:id" element={<PublicEmployeeOnboarding />} />
          <Route path="/hr/evaluation-appraisal/fill/:id" element={<PublicEvaluationForm />} />
          <Route path="/public-quotation/:token" element={<PublicQuotationForm />} />
          <Route path="/taj-complaints" element={<TajComplaintsPortal />} />
          <Route path="/taj-complaints/register" element={<RegisterComplaint />} />
          <Route path="/taj-complaints/my" element={<MyComplaints />} />
          <Route path="/asset-tagging/scan/:tagCode" element={<ScanAssetPage />} />
          <Route path="/at/:tagCode" element={<ScanAssetPage />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </NoChromeLayout>
    );
  }

  // If user is authenticated, show the full application with layout
  return (
    <DataProvider>
      <FinanceCompanyProvider>
        <SidebarProvider>
          <Layout>
            <Sidebar />
            <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <Header />
              <ChatFloatingButton />
              <Box component="main" className="app-main-print" sx={{ flexGrow: 1, p: 3 }}>
                <Suspense fallback={lazyPageFallback}>
                  <Routes>
                    {/* Dashboard */}
                    <Route
                      path="/dashboard"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management"]}><Dashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/settings"
                      element={<ProtectedRoute><SettingsPage /></ProtectedRoute>}
                    />

                    {/* HR Module */}
                    <Route
                      path="/hr"
                      element={<ProtectedRoute><HRDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/employees"
                      element={<ProtectedRoute><EmployeeList /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/non-employee-onboarding"
                      element={<ProtectedRoute><NonEmployeeOnboarding /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/employees/add"
                      element={<ProtectedRoute><EmployeeForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/reports"
                      element={<ProtectedRoute><HRReports /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/reports/payroll/:reportType"
                      element={<ProtectedRoute><PayrollReport /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/reports/attendance/:reportType"
                      element={<ProtectedRoute><AttendanceReports /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/employees/:id"
                      element={<ProtectedRoute><EmployeeView /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/employees/:id/edit"
                      element={<ProtectedRoute><EmployeeForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/companies"
                      element={<ProtectedRoute><HRCompanies /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/departments"
                      element={<ProtectedRoute><Departments /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/projects"
                      element={<ProtectedRoute><Projects /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/payroll"
                      element={<ProtectedRoute><Payroll /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/payroll-taxes"
                      element={<ProtectedRoute><PayrollTaxes /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/payroll/create"
                      element={<ProtectedRoute><PayrollForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/payroll/:id/edit"
                      element={<ProtectedRoute><PayrollForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/payroll/view/:id"
                      element={<ProtectedRoute><PayrollDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/payroll/view/employee/:employeeId"
                      element={<ProtectedRoute><EmployeePayrollDetails /></ProtectedRoute>}
                    />

                    {/* Attendance Routes */}
                    <Route
                      path="/hr/attendance/employee/:employeeId/detail"
                      element={<ProtectedRoute><AttendanceDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/attendance/add"
                      element={<ProtectedRoute><AttendanceForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/attendance/:id/edit"
                      element={<ProtectedRoute><AttendanceForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/attendance/:id"
                      element={<ProtectedRoute><AttendanceForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/attendance"
                      element={<ProtectedRoute><AttendanceList /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/attendance-record"
                      element={<ProtectedRoute><AttendanceRecord /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/attendance-record/:employeeId"
                      element={<ProtectedRoute><AttendanceRecordDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/attendance/report"
                      element={<ProtectedRoute><AttendanceReport /></ProtectedRoute>}
                    />

                    {/* Biometric Integration Routes */}
                    <Route
                      path="/hr/biometric"
                      element={<ProtectedRoute><BiometricIntegration /></ProtectedRoute>}
                    />

                    {/* FBR Tax Management Routes */}
                    <Route
                      path="/hr/fbr-tax"
                      element={<ProtectedRoute><FBRTaxManagement /></ProtectedRoute>}
                    />

                    {/* Evaluation & Appraisal Routes */}
                    <Route
                      path="/hr/evaluation-appraisal/fill/:id"
                      element={<PublicEvaluationForm />}
                    />
                    <Route
                      path="/hr/evaluation-appraisal/edit/:id"
                      element={<ProtectedRoute><PublicEvaluationForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/evaluation-appraisal/dashboard"
                      element={<ProtectedRoute><EvaluationDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/evaluation-appraisal/documents"
                      element={<ProtectedRoute><EvaluationDocuments /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/evaluation-appraisal/authorities"
                      element={<ProtectedRoute requiredRole="super_admin"><EvaluationAuthorities /></ProtectedRoute>}
                    />

                    {/* Documents Tracking Routes */}
                    <Route
                      path="/documents-tracking/dashboard"
                      element={<ProtectedRoute><DocumentsTrackingDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/documents-tracking/evaluation"
                      element={<ProtectedRoute><EvaluationTracking /></ProtectedRoute>}
                    />
                    <Route
                      path="/documents-tracking"
                      element={<ProtectedRoute><DocumentsTracking /></ProtectedRoute>}
                    />

                    {/* KPI Management Routes */}
                    <Route
                      path="/hr/kpi/dashboard"
                      element={<ProtectedRoute><KPIDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/kpi/templates"
                      element={<ProtectedRoute><KPITemplates /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/kpi/cycles"
                      element={<ProtectedRoute><KPICycles /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/kpi/review"
                      element={<ProtectedRoute><ReviewKPIs /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/kpi/sheet"
                      element={<ProtectedRoute><KPIMonthlySheet /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/kpi/submissions"
                      element={<ProtectedRoute><KPISubmissionsOverview /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/kpi/reports"
                      element={<ProtectedRoute><KPIReports /></ProtectedRoute>}
                    />

                    {/* Indents Routes */}
                    <Route
                      path="/general/indents/dashboard"
                      element={<ProtectedRoute><IndentsDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/indents/create"
                      element={<ProtectedRoute><IndentForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/indents/:id/edit"
                      element={<ProtectedRoute><IndentForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/indents/:id/print"
                      element={<ProtectedRoute><IndentPrintView /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/indents/:id"
                      element={<ProtectedRoute><IndentDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/indents"
                      element={<ProtectedRoute><IndentsList /></ProtectedRoute>}
                    />

                    <Route
                      path="/general/cash-approvals/create"
                      element={<ProtectedRoute><GeneralCashApprovalForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/cash-approvals/:id/edit"
                      element={<ProtectedRoute><GeneralCashApprovalForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/cash-approvals/:id"
                      element={<ProtectedRoute><GeneralCashApprovalDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/cash-approvals"
                      element={<ProtectedRoute><GeneralCashApprovalsList /></ProtectedRoute>}
                    />
                    <Route
                      path="/cash-approvals/:id/view"
                      element={<ProtectedRoute><CashApprovalGeneralViewPage /></ProtectedRoute>}
                    />

                    {/* General Module - Centralized Store Routes (accessible to all departments/employees) */}
                    <Route
                      path="/general/centralized-store"
                      element={<ProtectedRoute><CentralizedStoreManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/centralized-store/bills"
                      element={<ProtectedRoute><CentralizedStoreBills /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/centralized-store/bills/:id"
                      element={<ProtectedRoute><UtilityBillDetails /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/centralized-store/bill/new"
                      element={<ProtectedRoute><UtilityBillForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/centralized-store/bill/:id/edit"
                      element={<ProtectedRoute><UtilityBillForm /></ProtectedRoute>}
                    />

                    <Route
                      path="/general/ceo-secretariat/payments"
                      element={<ProtectedRoute><Payments /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat"
                      element={<ProtectedRoute><Navigate to="/general/president-secretariat/dashboard" replace /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/dashboard"
                      element={<ProtectedRoute><PresidentSecretariatDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/meetings"
                      element={<ProtectedRoute><PresidentMeetings /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/meetings/print"
                      element={<ProtectedRoute><PresidentMeetingsListPrintView /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/meetings/:id/print"
                      element={<ProtectedRoute><PresidentMeetingPrintView /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/meetings/:id"
                      element={<ProtectedRoute><PresidentMeetingDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/events"
                      element={<ProtectedRoute><PresidentEvents /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/events/print"
                      element={<ProtectedRoute><PresidentEventsListPrintView /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/events/:id/print"
                      element={<ProtectedRoute><PresidentEventPrintView /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/president-secretariat/events/:id"
                      element={<ProtectedRoute><PresidentEventDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/payments"
                      element={<ProtectedRoute><Payments /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/user-tracking"
                      element={<ProtectedRoute><UserTracking /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management"
                      element={<ProtectedRoute><ProjectManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/overview"
                      element={<ProtectedRoute><ProjectManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/projects"
                      element={<ProtectedRoute><ProjectManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/subcontractor-statement"
                      element={<ProtectedRoute><SubcontractorStatement /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/approvals"
                      element={<ProtectedRoute><ProjectApprovals /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/wbs-activities"
                      element={<ProtectedRoute><WbsActivities /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/slabs"
                      element={<ProtectedRoute><SlabSchedules /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/workspace/:section"
                      element={<ProtectedRoute><ProjectWorkspaceRedirect /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/:id"
                      element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/cost-centers"
                      element={<ProtectedRoute><GeneralCostCenters /></ProtectedRoute>}
                    />

                    {/* Developer Module Routes */}
                    <Route
                      path="/developer/server-monitor"
                      element={<ProtectedRoute requiredRole={["super_admin", "developer"]}><ServerMonitor /></ProtectedRoute>}
                    />
                    <Route
                      path="/developer/financials"
                      element={<ProtectedRoute requiredRole={["super_admin", "developer"]}><FinancialsDashboard /></ProtectedRoute>}
                    />

                    {/* Loan Management Routes */}
                    <Route
                      path="/hr/loans"
                      element={<ProtectedRoute><LoanManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/loans/statistics"
                      element={<ProtectedRoute><LoanStatistics /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/loans/new"
                      element={<ProtectedRoute><LoanForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/loans/:id"
                      element={<ProtectedRoute><LoanDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/loans/:id/edit"
                      element={<ProtectedRoute><LoanForm /></ProtectedRoute>}
                    />

                    {/* Final Settlement Routes */}
                    <Route
                      path="/hr/settlements"
                      element={<ProtectedRoute><FinalSettlementManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/settlements/new"
                      element={<ProtectedRoute><FinalSettlementForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/settlements/:id"
                      element={<ProtectedRoute><FinalSettlementDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/settlements/:id/edit"
                      element={<ProtectedRoute><FinalSettlementForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/settlements/statistics"
                      element={<ProtectedRoute><FinalSettlementStatistics /></ProtectedRoute>}
                    />

                    {/* Increment Management Routes */}
                    <Route
                      path="/hr/increments"
                      element={<ProtectedRoute><IncrementList /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/increments/create"
                      element={<ProtectedRoute><CreateIncrement /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/increments/history"
                      element={<ProtectedRoute><IncrementHistory /></ProtectedRoute>}
                    />

                    {/* Leave Management Routes */}
                    <Route
                      path="/hr/leaves"
                      element={<ProtectedRoute requiredRole={['super_admin', 'admin', 'hr_manager']}><LeaveManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/leaves/approval"
                      element={<ProtectedRoute requiredRole={['super_admin', 'admin', 'hr_manager']}><LeaveApproval /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/leaves/calendar"
                      element={<ProtectedRoute requiredRole={['super_admin', 'admin', 'hr_manager']}><LeaveCalendar /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/leaves/reports"
                      element={<ProtectedRoute requiredRole={['super_admin', 'admin', 'hr_manager']}><LeaveReports /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/leaves/employee/:employeeId"
                      element={<ProtectedRoute requiredRole={['super_admin', 'admin', 'hr_manager']}><EmployeeLeaveHistory /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/increments/:id"
                      element={<ProtectedRoute><IncrementDetail /></ProtectedRoute>}
                    />

                    {/* Talent Acquisition Routes */}
                    <Route
                      path="/hr/talent-acquisition"
                      element={<ProtectedRoute><TalentAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/job-postings"
                      element={<ProtectedRoute><JobPostings /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/job-postings/new"
                      element={<ProtectedRoute><JobPostingForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/job-postings/:id"
                      element={<ProtectedRoute><JobPostingForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/job-postings/:id/edit"
                      element={<ProtectedRoute><JobPostingForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/candidates"
                      element={<ProtectedRoute><Candidates /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/candidates/new"
                      element={<ProtectedRoute><CandidateForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/candidates/:id"
                      element={<ProtectedRoute><CandidateForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/candidates/:id/edit"
                      element={<ProtectedRoute><CandidateForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/applications"
                      element={<ProtectedRoute><Applications /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/applications/new"
                      element={<ProtectedRoute><ApplicationForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/applications/:id"
                      element={<ProtectedRoute><ApplicationForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/applications/:id/edit"
                      element={<ProtectedRoute><ApplicationForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/talent-acquisition/reports"
                      element={<ProtectedRoute><TalentAcquisitionReports /></ProtectedRoute>}
                    />

                    {/* Candidate Approval Routes */}
                    <Route
                      path="/hr/candidate-approvals"
                      element={<ProtectedRoute><CandidateApprovals /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/approvals/:id"
                      element={<ProtectedRoute><ApprovalDetail /></ProtectedRoute>}
                    />
                    {/* Public Approval Route for Email Links */}
                    <Route
                      path="/approvals/:id"
                      element={<ApprovalDetail />}
                    />

                    {/* Learning & Development Module */}
                    <Route
                      path="/hr/learning"
                      element={<ProtectedRoute><LearningManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/courses"
                      element={<ProtectedRoute><Courses /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/courses/new"
                      element={<ProtectedRoute><CourseForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/courses/:id"
                      element={<ProtectedRoute><CourseForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/courses/:id/edit"
                      element={<ProtectedRoute><CourseForm /></ProtectedRoute>}
                    />

                    {/* Enrollment Routes */}
                    <Route
                      path="/hr/learning/enrollments"
                      element={<ProtectedRoute><Enrollments /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/enrollments/new"
                      element={<ProtectedRoute><EnrollmentForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/enrollments/:id"
                      element={<ProtectedRoute><EnrollmentDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/enrollments/:id/edit"
                      element={<ProtectedRoute><EnrollmentForm /></ProtectedRoute>}
                    />

                    {/* Learning Reports */}
                    <Route
                      path="/hr/learning/reports"
                      element={<ProtectedRoute><LearningReports /></ProtectedRoute>}
                    />

                    {/* Training Programs Routes */}
                    <Route
                      path="/hr/learning/programs"
                      element={<ProtectedRoute><TrainingPrograms /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/programs/new"
                      element={<ProtectedRoute><TrainingProgramForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/programs/:id"
                      element={<ProtectedRoute><TrainingProgramDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/learning/programs/:id/edit"
                      element={<ProtectedRoute><TrainingProgramForm /></ProtectedRoute>}
                    />

                    {/* Organizational Development Routes */}
                    <Route
                      path="/hr/organizational-development"
                      element={<ProtectedRoute><OrganizationalDevelopment /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/organizational-development/org-chart"
                      element={<ProtectedRoute><OrganizationalChart /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/organizational-development/org-chart/edit"
                      element={<ProtectedRoute><OrganizationalChartEditor /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/organizational-development/job-analysis"
                      element={<ProtectedRoute><JobAnalysis /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/organizational-development/succession"
                      element={<ProtectedRoute><SuccessionPlanning /></ProtectedRoute>}
                    />

                    {/* Public Application Route - Handled in unauthenticated section */}

                    {/* Finance Module */}
                    <Route
                      path="/finance"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinanceDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/accounts"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><ChartOfAccounts /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/cost-centers"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinanceCostCenters /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/banking-setup"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BankingSetup /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/journal-entries"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><JournalEntriesList /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/journal-entries/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><JournalEntryForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/journal-entries/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><VoucherView /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/journal-entries/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><JournalEntryForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/general-ledger"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><GeneralLedger /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/customers"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinanceCustomersList /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/accounts-receivable"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><AccountsReceivable /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/accounts-receivable/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><StandardCustomerInvoiceForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/accounts-receivable/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><StandardCustomerInvoiceForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/accounts-payable"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><AccountsPayable /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/accounts-payable/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "hr_manager"]}><StandardVendorBillForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/accounts-payable/bill/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "hr_manager"]}><UtilityBillForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/utility-bills/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><UtilityBillDetails /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/banking"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><Banking /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/reports"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinancialReports /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/legacy"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><Legacy /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/journals"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinanceJournals /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/fiscal-periods"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FiscalPeriods /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/inventory-categories"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><InventoryCategories /></ProtectedRoute>}
                    />
                    <Route
                      path="/finance/inventory-valuation"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><InventoryValuation /></ProtectedRoute>}
                    />
                    <Route path="/finance/taxes" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><TaxManagement /></ProtectedRoute>} />
                    <Route path="/finance/fixed-assets" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FixedAssets /></ProtectedRoute>} />
                    <Route path="/asset-tagging" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><AssetTaggingDashboard /></ProtectedRoute>} />
                    <Route path="/asset-tagging/register" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><FixedAssetRegisterPage /></ProtectedRoute>} />
                    <Route path="/asset-tagging/assets" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><TaggedAssetsPage /></ProtectedRoute>} />
                    <Route path="/asset-tagging/verification/:sessionId" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><VerificationPage /></ProtectedRoute>} />
                    <Route path="/asset-tagging/verification" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><VerificationPage /></ProtectedRoute>} />
                    <Route path="/asset-tagging/events" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><TagEventsPage /></ProtectedRoute>} />
                    <Route path="/asset-tagging/scan/:tagCode" element={<ScanAssetPage />} />
                    <Route path="/at/:tagCode" element={<ScanAssetPage />} />
                    <Route path="/asset-tagging/label/:assetId" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><LabelPrintPage /></ProtectedRoute>} />
                    <Route path="/asset-tagging/labels/print" element={<ProtectedRoute requiredRole={["super_admin", "admin", "higher_management", "finance_manager", "procurement_manager", "audit_manager"]}><BulkLabelPrintPage /></ProtectedRoute>} />
                    <Route path="/finance/bank-reconciliation" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BankReconciliation /></ProtectedRoute>} />
                    <Route path="/finance/payroll-queue" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinancePayroll /></ProtectedRoute>} />
                    <Route path="/finance/vendors" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "procurement_manager"]}><FinanceVendorsList /></ProtectedRoute>} />
                    <Route path="/finance/vendor-statement" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "procurement_manager"]}><VendorStatement /></ProtectedRoute>} />
                    <Route path="/finance/budget-vs-actual" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BudgetVsActual /></ProtectedRoute>} />
                    <Route path="/finance/aged-payables" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><AgedPayables /></ProtectedRoute>} />
                    <Route path="/finance/payment-terms" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><PaymentTerms /></ProtectedRoute>} />
                    <Route path="/finance/balance-sheet" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BalanceSheet /></ProtectedRoute>} />
                    <Route path="/finance/profit-loss" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><ProfitLoss /></ProtectedRoute>} />
                    <Route path="/finance/tax-summary" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><TaxSummary /></ProtectedRoute>} />
                    <Route path="/finance/opening-balances" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><OpeningBalances /></ProtectedRoute>} />
                    <Route path="/finance/trial-balance" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><TrialBalance /></ProtectedRoute>} />
                    <Route path="/finance/cash-flow" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><CashFlow /></ProtectedRoute>} />
                    <Route path="/finance/year-end-closing" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><YearEndClosing /></ProtectedRoute>} />
                    <Route path="/finance/customer-statement" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><CustomerStatement /></ProtectedRoute>} />
                    <Route path="/finance/aged-receivables" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><AgedReceivables /></ProtectedRoute>} />
                    <Route path="/finance/customer-payments" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><CustomerPayments /></ProtectedRoute>} />
                    <Route path="/finance/credit-notes" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><CreditNotes /></ProtectedRoute>} />
                    <Route path="/finance/vendor-advance" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><VendorAdvance /></ProtectedRoute>} />
                    <Route
                      path="/finance/cash-approvals"
                      element={
                        <ProtectedRoute requiredRole={['super_admin', 'admin', 'finance_manager']}>
                          <Suspense fallback={lazyPageFallback}>
                            <CashApprovals />
                          </Suspense>
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/finance/vendor-payments" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><VendorPayments /></ProtectedRoute>} />
                    <Route path="/finance/vendor-refunds" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><VendorRefunds /></ProtectedRoute>} />
                    <Route path="/finance/bill-to-receive" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BillToReceive /></ProtectedRoute>} />
                    <Route path="/finance/billed-not-received" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BilledNotReceived /></ProtectedRoute>} />
                    <Route path="/finance/invoice-print/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><InvoicePrint /></ProtectedRoute>} />
                    <Route path="/finance/bill-print/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BillPrint /></ProtectedRoute>} />
                    <Route path="/finance/recurring-journals" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><RecurringJournals /></ProtectedRoute>} />
                    <Route path="/finance/payables-hub" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "accounts_officer", "finance_controller"]}><PayablesHub /></ProtectedRoute>} />
                    <Route path="/finance/batch-payment" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BatchPayment /></ProtectedRoute>} />
                    <Route path="/finance/company-profile" element={<ProtectedRoute requiredRole={["super_admin", "admin"]}><CompanyProfile /></ProtectedRoute>} />
                    <Route path="/finance/companies" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinanceCompanies /></ProtectedRoute>} />
                    <Route path="/finance/comparative-pl" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><ComparativePL /></ProtectedRoute>} />
                    <Route path="/finance/cost-center-pl" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><CostCenterPL /></ProtectedRoute>} />
                    <Route path="/finance/budgets" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BudgetList /></ProtectedRoute>} />
                    <Route path="/finance/budgets/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BudgetForm /></ProtectedRoute>} />
                    <Route path="/finance/deferred-entries" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><DeferredEntries /></ProtectedRoute>} />
                    <Route path="/finance/bank-statement-import" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BankStatementImport /></ProtectedRoute>} />
                    <Route path="/finance/vouchers" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><Vouchers /></ProtectedRoute>} />
                    <Route path="/finance/vouchers/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><VoucherView /></ProtectedRoute>} />
                    <Route path="/finance/setup" element={<ProtectedRoute requiredRole={["super_admin"]}><FinanceSetup /></ProtectedRoute>} />
                    <Route path="/procurement/purchase-returns" element={<ProtectedRoute requiredRole={["super_admin", "admin", "procurement_manager"]}><PurchaseReturns /></ProtectedRoute>} />
                    <Route
                      path="/finance/taj-utilities-charges"
                      element={<Navigate to="/finance/taj-utilities-charges/dashboard" replace />}
                    />
                    <Route
                      path="/finance/taj-utilities-charges/dashboard"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajUtilitiesDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/cam-charges"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <CAMCharges />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/water-bills"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <WaterBills />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/electricity-bills"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <Electricity />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/rental-agreements"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <RentalAgreementsFinance />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/rental-agreements/:id"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <RentalAgreementDetailFinance />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/rental-management"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <RentalManagementFinance />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/rental-management/:id"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <RentalManagementDetailFinance />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/taj-residents"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajResidents />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/taj-residents/:id"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajResidentDetail />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/taj-properties"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajProperties />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/taj-properties/:id"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajPropertyDetail />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/charges-slabs"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <ChargesSlabs />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/invoices"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <Invoices />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/open-invoices"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <OpenInvoices />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/deposits"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <Deposits />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/banks"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajUtilityBanks />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/suspense-account"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <SuspenseAccount />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/reports"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajUtilitiesReports />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/taj-utilities-charges/reconciliation"
                      element={
                        <ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "tcm_manager", "developer"]}>
                          <TajUtilitiesReconciliation />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/recovery"
                      element={<Navigate to="/finance/recovery/recovery-assignments" replace />}
                    />
                    <Route
                      path="/finance/recovery/recovery-assignments"
                      element={
                        <ProtectedRoute>
                          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}><CircularProgress /></Box>}>
                            <RecoveryAssignments />
                          </Suspense>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/recovery/recovery-members"
                      element={
                        <ProtectedRoute>
                          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}><CircularProgress /></Box>}>
                            <RecoveryMembers />
                          </Suspense>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/recovery/task-assignment"
                      element={
                        <ProtectedRoute>
                          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}><CircularProgress /></Box>}>
                            <RecoveryTaskAssignment />
                          </Suspense>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/recovery/completed-tasks"
                      element={
                        <ProtectedRoute>
                          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}><CircularProgress /></Box>}>
                            <CompletedTasks />
                          </Suspense>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/recovery/campaigns"
                      element={
                        <ProtectedRoute>
                          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}><CircularProgress /></Box>}>
                            <RecoveryCampaigns />
                          </Suspense>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/finance/recovery/my-tasks"
                      element={
                        <ProtectedRoute>
                          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}><CircularProgress /></Box>}>
                            <MyTasks />
                          </Suspense>
                        </ProtectedRoute>
                      }
                    />

                    {/* Procurement Module */}
                    <Route
                      path="/procurement"
                      element={<ProtectedRoute><ProcurementDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/requisitions/:id/print"
                      element={<ProtectedRoute><RequisitionPrintView /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/requisitions"
                      element={<ProtectedRoute><Requisitions /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/task-assignment"
                      element={<ProtectedRoute><ProcurementTaskAssignment /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/quotations"
                      element={<ProtectedRoute><Quotations /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/comparative-statements"
                      element={<ProtectedRoute><ComparativeStatements /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/purchase-orders"
                      element={<ProtectedRoute><PurchaseOrders /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/vendors"
                      element={<ProtectedRoute><Vendors /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/subcontractors"
                      element={<ProtectedRoute><Vendors /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/subcontractors"
                      element={<ProtectedRoute><Vendors /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/reports"
                      element={<ProtectedRoute><ProcurementReports /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/vendor-bills"
                      element={<ProtectedRoute><VendorBills /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/vendor-bills/new"
                      element={<ProtectedRoute><UtilityBillForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/vendor-bills/bill/:id/edit"
                      element={<ProtectedRoute><UtilityBillForm /></ProtectedRoute>}
                    />
                    {/* Store Submodule Routes */}
                    <Route
                      path="/procurement/store"
                      element={<ProtectedRoute><StoreDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/dashboard"
                      element={<Navigate to="/procurement/store" replace />}
                    />
                    <Route
                      path="/procurement/store/quality-assurance"
                      element={<ProtectedRoute><Navigate to="/procurement/store/delivery-challan-qa" replace /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/inventory"
                      element={<ProtectedRoute><Inventory /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/goods-receive"
                      element={<ProtectedRoute><GoodsReceive /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/delivery-challans"
                      element={<ProtectedRoute><DeliveryChallans /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/delivery-challan-qa"
                      element={<ProtectedRoute><DeliveryChallanQA /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/goods-issue"
                      element={<ProtectedRoute><GoodsIssue /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/cost-center"
                      element={<ProtectedRoute><CostCenters /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/manage"
                      element={<ProtectedRoute><StoreManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/item-catalog"
                      element={<ProtectedRoute><StoreItemCatalog /></ProtectedRoute>}
                    />
                    {/* Legacy routes - redirect to new paths */}
                    <Route
                      path="/procurement/inventory"
                      element={<Navigate to="/procurement/store/inventory" replace />}
                    />
                    <Route
                      path="/procurement/goods-receive"
                      element={<Navigate to="/procurement/store/goods-receive" replace />}
                    />
                    <Route
                      path="/procurement/goods-issue"
                      element={<Navigate to="/procurement/store/goods-issue" replace />}
                    />
                    <Route
                      path="/procurement/cost-centers"
                      element={<Navigate to="/procurement/store/cost-center" replace />}
                    />

                    {/* Sales Module */}
                    <Route
                      path="/sales"
                      element={<ProtectedRoute><SalesDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/sales/orders"
                      element={<ProtectedRoute><SalesOrders /></ProtectedRoute>}
                    />
                    <Route
                      path="/sales/customers"
                      element={<ProtectedRoute><SalesCustomers /></ProtectedRoute>}
                    />
                    <Route
                      path="/sales/products"
                      element={<ProtectedRoute><SalesProducts /></ProtectedRoute>}
                    />
                    <Route
                      path="/sales/reports"
                      element={<ProtectedRoute><SalesReports /></ProtectedRoute>}
                    />

                    {/* CRM Module */}
                    <Route
                      path="/crm"
                      element={<ProtectedRoute><CRMDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/leads"
                      element={<ProtectedRoute><Leads /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/leads/new"
                      element={<ProtectedRoute><Leads /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/leads/:id"
                      element={<ProtectedRoute><Leads /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/leads/:id/edit"
                      element={<ProtectedRoute><Leads /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/contacts"
                      element={<ProtectedRoute><Contacts /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/contacts/new"
                      element={<ProtectedRoute><Contacts /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/contacts/:id"
                      element={<ProtectedRoute><Contacts /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/contacts/:id/edit"
                      element={<ProtectedRoute><Contacts /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/companies"
                      element={<ProtectedRoute><Companies /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/companies/new"
                      element={<ProtectedRoute><Companies /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/companies/:id"
                      element={<ProtectedRoute><Companies /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/companies/:id/edit"
                      element={<ProtectedRoute><Companies /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/campaigns"
                      element={<ProtectedRoute><Campaigns /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/campaigns/new"
                      element={<ProtectedRoute><Campaigns /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/campaigns/:id"
                      element={<ProtectedRoute><Campaigns /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/campaigns/:id/edit"
                      element={<ProtectedRoute><Campaigns /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/opportunities"
                      element={<ProtectedRoute><Opportunities /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/opportunities/new"
                      element={<ProtectedRoute><Opportunities /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/opportunities/:id"
                      element={<ProtectedRoute><Opportunities /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/opportunities/:id/edit"
                      element={<ProtectedRoute><Opportunities /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/reports"
                      element={<ProtectedRoute><Reports /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/poll/new"
                      element={<ProtectedRoute><PollBuilder /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/poll/:id/edit"
                      element={<ProtectedRoute><PollBuilder /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/dashboard"
                      element={<ProtectedRoute><SurveyExecutiveDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey"
                      element={<ProtectedRoute><SurveyList /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/mine"
                      element={<ProtectedRoute><SurveyList /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/new"
                      element={<ProtectedRoute><SurveyBuilder /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/:id/edit"
                      element={<ProtectedRoute><SurveyBuilder /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/:id/respond"
                      element={<ProtectedRoute><SurveyRespond /></ProtectedRoute>}
                    />
                    <Route
                      path="/crm/survey/:id/analytics"
                      element={<ProtectedRoute><SurveyAnalytics /></ProtectedRoute>}
                    />

                    {/* Profile */}
                    <Route
                      path="/profile"
                      element={<ProtectedRoute><Profile /></ProtectedRoute>}
                    />
                    <Route
                      path="/profile/kpis"
                      element={<ProtectedRoute><MyKPIs /></ProtectedRoute>}
                    />
                    <Route
                      path="/profile/kpi-sheet"
                      element={<ProtectedRoute><KPIMonthlySheet /></ProtectedRoute>}
                    />
                    <Route
                      path="/profile/team-kpi-reviews"
                      element={<ProtectedRoute><KPIMonthlySheet /></ProtectedRoute>}
                    />
                    <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
                    <Route path="/chat/moderation" element={<ProtectedRoute><ChatModerationPage /></ProtectedRoute>} />
                    <Route path="/chat/:conversationId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />

                    {/* Admin Module */}
                    <Route
                      path="/admin/dashboard"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "am_admin", "hod_admin", "audit_manager", "finance_manager", "ceo_office", "hr_manager"]}><AdminDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/users"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "appraisal_manager"]}><UserManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/users/online"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "appraisal_manager"]}><OnlineUsers /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/users/mobile-approvals"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "developer"]}><MobileApprovalNotifications /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/roles"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><RoleManagement /></ProtectedRoute>}
                    />
                    {/* Vehicle Management Routes */}
                    <Route
                      path="/admin/vehicle-management"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/vehicles"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleList /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/vehicles/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/vehicles/:id/view"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleDetailsView /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/vehicles/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleDetails /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/vehicles/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/location"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleLocationList /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/maintenance"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleMaintenanceList /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/maintenance/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleMaintenanceForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/maintenance/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleMaintenanceForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/logbook"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleLogBookList /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/logbook/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleLogBookForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/logbook/:id/view"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleLogBookDetailsView /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/logbook/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleLogBookForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicle-management/reports"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleReports /></ProtectedRoute>}
                    />
                    {/* Legacy vehicle routes for backward compatibility */}
                    <Route
                      path="/admin/vehicles"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleList /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicles/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicles/:id/view"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleDetailsView /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicles/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleDetails /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/vehicles/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><VehicleForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/houses-inventory"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><HouseInventoryDashboard /></ProtectedRoute>}
                    />
                    {/* Centralized Store (bills + utility bills live here) */}
                    <Route
                      path="/admin/centralized-store"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><CentralizedStoreManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/centralized-store/bills"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><CentralizedStoreBills /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/centralized-store/bills/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin"]}><UtilityBillDetails /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/centralized-store/bill/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><UtilityBillForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/centralized-store/bill/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><UtilityBillForm /></ProtectedRoute>}
                    />

                    {/* Rental Management Routes */}
                    <Route
                      path="/admin/rental-agreements"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><RentalAgreementList /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/rental-agreements/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><RentalAgreementDetail /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/rental-management"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><RentalManagementDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/admin/rental-management/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "hr_manager"]}><RentalManagementDetail /></ProtectedRoute>}
                    />

                    {/* IT Module Routes */}
                    <Route
                      path="/it"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><ITDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/assets"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><AssetList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/assets/add"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><AssetForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/assets/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><AssetList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/assets/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><AssetForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/assets/:id/assign"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><AssetAssignment /></ProtectedRoute>}
                    />

                    {/* Software Management Routes */}
                    <Route
                      path="/it/software"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><SoftwareList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/software/add"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><SoftwareForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/software/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><SoftwareList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/software/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><SoftwareForm /></ProtectedRoute>}
                    />

                    {/* Network Management Routes */}
                    <Route
                      path="/it/network"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><NetworkList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/network/add"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><NetworkForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/network/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><NetworkList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/network/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><NetworkForm /></ProtectedRoute>}
                    />

                    {/* Vendor Management Routes */}
                    <Route
                      path="/it/vendors"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><VendorList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/vendors/add"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><VendorForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/vendors/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><VendorList /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/vendors/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><VendorForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/vendors/:id/contracts"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><VendorContracts /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/vendors/:id/passwords"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><PasswordWallet /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/vendors/:id/passwords/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><PasswordForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/passwords/:passwordId/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><PasswordForm /></ProtectedRoute>}
                    />

                    {/* Password Wallet Dashboard Routes */}
                    <Route
                      path="/it/passwords"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><PasswordWalletDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/it/passwords/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><PasswordForm /></ProtectedRoute>}
                    />

                    {/* IT Reports Routes */}
                    <Route
                      path="/it/reports"
                      element={<ProtectedRoute requiredRole={["super_admin", "admin", "it_manager"]}><ITReports /></ProtectedRoute>}
                    />

                    {/* Taj Residencia Routes */}
                    <Route
                      path="/taj-residencia"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><TajResidenciaDashboard /></ProtectedRoute>}
                    />

                    <Route
                      path="/taj-residencia/complains-tickets"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><ComplainsTickets /></ProtectedRoute>}
                    />

                    <Route
                      path="/taj-residencia/land-acquisition"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/maps"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/moza"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/registry"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/possession"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/exchange"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/transfers"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/reports"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/dashboard"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandAcquisition /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/parties"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandParties /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/parties/sellers"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandParties /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/parties/buyers"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandParties /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-acquisition/parties/dealers"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandParties /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-purchase"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandPurchaseViewer /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-purchase/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandPurchaseFormPage /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-purchase/:id"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandPurchaseDetailPage /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-purchase/:id/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandPurchaseFormPage /></ProtectedRoute>}
                    />
                    <Route
                      path="/taj-residencia/land-transfers"
                      element={<ProtectedRoute requiredRole={["super_admin", "taj_residencia_manager"]}><LandTransferViewer /></ProtectedRoute>}
                    />

                    {/* Audit Module Routes */}
                    <Route
                      path="/audit"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><AuditDashboard /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/list"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><AuditList /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "audit_director", "Audit Director"]}><AuditForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/:auditId/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "audit_director", "Audit Director"]}><AuditForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/findings"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><AuditFindings /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/findings/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><AddAuditFinding /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/corrective-actions"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><CorrectiveActions /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/corrective-actions/new"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "audit_director", "Audit Director"]}><CorrectiveActionForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/corrective-actions/:actionId/edit"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "audit_director", "Audit Director"]}><CorrectiveActionForm /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/trail"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "audit_director", "Audit Director"]}><AuditTrail /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/reports"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><AuditReports /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/schedules"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><AuditSchedules /></ProtectedRoute>}
                    />
                    <Route
                      path="/audit/pre-audit"
                      element={<ProtectedRoute requiredRole={["super_admin", "audit_manager", "auditor", "audit_director", "Audit Director"]}><PreAudit /></ProtectedRoute>}
                    />

                    {/* HR Management Routes */}
                    <Route
                      path="/hr/departments/manage"
                      element={<ProtectedRoute><DepartmentManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/positions/manage"
                      element={<ProtectedRoute><PositionManagement /></ProtectedRoute>}
                    />
                    <Route
                      path="/hr/banks/manage"
                      element={<ProtectedRoute><BankManagement /></ProtectedRoute>}
                    />

                    <Route
                      path="/taj-complaints"
                      element={<TajComplaintsPortal />}
                    />
                    <Route
                      path="/taj-complaints/register"
                      element={<RegisterComplaint />}
                    />
                    <Route
                      path="/taj-complaints/my"
                      element={<MyComplaints />}
                    />

                    {/* Public Routes (accessible to authenticated users) */}
                    <Route
                      path="/public-quotation/:token"
                      element={
                        <NoChromeLayout>
                          <PublicQuotationForm />
                        </NoChromeLayout>
                      }
                    />

                    {/* Default redirects */}
                    <Route
                      path="/"
                      element={<RoleBasedRedirect />}
                    />
                    <Route
                      path="/login"
                      element={<RoleBasedRedirect />}
                    />

                    <Route
                      path="*"
                      element={<NotFound />}
                    />
                  </Routes>
                </Suspense>
              </Box>
            </Box>
          </Layout>
        </SidebarProvider>
      </FinanceCompanyProvider>
    </DataProvider>
  );
}

export default App;