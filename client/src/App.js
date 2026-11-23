import React, { Suspense } from 'react';
import lazyWithReload from './utils/lazyWithReload';
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
import ChatFloatingButton from './components/ChatFloatingButton';

// IT Module Components


// Audit Module Components


import { PresidentOnly } from './pages/Dashboard/HomeDashboard';
import { isPresidentUser } from './utils/presidentAccess';

// Pages load on demand (each page is its own chunk) so the first visit downloads only the app shell.
// Login stays in the main bundle so the sign-in screen appears immediately.
const Dashboard = lazyWithReload(() => import('./pages/Dashboard/Dashboard'));
const HRDashboard = lazyWithReload(() => import('./pages/HR/HRDashboard'));
const EmployeeList = lazyWithReload(() => import('./pages/HR/EmployeeList'));
const NonEmployeeOnboarding = lazyWithReload(() => import('./pages/HR/NonEmployeeOnboarding'));
const EmployeeForm = lazyWithReload(() => import('./pages/HR/EmployeeForm'));
const EmployeeView = lazyWithReload(() => import('./pages/HR/EmployeeView'));
const HRReports = lazyWithReload(() => import('./pages/HR/Reports/HRReports'));
const PayrollReport = lazyWithReload(() => import('./pages/HR/Reports/PayrollReport'));
const AttendanceReports = lazyWithReload(() => import('./pages/HR/Reports/AttendanceReports'));
const Departments = lazyWithReload(() => import('./pages/HR/Departments'));
const Projects = lazyWithReload(() => import('./pages/HR/Projects'));
const HRCompanies = lazyWithReload(() => import('./pages/HR/Companies'));
const Payroll = lazyWithReload(() => import('./pages/HR/Payroll'));
const PayrollForm = lazyWithReload(() => import('./pages/HR/PayrollForm'));
const PayrollDetail = lazyWithReload(() => import('./pages/HR/PayrollDetail'));
const EmployeePayrollDetails = lazyWithReload(() => import('./pages/HR/EmployeePayrollDetails'));
const AttendanceList = lazyWithReload(() => import('./pages/HR/AttendanceList'));
const AttendanceRecord = lazyWithReload(() => import('./pages/HR/AttendanceRecord'));
const AttendanceRecordDetail = lazyWithReload(() => import('./pages/HR/AttendanceRecordDetail'));
const AttendanceDetail = lazyWithReload(() => import('./pages/HR/AttendanceDetail'));
const AttendanceForm = lazyWithReload(() => import('./pages/HR/AttendanceForm'));
const AttendanceReport = lazyWithReload(() => import('./pages/HR/AttendanceReport'));
const BiometricIntegration = lazyWithReload(() => import('./pages/HR/BiometricIntegration'));
const FinanceDashboard = lazyWithReload(() => import('./pages/Finance/FinanceDashboard'));
const ChartOfAccounts = lazyWithReload(() => import('./pages/Finance/ChartOfAccounts'));
const BankingSetup = lazyWithReload(() => import('./pages/Finance/BankingSetup'));
const GeneralLedger = lazyWithReload(() => import('./pages/Finance/GeneralLedger'));
const AccountsReceivable = lazyWithReload(() => import('./pages/Finance/AccountsReceivable'));
const AccountsPayable = lazyWithReload(() => import('./pages/Finance/AccountsPayable'));
const Banking = lazyWithReload(() => import('./pages/Finance/Banking'));
const FinancialReports = lazyWithReload(() => import('./pages/Finance/FinancialReports'));
const ChargesSlabs = lazyWithReload(() => import('./pages/Finance/TajUtilities/ChargesSlabs'));
const JournalEntryForm = lazyWithReload(() => import('./pages/Finance/JournalEntryForm'));
const JournalEntriesList = lazyWithReload(() => import('./pages/Finance/JournalEntriesList'));
const FinanceJournals = lazyWithReload(() => import('./pages/Finance/FinanceJournals'));
const FiscalPeriods = lazyWithReload(() => import('./pages/Finance/FiscalPeriods'));
const InventoryCategories = lazyWithReload(() => import('./pages/Finance/InventoryCategories'));
const InventoryValuation = lazyWithReload(() => import('./pages/Finance/InventoryValuation'));
const TaxManagement = lazyWithReload(() => import('./pages/Finance/TaxManagement'));
const FixedAssets = lazyWithReload(() => import('./pages/Finance/FixedAssets'));
const AssetTaggingDashboard = lazyWithReload(() => import('./pages/AssetTagging/AssetTaggingDashboard'));
const TaggedAssetsPage = lazyWithReload(() => import('./pages/AssetTagging/TaggedAssetsPage'));
const FixedAssetRegisterPage = lazyWithReload(() => import('./pages/AssetTagging/FixedAssetRegisterPage'));
const VerificationPage = lazyWithReload(() => import('./pages/AssetTagging/VerificationPage'));
const TagEventsPage = lazyWithReload(() => import('./pages/AssetTagging/TagEventsPage'));
const ScanAssetPage = lazyWithReload(() => import('./pages/AssetTagging/ScanAssetPage'));
const LabelPrintPage = lazyWithReload(() => import('./pages/AssetTagging/LabelPrintPage'));
const BulkLabelPrintPage = lazyWithReload(() => import('./pages/AssetTagging/BulkLabelPrintPage'));
const BankReconciliation = lazyWithReload(() => import('./pages/Finance/BankReconciliation'));
const VendorStatement = lazyWithReload(() => import('./pages/Finance/VendorStatement'));
const FinanceVendorsList = lazyWithReload(() => import('./pages/Finance/FinanceVendorsList'));
const FinanceCustomersList = lazyWithReload(() => import('./pages/Finance/FinanceCustomersList'));
const FinancePayroll = lazyWithReload(() => import('./pages/Finance/FinancePayroll'));
const BudgetVsActual = lazyWithReload(() => import('./pages/Finance/BudgetVsActual'));
const AgedPayables = lazyWithReload(() => import('./pages/Finance/AgedPayables'));
const PaymentTerms = lazyWithReload(() => import('./pages/Finance/PaymentTerms'));
const BalanceSheet = lazyWithReload(() => import('./pages/Finance/BalanceSheet'));
const ProfitLoss = lazyWithReload(() => import('./pages/Finance/ProfitLoss'));
const TaxSummary = lazyWithReload(() => import('./pages/Finance/TaxSummary'));
const OpeningBalances = lazyWithReload(() => import('./pages/Finance/OpeningBalances'));
const TrialBalance = lazyWithReload(() => import('./pages/Finance/TrialBalance'));
const CashFlow = lazyWithReload(() => import('./pages/Finance/CashFlow'));
const YearEndClosing = lazyWithReload(() => import('./pages/Finance/YearEndClosing'));
const CustomerStatement = lazyWithReload(() => import('./pages/Finance/CustomerStatement'));
const AgedReceivables = lazyWithReload(() => import('./pages/Finance/AgedReceivables'));
const CustomerPayments = lazyWithReload(() => import('./pages/Finance/CustomerPayments'));
const LoanReceipts = lazyWithReload(() => import('./pages/Finance/LoanReceipts'));
const CreditNotes = lazyWithReload(() => import('./pages/Finance/CreditNotes'));
const VendorPayments = lazyWithReload(() => import('./pages/Finance/VendorPayments'));
const VendorAdvance = lazyWithReload(() => import('./pages/Finance/VendorAdvance'));
const VendorRefunds = lazyWithReload(() => import('./pages/Finance/VendorRefunds'));
const BillToReceive = lazyWithReload(() => import('./pages/Finance/BillToReceive'));
const BilledNotReceived = lazyWithReload(() => import('./pages/Finance/BilledNotReceived'));
const RecurringJournals = lazyWithReload(() => import('./pages/Finance/RecurringJournals'));
const BatchPayment = lazyWithReload(() => import('./pages/Finance/BatchPayment'));
const PayablesHub = lazyWithReload(() => import('./pages/Finance/PayablesHub'));
const CompanyProfile = lazyWithReload(() => import('./pages/Finance/CompanyProfile'));
const FinanceCompanies = lazyWithReload(() => import('./pages/Finance/FinanceCompanies'));
const BudgetList = lazyWithReload(() => import('./pages/Finance/BudgetList'));
const BudgetForm = lazyWithReload(() => import('./pages/Finance/BudgetForm'));
const DeferredEntries = lazyWithReload(() => import('./pages/Finance/DeferredEntries'));
const BankStatementImport = lazyWithReload(() => import('./pages/Finance/BankStatementImport'));
const FinanceSetup = lazyWithReload(() => import('./pages/Finance/FinanceSetup'));
const Vouchers = lazyWithReload(() => import('./pages/Finance/Vouchers'));
const VoucherView = lazyWithReload(() => import('./pages/Finance/VoucherView'));
const Legacy = lazyWithReload(() => import('./pages/Finance/Legacy'));
const PurchaseReturns = lazyWithReload(() => import('./pages/Procurement/PurchaseReturns'));
const ProcurementDashboard = lazyWithReload(() => import('./pages/Procurement/ProcurementDashboard'));
const ProcurementReports = lazyWithReload(() => import('./pages/Procurement/ProcurementReports'));
const Requisitions = lazyWithReload(() => import('./pages/Procurement/Requisitions'));
const ProcurementTaskAssignment = lazyWithReload(() => import('./pages/Procurement/ProcurementTaskAssignment'));
const RequisitionPrintView = lazyWithReload(() => import('./pages/Procurement/RequisitionPrintView'));
const Quotations = lazyWithReload(() => import('./pages/Procurement/Quotations'));
const PurchaseOrders = lazyWithReload(() => import('./pages/Procurement/PurchaseOrders'));
const ComparativeStatements = lazyWithReload(() => import('./pages/Procurement/ComparativeStatements'));
const Vendors = lazyWithReload(() => import('./pages/Procurement/Vendors'));
const Inventory = lazyWithReload(() => import('./pages/Procurement/Inventory'));
const GoodsReceive = lazyWithReload(() => import('./pages/Procurement/GoodsReceive'));
const DeliveryChallans = lazyWithReload(() => import('./pages/Procurement/Store/DeliveryChallans'));
const DeliveryChallanQA = lazyWithReload(() => import('./pages/Procurement/Store/DeliveryChallanQA'));
const GoodsIssue = lazyWithReload(() => import('./pages/Procurement/GoodsIssue'));
const CostCenters = lazyWithReload(() => import('./pages/Procurement/CostCenters'));
const VendorBills = lazyWithReload(() => import('./pages/Procurement/VendorBills'));
const VendorLedger = lazyWithReload(() => import('./pages/Procurement/VendorLedger'));
const GrnVendorBillView = lazyWithReload(() => import('./pages/Procurement/GrnVendorBillView'));
const StoreDashboard = lazyWithReload(() => import('./pages/Procurement/Store/StoreDashboard'));
const StockTransfers = lazyWithReload(() => import('./pages/Procurement/Store/StockTransfers'));
const StockReports = lazyWithReload(() => import('./pages/Procurement/Store/StockReports'));
const StoreManagement = lazyWithReload(() => import('./pages/Procurement/Store/StoreManagement'));
const StoreItemCatalog = lazyWithReload(() => import('./pages/Procurement/Store/StoreItemCatalog'));
const SalesDashboard = lazyWithReload(() => import('./pages/Sales/SalesDashboard'));
const SalesOrders = lazyWithReload(() => import('./pages/Sales/SalesOrders'));
const SalesCustomers = lazyWithReload(() => import('./pages/Sales/SalesCustomers'));
const SalesProducts = lazyWithReload(() => import('./pages/Sales/SalesProducts'));
const SalesReports = lazyWithReload(() => import('./pages/Sales/SalesReports'));
const CRMDashboard = lazyWithReload(() => import('./pages/CRM/CRMDashboard'));
const Leads = lazyWithReload(() => import('./pages/CRM/Leads'));
const Contacts = lazyWithReload(() => import('./pages/CRM/Contacts'));
const Companies = lazyWithReload(() => import('./pages/CRM/Companies'));
const Campaigns = lazyWithReload(() => import('./pages/CRM/Campaigns'));
const Opportunities = lazyWithReload(() => import('./pages/CRM/Opportunities'));
const Reports = lazyWithReload(() => import('./pages/CRM/Reports'));
const SurveyList = lazyWithReload(() => import('./pages/CRM/Survey/SurveyList'));
const SurveyBuilder = lazyWithReload(() => import('./pages/CRM/Survey/SurveyBuilder'));
const SurveyRespond = lazyWithReload(() => import('./pages/CRM/Survey/SurveyRespond'));
const SurveyAnalytics = lazyWithReload(() => import('./pages/CRM/Survey/SurveyAnalytics'));
const SurveyExecutiveDashboard = lazyWithReload(() => import('./pages/CRM/Survey/SurveyExecutiveDashboard'));
const PollBuilder = lazyWithReload(() => import('./pages/CRM/Survey/PollBuilder'));
const Profile = lazyWithReload(() => import('./pages/Profile/Profile'));
const MyKPIs = lazyWithReload(() => import('./pages/Profile/MyKPIs'));
const ChatPage = lazyWithReload(() => import('./pages/Chat/ChatPage'));
const ChatModerationPage = lazyWithReload(() => import('./pages/Chat/ChatModerationPage'));
const UserManagement = lazyWithReload(() => import('./pages/Admin/UserManagement'));
const OnlineUsers = lazyWithReload(() => import('./pages/Admin/OnlineUsers'));
const MobileApprovalNotifications = lazyWithReload(() => import('./pages/Admin/MobileApprovalNotifications'));
const VehicleList = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleList'));
const VehicleForm = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleForm'));
const VehicleDetails = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleDetails'));
const VehicleDetailsView = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleDetailsView'));
const VehicleMaintenanceForm = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleMaintenanceForm'));
const VehicleLogBookForm = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleLogBookForm'));
const VehicleDashboard = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleDashboard'));
const VehicleReports = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleReports'));
const VehicleMaintenanceList = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleMaintenanceList'));
const VehicleLogBookList = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleLogBookList'));
const VehicleLogBookDetailsView = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleLogBookDetailsView'));
const VehicleLocationList = lazyWithReload(() => import('./pages/Admin/VehicleManagement/VehicleLocationList'));
const HouseInventoryDashboard = lazyWithReload(() => import('./pages/Admin/HouseInventory/HouseInventoryDashboard'));
const UtilityBillForm = lazyWithReload(() => import('./pages/Admin/UtilityBillManagement/UtilityBillForm'));
const StandardVendorBillForm = lazyWithReload(() => import('./pages/Finance/StandardVendorBillForm'));
const StandardCustomerInvoiceForm = lazyWithReload(() => import('./pages/Finance/StandardCustomerInvoiceForm'));
const UtilityBillDetails = lazyWithReload(() => import('./pages/Admin/UtilityBillManagement/UtilityBillDetails'));
const CentralizedStoreManagement = lazyWithReload(() => import('./pages/Admin/UtilityBillManagement/CentralizedStoreManagement'));
const CentralizedStoreBills = lazyWithReload(() => import('./pages/Admin/UtilityBillManagement/CentralizedStoreBills'));
const RentalAgreementList = lazyWithReload(() => import('./pages/Admin/RentalAgreements/RentalAgreementList'));
const RentalAgreementDetail = lazyWithReload(() => import('./pages/Admin/RentalAgreements/RentalAgreementDetail'));
const RentalManagementDashboard = lazyWithReload(() => import('./pages/Admin/RentalManagement/RentalManagementDashboard'));
const RentalManagementDetail = lazyWithReload(() => import('./pages/Admin/RentalManagement/RentalManagementDetail'));
const RoleManagement = lazyWithReload(() => import('./pages/Admin/RoleManagement'));
const AdminDashboard = lazyWithReload(() => import('./pages/Admin/AdminDashboard'));
const SettingsPage = lazyWithReload(() => import('./pages/Settings/SettingsPage'));
const ITDashboard = lazyWithReload(() => import('./pages/IT/ITDashboard'));
const AssetList = lazyWithReload(() => import('./pages/IT/AssetList'));
const AssetForm = lazyWithReload(() => import('./pages/IT/AssetForm'));
const AssetAssignment = lazyWithReload(() => import('./pages/IT/AssetAssignment'));
const SoftwareList = lazyWithReload(() => import('./pages/IT/SoftwareList'));
const SoftwareForm = lazyWithReload(() => import('./pages/IT/SoftwareForm'));
const NetworkList = lazyWithReload(() => import('./pages/IT/NetworkList'));
const NetworkForm = lazyWithReload(() => import('./pages/IT/NetworkForm'));
const VendorList = lazyWithReload(() => import('./pages/IT/VendorList'));
const VendorForm = lazyWithReload(() => import('./pages/IT/VendorForm'));
const VendorContracts = lazyWithReload(() => import('./pages/IT/VendorContracts'));
const PasswordWallet = lazyWithReload(() => import('./pages/IT/PasswordWallet'));
const PasswordWalletDashboard = lazyWithReload(() => import('./pages/IT/PasswordWalletDashboard'));
const PasswordForm = lazyWithReload(() => import('./pages/IT/PasswordForm'));
const ITReports = lazyWithReload(() => import('./pages/IT/Reports'));
const TajResidenciaDashboard = lazyWithReload(() => import('./pages/TajResidencia/TajResidenciaDashboard'));
const ComplainsTickets = lazyWithReload(() => import('./pages/TajResidencia/ComplainsTickets'));
const LandAcquisition = lazyWithReload(() => import('./pages/TajResidencia/LandAcquisition'));
const LandParties = lazyWithReload(() => import('./pages/TajResidencia/LandParties'));
const LandPurchaseViewer = lazyWithReload(() => import('./pages/TajResidencia/LandPurchaseViewer'));
const LandPurchaseFormPage = lazyWithReload(() => import('./pages/TajResidencia/LandPurchaseFormPage'));
const LandPurchaseDetailPage = lazyWithReload(() => import('./pages/TajResidencia/LandPurchaseDetailPage'));
const LandTransferViewer = lazyWithReload(() => import('./pages/TajResidencia/LandTransferViewer'));
const AuditDashboard = lazyWithReload(() => import('./pages/Audit/AuditDashboard'));
const AuditList = lazyWithReload(() => import('./pages/Audit/AuditList'));
const AuditFindings = lazyWithReload(() => import('./pages/Audit/AuditFindings'));
const AddAuditFinding = lazyWithReload(() => import('./pages/Audit/AddAuditFinding'));
const CorrectiveActions = lazyWithReload(() => import('./pages/Audit/CorrectiveActions'));
const AuditTrail = lazyWithReload(() => import('./pages/Audit/AuditTrail'));
const AuditReports = lazyWithReload(() => import('./pages/Audit/AuditReports'));
const AuditSchedules = lazyWithReload(() => import('./pages/Audit/AuditSchedules'));
const AuditForm = lazyWithReload(() => import('./pages/Audit/AuditForm'));
const CorrectiveActionForm = lazyWithReload(() => import('./pages/Audit/CorrectiveActionForm'));
const PreAudit = lazyWithReload(() => import('./pages/Audit/PreAudit'));
const DepartmentManagement = lazyWithReload(() => import('./pages/HR/DepartmentManagement'));
const PositionManagement = lazyWithReload(() => import('./pages/HR/PositionManagement'));
const BankManagement = lazyWithReload(() => import('./pages/HR/BankManagement'));
const NotFound = lazyWithReload(() => import('./pages/NotFound/NotFound'));
const FBRTaxManagement = lazyWithReload(() => import('./pages/HR/FBRTaxManagement'));
const PayrollTaxes = lazyWithReload(() => import('./pages/HR/PayrollTaxes'));
const EvaluationDocuments = lazyWithReload(() => import('./pages/HR/EvaluationAppraisal/EvaluationDocuments'));
const EvaluationAuthorities = lazyWithReload(() => import('./pages/HR/EvaluationAppraisal/EvaluationAuthorities'));
const EvaluationDashboard = lazyWithReload(() => import('./pages/HR/EvaluationAppraisal/EvaluationDashboard'));
const DocumentsTracking = lazyWithReload(() => import('./pages/HR/DocumentsTracking'));
const DocumentsTrackingDashboard = lazyWithReload(() => import('./pages/DocumentsTracking/DocumentsTrackingDashboard'));
const EvaluationTracking = lazyWithReload(() => import('./pages/DocumentsTracking/EvaluationTracking'));
const UserTracking = lazyWithReload(() => import('./pages/General/UserTracking'));
const DocumentFlowReport = lazyWithReload(() => import('./pages/General/Reports/DocumentFlowReport'));
const DocumentFlowRegister = lazyWithReload(() => import('./pages/General/Reports/DocumentFlowRegister'));
const IndentsDashboard = lazyWithReload(() => import('./pages/General/Indents/IndentsDashboard'));
const IndentsList = lazyWithReload(() => import('./pages/General/Indents/IndentsList'));
const IndentForm = lazyWithReload(() => import('./pages/General/Indents/IndentForm'));
const GeneralCashApprovalsList = lazyWithReload(() => import('./pages/General/CashApprovals/GeneralCashApprovalsList'));
const GeneralCashApprovalForm = lazyWithReload(() => import('./pages/General/CashApprovals/GeneralCashApprovalForm'));
const GeneralCashApprovalDetail = lazyWithReload(() => import('./pages/General/CashApprovals/GeneralCashApprovalDetail'));
const CashApprovalGeneralViewPage = lazyWithReload(() => import('./pages/CashApprovals/CashApprovalGeneralViewPage'));
const IndentDetail = lazyWithReload(() => import('./pages/General/Indents/IndentDetail'));
const IndentPrintView = lazyWithReload(() => import('./pages/General/Indents/IndentPrintView'));
const Payments = lazyWithReload(() => import('./pages/General/Payments'));
const ProjectManagement = lazyWithReload(() => import('./pages/General/ProjectManagement'));
const ProjectPortfolioDashboard = lazyWithReload(() => import('./pages/General/ProjectPortfolioDashboard'));
const BudgetApprovals = lazyWithReload(() => import('./pages/General/BudgetApprovals'));
const FinanceApprovals = lazyWithReload(() => import('./pages/Finance/FinanceApprovals'));
const ProjectDetail = lazyWithReload(() => import('./pages/General/ProjectDetail'));
const ProjectWorkspaceRedirect = lazyWithReload(() => import('./pages/General/ProjectWorkspaceRedirect'));
const WbsActivities = lazyWithReload(() => import('./pages/General/WbsActivities'));
const SlabSchedules = lazyWithReload(() => import('./pages/General/SlabSchedules'));
const ProjectApprovals = lazyWithReload(() => import('./pages/General/ProjectApprovals'));
const SubcontractorStatement = lazyWithReload(() => import('./pages/General/SubcontractorStatement'));
const PresidentSecretariatDashboard = lazyWithReload(() => import('./pages/General/PresidentSecretariat/Dashboard'));
const PresidentDashboard = lazyWithReload(() => import('./pages/General/PresidentDashboard'));
const PresidentMeetings = lazyWithReload(() => import('./pages/General/PresidentSecretariat/Meetings'));
const PresidentMeetingDetail = lazyWithReload(() => import('./pages/General/PresidentSecretariat/MeetingDetail'));
const PresidentMeetingPrintView = lazyWithReload(() => import('./pages/General/PresidentSecretariat/MeetingPrintView'));
const PresidentMeetingsListPrintView = lazyWithReload(() => import('./pages/General/PresidentSecretariat/MeetingsListPrintView'));
const PresidentEvents = lazyWithReload(() => import('./pages/General/PresidentSecretariat/Events'));
const PresidentEventDetail = lazyWithReload(() => import('./pages/General/PresidentSecretariat/EventDetail'));
const PresidentEventPrintView = lazyWithReload(() => import('./pages/General/PresidentSecretariat/EventPrintView'));
const PresidentEventsListPrintView = lazyWithReload(() => import('./pages/General/PresidentSecretariat/EventsListPrintView'));
const ServerMonitor = lazyWithReload(() => import('./pages/Developer/ServerMonitor'));
const FinancialsDashboard = lazyWithReload(() => import('./pages/Developer/FinancialsDashboard'));
const LoanManagement = lazyWithReload(() => import('./pages/HR/LoanManagement'));
const LoanForm = lazyWithReload(() => import('./pages/HR/LoanForm'));
const LoanDetail = lazyWithReload(() => import('./pages/HR/LoanDetail'));
const LoanStatistics = lazyWithReload(() => import('./pages/HR/LoanStatistics'));
const FinalSettlementManagement = lazyWithReload(() => import('./pages/HR/FinalSettlementManagement'));
const FinalSettlementForm = lazyWithReload(() => import('./pages/HR/FinalSettlementForm'));
const FinalSettlementStatistics = lazyWithReload(() => import('./pages/HR/FinalSettlementStatistics'));
const FinalSettlementDetail = lazyWithReload(() => import('./pages/HR/FinalSettlementDetail'));
const TalentAcquisition = lazyWithReload(() => import('./pages/HR/TalentAcquisition'));
const JobPostings = lazyWithReload(() => import('./pages/HR/JobPostings'));
const JobPostingForm = lazyWithReload(() => import('./pages/HR/JobPostingForm'));
const Candidates = lazyWithReload(() => import('./pages/HR/Candidates'));
const CandidateForm = lazyWithReload(() => import('./pages/HR/CandidateForm'));
const ApplicationForm = lazyWithReload(() => import('./pages/HR/ApplicationForm'));
const Applications = lazyWithReload(() => import('./pages/HR/Applications'));
const CandidateApprovals = lazyWithReload(() => import('./pages/HR/CandidateApprovals'));
const ApprovalDetail = lazyWithReload(() => import('./pages/HR/ApprovalDetail'));
const TalentAcquisitionReports = lazyWithReload(() => import('./pages/HR/TalentAcquisitionReports'));
const LearningManagement = lazyWithReload(() => import('./pages/HR/LearningManagement'));
const Courses = lazyWithReload(() => import('./pages/HR/Courses'));
const CourseForm = lazyWithReload(() => import('./pages/HR/CourseForm'));
const Enrollments = lazyWithReload(() => import('./pages/HR/Enrollments'));
const EnrollmentForm = lazyWithReload(() => import('./pages/HR/EnrollmentForm'));
const EnrollmentDetail = lazyWithReload(() => import('./pages/HR/EnrollmentDetail'));
const LearningReports = lazyWithReload(() => import('./pages/HR/LearningReports'));
const TrainingPrograms = lazyWithReload(() => import('./pages/HR/TrainingPrograms'));
const TrainingProgramForm = lazyWithReload(() => import('./pages/HR/TrainingProgramForm'));
const TrainingProgramDetail = lazyWithReload(() => import('./pages/HR/TrainingProgramDetail'));
const OrganizationalDevelopment = lazyWithReload(() => import('./pages/HR/OrganizationalDevelopment'));
const OrganizationalChart = lazyWithReload(() => import('./pages/HR/OrganizationalChart'));
const OrganizationalChartEditor = lazyWithReload(() => import('./pages/HR/OrganizationalChartEditor'));
const JobAnalysis = lazyWithReload(() => import('./pages/HR/JobAnalysis'));
const SuccessionPlanning = lazyWithReload(() => import('./pages/HR/SuccessionPlanning'));
const JobApplication = lazyWithReload(() => import('./pages/Public/JobApplication'));
const PublicApproval = lazyWithReload(() => import('./pages/Public/PublicApproval'));
const OfferAcceptance = lazyWithReload(() => import('./pages/Public/OfferAcceptance'));
const PublicJoiningDocument = lazyWithReload(() => import('./pages/Public/PublicJoiningDocument'));
const PublicEmployeeOnboarding = lazyWithReload(() => import('./pages/Public/PublicEmployeeOnboarding'));
const PublicEvaluationForm = lazyWithReload(() => import('./pages/Public/PublicEvaluationForm'));
const PublicQuotationForm = lazyWithReload(() => import('./pages/Public/PublicQuotationForm'));
const RegisterComplaint = lazyWithReload(() => import('./pages/Public/RegisterComplaint'));
const MyComplaints = lazyWithReload(() => import('./pages/Public/MyComplaints'));
const TajComplaintsPortal = lazyWithReload(() => import('./pages/Public/TajComplaintsPortal'));
const IncrementList = lazyWithReload(() => import('./pages/Increments/IncrementList'));
const CreateIncrement = lazyWithReload(() => import('./pages/Increments/CreateIncrement'));
const IncrementHistory = lazyWithReload(() => import('./pages/Increments/IncrementHistory'));
const IncrementDetail = lazyWithReload(() => import('./pages/Increments/IncrementDetail'));
const KPIDashboard = lazyWithReload(() => import('./pages/HR/KPI/KPIDashboard'));
const KPITemplates = lazyWithReload(() => import('./pages/HR/KPI/KPITemplates'));
const KPICycles = lazyWithReload(() => import('./pages/HR/KPI/KPICycles'));
const ReviewKPIs = lazyWithReload(() => import('./pages/HR/KPI/ReviewKPIs'));
const KPIMonthlySheet = lazyWithReload(() => import('./pages/HR/KPI/KPIMonthlySheet'));
const KPISubmissionsOverview = lazyWithReload(() => import('./pages/HR/KPI/KPISubmissionsOverview'));
const KPIReports = lazyWithReload(() => import('./pages/HR/KPI/KPIReports'));
const LeaveManagement = lazyWithReload(() => import('./pages/HR/Leaves/LeaveManagement'));
const LeaveApproval = lazyWithReload(() => import('./pages/HR/Leaves/LeaveApproval'));
const LeaveCalendar = lazyWithReload(() => import('./pages/HR/Leaves/LeaveCalendar'));
const LeaveReports = lazyWithReload(() => import('./pages/HR/Leaves/LeaveReports'));
const EmployeeLeaveHistory = lazyWithReload(() => import('./pages/HR/Leaves/EmployeeLeaveHistory'));

