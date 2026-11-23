const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware, authorize, refreshAuthMiddleware } = require('../middleware/auth');
const permissions = require('../middleware/permissions');
const User = require('../models/User');
const Department = require('../models/hr/Department');
const SubRole = require('../models/SubRole');
const Employee = require('../models/hr/Employee');
const { ROLE_VALUES, ROLE_MODULE_ACCESS } = require('../config/permissions');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const UserLoginLog = require('../models/general/UserLoginLog');
const { getClientIP, getUserAgent } = require('../utils/requestHelpers');
const realtimeNotificationGateway = require('../services/realtimeNotificationGateway');
const {
  findEmployeeForAuthUser,
  loadReportingLineForProfile,
  saveReportingLineForUser,
  linkUserToEmployee,
  unlinkUserFromEmployee
} = require('../utils/employeeUserLink');
const {
  departmentAuthValidator,
  optionalDepartmentAuthValidator
} = require('../utils/departmentResolver');

const { attachHigherManagementRole } = require('../utils/higherManagementRole');
const router = express.Router();

const USER_ROLE_POPULATE = [
  { path: 'roleRef', select: 'name displayName description permissions isActive' },
  { path: 'roles', select: 'name displayName description permissions isActive' },
  { path: 'subRoles', select: 'name module permissions description' }
];

async function loadUserWithRoles(userIdOrDoc) {
  const id = userIdOrDoc?._id || userIdOrDoc?.id || userIdOrDoc;
  const user = await User.findById(id).select('-password');
  if (!user) return null;
  await user.populate(USER_ROLE_POPULATE);
  return user;
}

async function buildAuthProfilePayload(userIdOrDoc, { forSelf = true } = {}) {
  const user = await loadUserWithRoles(userIdOrDoc);
  if (!user) return null;
  // The logged-in user's own profile: a restricted higher_management role's permissions apply (not saved)
  if (forSelf) await attachHigherManagementRole(user);
  const userProfile = user.getProfile();
  userProfile.linkedEmployee = user.linkedEmployee;
  await attachEmployeeProfileFields(userProfile, user);
  return userProfile;
}

/** Attach linked employee fields (incl. explicit reporting line choice) to auth profile payload. */
async function attachEmployeeProfileFields(userProfile, userDoc) {
  const employeeData = await findEmployeeForAuthUser(userDoc, {
    select: 'jobDescription leaveBalance reportingLine employeeId placementDesignation designation position',
    autoLink: false
  });

  if (employeeData) {
    userProfile.jobDescription = employeeData.jobDescription;
    userProfile.leaveBalance = employeeData.leaveBalance;
    userProfile.employeeDocId = employeeData._id;
    if (employeeData.employeeId) {
      userProfile.employeeId = employeeData.employeeId; // Force Employee ID as master source
    }

    // Resolve designation title for sidebar / profile display
    if (employeeData.placementDesignation) {
      await employeeData.populate('placementDesignation', 'title');
    }
    const designationTitle =
      employeeData.placementDesignation?.title ||
      (typeof employeeData.designation === 'object'
        ? (employeeData.designation?.title || employeeData.designation?.name)
        : employeeData.designation) ||
      employeeData.position ||
      '';
    if (designationTitle) {
      userProfile.designation = String(designationTitle).trim();
    }
  }

  // Fallback: User.position when no linked employee designation
  if (!userProfile.designation && userProfile.position) {
    userProfile.designation = String(userProfile.position).trim();
  }

  userProfile.reportingLine = await loadReportingLineForProfile(userDoc);

  return userProfile;
}

// Configure multer for profile image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'profile-images');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

const signatureStorage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'digital-signatures');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'signature-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadSignature = multer({
  storage: signatureStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for signatures'), false);
    }
  }
});

