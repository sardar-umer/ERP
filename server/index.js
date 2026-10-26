const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectDB } = require('./config/database');
const app = express();
const server = http.createServer(app);

// Load models to ensure they are registered
require('./models/hr/VehicleLogBook');
require('./models/hr/VehicleMaintenance');
require('./models/hr/Vehicle');

// Load IT models
require('./models/it/PasswordWallet');

// Connect to MongoDB
connectDB();

// Import routes
const authRoutes = require('./routes/auth');
const hrRoutes = require('./routes/hr');
const manualSalaryRoutes = require('./routes/manualSalary');
const payrollRoutes = require('./routes/payroll');
const salaryAdvancesRoutes = require('./routes/salaryAdvances');
const payrollTaxSettingsRoutes = require('./routes/payrollTaxSettings');
const attendanceRoutes = require('./routes/attendance');
const biometricRoutes = require('./routes/biometric');
const financeRoutes = require('./routes/finance');
const financeAdvancedRoutes = require('./routes/financeAdvanced');
const financeCostCentersRoutes = require('./routes/financeCostCenters');
const procurementRoutes = require('./routes/procurement');
const salesRoutes = require('./routes/sales');
const crmRoutes = require('./routes/crm');
const crmSurveyRoutes = require('./routes/crmSurveys');
const campaignRoutes = require('./routes/campaigns');
const reportsRoutes = require('./routes/reports');
const positionRoutes = require('./routes/positions');
const bankRoutes = require('./routes/banks');
const companyRoutes = require('./routes/companies');
const projectRoutes = require('./routes/projects');
const sectionRoutes = require('./routes/sections');
const designationRoutes = require('./routes/designations');
const locationRoutes = require('./routes/locations');
const cityRoutes = require('./routes/cities');
const provinceRoutes = require('./routes/provinces');
const countryRoutes = require('./routes/countries');
const loanRoutes = require('./routes/loans');
const finalSettlementRoutes = require('./routes/finalSettlements');
const hrReportsRoutes = require('./routes/hrReports');
const payrollReportsRoutes = require('./routes/payrollReports');
const attendanceReportsRoutes = require('./routes/attendanceReports');
const payslipRoutes = require('./routes/payslips');
const jobPostingRoutes = require('./routes/jobPostings');
// const publicJobPostingRoutes = require('./routes/publicJobPostings');
const candidateRoutes = require('./routes/candidates');
// const publicCandidateRoutes = require('./routes/publicCandidates');
const candidateApprovalRoutes = require('./routes/candidateApprovals');
const publicApprovalRoutes = require('./routes/publicApprovals');
const applicationRoutes = require('./routes/applications');
const notificationRoutes = require('./routes/notifications');
const chatRoutes = require('./routes/chat');
const chatAdminRoutes = require('./routes/chatAdmin');
const aiAssistantRoutes = require('./routes/aiAssistant');
const executiveApprovalsRoutes = require('./routes/executiveApprovals');
const { attachSocketRedisAdapter } = require('./services/socketRedisAdapter');
const settingsRoutes = require('./routes/settings');
// const publicApplicationRoutes = require('./routes/publicApplications');
const easyApplyRoutes = require('./routes/easyApply');
const courseRoutes = require('./routes/courses');
const enrollmentRoutes = require('./routes/enrollments');
const trainingProgramRoutes = require('./routes/trainingPrograms');
const zktecoRoutes = require('./routes/zkteco');
const hiringRoutes = require('./routes/hiring');
const employeeOnboardingRoutes = require('./routes/employeeOnboarding');
const nonEmployeeRoutes = require('./routes/hr/nonEmployeeRoutes');
const zkbioTimeRoutes = require('./routes/zkbioTimeRoutes');
const { router: imageProxyRoutes, setZKBioTimeWebSocketProxy } = require('./routes/imageProxy');
const vehicleRoutes = require('./routes/vehicles');
const vehicleMaintenanceRoutes = require('./routes/vehicleMaintenance');
const vehicleLogBookRoutes = require('./routes/vehicleLogBook');
const trakkerRoutes = require('./routes/trakker');
const houseInventoryRoutes = require('./routes/houseInventory');
const supplierRoutes = require('./routes/suppliers');
const attendanceProxyRoutes = require('./routes/attendanceProxy');
const utilityBillRoutes = require('./routes/utilityBills');
const centralizedStoreRoutes = require('./routes/centralizedStore');
const itRoutes = require('./routes/it');
const arrearsRoutes = require('./routes/arrears');
const orgChartRoutes = require('./routes/orgChart');
const rentalAgreementRoutes = require('./routes/rentalAgreements');
const tajRentalAgreementRoutes = require('./routes/tajRentalAgreements');
const rentalManagementRoutes = require('./routes/rentalManagement');
const paymentSettlementRoutes = require('./routes/paymentSettlements');
// Finance models used by utility-bill → AP posting (must load before audit/pre-audit routes)
require('./models/finance/FinanceJournal');
require('./models/finance/FiscalPeriod');