// Increment Management Pages

// KPI Management

// Leave Management Pages

// Recovery module - lazy loaded for faster initial load (must be after all imports for eslint import/first)
const RecoveryAssignments = lazyWithReload(() => import('./pages/Finance/Recovery/RecoveryAssignments'));
const RecoveryMembers = lazyWithReload(() => import('./pages/Finance/Recovery/RecoveryMembers'));
const RecoveryTaskAssignment = lazyWithReload(() => import('./pages/Finance/Recovery/RecoveryTaskAssignment'));
const CompletedTasks = lazyWithReload(() => import('./pages/Finance/Recovery/CompletedTasks'));
const RecoveryCampaigns = lazyWithReload(() => import('./pages/Finance/Recovery/RecoveryCampaigns'));
const MyTasks = lazyWithReload(() => import('./pages/Finance/Recovery/MyTasks'));
const CashApprovals = lazyWithReload(() => import('./pages/Procurement/CashApprovals'));
const CashApprovalDocumentView = lazyWithReload(() => import('./pages/Procurement/CashApprovalDocumentView'));

// Taj Utilities Lazy Loaded Pages
const RentalAgreementsFinance = lazyWithReload(() => import('./pages/Finance/TajUtilities/RentalAgreements'));
const RentalAgreementDetailFinance = lazyWithReload(() => import('./pages/Finance/TajUtilities/RentalAgreementDetail'));
const RentalManagementFinance = lazyWithReload(() => import('./pages/Finance/TajUtilities/RentalManagement'));
const TajProperties = lazyWithReload(() => import('./pages/Finance/TajUtilities/TajProperties'));
const TajPropertyDetail = lazyWithReload(() => import('./pages/Finance/TajUtilities/TajPropertyDetail'));
const RentalManagementDetailFinance = lazyWithReload(() => import('./pages/Finance/TajUtilities/RentalManagementDetail'));
const TajUtilitiesDashboard = lazyWithReload(() => import('./pages/Finance/TajUtilities/Dashboard'));
const CAMCharges = lazyWithReload(() => import('./pages/Finance/TajUtilities/CAMCharges'));
const WaterBills = lazyWithReload(() => import('./pages/Finance/TajUtilities/WaterBills'));
const Electricity = lazyWithReload(() => import('./pages/Finance/TajUtilities/Electricity'));
const Invoices = lazyWithReload(() => import('./pages/Finance/TajUtilities/Invoices'));
const OpenInvoices = lazyWithReload(() => import('./pages/Finance/TajUtilities/OpenInvoices'));
const TajResidents = lazyWithReload(() => import('./pages/Finance/TajUtilities/TajResidents'));
const Deposits = lazyWithReload(() => import('./pages/Finance/TajUtilities/Deposits'));
const TajUtilityBanks = lazyWithReload(() => import('./pages/Finance/TajUtilities/Banks'));
const SuspenseAccount = lazyWithReload(() => import('./pages/Finance/TajUtilities/SuspenseAccount'));
const TajResidentDetail = lazyWithReload(() => import('./pages/Finance/TajUtilities/TajResidentDetail'));
const TajUtilitiesReports = lazyWithReload(() => import('./pages/Finance/TajUtilities/Reports'));
const TajUtilitiesReconciliation = lazyWithReload(() => import('./pages/Finance/TajUtilities/Reconciliation'));