const stampStorage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'approval-stamps');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'stamp-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadApprovalStamp = multer({
  storage: stampStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for approval stamp'), false);
    }
  }
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please enter a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('department').custom(departmentAuthValidator),
  body('position')
    .trim()
    .notEmpty()
    .withMessage('Position is required'),
  body('employeeId')
    .trim()
    .notEmpty()
    .withMessage('Employee ID is required')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const {
    firstName,
    lastName,
    email,
    password,
    department,
    position,
    employeeId,
    phone,
    role = 'employee',
    subRoles = []
  } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ email }, { employeeId }]
  });

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: existingUser.email === email 
        ? 'Email already registered' 
        : 'Employee ID already exists'
    });
  }

  // Create new user
  const user = new User({
    firstName,
    lastName,
    email,
    password,
    department,
    position,
    employeeId,
    phone,
    role,
    subRoles
  });

  await user.save();

  // Populate RBAC roles + legacy sub-roles before returning
  await user.populate('roleRef', 'name displayName description permissions isActive');
  await user.populate('roles', 'name displayName description permissions isActive');
  await user.populate('subRoles', 'name module permissions description');

  // Generate JWT token
  const token = user.generateAuthToken();

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: user.getProfile(),
      token
    }
  });
}));

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please enter a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('🔐 Login validation failed:', errors.array());
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email, password } = req.body;
  const loginEmail = String(email || '')
    .trim()
    .toLowerCase();
  console.log('🔐 Login attempt for:', loginEmail);

  try {
    // Match stored users (schema lowercases email on save; normalize avoids lookup mismatches)
    const user = await User.findOne({ email: loginEmail }).select('+password');

    if (!user) {
      console.log('🔐 Login failed: User not found:', loginEmail);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      console.log('🔐 Login failed: User deactivated:', loginEmail);
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log('🔐 Login failed: Invalid password for:', loginEmail);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Populate RBAC roles + legacy sub-roles before generating response
    await user.populate('roleRef', 'name displayName description permissions isActive');
    await user.populate('roles', 'name displayName description permissions isActive');
    await user.populate('subRoles', 'name module permissions description');
    await attachHigherManagementRole(user);
    
    // Generate JWT token
    const token = user.generateAuthToken();

    // Log login event asynchronously (don't block response)
    UserLoginLog.create({
      userId: user._id,
      username: `${user.firstName} ${user.lastName}`,
      email: user.email,
      loginTime: new Date(),
      ipAddress: getClientIP(req),
      userAgent: getUserAgent(req),
      status: 'active'
    }).catch(() => {
      // Silently fail - don't block login
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.getProfile(),
        token
      }
    });
  } catch (error) {
    console.error('🔐 Login error:', error);
    console.error('🔐 Error stack:', error.stack);
    
    // Check for specific error types
    if (error.message === 'JWT_SECRET not configured') {
      return res.status(500).json({
        success: false,
        message: 'Server configuration error. Please contact administrator.'
      });
    }
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
}));

// @route   POST /api/auth/refresh-token
// @desc    Refresh JWT token (issue new token if current one is valid)
// @access  Private
router.post('/refresh-token', refreshAuthMiddleware, asyncHandler(async (req, res) => {
  try {
    // User is already authenticated via authMiddleware
    // Populate RBAC roles + legacy sub-roles before generating new token
    await req.user.populate('roleRef', 'name displayName description permissions isActive');
    await req.user.populate('roles', 'name displayName description permissions isActive');
    await req.user.populate('subRoles', 'name module permissions description');
    await attachHigherManagementRole(req.user);
    
    // Generate new token
    const newToken = req.user.generateAuthToken();
    
    // Update last login (optional - can be removed if you don't want to update on refresh)
    // req.user.lastLogin = new Date();
    // await req.user.save();
    
    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: newToken,
        user: req.user.getProfile()
      }
    });
  } catch (error) {
    console.error('🔐 Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
}));

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  const userProfile = await buildAuthProfilePayload(req.user.id);

  res.json({
    success: true,
    data: {
      user: userProfile
    }
  });
}));