const auditRoutes = require('./routes/audit');
const auditFindingsRoutes = require('./routes/auditFindings');
const auditTrailRoutes = require('./routes/auditTrail');
const subRoleRoutes = require('./routes/subRoles');
const userSubRoleRoutes = require('./routes/userSubRoles');
const tajResidenciaComplaintsRoutes = require('./routes/tajResidenciaComplaints');
const landAcquisitionMozaRoutes = require('./routes/landAcquisitionMoza');
const landAcquisitionRegistryRoutes = require('./routes/landAcquisitionRegistry');
const landAcquisitionPossessionRoutes = require('./routes/landAcquisitionPossession');
const landAcquisitionMapRoutes = require('./routes/landAcquisitionMap');
const landAcquisitionPartiesRoutes = require('./routes/landAcquisitionParties');
const landAcquisitionPurchaseRoutes = require('./routes/landAcquisitionPurchase');
const landAcquisitionTransferRoutes = require('./routes/landAcquisitionTransfer');
const landAcquisitionExchangeRoutes = require('./routes/landAcquisitionExchange');
const tajRentalManagementRoutes = require('./routes/tajRentalManagement');
const camChargesRoutes = require('./routes/camCharges');
const waterChargesRoutes = require('./routes/waterCharges');
const electricityRoutes = require('./routes/electricity');
const tajPropertiesRoutes = require('./routes/tajProperties');
const propertyInvoicesRoutes = require('./routes/propertyInvoices');
const propertyReceiptsRoutes = require('./routes/propertyReceipts');
const bankIslamicIntegrationRoutes = require('./routes/bankIslamicIntegration');
const chargesSlabsRoutes = require('./routes/chargesSlabs');
const waterUtilitySlabsRoutes = require('./routes/waterUtilitySlabs');
const tajResidentsRoutes = require('./routes/tajResidents');
const tajBanksRoutes = require('./routes/tajBanks');
const tajSectorsRoutes = require('./routes/tajSectors');
const recoveryMembersRoutes = require('./routes/recoveryMembers');
const recoveryAssignmentsRoutes = require('./routes/recoveryAssignments');
const recoveryTaskAssignmentRulesRoutes = require('./routes/recoveryTaskAssignmentRules');
const recoveryTasksRoutes = require('./routes/recoveryTasks');
const recoveryCampaignsRoutes = require('./routes/recoveryCampaigns');
const chargeTypesRoutes = require('./routes/chargeTypes');
const documentTrackingRoutes = require('./routes/documentTracking');
const evaluationDocumentsRoutes = require('./routes/evaluationDocuments');
const evaluationLevel0AuthoritiesRoutes = require('./routes/evaluationLevel0Authorities');
const indentsRoutes = require('./routes/indents');
const storesRoutes = require('./routes/stores');
const projectManagementRoutes = require('./routes/projectManagement');
const presidentMeetingsRoutes = require('./routes/presidentMeetings');
const presidentEventsRoutes = require('./routes/presidentEvents');
const userTrackingRoutes = require('./routes/userTracking');
const developerRoutes = require('./routes/developer');
const activityLogger = require('./middleware/activityLogger');
// Finance integration — new modules
const financeJournalsRoutes = require('./routes/financeJournals');
const fiscalPeriodsRoutes = require('./routes/fiscalPeriods');
const inventoryCategoriesRoutes = require('./routes/inventoryCategories');
const taxesRoutes = require('./routes/taxes');
const fixedAssetsRoutes = require('./routes/fixedAssets');
const assetTaggingRoutes = require('./routes/assetTagging');
const paymentTermsRoutes = require('./routes/paymentTerms');
const financeCompaniesRoutes = require('./routes/financeCompanies');
const purchaseReturnsRoutes = require('./routes/purchaseReturns');
const cashApprovalsRoutes = require('./routes/cashApprovals');
// Pre-load new models so Mongoose registers them before any route uses them
require('./models/finance/FinanceJournal');
require('./models/finance/FiscalPeriod');
require('./models/finance/Tax');
require('./models/finance/FixedAsset');
require('./models/assetTagging/AssetTag');
require('./models/assetTagging/AssetTagEvent');
require('./models/assetTagging/AssetVerificationSession');
require('./models/finance/PaymentTerm');
require('./models/finance/CompanyBank');
require('./models/finance/CostCenter');
require('./models/finance/PayrollPeriodPaymentApplication');
require('./models/procurement/PurchaseReturn');
require('./models/procurement/InventoryCategory');
require('./models/procurement/CashApproval');
require('./models/procurement/DeliveryChallan');
require('./models/chat/ChatConversation');
require('./models/chat/ChatMessage');


// Import services
const attendanceService = require('./services/attendanceService');
const ChangeStreamService = require('./services/changeStreamService');
const ZKBioTimeWebSocketProxy = require('./services/zkbioTimeWebSocketProxy');
const itNotificationService = require('./services/itNotificationService');
const realtimeNotificationGateway = require('./services/realtimeNotificationGateway');

// Initialize services
let changeStreamService = null;
let zkbioTimeWebSocketProxy = null;

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');
const { logRequest } = require('./middleware/auditTrail');

// Database connection already imported at the top

// Set environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy for correct IP detection behind reverse proxy/load balancer
// This is important for rate limiting to work correctly in production
if (NODE_ENV === 'production') {
  app.set('trust proxy', 1); // Trust first proxy (nginx/load balancer)
}