// Printing / PDF & Excel Export Heavy Pages
const InvoicePrint = lazyWithReload(() => import('./pages/Finance/InvoicePrint'));
const BillPrint = lazyWithReload(() => import('./pages/Finance/BillPrint'));
const PayablesDocument = lazyWithReload(() => import('./pages/Finance/payables/PayablesDocument'));
const PayablesPayment = lazyWithReload(() => import('./pages/Finance/payables/PayablesPayment'));
const ComparativePL = lazyWithReload(() => import('./pages/Finance/ComparativePL'));
const CostCenterPL = lazyWithReload(() => import('./pages/Finance/CostCenterPL'));

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

  const redirectPath = isPresidentUser(user) ? '/general/president-dashboard' : getRedirectPath(user.role);
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

    const redirectPath = isPresidentUser(user) ? '/general/president-dashboard' : getRedirectPath(user.role);
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
        <Suspense fallback={lazyPageFallback}>
        <Routes>
          <Route path="/asset-tagging/scan/:tagCode" element={<ScanAssetPage />} />
          <Route path="/at/:tagCode" element={<ScanAssetPage />} />
          <Route path="*" element={<Navigate to={location.pathname} replace />} />
        </Routes>
        </Suspense>
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
        <Suspense fallback={lazyPageFallback}>
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
        </Suspense>
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
                      path="/general/president-dashboard"
                      element={<ProtectedRoute><PresidentOnly><PresidentDashboard /></PresidentOnly></ProtectedRoute>}
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
                      path="/general/reports"
                      element={<Navigate to="/general/reports/document-flow" replace />}
                    />
                    <Route
                      path="/general/reports/document-flow"
                      element={<ProtectedRoute><DocumentFlowRegister /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/reports/document-trace"
                      element={<ProtectedRoute><DocumentFlowReport /></ProtectedRoute>}
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
                      element={<Navigate to="/general/project-management/projects" replace />}
                    />
                    <Route
                      path="/budget-approvals"
                      element={<ProtectedRoute><BudgetApprovals /></ProtectedRoute>}
                    />
                    <Route
                      path="/general/project-management/dashboard"
                      element={<ProtectedRoute><ProjectPortfolioDashboard /></ProtectedRoute>}
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
                      element={<Navigate to="/procurement/store/cost-center" replace />}
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
                      element={<Navigate to="/procurement/store/cost-center" replace />}
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
                    <Route path="/finance/loan-receipts" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><LoanReceipts /></ProtectedRoute>} />
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
                    <Route path="/finance/bill-print/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "accounts_officer", "finance_controller"]}><BillPrint /></ProtectedRoute>} />
                    <Route path="/procurement/cash-approvals/:id/print" element={<ProtectedRoute><Suspense fallback={lazyPageFallback}><CashApprovalDocumentView /></Suspense></ProtectedRoute>} />
                    <Route path="/finance/recurring-journals" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><RecurringJournals /></ProtectedRoute>} />
                    <Route path="/finance/payables-hub" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "accounts_officer", "finance_controller"]}><PayablesHub /></ProtectedRoute>} />
                    <Route path="/finance/payables-hub/document/:kind/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "accounts_officer", "finance_controller"]}><Suspense fallback={lazyPageFallback}><PayablesDocument /></Suspense></ProtectedRoute>} />
                    <Route path="/finance/payables-hub/payment/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager", "accounts_officer", "finance_controller"]}><Suspense fallback={lazyPageFallback}><PayablesPayment /></Suspense></ProtectedRoute>} />
                    <Route path="/finance/batch-payment" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BatchPayment /></ProtectedRoute>} />
                    <Route path="/finance/company-profile" element={<ProtectedRoute requiredRole={["super_admin", "admin"]}><CompanyProfile /></ProtectedRoute>} />
                    <Route path="/finance/companies" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><FinanceCompanies /></ProtectedRoute>} />
                    <Route path="/finance/comparative-pl" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><ComparativePL /></ProtectedRoute>} />
                    <Route path="/finance/cost-center-pl" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><CostCenterPL /></ProtectedRoute>} />
                    <Route path="/finance/budgets" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BudgetList /></ProtectedRoute>} />
                    <Route path="/finance/budgets/:id" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BudgetForm /></ProtectedRoute>} />
                    <Route path="/finance/deferred-entries" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><DeferredEntries /></ProtectedRoute>} />
                    <Route path="/finance/bank-statement-import" element={<ProtectedRoute requiredRole={["super_admin", "admin", "finance_manager"]}><BankStatementImport /></ProtectedRoute>} />
                    <Route path="/finance/approvals" element={<ProtectedRoute><FinanceApprovals /></ProtectedRoute>} />
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
                      path="/procurement/vendor-ledger"
                      element={<ProtectedRoute><VendorLedger /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/vendor-bills"
                      element={<ProtectedRoute><VendorBills /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/vendor-bills/view/:id"
                      element={<ProtectedRoute><GrnVendorBillView /></ProtectedRoute>}
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
                      element={<ProtectedRoute><Inventory key="inventory" /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/stock-check"
                      element={<ProtectedRoute><Inventory key="stock-check" openStockCheck /></ProtectedRoute>}
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
                      element={<ProtectedRoute><GoodsIssue key="sin" /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/store-returns"
                      element={<ProtectedRoute><GoodsIssue key="srn" initialTab={1} /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/stock-transfers"
                      element={<ProtectedRoute><StockTransfers /></ProtectedRoute>}
                    />
                    <Route
                      path="/procurement/store/stock-reports"
                      element={<ProtectedRoute><StockReports /></ProtectedRoute>}
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