// @route   GET /api/auth/reporting-options
// @desc    Get active employees for manager/HOD selection
// @access  Private
router.get('/reporting-options', authMiddleware, asyncHandler(async (req, res) => {
  const me = await findEmployeeForAuthUser(req.user, { select: '_id', autoLink: false });

  const query = {
    isDeleted: { $ne: true },
    isActive: true
  };
  if (me?._id) {
    query._id = { $ne: me._id };
  }

  const employees = await Employee.find(query)
    .select('_id firstName lastName employeeId placementDesignation placementDepartment')
    .populate('placementDesignation', 'title')
    .populate('placementDepartment', 'name')
    .sort({ firstName: 1, lastName: 1 })
    .lean();

  res.json({
    success: true,
    data: employees
  });
}));

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', [
  authMiddleware,
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('phone')
    .optional()
    .trim()
    .matches(/^[\+]?[1-9][\d]{0,15}$/)
    .withMessage('Please enter a valid phone number')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { firstName, lastName, phone, address, profileImage, digitalSignature, approvalStamp, reportingLineId } = req.body;

  // Update user profile
  const updateData = {};
  if (firstName !== undefined) updateData.firstName = firstName;
  if (lastName !== undefined) updateData.lastName = lastName;
  if (phone !== undefined) updateData.phone = phone;
  if (address !== undefined) updateData.address = address;
  if (profileImage !== undefined) updateData.profileImage = profileImage;
  if (digitalSignature !== undefined) updateData.digitalSignature = digitalSignature;
  if (approvalStamp !== undefined) updateData.approvalStamp = approvalStamp;

  await User.findByIdAndUpdate(req.user.id, updateData, { runValidators: true });

  if (reportingLineId !== undefined) {
    try {
      await saveReportingLineForUser(req.user, reportingLineId);
    } catch (e) {
      if (e.code === 'NO_EMPLOYEE_LINK') {
        return res.status(404).json({
          success: false,
          message:
            `Your login (${req.user.email || 'unknown'}) is not linked to your own HR employee record, so reporting line cannot be saved yet. ` +
            'The manager you selected (e.g. Adeel Khalid Siddiqui) only needs to exist in HR — your account must match your employee profile by email, employee ID, or name. Ask HR to link your user in Admin → User Management to your HR employee, or align email/employee ID.'
        });
      }
      return res.status(400).json({
        success: false,
        message: e.message || 'Invalid reporting line values'
      });
    }
  }

  const userProfile = await buildAuthProfilePayload(req.user.id);

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: {
      user: userProfile
    }
  });
}));

// @route   POST /api/auth/upload-profile-image
// @desc    Upload profile image for current user
// @access  Private
router.post('/upload-profile-image', 
  authMiddleware,
  upload.single('profileImage'),
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image file provided'
        });
      }

      // Get the file path
      const imagePath = `/uploads/profile-images/${req.file.filename}`;
      
      // Update user's profile image
      await User.findByIdAndUpdate(req.user.id, { profileImage: imagePath }, { runValidators: true });
      const userProfile = await buildAuthProfilePayload(req.user.id);

      res.json({
        success: true,
        message: 'Profile image uploaded successfully',
        data: {
          imagePath: imagePath,
          filename: req.file.filename,
          user: userProfile
        }
      });
    } catch (error) {
      console.error('Error uploading profile image:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading profile image',
        error: error.message
      });
    }
  })
);

// @route   POST /api/auth/upload-digital-signature
// @desc    Upload digital signature image for current user (PNG/JPG scan or drawn export)
// @access  Private
router.post(
  '/upload-digital-signature',
  authMiddleware,
  uploadSignature.single('digitalSignature'),
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No signature image provided'
        });
      }

      const imagePath = `/uploads/digital-signatures/${req.file.filename}`;
      await User.findByIdAndUpdate(req.user.id, { digitalSignature: imagePath }, { runValidators: true });
      const userProfile = await buildAuthProfilePayload(req.user.id);

      res.json({
        success: true,
        message: 'Digital signature saved successfully',
        data: {
          imagePath,
          filename: req.file.filename,
          user: userProfile
        }
      });
    } catch (error) {
      console.error('Error uploading digital signature:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading digital signature',
        error: error.message
      });
    }
  })
);

// @route   POST /api/auth/upload-approval-stamp
// @desc    Upload approval stamp image for current user
// @access  Private
router.post(
  '/upload-approval-stamp',
  authMiddleware,
  uploadApprovalStamp.single('approvalStamp'),
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No approval stamp image provided'
        });
      }

      const imagePath = `/uploads/approval-stamps/${req.file.filename}`;
      await User.findByIdAndUpdate(req.user.id, { approvalStamp: imagePath }, { runValidators: true });
      const userProfile = await buildAuthProfilePayload(req.user.id);

      res.json({
        success: true,
        message: 'Approval stamp saved successfully',
        data: {
          imagePath,
          filename: req.file.filename,
          user: userProfile
        }
      });
    } catch (error) {
      console.error('Error uploading approval stamp:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading approval stamp',
        error: error.message
      });
    }
  })
);

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', [
  authMiddleware,
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { currentPassword, newPassword } = req.body;

  // Get user with password
  const user = await User.findById(req.user.id).select('+password');

  // Verify current password
  const isCurrentPasswordValid = await user.comparePassword(currentPassword);
  if (!isCurrentPasswordValid) {
    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect'
    });
  }

  // Update password
  user.password = newPassword;
  await user.save();

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please enter a valid email')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    // Don't reveal if email exists or not for security
    return res.json({
      success: true,
      message: 'If the email exists, a password reset link has been sent'
    });
  }

  // Generate reset token (implement email sending logic here)
  // For now, just return success message
  res.json({
    success: true,
    message: 'If the email exists, a password reset link has been sent'
  });
}));

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  // Log logout event asynchronously (don't block response)
  setImmediate(async () => {
    try {
      const activeLogin = await UserLoginLog.findOne({
        userId: req.user._id,
        status: 'active'
      }).sort({ loginTime: -1 });
      
      if (activeLogin) {
        activeLogin.logoutTime = new Date();
        activeLogin.status = 'logged_out';
        activeLogin.logoutReason = 'manual';
        activeLogin.calculateDuration();
        await activeLogin.save();
      }
    } catch (error) {
      // Silently fail - don't block logout
    }
  });
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