// Check critical environment variables
console.log('🔧 Environment Check:');
console.log('   NODE_ENV:', NODE_ENV);
console.log('   JWT_SECRET:', process.env.JWT_SECRET ? '✅ Set' : '❌ NOT SET');
console.log('   Database:', process.env.NODE_ENV === 'production' ? (process.env.MONGODB_URI ? '✅ MONGODB_URI (production)' : '❌ MONGODB_URI NOT SET') : (process.env.MONGODB_URI_LOCAL ? '✅ MONGODB_URI_LOCAL (local)' : process.env.MONGODB_URI ? '✅ MONGODB_URI (fallback)' : '❌ No DB URI set'));

if (!process.env.JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET environment variable is not set!');
  console.error('❌ This will cause login failures. Please set JWT_SECRET in your .env file.');
  process.exit(1);
}

// Database connection is handled at the top



// Initialize Change Stream service

// Security middleware
const getCSPDirectives = () => {
  const baseDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https:"],
    fontSrc: ["'self'", "https:", "data:"],
    connectSrc: ["'self'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"]
  };

  // Add environment-specific image sources
  if (NODE_ENV === 'development') {
    baseDirectives.imgSrc = ["'self'", "data:", "http://localhost:3000", "https://localhost:3000", "http://localhost:5001", "https://localhost:5001"];
  } else {
    baseDirectives.imgSrc = ["'self'", "data:", "http://tovus.net", "https://tovus.net", "http://www.tovus.net", "https://www.tovus.net"];
    baseDirectives.upgradeInsecureRequests = [];
  }

  return baseDirectives;
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: getCSPDirectives()
  }
}));
app.use(compression());

// Rate limiting (disabled for development)
if (NODE_ENV === 'production') {
  // Separate, more lenient rate limiter for login endpoint
  // This allows more login attempts per IP to handle multiple users behind NAT/proxy
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 20, // 20 login attempts per 15 minutes per IP
    message: {
      success: false,
      message: 'Too many login attempts from this IP. Please wait a few minutes before trying again.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false, // Count all attempts, even successful ones
    keyGenerator: (req) => {
      // Get IP address - check X-Forwarded-For header first (for proxy/load balancer)
      // Then fall back to req.ip (set by express) or connection remoteAddress
      const forwarded = req.headers['x-forwarded-for'];
      const ip = forwarded 
        ? forwarded.split(',')[0].trim() 
        : (req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress);
      return ip || 'unknown';
    },
    // Add handler for when rate limit is exceeded
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: 'Too many login attempts from this IP. Please wait a few minutes before trying again.',
        retryAfter: Math.ceil(15 * 60 / 1000) // Retry after 15 minutes (in seconds)
      });
    }
  });

  // Separate, more lenient rate limiter for file uploads (applied first)
  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 uploads per 15 minutes (more lenient for file operations)
    message: 'Too many file upload requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  });

  // General rate limiter — **per public IP**. Everyone behind the same office NAT shares one bucket.
  // Bulk Recovery WhatsApp (many POST /send-whatsapp) + normal use can hit 429 for *all* users on that IP.
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 2500;

  const generalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
    max: Number.isFinite(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 2500,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    // Use originalUrl — under app.use('/api/', ...) req.path is often '/auth/...' not '/api/auth/...'
    skip: (req) => {
      if (req.method === 'OPTIONS') return true;
      const p = String(req.originalUrl || req.url || '').split('?')[0];
      return (
        p.includes('/upload-image') ||
        p.includes('/upload-file') ||
        p.includes('/auth/login') ||
        p.includes('/auth/refresh-token') ||
        p.includes('/auth/me') ||
        p.includes('/webhooks/whatsapp') ||
        p.includes('/send-whatsapp') ||
        p.includes('/bulk-create-cam-invoices') ||
        p.includes('/bulk-create-rent-invoices')
      );
    }
  });

  // Apply login limiter FIRST to login endpoint
  app.use('/api/auth/login', loginLimiter);
  
  // Apply upload limiter to specific upload endpoints
  app.use('/api/hr/upload-image', uploadLimiter);
  
  // Then apply general limiter to all API routes (excluding uploads and login via skip function)
  app.use('/api/', generalLimiter);
  
  console.log('🔒 Rate limiting enabled for production');
  console.log('🔐 Login rate limiting: 20 attempts per 15 minutes per IP');
  console.log('📤 File upload rate limiting: 50 uploads per 15 minutes');
  console.log(`📊 General API rate limiting: ${rateLimitMax} requests per window (per IP; set RATE_LIMIT_MAX_REQUESTS to tune)`);
} else {
  console.log('🔓 Rate limiting disabled for development');
}

// CORS configuration
const baseOrigins = [
  'http://localhost:3000',
  'http://localhost:5001',
  'https://tovus.net',
  'http://tovus.net',
  'https://www.tovus.net',
  'http://www.tovus.net'
];
const extraOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...baseOrigins, ...extraOrigins])];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      if (NODE_ENV === 'production') {
        console.log('CORS blocked origin:', origin);
      }
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
}));

// Audit trail middleware (should be early in the middleware stack)
app.use(logRequest);

// Body parsing middleware (increased for large file uploads)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