// @route   POST /api/auth/users
// @desc    Create a new user (Admin only)
// @access  Private (Admin)
router.post('/users', [
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'create'),
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .custom((value) => {
      if (value === '' || value === null || value === undefined) {
        return true; // Allow empty values
      }
      if (value.trim().length < 2 || value.trim().length > 50) {
        throw new Error('Last name must be between 2 and 50 characters');
      }
      return true;
    }),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please enter a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('department').custom(departmentAuthValidator),
  body('position')
    .trim()
    .notEmpty()
    .withMessage('Position is required'),
  body('employeeId')
    .trim()
    .notEmpty()
    .withMessage('Employee ID is required')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const {
    firstName,
    lastName,
    email,
    password,
    department,
    position,
    employeeId,
    phone,
    profileImage,
    employee // Employee ID to link
  } = req.body;
  
  // Default role to 'employee' - roles will be assigned through Role Management
  const role = 'employee';
  const subRoles = [];

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [{ email }, { employeeId }]
  });

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: existingUser.email === email 
        ? 'Email already registered' 
        : 'Employee ID already exists'
    });
  }

  // If employee ID is provided, verify it exists and doesn't have a user account
  let employeeDoc = null;
  if (employee) {
    const Employee = require('../models/hr/Employee');
    employeeDoc = await Employee.findById(employee);
    
    if (!employeeDoc) {
      return res.status(400).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    if (employeeDoc.user) {
      const linkedUserExists = await User.findById(employeeDoc.user);
      if (linkedUserExists) {
        return res.status(400).json({
          success: false,
          message: 'Employee already has a user account'
        });
      }
      // Orphaned reference (user was deleted) – allow creating a new user; we'll link below
    }
  }

  // Create new user
  const user = new User({
    firstName,
    lastName,
    email,
    password,
    department,
    position,
    employeeId,
    phone,
    role,
    subRoles,
    profileImage
  });

  await user.save();

  if (employeeDoc) {
    await linkUserToEmployee(user._id, employeeDoc._id);
  }

  const userProfile = await buildAuthProfilePayload(user._id, { forSelf: false });

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: {
      user: userProfile
    }
  });
}));

// @route   GET /api/auth/users
// @desc    Get all users (Admin only)
// @access  Private (Admin)
router.get('/users', 
  authMiddleware,
  (req, res, next) => {
    if (req.query.dropdown === 'true') {
      return next();
    }
    return permissions.checkSubRolePermission('admin', 'user_management', 'read')(req, res, next);
  },
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 10, 
      department, 
      role,
      search,
      status 
    } = req.query;

    const query = {};

    // Handle status filter
    if (status === 'active') {
      query.isActive = true;
    } else if (status === 'inactive') {
      query.isActive = false;
    }
    // If status is 'all' or not provided, don't filter by status (show all users)

    // Add filters
    if (department) query.department = department;
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .populate('subRoles', 'name module permissions')
      .populate('roleRef', 'name displayName description permissions isActive')
      .populate('roles', 'name displayName description permissions isActive')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users: users.map(user => user.getProfile()),
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  })
);

// @route   GET /api/auth/users-online
// @desc    Get currently online users (Admin only)
// @access  Private (Admin)
router.get(
  '/users-online',
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'read'),
  asyncHandler(async (req, res) => {
    const { search = '', department = '' } = req.query;
    const onlineIds = realtimeNotificationGateway.getOnlineUserIds();

    if (!onlineIds.length) {
      return res.json({
        success: true,
        data: { totalOnline: 0, users: [] }
      });
    }

    const query = {
      _id: { $in: onlineIds.map((id) => new mongoose.Types.ObjectId(id)) },
      isActive: true
    };

    if (department) query.department = department;
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('firstName lastName email employeeId department position profileImage lastLogin role')
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    res.json({
      success: true,
      data: {
        totalOnline: users.length,
        users: users.map((u) => ({
          id: u._id,
          firstName: u.firstName || '',
          lastName: u.lastName || '',
          fullName: [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
          email: u.email || '',
          employeeId: u.employeeId || '',
          department: u.department || '',
          position: u.position || '',
          profileImage: u.profileImage || '',
          lastLogin: u.lastLogin || null,
          role: u.role || '',
          isOnline: true
        }))
      }
    });
  })
);

// @route   GET /api/auth/users/:id
// @desc    Get user by ID (Admin only)
// @access  Private (Admin)
router.get('/users/:id', 
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'read'),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('roleRef', 'name displayName description permissions isActive')
      .populate('roles', 'name displayName description permissions isActive')
      .populate('subRoles', 'name module permissions');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: user.getProfile()
      }
    });
  })
);

// @route   PATCH /api/auth/users/:id/link-employee
// @desc    Explicitly link or unlink HR employee (Admin only)
// @access  Private (Admin)
router.patch(
  '/users/:id/link-employee',
  [
    authMiddleware,
    permissions.checkSubRolePermission('admin', 'user_management', 'update'),
    body('employee').optional().isMongoId().withMessage('Invalid employee id'),
    body('unlink').optional().isBoolean()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { employee, unlink } = req.body;
    try {
      if (unlink) {
        await unlinkUserFromEmployee(req.params.id);
      } else if (employee) {
        await linkUserToEmployee(req.params.id, employee);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Provide employee (HR record id) or unlink: true'
        });
      }
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message || 'Link failed' });
    }

    const userProfile = await buildAuthProfilePayload(req.params.id, { forSelf: false });
    res.json({
      success: true,
      message: unlink ? 'Employee link removed' : 'Employee linked successfully',
      data: { user: userProfile }
    });
  })
);

// @route   PUT /api/auth/users/:id
// @desc    Update user (Admin only)
// @access  Private (Admin)
router.put('/users/:id', [
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'update'),
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('role')
    .optional()
    .custom((value) => {
      if (!value) return true; // Allow empty/undefined for optional field
      
      // Check if role is in predefined ROLE_VALUES
      if (ROLE_VALUES.includes(value)) {
        return true;
      }
      // Check if role exists in ROLE_MODULE_ACCESS (for custom roles like "Audit Director", "Hr General Manager")
      if (ROLE_MODULE_ACCESS[value]) {
        return true;
      }
      // Also check normalized variations (handle case and spaces)
      const normalized = String(value).toLowerCase().replace(/\s+/g, '_');
      const lowerCase = String(value).toLowerCase();
      if (ROLE_MODULE_ACCESS[normalized] || ROLE_MODULE_ACCESS[lowerCase]) {
        return true;
      }
      throw new Error('Invalid role');
    })
    .withMessage('Invalid role'),
  body('department').optional().custom(optionalDepartmentAuthValidator),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const allowedFields = [
    'firstName',
    'lastName',
    'phone',
    'department',
    'position',
    'role',
    'isActive',
    'profileImage'
  ];
  const update = {};
  allowedFields.forEach((key) => {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  });

  const user = await User.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true
  }).select('-password');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  const userProfile = await buildAuthProfilePayload(user._id, { forSelf: false });

  res.json({
    success: true,
    message: 'User updated successfully',
    data: {
      user: userProfile
    }
  });
}));

// @route   PATCH /api/auth/users/:id/role
// @desc    Update user role (Admin only)
// @access  Private (Admin)
router.patch('/users/:id/role', [
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'update'),
  body('role')
    .custom((value) => {
      if (!value) {
        throw new Error('Role is required');
      }
      
      // Check if role is in predefined ROLE_VALUES
      if (ROLE_VALUES.includes(value)) {
        return true;
      }
      // Check if role exists in ROLE_MODULE_ACCESS (for custom roles like "Audit Director", "Hr General Manager")
      if (ROLE_MODULE_ACCESS[value]) {
        return true;
      }
      // Also check normalized variations (handle case and spaces)
      const normalized = String(value).toLowerCase().replace(/\s+/g, '_');
      const lowerCase = String(value).toLowerCase();
      if (ROLE_MODULE_ACCESS[normalized] || ROLE_MODULE_ACCESS[lowerCase]) {
        return true;
      }
      throw new Error('Invalid role');
    })
    .withMessage('Invalid role')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { role } = req.body;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    { new: true, runValidators: true }
  ).select('-password');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    message: 'User role updated successfully',
    data: {
      user: user.getProfile()
    }
  });
}));