const { getUploadsRoot } = require('./utils/uploadsRoot');
const uploadsStaticHeaders = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
  } else if (filePath.toLowerCase().endsWith('.pdf')) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + path.basename(filePath) + '"');
  }
};

// Static files with CORS headers
app.use('/uploads', (req, res, next) => {
  // Set CORS headers for all requests
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  setHeaders: uploadsStaticHeaders
}));

// SGC_UPLOADS_DIR — persistent uploads (Easy Apply CVs when env is set)
const resolvedEnvUploads = path.resolve(getUploadsRoot());
const resolvedServerUploads = path.resolve(path.join(__dirname, 'uploads'));
if (resolvedEnvUploads !== resolvedServerUploads) {
  app.use('/uploads', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  }, express.static(resolvedEnvUploads, { setHeaders: uploadsStaticHeaders }));
}

// Legacy uploads fallback: some older flows stored files at repo-root /uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: uploadsStaticHeaders
}));

app.use('/images', express.static(path.join(__dirname, '../client/public/images')));

// Note: React build files are now served by nginx, not by Node.js

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'SGC ERP System is running',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// Temporary migration route (public)
app.all('/api/public-update-eobi-407', async (req, res) => {
  try {
    const Employee = require('./models/hr/Employee');
    const result = await Employee.updateMany(
      { 'eobi.isActive': true },
      { $set: { 'eobi.amount': 407 } }
    );
    res.json({ success: true, message: 'Active employee EOBI amounts updated to 407', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WhatsApp webhook (public - Meta calls this, no auth)
const whatsappWebhookRoutes = require('./routes/whatsappWebhook');
app.use('/api/webhooks/whatsapp', whatsappWebhookRoutes);

// Public WhatsApp media serving — must be BEFORE auth middleware.
// Images/audio/video sent or received via WhatsApp are stored in
// server/uploads/whatsapp-media/. We serve them through /api/ (not /uploads/)
// to bypass the nginx nested-location bug that catches *.jpg and serves from
// the React build dir instead of proxying to Node.js.
app.get('/api/whatsapp-media/:filename', (req, res) => {
  const pathMod = require('path');
  const fsMod = require('fs');
  const filename = pathMod.basename(req.params.filename || '');
  if (!filename || filename.includes('..')) {
    return res.status(400).json({ success: false, message: 'Invalid filename' });
  }
  const filePath = pathMod.join(__dirname, 'uploads', 'whatsapp-media', filename);
  if (!fsMod.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  const ext = pathMod.extname(filename).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
    '.3gp': 'video/3gpp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4', '.amr': 'audio/amr', '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.sendFile(filePath);
});

// Public route for profile images (must be before authenticated routes)
app.get('/api/hr/image/:filename(*)', (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Security: Validate filename to prevent directory traversal attacks
    // Only allow alphanumeric, dots, dashes, and underscores in filename
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      });
    }
    
    // Ensure we only serve files from profile-images directory
    const imagePath = path.join(__dirname, 'uploads', 'profile-images', filename);
    
    // Additional security: Verify the resolved path is actually in the profile-images directory
    const profileImagesDir = path.join(__dirname, 'uploads', 'profile-images');
    const resolvedPath = path.resolve(imagePath);
    const resolvedDir = path.resolve(profileImagesDir);
    
    if (!resolvedPath.startsWith(resolvedDir)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      // Log missing file for debugging (only in development)
      if (NODE_ENV === 'development') {
        console.log(`⚠️  Image not found: ${filename} at ${imagePath}`);
      }
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    // Set proper headers
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };
    
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // Send the file
    res.sendFile(imagePath);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({
      success: false,
      message: 'Error serving image'
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/hr', authMiddleware, activityLogger, hrRoutes);
app.use('/api/hr/manual-salary', authMiddleware, activityLogger, manualSalaryRoutes);
app.use('/api/hr/non-employees', authMiddleware, activityLogger, nonEmployeeRoutes);
app.use('/api/payroll', authMiddleware, activityLogger, payrollRoutes);
app.use('/api/hr/salary-advances', authMiddleware, activityLogger, salaryAdvancesRoutes);
app.use('/api/hr/payroll-taxes', authMiddleware, activityLogger, payrollTaxSettingsRoutes);
app.use('/api/attendance', authMiddleware, activityLogger, attendanceRoutes);
app.use('/api/biometric', authMiddleware, activityLogger, biometricRoutes);
app.use('/api/finance/recovery-members', authMiddleware, activityLogger, recoveryMembersRoutes);
app.use('/api/finance/recovery-assignments', authMiddleware, activityLogger, recoveryAssignmentsRoutes);
app.use('/api/finance/recovery-task-rules', authMiddleware, activityLogger, recoveryTaskAssignmentRulesRoutes);
app.use('/api/finance/recovery-tasks', authMiddleware, activityLogger, recoveryTasksRoutes);
app.use('/api/finance/recovery-campaigns', authMiddleware, activityLogger, recoveryCampaignsRoutes);
app.use('/api/finance/companies', authMiddleware, activityLogger, financeCompaniesRoutes);
app.use('/api/finance', authMiddleware, activityLogger, financeAdvancedRoutes);
app.use('/api/finance/cost-centers', authMiddleware, activityLogger, financeCostCentersRoutes);
app.use('/api/finance/journals', authMiddleware, activityLogger, financeJournalsRoutes);
app.use('/api/finance/fiscal-periods', authMiddleware, activityLogger, fiscalPeriodsRoutes);
app.use('/api/finance/taxes', authMiddleware, activityLogger, taxesRoutes);
app.use('/api/finance/fixed-assets', authMiddleware, activityLogger, fixedAssetsRoutes);
app.use('/api/asset-tagging', authMiddleware, activityLogger, assetTaggingRoutes);
app.use('/api/finance/payment-terms', authMiddleware, activityLogger, paymentTermsRoutes);
app.use('/api/inventory-categories', authMiddleware, activityLogger, inventoryCategoriesRoutes);
app.use('/api/procurement/purchase-returns', authMiddleware, activityLogger, purchaseReturnsRoutes);
app.use('/api/cash-approvals', cashApprovalsRoutes.lineFileRouter);
app.use('/api/cash-approvals', authMiddleware, activityLogger, cashApprovalsRoutes);
app.use('/api/procurement', authMiddleware, activityLogger, procurementRoutes);
app.use('/api/sales', authMiddleware, activityLogger, salesRoutes);
app.use('/api/crm/surveys', authMiddleware, activityLogger, crmSurveyRoutes);
app.use('/api/crm', authMiddleware, activityLogger, crmRoutes);
app.use('/api/campaigns', authMiddleware, activityLogger, campaignRoutes);
app.use('/api/reports', authMiddleware, activityLogger, reportsRoutes);
app.use('/api/positions', authMiddleware, activityLogger, positionRoutes);
app.use('/api/banks', authMiddleware, activityLogger, bankRoutes);
app.use('/api/companies', authMiddleware, activityLogger, companyRoutes);
app.use('/api/projects', authMiddleware, activityLogger, projectRoutes);
app.use('/api/sections', authMiddleware, activityLogger, sectionRoutes);
app.use('/api/designations', authMiddleware, activityLogger, designationRoutes);
app.use('/api/locations', authMiddleware, activityLogger, locationRoutes);
app.use('/api/cities', authMiddleware, activityLogger, cityRoutes);
app.use('/api/provinces', authMiddleware, activityLogger, provinceRoutes);
app.use('/api/countries', authMiddleware, activityLogger, countryRoutes);
app.use('/api/loans', authMiddleware, activityLogger, loanRoutes);
app.use('/api/final-settlements', authMiddleware, activityLogger, finalSettlementRoutes);
app.use('/api/leaves', authMiddleware, activityLogger, require('./routes/leaves'));
app.use('/api/hr/reports/payroll', authMiddleware, activityLogger, payrollReportsRoutes);
app.use('/api/hr/reports/attendance', authMiddleware, activityLogger, attendanceReportsRoutes);
app.use('/api/hr/reports', authMiddleware, activityLogger, hrReportsRoutes);
app.use('/api/payslips', authMiddleware, activityLogger, payslipRoutes);
// Public routes (no authentication required)
app.use('/api/public-update-eobi-407', async (req, res) => {
  try {
    const Employee = require('./models/hr/Employee');
    const result = await Employee.updateMany(
      { 'eobi.isActive': true },
      { $set: { 'eobi.amount': 407 } }
    );
    res.json({ success: true, message: 'Active employee EOBI amounts updated to 407', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/api/job-postings/apply', require('./routes/publicJobPostings'));
app.use('/api/applications/public', require('./routes/publicApplications'));
app.use('/api/applications/easy-apply', easyApplyRoutes);
app.use('/api/public-approvals', require('./routes/publicApprovals')); // Public approval endpoints
app.use('/api/public/asset-tagging', require('./routes/publicAssetTagging'));
app.use('/api/hiring', hiringRoutes); // Hiring system endpoints (includes public routes)
app.use('/api/employee-onboarding', employeeOnboardingRoutes); // Employee onboarding endpoints

// Protected routes (authentication required)
app.use('/api/job-postings', authMiddleware, activityLogger, jobPostingRoutes);
// Mount candidate routes with authentication
app.use('/api/candidates', authMiddleware, activityLogger, candidateRoutes);
app.use('/api/public/candidates', require('./routes/publicCandidates')); // Public candidate routes
app.use('/api/candidate-approvals', authMiddleware, activityLogger, candidateApprovalRoutes);
app.use('/api/applications', authMiddleware, activityLogger, applicationRoutes);
app.use('/api/notifications', authMiddleware, activityLogger, notificationRoutes);
app.use('/api/chat/admin', authMiddleware, activityLogger, chatAdminRoutes);
app.use('/api/chat', authMiddleware, activityLogger, chatRoutes);
app.use('/api/ai', authMiddleware, activityLogger, aiAssistantRoutes);
app.use('/api/executive', authMiddleware, activityLogger, executiveApprovalsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/courses', authMiddleware, activityLogger, courseRoutes);
app.use('/api/enrollments', authMiddleware, activityLogger, enrollmentRoutes);
app.use('/api/training-programs', authMiddleware, activityLogger, trainingProgramRoutes);
app.use('/api/zkteco', zktecoRoutes);
app.use('/api/zkbio', zkbioTimeRoutes);
app.use('/api/images', imageProxyRoutes);
app.use('/api/vehicles', authMiddleware, activityLogger, vehicleRoutes);
app.use('/api/vehicle-maintenance', authMiddleware, activityLogger, vehicleMaintenanceRoutes);
app.use('/api/vehicle-logbook', authMiddleware, activityLogger, vehicleLogBookRoutes);
app.use('/api/trakker', trakkerRoutes);
app.use('/api/house-inventory', authMiddleware, activityLogger, houseInventoryRoutes);
app.use('/api/suppliers', authMiddleware, activityLogger, supplierRoutes);
app.use('/api/attendance-proxy', attendanceProxyRoutes);
app.use('/api/utility-bills', authMiddleware, activityLogger, utilityBillRoutes);
app.use('/api/admin/centralized-store', authMiddleware, activityLogger, centralizedStoreRoutes);
app.use('/api/hr/arrears', authMiddleware, activityLogger, arrearsRoutes);
app.use('/api/hr/org-chart', authMiddleware, activityLogger, orgChartRoutes);
// Register file routes separately (without authMiddleware, handles auth internally with query token)
app.use('/api/rental-agreements', rentalAgreementRoutes.fileRouter);
app.use('/api/rental-agreements', authMiddleware, activityLogger, rentalAgreementRoutes);
app.use('/api/taj-rental-agreements', tajRentalAgreementRoutes.fileRouter);
app.use('/api/taj-rental-agreements', authMiddleware, activityLogger, tajRentalAgreementRoutes);
app.use('/api/rental-management', authMiddleware, activityLogger, rentalManagementRoutes);
app.use('/api/payment-settlements', authMiddleware, activityLogger, paymentSettlementRoutes);
app.use('/api/admin/dashboard', authMiddleware, activityLogger, require('./routes/adminDashboard'));
app.use('/api/it', authMiddleware, activityLogger, itRoutes);
// Audit sub-routes (must come before main audit route)
app.use('/api/audit/findings', authMiddleware, activityLogger, auditFindingsRoutes);
app.use('/api/audit/corrective-actions', authMiddleware, activityLogger, require('./routes/correctiveActions'));
app.use('/api/audit/trail', authMiddleware, activityLogger, auditTrailRoutes);
app.use('/api/audit/reports', authMiddleware, activityLogger, require('./routes/auditReports'));
app.use('/api/audit/schedules', authMiddleware, activityLogger, require('./routes/auditSchedules'));
app.use('/api/pre-audit', authMiddleware, activityLogger, require('./routes/preAudit'));

// Main audit routes (must come after sub-routes)
app.use('/api/audit', authMiddleware, activityLogger, auditRoutes);

// Sub-role management routes
app.use('/api/sub-roles', subRoleRoutes);
app.use('/api/user-sub-roles', userSubRoleRoutes);
app.use('/api/roles', authMiddleware, activityLogger, require('./routes/roles'));

// Taj Residencia routes
app.use('/api', tajResidenciaComplaintsRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionMozaRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionRegistryRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionPossessionRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionMapRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionPartiesRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionPurchaseRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionTransferRoutes);
app.use('/api/taj-residencia/land-acquisition', authMiddleware, landAcquisitionExchangeRoutes);
app.use('/api/taj-utilities/rental-management', authMiddleware, activityLogger, tajRentalManagementRoutes);
app.use('/api/taj-utilities/cam-charges', authMiddleware, activityLogger, camChargesRoutes);
app.use('/api/taj-utilities/water-charges', authMiddleware, activityLogger, waterChargesRoutes);
app.use('/api/taj-utilities/electricity', authMiddleware, activityLogger, electricityRoutes);
app.use('/api/taj-utilities/properties', authMiddleware, activityLogger, tajPropertiesRoutes);
app.use('/api/taj-utilities/invoices', authMiddleware, activityLogger, propertyInvoicesRoutes);
app.use('/api/taj-utilities/receipts', authMiddleware, activityLogger, propertyReceiptsRoutes);
app.use('/api/taj-utilities/charges-slabs', authMiddleware, activityLogger, chargesSlabsRoutes);
app.use('/api/taj-utilities/water-utility-slabs', authMiddleware, activityLogger, waterUtilitySlabsRoutes);
app.use('/api/taj-utilities/residents', authMiddleware, activityLogger, tajResidentsRoutes);
app.use('/api/taj-utilities/banks', authMiddleware, activityLogger, tajBanksRoutes);
app.use('/api/taj-utilities/sectors', authMiddleware, activityLogger, tajSectorsRoutes);
app.use('/api/taj-utilities/charge-types', authMiddleware, activityLogger, chargeTypesRoutes);
app.use('/api/bank-islamic', bankIslamicIntegrationRoutes);
app.use('/api/document-tracking', authMiddleware, activityLogger, documentTrackingRoutes);
app.use('/api/evaluation-documents', authMiddleware, activityLogger, evaluationDocumentsRoutes);
app.use('/api/indents', authMiddleware, activityLogger, indentsRoutes);
app.use('/api/stores', authMiddleware, activityLogger, storesRoutes);
app.use('/api/project-management', authMiddleware, activityLogger, projectManagementRoutes);
app.use('/api/president-meetings', authMiddleware, activityLogger, presidentMeetingsRoutes);
app.use('/api/president-events', authMiddleware, activityLogger, presidentEventsRoutes);
app.use('/api/kpi/worksheets', authMiddleware, activityLogger, require('./routes/kpiWorksheet'));
app.use('/api/kpi', authMiddleware, activityLogger, require('./routes/kpi'));
app.use('/api/items', authMiddleware, activityLogger, require('./routes/items'));
app.use('/api/evaluation-level0-authorities', authMiddleware, activityLogger, evaluationLevel0AuthoritiesRoutes);
app.use('/api/tracking', authMiddleware, userTrackingRoutes); // Don't add activityLogger to tracking routes to avoid recursion
app.use('/api/developer', authMiddleware, developerRoutes);
// Public evaluation documents route (token-based access)
app.use('/api/public/evaluation-documents', require('./routes/publicEvaluationDocuments'));

// 404 handler (only for API routes) - must be after all API routes
// Use app.all to catch all HTTP methods, but only for unmatched API routes
app.all('/api/*', (req, res, next) => {
  // If we reach here, the route wasn't matched by any previous route
  res.status(404).json({
    success: false,
    message: 'API route not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use(errorHandler);

// Serve React app for client-side routing (must be after API routes)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
} else {
  // Catch-all route for non-API requests in development - return 404 for any non-API routes
  app.get('*', (req, res, next) => {
    // Skip API routes - let them be handled by the API 404 handler above
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.status(404).json({ 
      error: 'API endpoint not found',
      message: 'This route is not handled by the backend API',
      availableRoutes: '/api/*'
    });
  });
}

const PORT = process.env.PORT || 5001;

// Initialize user-targeted notification socket gateway
realtimeNotificationGateway.initialize(server);
attachSocketRedisAdapter(realtimeNotificationGateway.getIO()).catch((e) => {
  console.warn('Socket.IO Redis adapter:', e.message || e);
});

// Initialize Change Stream service after MongoDB connection
mongoose.connection.once('open', async () => {
  try {
    // Initialize services in parallel for faster startup
    console.log('🚀 Initializing services in parallel...');
    
    const initPromises = [
      // Ensure Audit Trail 30-day TTL retention + purge older rows immediately
      (async () => {
        const AuditTrail = require('./models/audit/AuditTrail');
        await AuditTrail.ensureRetentionIndex();
        const purged = await AuditTrail.purgeOlderThanRetention();
        console.log(
          `✅ Audit Trail retention ready (30 days only)`
          + (purged.deletedCount ? ` — purged ${purged.deletedCount} older entries` : '')
        );
      })(),

      // Initialize Change Stream service
      (async () => {
        console.log('🚀 Initializing Change Stream service...');
        changeStreamService = new ChangeStreamService();
        await changeStreamService.start();
        console.log('✅ Change Stream service initialized successfully');
      })(),
      
      // Initialize ZKBio Time WebSocket Proxy (non-blocking)
      (async () => {
        console.log('🔌 Initializing ZKBio Time WebSocket Proxy...');
        zkbioTimeWebSocketProxy = new ZKBioTimeWebSocketProxy();
        zkbioTimeWebSocketProxy.initializeSocketIO(server);
        setZKBioTimeWebSocketProxy(zkbioTimeWebSocketProxy);
        console.log('✅ ZKBio Time WebSocket Proxy initialized');
        
        // Connect WebSockets asynchronously (non-blocking)
        setTimeout(async () => {
          console.log('🧪 Testing ZKBio Time connection...');
          const connectionTest = await zkbioTimeWebSocketProxy.testConnection();
          
          if (connectionTest) {
            console.log('✅ Connection test passed, starting WebSocket connections...');
          } else {
            console.log('⚠️  Connection test failed, will attempt WebSocket connections anyway...');
          }
          
          // Connect all WebSockets in parallel instead of sequentially
          zkbioTimeWebSocketProxy.connectToZKBioTime();
          zkbioTimeWebSocketProxy.connectToChartWebSocket();
          zkbioTimeWebSocketProxy.connectToDeviceWebSocket();
          zkbioTimeWebSocketProxy.connectToDepartmentWebSocket();
          
          // Start periodic retry mechanism
          setTimeout(() => {
            zkbioTimeWebSocketProxy.startPeriodicRetry();
          }, 2000);
        }, 500); // Reduced from 2000ms to 500ms
      })(),
      
      // Start IT Notification Service (non-blocking)
      (async () => {
        console.log('🔔 Starting IT Notification Service...');
        itNotificationService.start();
        console.log('✅ IT Notification Service started successfully');
      })(),

      // Clear legacy auto follow-up mappings (one-time safe cleanup on each deploy)
      (async () => {
        try {
          const RecoveryCampaign = require('./models/finance/RecoveryCampaign');
          const r = await RecoveryCampaign.updateMany(
            { followUpCampaignId: { $exists: true, $ne: null } },
            { $unset: { followUpCampaignId: '' } }
          );
          if (r.modifiedCount > 0) {
            console.log(`[Recovery] Cleared legacy follow-up on ${r.modifiedCount} campaign(s)`);
          }
        } catch (e) {
          console.warn('[Recovery] Legacy follow-up cleanup skipped:', e.message);
        }
      })()
    ];
    
    // Wait for all critical services to initialize
    await Promise.all(initPromises);
    console.log('✅ All services initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    // Don't block server startup if services fail
  }
});

// Scheduled Sync Service is already initialized as singleton

// Initialize Anniversary Leave Scheduler
const AnniversaryLeaveScheduler = require('./services/anniversaryLeaveScheduler');

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 SGC ERP Server running on port ${PORT}`);
  console.log(`📊 Environment: ${NODE_ENV}`);
  console.log(`🌐 API Base URL: http://0.0.0.0:${PORT}/api`);
  console.log(`🔒 Server bound to all interfaces (0.0.0.0)`);
  
  // Start Anniversary Leave Scheduler
  try {
    AnniversaryLeaveScheduler.start();
    console.log('✅ Anniversary Leave Scheduler started successfully');
  } catch (error) {
    console.error('❌ Failed to start Anniversary Leave Scheduler:', error);
  }

  // Start Recurring Journal Entries cron
  try {
    const { startRecurringJournalCron } = require('./utils/recurringJournalCron');
    startRecurringJournalCron();
  } catch (error) {
    console.error('❌ Failed to start Recurring Journal Cron:', error);
  }

  // Start Fixed Asset Auto-Depreciation cron (1st of month, 07:00 AM PKT)
  try {
    const { startFixedAssetDepreciationCron } = require('./utils/fixedAssetDepreciationCron');
    startFixedAssetDepreciationCron();
  } catch (error) {
    console.error('❌ Failed to start Fixed Asset Depreciation Cron:', error);
  }

  // Start Deferred Revenue/Expense Recognition cron (1st of month, 07:30 AM PKT)
  try {
    const { startDeferredEntryCron } = require('./utils/deferredEntryCron');
    startDeferredEntryCron();
  } catch (error) {
    console.error('❌ Failed to start Deferred Entry Cron:', error);
  }

  // Utility / CS bills: mark Overdue + linked AP when due date has passed
  try {
    const { startUtilityBillOverdueCron } = require('./utils/utilityBillOverdueCron');
    startUtilityBillOverdueCron();
  } catch (error) {
    console.error('❌ Failed to start Utility Bill Overdue Cron:', error);
  }

  // Project Management: daily reminders for IPCs waiting too long at an approval desk
  try {
    const { startIpcReminderCron } = require('./utils/projectIpcReminders');
    startIpcReminderCron();
  } catch (error) {
    console.error('❌ Failed to start IPC Reminder Cron:', error);
  }

  // Recovery WhatsApp: manual sends only (My Tasks). No cron or automatic follow-up.

  try {
    const { startKpiWorksheetMonthlyCron } = require('./utils/kpiWorksheetMonthlyCron');
    startKpiWorksheetMonthlyCron();
  } catch (error) {
    console.error('❌ Failed to start KPI Worksheet Monthly Cron:', error);
  }

  // Backfill current month KPI worksheets once on startup (non-blocking)
  try {
    const { ensureWorksheetsForMonth } = require('./utils/kpiWorksheetService');
    const n = new Date();
    ensureWorksheetsForMonth(n.getFullYear(), n.getMonth() + 1).then((r) => {
      if (r.created) console.log(`[KPIWorksheet] Startup backfill created ${r.created} worksheet(s)`);
    }).catch(() => {});
  } catch (_) {
    /* ignore */
  }

  // Automatically sync any missed attendance records on startup
  // Note: This is disabled since we're using real-time WebSocket connection
  // The ZKTeco device sends data in real-time, so no scheduled sync is needed
  
  // try {
  //   console.log('🔄 Checking for missed attendance records...');
  //   const today = new Date();
  //   const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  //   
  //   const syncResult = await attendanceService.syncZKTecoAttendance(yesterday, today);
  //   if (syncResult.success) {
  //     console.log(`✅ Auto-sync completed: ${syncResult.data.created} created, ${syncResult.data.updated} updated`);
  //   } else {
  //     console.log('⚠️ Auto-sync failed, but continuing...');
  //   }
  // } catch (error) {
  //   console.error('⚠️ Auto-sync error (continuing anyway):', error.message);
  // }
  

});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Stop Change Stream service
  if (changeStreamService) {
    changeStreamService.stop();
    console.log('✅ Change Stream service stopped');
  }
  
  // Stop ZKBio Time WebSocket Proxy
  if (zkbioTimeWebSocketProxy) {
    zkbioTimeWebSocketProxy.disconnect();
    console.log('✅ ZKBio Time WebSocket Proxy stopped');
  }
  
  // Stop IT Notification Service
  itNotificationService.stop();
  console.log('✅ IT Notification Service stopped');
  
  mongoose.connection.close().then(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  // Stop Change Stream service
  if (changeStreamService) {
    changeStreamService.stop();
    console.log('✅ Change Stream service stopped');
  }
  
  // Stop ZKBio Time WebSocket Proxy
  if (zkbioTimeWebSocketProxy) {
    zkbioTimeWebSocketProxy.disconnect();
    console.log('✅ ZKBio Time WebSocket Proxy stopped');
  }
  
  // Stop IT Notification Service
  itNotificationService.stop();
  console.log('✅ IT Notification Service stopped');
  
  mongoose.connection.close().then(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
}); 