// @route   PATCH /api/auth/users/:id/status
// @desc    Update user status (Admin only)
// @access  Private (Admin)
router.patch('/users/:id/status', [
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'update'),
  body('isActive')
    .isBoolean()
    .withMessage('isActive must be a boolean')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { isActive } = req.body;

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive },
    { new: true, runValidators: true }
  ).select('-password');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
    data: {
      user: user.getProfile()
    }
  });
}));

// @route   DELETE /api/auth/users/:id
// @desc    Delete user (Admin only)
// @access  Private (Admin)
router.delete('/users/:id', 
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'delete'),
  asyncHandler(async (req, res) => {
    // Check if the ID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    // Clear employee.user reference so this employee shows again in "Create User" employee list
    const Employee = require('../models/hr/Employee');
    await Employee.updateMany(
      { user: req.params.id },
      { $unset: { user: 1 } }
    );

    // Delete the user
    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  })
);

// @route   PUT /api/auth/users/:id/permissions
// @desc    Update user permissions (Admin only)
// @access  Private (Admin)
router.put('/users/:id/permissions', [
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'update'),
  body('permissions')
    .isArray()
    .withMessage('Permissions must be an array'),
  body('permissions.*.module')
    .notEmpty()
    .trim()
    .withMessage('Module is required for each permission'),
  body('permissions.*.actions')
    .isArray()
    .withMessage('Actions must be an array for each permission'),
  body('permissions.*.actions.*')
    .isIn(['create', 'read', 'update', 'delete', 'approve', 'view', 'manage'])
    .withMessage('Invalid action type')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Update permissions
  user.permissions = req.body.permissions;
  await user.save();

  res.json({
    success: true,
    message: 'Permissions updated successfully',
    data: {
      user: user.getProfile()
    }
  });
}));

// @route   PUT /api/auth/users/:id/role-ref
// @desc    Assign role to user (Admin only)
// @access  Private (Admin)
router.put('/users/:id/role-ref', [
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'update'),
  body('roleRef')
    .optional()
    .isMongoId()
    .withMessage('Role ID must be a valid MongoDB ObjectId')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // If roleRef is provided, validate it exists
  if (req.body.roleRef) {
    const Role = require('../models/Role');
    const role = await Role.findById(req.body.roleRef);
    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Role not found'
      });
    }
    if (!role.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign inactive role'
      });
    }
  }

  // Update roleRef
  user.roleRef = req.body.roleRef || null;
  await user.save();

  // Populate roleRef for response
  await user.populate('roleRef', 'name displayName description permissions');

  res.json({
    success: true,
    message: 'Role assigned successfully',
    data: {
      user: user.getProfile()
    }
  });
}));

// @route   PUT /api/auth/users/:id/roles
// @desc    Assign multiple roles to user (Admin only)
// @access  Private (Admin)
router.put('/users/:id/roles', [
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'user_management', 'update'),
  body('roles')
    .isArray()
    .withMessage('Roles must be an array'),
  body('roles.*')
    .isMongoId()
    .withMessage('Each role ID must be a valid MongoDB ObjectId')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Validate all roles exist and are active
  const Role = require('../models/Role');
  const roles = await Role.find({ _id: { $in: req.body.roles }, isActive: true });
  if (roles.length !== req.body.roles.length) {
    return res.status(400).json({
      success: false,
      message: 'One or more roles not found or inactive'
    });
  }

  // Update roles array
  user.roles = req.body.roles;
  await user.save();

  // Populate roles for response
  await user.populate('roles', 'name displayName description permissions isActive');

  res.json({
    success: true,
    message: 'Roles assigned successfully',
    data: {
      user: user.getProfile()
    }
  });
}));

// @route   GET /api/auth/sub-roles/:module
// @desc    Get sub-roles for a specific module
// @access  Private (Admin)
router.get('/sub-roles/:module', 
  authMiddleware,
  permissions.checkSubRolePermission('admin', 'sub_roles', 'read'),
  asyncHandler(async (req, res) => {
    const { module } = req.params;
    
    const subRoles = await SubRole.find({ 
      module: module,
      isActive: true 
    }).select('name module description permissions');
    
    res.json({
      success: true,
      data: {
        subRoles
      }
    });
  })
);

module.exports = router; 