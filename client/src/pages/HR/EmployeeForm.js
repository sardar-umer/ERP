import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  FormHelperText,
  Switch,
  Stepper,
  Step,
  StepLabel,
  Card,
  CardContent,
  Avatar,
  Alert,
  Snackbar,
  Divider,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton
} from '@mui/material';
import {
  Save as SaveIcon,
  Cancel as CancelIcon,
  Person as PersonIcon,
  Work as WorkIcon,
  ContactPhone as ContactIcon,
  School as EducationIcon,
  AttachMoney as SalaryIcon,
  Add as AddIcon,
  PhotoCamera as PhotoCameraIcon,
  Upload as UploadIcon,
  Delete as DeleteIcon,
  Print as PrintIcon
} from '@mui/icons-material';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import api from '../../services/api';
import { formatPKR } from '../../utils/currency';
import { allowancesForForm, vehicleFuelTotal, buildAllowancesPayload, vehicleAllowanceAmount, fuelAllowanceAmount } from '../../utils/allowanceHelpers';
import { computeAutoSalaryBreakdown } from '../../utils/salaryBreakdown';
import AutoCalculatedSalaryBreakdown from '../../components/AutoCalculatedSalaryBreakdown';
import { useData } from '../../contexts/DataContext';
import { getImageUrl, handleImageError } from '../../utils/imageService';
import { printEmployeeFormStep } from '../../utils/employeeFormPrint';

const steps = ['Joining Report', 'Personal Information', 'Employment Details', 'Contact & Address', 'Salary & Benefits'];

const PAYROLL_MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
];

const EmployeeForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { fetchEmployees, employees: allEmployees = [] } = useData();
  
  // Get the page number from location state (passed when navigating from EmployeeList)
  const savedPage = location.state?.page || 0;
  const [activeStep, setActiveStep] = useState(0);
  const [partialPeriodDraft, setPartialPeriodDraft] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  });
  const [departments, setDepartments] = useState([]);

  const [banks, setBanks] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sections, setSections] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [qualifications, setQualifications] = useState([]);
  const [countries, setCountries] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [nextEmployeeId, setNextEmployeeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [employee, setEmployee] = useState(null);

  const [showAddCompanyDialog, setShowAddCompanyDialog] = useState(false);
  const [showAddSectorDialog, setShowAddSectorDialog] = useState(false);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);
  const [showAddDepartmentDialog, setShowAddDepartmentDialog] = useState(false);
  const [showAddSectionDialog, setShowAddSectionDialog] = useState(false);
  const [showAddDesignationDialog, setShowAddDesignationDialog] = useState(false);
  const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);
  const [showAddQualificationDialog, setShowAddQualificationDialog] = useState(false);


  // New data states for placement dialogs
  const [newCompanyData, setNewCompanyData] = useState({
    name: '',
    type: 'Private Limited',
    description: ''
  });

  const [newSectorData, setNewSectorData] = useState({
    name: '',
    industry: 'Technology'
  });

  const [newProjectData, setNewProjectData] = useState({
    name: '',
    code: '',
    description: ''
  });

  const [newDepartmentData, setNewDepartmentData] = useState({
    name: '',
    description: ''
  });

  const [newSectionData, setNewSectionData] = useState({
    name: ''
  });

  const [newDesignationData, setNewDesignationData] = useState({
    title: '',
    level: 'Entry',
    description: ''
  });

  const [newLocationData, setNewLocationData] = useState({
    name: '',
    type: 'Office'
  });

  const [newQualificationData, setNewQualificationData] = useState({
    name: '',
    description: ''
  });



  // State for company search suggestions
  const [companySuggestions, setCompanySuggestions] = useState([]);
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);

  // State for project search suggestions
  const [projectSuggestions, setProjectSuggestions] = useState([]);
  const [showProjectSuggestions, setShowProjectSuggestions] = useState(false);

  // Validation schema
  const validationSchema = Yup.object({
    joiningReport: Yup.object({
      documentNumber: Yup.string().optional(),
      revisionNumber: Yup.string().optional(),
      issueDate: Yup.date().nullable().optional(),
      employeeName: Yup.string().optional(),
      employmentPosition: Yup.string().optional(),
      employeeTitle: Yup.string().oneOf(['Mr.', 'Mrs.', 'Ms.']).optional(),
      parentSpouseRelation: Yup.string().oneOf(['S/o', 'D/o', 'W/o']).optional(),
      parentSpouseName: Yup.string().optional(),
      cnic: Yup.string().optional(),
      contactNumber: Yup.string().optional(),
      reportingLocation: Yup.string().optional(),
      reportingDateTime: Yup.date().nullable().optional(),
      employeeSignature: Yup.string().optional(),
      employeeSignatureDate: Yup.date().nullable().optional(),
      verificationDepartment: Yup.string().optional(),
      hodName: Yup.string().optional(),
      joiningRemarks: Yup.string().optional(),
      hrSignature: Yup.string().optional(),
      hrSignatureDate: Yup.date().nullable().optional()
    }),
    firstName: Yup.string().required('First name is required'),
    lastName: Yup.string(),
    email: Yup.string().nullable().email('Invalid email format').optional(),
    phone: Yup.string().required('Phone is required'),
    dateOfBirth: Yup.date().required('Date of birth is required'),
    gender: Yup.string().required('Gender is required'),
    idCard: Yup.string().required('ID Card number is required'),
    nationality: Yup.string().required('Nationality is required'),
    religion: Yup.string().required('Religion is required'),
    maritalStatus: Yup.string().required('Marital status is required'),
    employeeId: Yup.string(),
    qualification: Yup.string().required('Qualification is required'),
    bankName: Yup.string().optional(),
    bankAccountNumber: Yup.string().optional(),
    foreignBankAccount: Yup.string().optional(),
    spouseName: Yup.string().optional(),
    appointmentDate: Yup.date().required('Appointment date is required'),
    probationPeriodMonths: Yup.number()
      .required('Probation period is required')
      .min(0, 'Probation period cannot be negative')
      .max(24, 'Probation period cannot exceed 24 months'),
    hireDate: Yup.date().required('Hire date is required'),
    jobDescription: Yup.string().optional(),
    // Employment status
    employmentStatus: Yup.string().oneOf(['Draft', 'Active', 'Inactive', 'Terminated', 'Resigned', 'Retired', 'Reinstated'], 'Invalid employment status'),
    terminationDate: Yup.date().when('employmentStatus', {
      is: (val) => ['Terminated', 'Resigned', 'Inactive', 'Retired'].includes(val),
      then: (schema) => schema.required('Termination/Separation date is required for this status'),
      otherwise: (schema) => schema.nullable()
    }),
    terminationReason: Yup.string().when('employmentStatus', {
      is: (val) => ['Terminated', 'Resigned', 'Inactive', 'Retired'].includes(val),
      then: (schema) => schema.required('Reason is required for this status'),
      otherwise: (schema) => schema.nullable()
    }),
    // Placement fields
    placementCompany: Yup.string().optional(),
    placementSector: Yup.string().optional(),
    placementProject: Yup.string(),
    placementDepartment: Yup.string(),
    placementSection: Yup.string(),
    placementDesignation: Yup.string(),
    placementLocation: Yup.string(),
    oldDesignation: Yup.string(),
    salary: Yup.object({
      gross: Yup.number().nullable().optional().min(0, 'Gross salary must be positive'),
      basic: Yup.number().min(0, 'Basic salary must be positive')
    }),
    allowances: Yup.object({
      conveyance: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Conveyance allowance must be positive')
      }),
      food: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Food allowance must be positive')
      }),
      mobile: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Mobile allowance must be positive')
      }),
      vehicle: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Vehicle allowance must be positive')
      }),
      fuel: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Fuel allowance must be positive')
      }),
      medical: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Medical allowance must be positive')
      }),
      houseRent: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'House allowance must be positive')
      }),
      special: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Special allowance must be positive')
      }),
      other: Yup.object({
        isActive: Yup.boolean(),
        amount: Yup.number().min(0, 'Other allowance must be positive')
      })
    }),
    eobi: Yup.object({
      isActive: Yup.boolean(),
      amount: Yup.number().min(0, 'EOBI amount must be positive'),
      percentage: Yup.number().min(0, 'EOBI percentage must be positive')
    }),
    manualTax: Yup.object({
      isActive: Yup.boolean(),
      fixedAmount: Yup.number().min(0, 'Manual tax amount must be 0 or more')
    }),
    providentFund: Yup.object({
      isActive: Yup.boolean(),
      amount: Yup.number().min(0, 'Provident Fund amount must be positive'),
      percentage: Yup.number().min(0, 'Provident Fund percentage must be positive')
    }),
    employeeSecurity: Yup.object({
      isActive: Yup.boolean(),
      amount: Yup.number().min(0, 'Employee security amount must be positive')
    }),
    address: Yup.object({
      street: Yup.string().required('Street address is required'),
      city: Yup.string().required('City is required'),
      state: Yup.string().required('State is required'),
      country: Yup.string().required('Country is required')
    }),
    academicBackground: Yup.array().of(
      Yup.object({
        degree: Yup.string().optional(),
        institution: Yup.string().optional(),
        fieldOfStudy: Yup.string().optional(),
        graduationYear: Yup.mixed()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            // Convert empty string, null, or undefined to undefined
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return undefined;
            }
            const num = Number(originalValue);
            return isNaN(num) ? undefined : num;
          })
          .test('is-valid-year', 'Graduation year must be between 1900 and 2100', function(value) {
            // If value is undefined/null/empty, it's valid (optional field)
            if (value === undefined || value === null || value === '') {
              return true;
            }
            const num = Number(value);
            return !isNaN(num) && num >= 1900 && num <= 2100;
          }),
        gpa: Yup.mixed()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return undefined;
            }
            const num = Number(originalValue);
            return isNaN(num) ? undefined : num;
          })
          .test('is-valid-gpa', 'GPA must be between 0 and 4', function(value) {
            if (value === undefined || value === null || value === '') {
              return true;
            }
            const num = Number(value);
            return !isNaN(num) && num >= 0 && num <= 4;
          }),
        percentage: Yup.mixed()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return undefined;
            }
            const num = Number(originalValue);
            return isNaN(num) ? undefined : num;
          })
          .test('is-valid-percentage', 'Percentage must be between 0 and 100', function(value) {
            if (value === undefined || value === null || value === '') {
              return true;
            }
            const num = Number(value);
            return !isNaN(num) && num >= 0 && num <= 100;
          }),
        grade: Yup.string().optional(),
        certificate: Yup.string().optional()
      })
    ).optional(),
    professionalEducation: Yup.array().of(
      Yup.object({
        courseName: Yup.string().optional(),
        institution: Yup.string().optional(),
        certificationBody: Yup.string().optional(),
        completionDate: Yup.date()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return null;
            }
            return value;
          }),
        expiryDate: Yup.date()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return null;
            }
            return value;
          }),
        certificateNumber: Yup.string().optional(),
        certificate: Yup.string().optional(),
        isActive: Yup.boolean().optional()
      })
    ).optional(),
    employmentHistory: Yup.array().of(
      Yup.object({
        companyName: Yup.string().optional(),
        position: Yup.string().optional(),
        startDate: Yup.date()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return null;
            }
            return value;
          }),
        endDate: Yup.date()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return null;
            }
            return value;
          }),
        isCurrentJob: Yup.boolean().optional(),
        location: Yup.string().optional(),
        responsibilities: Yup.string().optional(),
        reasonForLeaving: Yup.string().optional(),
        salary: Yup.mixed()
          .nullable()
          .optional()
          .transform((value, originalValue) => {
            if (originalValue === '' || originalValue === null || originalValue === undefined) {
              return undefined;
            }
            const num = Number(originalValue);
            return isNaN(num) ? undefined : num;
          })
          .test('is-valid-salary', 'Salary must be a positive number', function(value) {
            if (value === undefined || value === null || value === '') {
              return true;
            }
            const num = Number(value);
            return !isNaN(num) && num >= 0;
          }),
        supervisorName: Yup.string().optional(),
        supervisorContact: Yup.string().optional()
      })
    ).optional()
  });

  // Fetch departments
  const fetchDepartments = async () => {
    try {
      const response = await api.get('/hr/departments');
      setDepartments(response.data.data || []);
    } catch (error) {
      // Error fetching departments
    }
  };



  // Fetch banks
  const fetchBanks = async () => {
    try {
      const response = await api.get('/hr/banks');
      setBanks(response.data.data || []);
    } catch (error) {
      // Error fetching banks
    }
  };

  // Fetch companies
  const fetchCompanies = async () => {
    try {
      const response = await api.get('/hr/companies');
      setCompanies(response.data.data || []);
    } catch (error) {
      // Error fetching companies
    }
  };

  // Fetch sectors
  const fetchSectors = async () => {
    try {
      const response = await api.get('/hr/sectors');
      setSectors(response.data.data || []);
    } catch (error) {
      // Error fetching sectors
    }
  };



  // Fetch projects
  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects');
      setProjects(response.data.data || []);
    } catch (error) {
      // Error fetching projects
    }
  };

  // Fetch sections
  const fetchSections = async () => {
    try {
      const response = await api.get('/sections');
      setSections(response.data.data || []);
    } catch (error) {
      // Error fetching sections
    }
  };

  // Fetch sections by department
  const fetchSectionsByDepartment = async (departmentId) => {
    try {
      const response = await api.get(`/sections?department=${departmentId}`);
      setSections(response.data.data || []);
    } catch (error) {
      // Error fetching sections by department
    }
  };

  // Fetch designations by section
  const fetchDesignationsBySection = async (sectionId) => {
    try {
      const response = await api.get(`/designations?section=${sectionId}`);
      setDesignations(response.data.data || []);
    } catch (error) {
      // Error fetching designations by section
    }
  };

  // Fetch designations
  const fetchDesignations = async () => {
    try {
      const response = await api.get('/designations');
      setDesignations(response.data.data || []);
    } catch (error) {
      // Error fetching designations
    }
  };

  // Fetch locations
  const fetchLocations = async () => {
    try {
      const response = await api.get('/hr/locations');
      const fetchedLocations = response.data.data || [];
      setLocations(fetchedLocations);
      
      // Check if current placementLocation value exists in the fetched locations
      // If not, clear it to prevent MUI Select warning
      if (formik.values.placementLocation && 
          formik.values.placementLocation !== 'add_new' &&
          !fetchedLocations.some(loc => loc._id === formik.values.placementLocation)) {
        formik.setFieldValue('placementLocation', '');
      }
    } catch (error) {
    }
  };

  // Fetch qualifications
  const fetchQualifications = async () => {
    try {
      const response = await api.get('/hr/qualifications');
      const fetchedQualifications = response.data.data || [];
      setQualifications(fetchedQualifications);
    } catch (error) {
      // Error fetching qualifications
    }
  };

  // Fetch address data
  const fetchCountries = async () => {
    try {
      const response = await api.get('/countries');
      setCountries(response.data.data || []);
    } catch (error) {
      // Error fetching countries
    }
  };

  const fetchProvinces = async (countryId = null) => {
    try {
      const url = countryId ? `/provinces?country=${countryId}` : '/provinces';
      const response = await api.get(url);
      setProvinces(response.data.data || []);
    } catch (error) {
      // Error fetching provinces
    }
  };

  const fetchCities = async (provinceId = null) => {
    try {
      const url = provinceId ? `/cities?province=${provinceId}` : '/cities';
      const response = await api.get(url);
      setCities(response.data.data || []);
    } catch (error) {
      // Error fetching cities
    }
  };

  // Fetch next employee ID
  const fetchNextEmployeeId = async () => {
    try {
      const response = await api.get('/hr/employees/next-id');
      setNextEmployeeId(response.data.data.nextEmployeeId);
    } catch (error) {
      // Error fetching next employee ID
    }
  };

  // Handle image upload
  const handleImageUpload = async (file) => {
    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setSnackbar({
          open: true,
          message: 'Please select a valid image file',
          severity: 'error'
        });
        return;
      }

      // Validate file size (5MB limit)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        setSnackbar({
          open: true,
          message: 'Image size must be less than 5MB',
          severity: 'error'
        });
        return;
      }

      const formData = new FormData();
      formData.append('profileImage', file);
      
      const response = await api.post('/hr/upload-image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        const imagePath = response.data.data.imagePath;
        
        // Set the profileImage field in formik
        formik.setFieldValue('profileImage', imagePath);
        
        // Use the server URL for preview
        setImagePreview(getImageUrl(imagePath));
        
        setSnackbar({
          open: true,
          message: 'Image uploaded successfully!',
          severity: 'success'
        });
      } else {
        throw new Error(response.data.message || 'Image upload failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Error uploading image';
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error'
      });
      // Clear preview on error
      setImagePreview(null);
      setImageFile(null);
    }
  };

  // Handle file input change
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setImageFile(file);
      // Show immediate preview with blob URL while uploading
      const blobUrl = URL.createObjectURL(file);
      setImagePreview(blobUrl);
      handleImageUpload(file);
    }
  };

  // Handle camera capture
  const handleCameraCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'camera';
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (file) {
        setImageFile(file);
        // Show immediate preview with blob URL while uploading
        const blobUrl = URL.createObjectURL(file);
        setImagePreview(blobUrl);
        handleImageUpload(file);
      }
    };
    input.click();
  };

  // Handle employment status change
  const handleEmploymentStatusChange = (newStatus) => {
    // Auto-sync isActive when employment status changes
    if (newStatus === 'Active' || newStatus === 'Reinstated') {
      formik.setFieldValue('isActive', true);
    } else if (newStatus === 'Draft' || ['Terminated', 'Resigned', 'Inactive', 'Retired'].includes(newStatus)) {
      formik.setFieldValue('isActive', false);
    }
    formik.setFieldValue('employmentStatus', newStatus);
  };

  // Fetch employee for editing
  const fetchEmployee = async () => {
    if (!id || id === 'add') return;
    
    // Validate ID format before making request
    if (id && !/^[0-9a-fA-F]{24}$/.test(id)) {
      setSnackbar({
        open: true,
        message: `Invalid employee ID format: ${id}. Please check the URL.`,
        severity: 'error'
      });
      return;
    }
    
    try {
      setLoading(true);
      
      const response = await api.get(`/hr/employees/${id}`);
      const employeeData = response.data.data;
      setEmployee(employeeData);
      
      // Extract IDs from populated objects
      const formData = {
        ...employeeData,
        bankName: employeeData.bankName?._id || employeeData.bankName || '',
        bankAccountNumber: employeeData.bankAccountNumber || employeeData.accountNumber || '',
        placementCompany: employeeData.placementCompany?._id || employeeData.placementCompany || '',
        placementSector: employeeData.placementSector?._id || employeeData.placementSector || '',
        placementProject: employeeData.placementProject?._id || employeeData.placementProject || '',
        placementDepartment: employeeData.placementDepartment?._id || employeeData.placementDepartment || '',
        placementSection: employeeData.placementSection?._id || employeeData.placementSection || '',
        placementDesignation: employeeData.placementDesignation?._id || employeeData.placementDesignation || '',
        oldDesignation: employeeData.oldDesignation?._id || employeeData.oldDesignation || undefined,
        placementLocation: employeeData.placementLocation?._id || employeeData.placementLocation || '',
        employeeCategory: employeeData.employeeCategory || '',
        reportingLine: employeeData.reportingLine?._id || employeeData.reportingLine || '',
        salary: {
          gross: employeeData.salary?.gross || 0,
          basic: employeeData.salary?.basic || 0
        },
        allowances: {
          ...allowancesForForm(employeeData.allowances || {}),
          conveyance: {
            isActive: employeeData.allowances?.conveyance?.isActive || false,
            amount: employeeData.allowances?.conveyance?.amount || 0
          },
          food: {
            isActive: employeeData.allowances?.food?.isActive || false,
            amount: employeeData.allowances?.food?.amount || 0
          },
          mobile: {
            isActive: employeeData.allowances?.mobile?.isActive || false,
            amount: employeeData.allowances?.mobile?.amount || 0
          },
          medical: {
            isActive: employeeData.allowances?.medical?.isActive || false,
            amount: employeeData.allowances?.medical?.amount || 0
          },
          houseRent: {
            isActive: employeeData.allowances?.houseRent?.isActive || false,
            amount: employeeData.allowances?.houseRent?.amount || 0
          },
          special: {
            isActive: employeeData.allowances?.special?.isActive || false,
            amount: employeeData.allowances?.special?.amount || 0
          },
          other: {
            isActive: employeeData.allowances?.other?.isActive || false,
            amount: employeeData.allowances?.other?.amount || 0
          }
        },
        eobi: {
          isActive: employeeData.eobi?.isActive || false,
          amount: employeeData.eobi?.amount || 0,
          percentage: employeeData.eobi?.percentage || 0.06 // Assuming 6% is the default
        },
        manualTax: {
          isActive: employeeData.manualTax?.isActive || false,
          fixedAmount: employeeData.manualTax?.fixedAmount || 0
        },
        providentFund: {
          isActive: employeeData.providentFund?.isActive || false,
          amount: employeeData.providentFund?.amount || 0,
          percentage: employeeData.providentFund?.percentage || 0.0834 // 8.34% is the default
        },
        employeeSecurity: {
          isActive: employeeData.employeeSecurity?.isActive || false,
          amount: employeeData.employeeSecurity?.amount || 0
        },
        address: {
          ...employeeData.address,
          city: employeeData.address?.city?._id || employeeData.address?.city || '',
          state: employeeData.address?.state?._id || employeeData.address?.state || '',
          country: employeeData.address?.country?._id || employeeData.address?.country || ''
        },
        emergencyContact: {
          name: employeeData.emergencyContact?.name || '',
          relationship: employeeData.emergencyContact?.relationship || '',
          phone: employeeData.emergencyContact?.phone || ''
        },
        joiningReport: {
          documentNumber: employeeData.joiningReport?.documentNumber || 'UD/HR/FRM-005',
          revisionNumber: employeeData.joiningReport?.revisionNumber || '00',
          issueDate: employeeData.joiningReport?.issueDate ? new Date(employeeData.joiningReport.issueDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          employeeName: employeeData.joiningReport?.employeeName || '',
          employmentPosition: employeeData.joiningReport?.employmentPosition || '',
          employeeTitle: employeeData.joiningReport?.employeeTitle || 'Mr.',
          parentSpouseRelation: employeeData.joiningReport?.parentSpouseRelation || 'S/o',
          parentSpouseName: employeeData.joiningReport?.parentSpouseName || '',
          cnic: employeeData.joiningReport?.cnic || '',
          contactNumber: employeeData.joiningReport?.contactNumber || '',
          reportingLocation: employeeData.joiningReport?.reportingLocation || '',
          reportingDateTime: employeeData.joiningReport?.reportingDateTime ? new Date(employeeData.joiningReport.reportingDateTime).toISOString().slice(0, 16) : '',
          employeeSignature: employeeData.joiningReport?.employeeSignature || '',
          employeeSignatureDate: employeeData.joiningReport?.employeeSignatureDate ? new Date(employeeData.joiningReport.employeeSignatureDate).toISOString().split('T')[0] : '',
          verificationDepartment: employeeData.joiningReport?.verificationDepartment || '',
          hodName: employeeData.joiningReport?.hodName || '',
          joiningRemarks: employeeData.joiningReport?.joiningRemarks || '',
          hrSignature: employeeData.joiningReport?.hrSignature || '',
          hrSignatureDate: employeeData.joiningReport?.hrSignatureDate ? new Date(employeeData.joiningReport.hrSignatureDate).toISOString().split('T')[0] : ''
        },
        dateOfBirth: employeeData.dateOfBirth ? new Date(employeeData.dateOfBirth).toISOString().split('T')[0] : '',
        hireDate: employeeData.hireDate ? new Date(employeeData.hireDate).toISOString().split('T')[0] : '',
        appointmentDate: employeeData.appointmentDate ? new Date(employeeData.appointmentDate).toISOString().split('T')[0] : '',
        endOfProbationDate: employeeData.endOfProbationDate ? new Date(employeeData.endOfProbationDate).toISOString().split('T')[0] : '',
        confirmationDate: employeeData.confirmationDate ? new Date(employeeData.confirmationDate).toISOString().split('T')[0] : '',
        isActive: employeeData.isActive !== undefined ? employeeData.isActive : true,
        isLateEntryForPayroll: employeeData.isLateEntryForPayroll !== undefined ? employeeData.isLateEntryForPayroll : false,
        isLateTerminationEntryForPayroll: employeeData.isLateTerminationEntryForPayroll !== undefined ? employeeData.isLateTerminationEntryForPayroll : false,
        employmentStatus: employeeData.employmentStatus || 'Draft',
        terminationDate: employeeData.terminationDate ? new Date(employeeData.terminationDate).toISOString().split('T')[0] : '',
        terminationReason: employeeData.terminationReason || '',
        profileImage: employeeData.profileImage || '',
        jobDescription: employeeData.jobDescription || '',
        academicBackground: (employeeData.academicBackground || []).map(bg => ({
          ...bg,
          graduationYear: bg.graduationYear || ''
        })),
        professionalEducation: (employeeData.professionalEducation || []).map(edu => ({
          ...edu,
          completionDate: edu.completionDate ? new Date(edu.completionDate).toISOString().split('T')[0] : '',
          expiryDate: edu.expiryDate ? new Date(edu.expiryDate).toISOString().split('T')[0] : ''
        })),
        employmentHistory: (employeeData.employmentHistory || []).map(emp => ({
          ...emp,
          startDate: emp.startDate ? new Date(emp.startDate).toISOString().split('T')[0] : '',
          endDate: emp.endDate ? new Date(emp.endDate).toISOString().split('T')[0] : '',
          isCurrentJob: emp.isCurrentJob || false
        })),
        partialSalaryPay: {
          isActive: employeeData.partialSalaryPay?.isActive || false,
          payableDaysPerMonth: employeeData.partialSalaryPay?.payableDaysPerMonth || '',
          periods: (employeeData.partialSalaryPay?.periods || []).map((p) => ({
            month: p.month,
            year: p.year
          }))
        },
        cashSalary: employeeData.cashSalary || false
      };
      
      formik.setValues(formData);
      
      // Set image preview if profileImage exists
      if (employeeData.profileImage) {
        setImagePreview(getImageUrl(employeeData.profileImage));
      } else {
        setImagePreview(null);
      }
      
      // Fetch dependent data if needed (in parallel for faster loading)
      const promises = [];
      if (formData.address.country) {
        promises.push(fetchProvinces(formData.address.country));
      }
      if (formData.address.state) {
        promises.push(fetchCities(formData.address.state));
      }
      // Load sections and designations in parallel
      promises.push(fetchSections());
      promises.push(fetchDesignations());
      
      await Promise.all(promises);
    } catch (error) {
      if (error.name === 'NetworkError' || error.code === 'ERR_NETWORK') {
        setSnackbar({
          open: true,
          message: 'Network Error: Cannot connect to server. Please check if the server is running.',
          severity: 'error'
        });
      } else if (error.response?.status === 401) {
        setSnackbar({
          open: true,
          message: 'Authentication error. Please log in again.',
          severity: 'error'
        });
        setTimeout(() => {
          localStorage.removeItem('token');
          window.location.href = '/login';
        }, 2000);
      } else if (error.response?.status === 404) {
        setSnackbar({
          open: true,
          message: 'Employee not found',
          severity: 'error'
        });
      } else {
        setSnackbar({
          open: true,
          message: `Error fetching employee details: ${error.response?.data?.message || error.message}`,
          severity: 'error'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Load initial data - only run once on mount
  useEffect(() => {
    fetchDepartments();
    fetchBanks();
    fetchCompanies();
    fetchSectors();
    fetchProjects();
    fetchSections();
    fetchDesignations();
    fetchLocations();
    fetchQualifications();
    fetchCountries();
    fetchProvinces();
    fetchCities();
    fetchNextEmployeeId();
    fetchEmployees(); // for Reporting Line dropdown
  }, []); // Empty dependency array - only run once

  // Fetch employee data when ID changes
  useEffect(() => {
    if (id && id !== 'add') {
      fetchEmployee();
    }
  }, [id]);

  // Update formik values when nextEmployeeId is fetched
  useEffect(() => {
    if (nextEmployeeId && (!id || id === 'add')) {
      formik.setFieldValue('employeeId', nextEmployeeId);
    }
  }, [nextEmployeeId, id]);

  // Cleanup blob URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const formik = useFormik({
    initialValues: {
    joiningReport: {
      documentNumber: 'UD/HR/FRM-005',
      revisionNumber: '00',
      issueDate: new Date().toISOString().split('T')[0],
      employeeName: '',
      employmentPosition: '',
      employeeTitle: 'Mr.',
      parentSpouseRelation: 'S/o',
      parentSpouseName: '',
      cnic: '',
      contactNumber: '',
      reportingLocation: '',
      reportingDateTime: '',
      employeeSignature: '',
      employeeSignatureDate: '',
      verificationDepartment: '',
      hodName: '',
      joiningRemarks: '',
      hrSignature: '',
      hrSignatureDate: ''
    },
      jobDescription: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      dateOfBirth: '',
      gender: '',
      idCard: '',
      nationality: '',
      profileImage: '',
      religion: 'Islam',
      maritalStatus: 'Single',
      employeeId: (id && id !== 'add') ? '' : nextEmployeeId, // Empty for editing, nextEmployeeId for new
      qualification: '',
      bankName: '',
      bankAccountNumber: '',
      foreignBankAccount: '',
      spouseName: '',
      appointmentDate: '',
      probationPeriodMonths: 3,
      hireDate: '',
      isLateEntryForPayroll: false,
      isLateTerminationEntryForPayroll: false,
      salary: {
        gross: ''
      },
      partialSalaryPay: {
        isActive: false,
        payableDaysPerMonth: '',
        periods: []
      },
      // Placement fields
      placementSector: '',
      placementProject: '',
      placementDepartment: '',
      placementSection: '',
      placementDesignation: '',
      placementLocation: '',
      oldDesignation: undefined,
      employeeCategory: '',
      reportingLine: '',
      isActive: true,
      cashSalary: false,
      employmentStatus: 'Draft', // Default to Draft for new employees
      terminationDate: '',
      terminationReason: '',
      address: {
        street: '',
        city: '',
        state: '',
        country: ''
      },
      emergencyContact: {
        name: '',
        relationship: '',
        phone: ''
      },
      eobi: {
        isActive: false,
        amount: 0
      },
      manualTax: {
        isActive: false,
        fixedAmount: 0
      },
      providentFund: {
        isActive: false,
        amount: 0
      },
      employeeSecurity: {
        isActive: false,
        amount: 0
      },
      academicBackground: [],
      professionalEducation: [],
      employmentHistory: []
    },
    validationSchema,
    onSubmit: async (values, { setSubmitting }) => {
      try {
        setLoading(true);
        setSubmitting(true);
        
        // Clean up values before submission
        const cleanedValues = { ...values };
        
        // Handle empty oldDesignation
        if (cleanedValues.oldDesignation === '' || cleanedValues.oldDesignation === undefined) {
          delete cleanedValues.oldDesignation;
        }
        
        // Clean up empty placement fields (convert empty strings to undefined)
        const placementFields = [
          'placementCompany', 'placementSector', 'placementProject', 
          'placementDepartment', 'placementSection', 'placementDesignation', 'placementLocation'
        ];
        
        placementFields.forEach(field => {
          if (cleanedValues[field] === '' || cleanedValues[field] === null || cleanedValues[field] === undefined) {
            delete cleanedValues[field];
          }
        });
        
        // Clean up other ObjectId fields that might be empty strings
        const objectIdFields = [
          'user', 'city', 'state', 'country', 'department', 'position', 'manager'
        ];
        
        objectIdFields.forEach(field => {
          if (cleanedValues[field] === '' || cleanedValues[field] === null || cleanedValues[field] === undefined) {
            delete cleanedValues[field];
          }
        });
        
        // Handle address ObjectId fields
        if (cleanedValues.address) {
          if (cleanedValues.address.city === '' || cleanedValues.address.city === null || cleanedValues.address.city === undefined) {
            delete cleanedValues.address.city;
          }
          if (cleanedValues.address.state === '' || cleanedValues.address.state === null || cleanedValues.address.state === undefined) {
            delete cleanedValues.address.state;
          }
          if (cleanedValues.address.country === '' || cleanedValues.address.country === null || cleanedValues.address.country === undefined) {
            delete cleanedValues.address.country;
          }
        }
        
        // Ensure salary.gross is a number
        if (cleanedValues.salary?.gross !== undefined && cleanedValues.salary?.gross !== null && cleanedValues.salary?.gross !== '') {
          cleanedValues.salary.gross = parseFloat(cleanedValues.salary.gross);
        } else {
          delete cleanedValues.salary;
        }

        if (cleanedValues.partialSalaryPay) {
          const psp = cleanedValues.partialSalaryPay;
          psp.isActive = Boolean(psp.isActive);
          psp.payableDaysPerMonth = parseInt(psp.payableDaysPerMonth, 10) || 0;
          psp.periods = (psp.periods || [])
            .map((p) => ({
              month: parseInt(p.month, 10),
              year: parseInt(p.year, 10)
            }))
            .filter((p) => p.month >= 1 && p.month <= 12 && p.year >= 2020);
          if (!psp.isActive) {
            psp.payableDaysPerMonth = 0;
            psp.periods = [];
          }
        }
        
        // Process academicBackground array - filter out empty objects and convert dates
        if (cleanedValues.academicBackground && Array.isArray(cleanedValues.academicBackground)) {
          cleanedValues.academicBackground = cleanedValues.academicBackground
            .filter(record => {
              // Keep record if it has at least one non-empty field
              return record.degree || record.institution || record.fieldOfStudy || 
                     record.graduationYear || record.gpa || record.percentage || 
                     record.grade || record.certificate;
            })
            .map(record => {
              // Clean up the record - convert empty strings to undefined
              const cleanedRecord = { ...record };
              
              // Handle graduationYear - convert empty string to undefined
              if (cleanedRecord.graduationYear === '' || cleanedRecord.graduationYear === null) {
                cleanedRecord.graduationYear = undefined;
              } else if (cleanedRecord.graduationYear) {
                const year = parseInt(cleanedRecord.graduationYear);
                cleanedRecord.graduationYear = isNaN(year) ? undefined : year;
              }
              
              // Handle gpa - convert empty string to undefined
              if (cleanedRecord.gpa === '' || cleanedRecord.gpa === null) {
                cleanedRecord.gpa = undefined;
              } else if (cleanedRecord.gpa) {
                const gpa = parseFloat(cleanedRecord.gpa);
                cleanedRecord.gpa = isNaN(gpa) ? undefined : gpa;
              }
              
              // Handle percentage - convert empty string to undefined
              if (cleanedRecord.percentage === '' || cleanedRecord.percentage === null) {
                cleanedRecord.percentage = undefined;
              } else if (cleanedRecord.percentage) {
                const percentage = parseFloat(cleanedRecord.percentage);
                cleanedRecord.percentage = isNaN(percentage) ? undefined : percentage;
              }
              
              return cleanedRecord;
            });
          // Always send array (even if empty) so backend can update it
          if (!cleanedValues.academicBackground || cleanedValues.academicBackground.length === 0) {
            cleanedValues.academicBackground = [];
          }
        } else if (cleanedValues.academicBackground === undefined) {
          // Initialize if not present
          cleanedValues.academicBackground = [];
        }
        
        // Process professionalEducation array - filter out empty objects and convert dates
        if (cleanedValues.professionalEducation && Array.isArray(cleanedValues.professionalEducation)) {
          cleanedValues.professionalEducation = cleanedValues.professionalEducation
            .filter(record => {
              // Keep record if it has at least one non-empty field
              return record.courseName || record.institution || record.certificationBody || 
                     record.completionDate || record.expiryDate || record.certificateNumber || 
                     record.certificate;
            })
            .map(record => ({
              ...record,
              completionDate: record.completionDate ? record.completionDate : undefined,
              expiryDate: record.expiryDate ? record.expiryDate : undefined,
              isActive: record.isActive !== undefined ? record.isActive : true
            }));
          // Always send array (even if empty) so backend can update it
          if (!cleanedValues.professionalEducation || cleanedValues.professionalEducation.length === 0) {
            cleanedValues.professionalEducation = [];
          }
        } else if (cleanedValues.professionalEducation === undefined) {
          // Initialize if not present
          cleanedValues.professionalEducation = [];
        }
        
        // Process employmentHistory array - filter out empty objects and convert dates
        if (cleanedValues.employmentHistory && Array.isArray(cleanedValues.employmentHistory)) {
          cleanedValues.employmentHistory = cleanedValues.employmentHistory
            .filter(record => {
              // Keep record if it has at least one non-empty field
              return record.companyName || record.position || record.startDate || 
                     record.endDate || record.location || record.responsibilities || 
                     record.reasonForLeaving || record.salary || record.supervisorName || 
                     record.supervisorContact;
            })
            .map(record => ({
              ...record,
              startDate: record.startDate ? record.startDate : undefined,
              endDate: record.endDate && !record.isCurrentJob ? record.endDate : undefined,
              isCurrentJob: record.isCurrentJob !== undefined ? record.isCurrentJob : false,
              salary: record.salary ? parseFloat(record.salary) : undefined
            }));
          // Always send array (even if empty) so backend can update it
          if (!cleanedValues.employmentHistory || cleanedValues.employmentHistory.length === 0) {
            cleanedValues.employmentHistory = [];
          }
        } else if (cleanedValues.employmentHistory === undefined) {
          // Initialize if not present
          cleanedValues.employmentHistory = [];
        }
        
        // Ensure profileImage is preserved (don't delete it even if empty string)
        // Only delete if it's null or undefined, keep empty string as it might be intentionally cleared
        if (cleanedValues.profileImage === null || cleanedValues.profileImage === undefined) {
          delete cleanedValues.profileImage;
        }
        
        // Ensure arrays are always present (even if empty) so backend can properly save them
        if (!cleanedValues.academicBackground || !Array.isArray(cleanedValues.academicBackground)) {
          cleanedValues.academicBackground = [];
        }
        if (!cleanedValues.professionalEducation || !Array.isArray(cleanedValues.professionalEducation)) {
          cleanedValues.professionalEducation = [];
        }
        if (!cleanedValues.employmentHistory || !Array.isArray(cleanedValues.employmentHistory)) {
          cleanedValues.employmentHistory = [];
        }

        if (cleanedValues.allowances) {
          cleanedValues.allowances = buildAllowancesPayload(cleanedValues.allowances);
        }
        
        let employeeId = id;
        
        if (id && id !== 'add') {
          // Update existing employee
          const response = await api.put(`/hr/employees/${id}`, cleanedValues);
          employeeId = response.data?.data?._id || id;
          setSnackbar({
            open: true,
            message: 'Employee updated successfully',
            severity: 'success'
          });
        } else {
          // Create new employee
          const response = await api.post('/hr/employees', cleanedValues);
          employeeId = response.data?.data?._id;
          setSnackbar({
            open: true,
            message: 'Employee created successfully',
            severity: 'success'
          });
        }
        
        // Navigate immediately without waiting for fetchEmployees
        navigate('/hr/employees', { state: { employeeId, page: savedPage } });
      } catch (error) {
        
        // Handle validation errors with specific field messages
        if (error.response?.data?.errors && Array.isArray(error.response.data.errors)) {
          const validationErrors = error.response.data.errors;
          
          // Set formik field errors for each validation error
          const formikErrors = {};
          const touchedFields = {};
          const errorMessages = [];
          
          validationErrors.forEach(err => {
            const fieldName = err.path || err.param || err.field;
            const errorMessage = err.msg || err.message || 'Invalid value';
            
            if (fieldName) {
              formikErrors[fieldName] = errorMessage;
              touchedFields[fieldName] = true;
              
              // Build user-friendly error message
              const fieldLabel = fieldName 
                .split('.')
                .map(part => part.charAt(0).toUpperCase() + part.slice(1).replace(/([A-Z])/g, ' $1'))
                .join(' ')
                .trim();
              errorMessages.push(`${fieldLabel}: ${errorMessage}`);
            }
          });
          
          // Set formik errors and mark fields as touched to show errors
          if (Object.keys(formikErrors).length > 0) {
            formik.setErrors(formikErrors);
            formik.setTouched(touchedFields);
            
            // Scroll to first error field
            const firstErrorField = Object.keys(formikErrors)[0];
            const fieldElement = document.querySelector(`[name="${firstErrorField}"]`);
            if (fieldElement) {
              fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              fieldElement.focus();
            }
          }
          
          // Show comprehensive error message
          const errorMessage = errorMessages.length > 0 
            ? `Please fix the following errors:\n${errorMessages.join('\n')}`
            : error.response?.data?.message || 'Validation failed. Please check the form fields.';
          
          setSnackbar({
            open: true,
            message: errorMessage,
            severity: 'error'
          });
        } else {
          // Handle other types of errors (duplicate email, etc.)
          const errorMessage = error.response?.data?.message || error.message || 'Error saving employee';
          setSnackbar({
            open: true,
            message: errorMessage,
            severity: 'error'
          });
        }
      } finally {
        setLoading(false);
        setSubmitting(false);
      }
    },
    enableReinitialize: true
  });

  const handleNext = () => {
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const handleStepClick = (step) => {
    setActiveStep(step);
  };

  const handlePrintStep = useCallback(() => {
    const employeeLabel = `${formik.values.firstName || ''} ${formik.values.lastName || ''}`.trim()
      || formik.values.joiningReport?.employeeName
      || '';

    const result = printEmployeeFormStep(activeStep, formik.values, {
      employeeLabel,
      lookups: {
        companies,
        sectors,
        projects,
        departments,
        sections,
        designations,
        locations,
        banks,
        countries,
        provinces,
        cities
      }
    });

    if (result?.ok === false) {
      setSnackbar({
        open: true,
        message: result.message || 'Unable to print this section.',
        severity: 'warning'
      });
    }
  }, [
    activeStep,
    formik.values,
    companies,
    sectors,
    projects,
    departments,
    sections,
    designations,
    locations,
    banks,
    countries,
    provinces,
    cities
  ]);

  // Handler functions for new placement items
  const handleNewCompanyChange = (field, value) => {
    setNewCompanyData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNewSectorChange = (field, value) => {
    setNewSectorData(prev => ({
      ...prev,
      [field]: value
    }));
  };



  const handleNewProjectChange = (field, value) => {
    setNewProjectData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNewDepartmentChange = (field, value) => {
    setNewDepartmentData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNewSectionChange = (field, value) => {
    setNewSectionData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNewDesignationChange = (field, value) => {
    setNewDesignationData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNewLocationChange = (field, value) => {
    setNewLocationData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNewQualificationChange = (field, value) => {
    setNewQualificationData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Save functions for new placement items
  const handleSaveNewCompany = async () => {
    try {
      if (!newCompanyData.name) {
        setSnackbar({
          open: true,
          message: 'Please fill in all required fields',
          severity: 'error'
        });
        return;
      }

      const response = await api.post('/hr/companies', newCompanyData);
      
      setSnackbar({
        open: true,
        message: 'Company added successfully',
        severity: 'success'
      });

      setShowAddCompanyDialog(false);
      setNewCompanyData({ name: '', type: 'Private Limited', description: '' });
      
      // Refresh companies
      await fetchCompanies();
      
      // Set the newly created company as selected
      formik.setFieldValue('placementCompany', response.data.data._id);
      
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error adding company',
        severity: 'error'
      });
    }
  };

  const handleSaveNewSector = async () => {
    try {
      if (!newSectorData.name) {
        setSnackbar({
          open: true,
          message: 'Please fill in all required fields',
          severity: 'error'
        });
        return;
      }

      const response = await api.post('/hr/sectors', newSectorData);
      
      setSnackbar({
        open: true,
        message: 'Sector added successfully',
        severity: 'success'
      });

      setShowAddSectorDialog(false);
      setNewSectorData({ name: '', industry: 'Technology' });
      
      // Refresh sectors
      await fetchSectors();
      
      // Set the newly created sector as selected
      formik.setFieldValue('placementSector', response.data.data._id);
      
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error adding sector',
        severity: 'error'
      });
    }
  };



  const handleSaveNewProject = async () => {
    try {
      if (!newProjectData.name) {
        setSnackbar({
          open: true,
          message: 'Project name is required',
          severity: 'error'
        });
        return;
      }

      const projectData = {
        name: newProjectData.name,
        ...(newProjectData.description && { description: newProjectData.description }),
        sector: formik.values.placementSector
      };

      const response = await api.post('/hr/projects', projectData);
      
      setSnackbar({
        open: true,
        message: 'Project added successfully',
        severity: 'success'
      });

      setShowAddProjectDialog(false);
      setNewProjectData({ name: '', description: '' });
      
      // Refresh projects
      await fetchProjects();
      
      // Set the newly created project as selected
      formik.setFieldValue('placementProject', response.data.data._id);
      
    } catch (error) {
      const errorMessage = error.response?.data?.message || 
                          (error.response?.data?.errors?.[0]?.msg) ||
                          'Error adding project';
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error'
      });
    }
  };

  const handleSaveNewDepartment = async () => {
    try {
      if (!newDepartmentData.name) {
        setSnackbar({
          open: true,
          message: 'Please fill in all required fields',
          severity: 'error'
        });
        return;
      }

      const response = await api.post('/hr/departments', {
        name: newDepartmentData.name.trim(),
        description: newDepartmentData.description?.trim() || undefined
      });
      
      setSnackbar({
        open: true,
        message: 'Department added successfully',
        severity: 'success'
      });

      setShowAddDepartmentDialog(false);
      setNewDepartmentData({ name: '', description: '' });
      
      // Refresh departments
      await fetchDepartments();
      
      // Set the newly created department as selected
      formik.setFieldValue('placementDepartment', response.data.data._id);
      
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error adding department',
        severity: 'error'
      });
    }
  };

  const handleSaveNewSection = async () => {
    try {
      if (!newSectionData.name) {
        setSnackbar({
          open: true,
          message: 'Please fill in all required fields',
          severity: 'error'
        });
        return;
      }

      if (!formik.values.placementDepartment) {
        setSnackbar({
          open: true,
          message: 'Please select a department first',
          severity: 'error'
        });
        return;
      }

      const sectionData = {
        ...newSectionData,
        department: formik.values.placementDepartment
      };

      const response = await api.post('/hr/sections', sectionData);
      
      setSnackbar({
        open: true,
        message: 'Section added successfully',
        severity: 'success'
      });

      setShowAddSectionDialog(false);
      setNewSectionData({ name: '' });
      
      // Refresh sections
      await fetchSectionsByDepartment(formik.values.placementDepartment);
      
      // Set the newly created section as selected
      formik.setFieldValue('placementSection', response.data.data._id);
      
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error adding section',
        severity: 'error'
      });
    }
  };

  const handleSaveNewDesignation = async () => {
    try {
      if (!newDesignationData.title) {
        setSnackbar({
          open: true,
          message: 'Please fill in all required fields',
          severity: 'error'
        });
        return;
      }

      const designationData = {
        ...newDesignationData,
        section: formik.values.placementSection
      };

      const response = await api.post('/hr/designations', designationData);
      
      setSnackbar({
        open: true,
        message: 'Designation added successfully',
        severity: 'success'
      });

      setShowAddDesignationDialog(false);
      setNewDesignationData({ title: '', level: 'Entry', description: '' });
      
      // Refresh all designations (not filtered by section)
      await fetchDesignations();
      
      // Set the newly created designation as selected
      const newDesignation = response.data.data;
      formik.setFieldValue('placementDesignation', newDesignation._id);
      
      // Auto-set category based on new designation
      const title = (newDesignation.title || '').toLowerCase();
      const level = (newDesignation.level || '').toLowerCase();
      let category = 'white_collar'; // default
      
      // Blue collar keywords
      const blueKeywords = ['worker', 'technician', 'operator', 'labour', 'labor', 'helper', 'driver', 'mechanic', 'foreman', 'attendant'];
      if (blueKeywords.some(keyword => title.includes(keyword)) || level === 'entry') {
        category = 'blue_collar';
      }
      
      formik.setFieldValue('employeeCategory', category);
      
    } catch (error) {
      setSnackbar({
        open: true,
        message: error.response?.data?.message || 'Error adding designation',
        severity: 'error'
      });
    }
  };

  const handleSaveNewLocation = async () => {
    try {
      if (!newLocationData.name) {
        setSnackbar({
          open: true,
          message: 'Please fill in all required fields',
          severity: 'error'
        });
        return;
      }

      // Don't send code or description fields
      const locationPayload = {
        name: newLocationData.name,
        type: newLocationData.type
      };

      const response = await api.post('/hr/locations', locationPayload);
      
      setSnackbar({
        open: true,
        message: 'Location added successfully',
        severity: 'success'
      });

      setShowAddLocationDialog(false);
      setNewLocationData({ name: '', type: 'Office' });
      
      // Refresh locations
      await fetchLocations();
      
      // Set the newly created location as selected
      formik.setFieldValue('placementLocation', response.data.data._id);
      
    } catch (error) {
      const errorMessage = error.response?.data?.message || 
                          (error.response?.data?.errors?.[0]?.msg) ||
                          'Error adding location';
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error'
      });
    }
  };

  const handleSaveNewQualification = async () => {
    try {
      if (!newQualificationData.name) {
        setSnackbar({
          open: true,
          message: 'Qualification name is required',
          severity: 'error'
        });
        return;
      }

      const qualificationPayload = {
        name: newQualificationData.name,
        ...(newQualificationData.description && { description: newQualificationData.description })
      };

      const response = await api.post('/hr/qualifications', qualificationPayload);
      
      setSnackbar({
        open: true,
        message: 'Qualification added successfully',
        severity: 'success'
      });

      setShowAddQualificationDialog(false);
      setNewQualificationData({ name: '', description: '' });
      
      // Refresh qualifications
      await fetchQualifications();
      
      // Set the newly created qualification as selected
      formik.setFieldValue('qualification', response.data.data.name);
      
    } catch (error) {
      const errorMessage = error.response?.data?.message || 
                          (error.response?.data?.errors?.[0]?.msg) ||
                          'Error adding qualification';
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error'
      });
    }
  };

  // Calculate end of probation date
  const calculateEndOfProbation = (appointmentDate, probationMonths) => {
    if (!appointmentDate || !probationMonths) return '';
    
    const endDate = new Date(appointmentDate);
    endDate.setMonth(endDate.getMonth() + parseInt(probationMonths));
    return endDate.toISOString().split('T')[0];
  };

  // Handle appointment date or probation period change
  const handleProbationChange = (field, value) => {
    formik.setFieldValue(field, value);
    
    if (field === 'appointmentDate' || field === 'probationPeriodMonths') {
      const appointmentDate = field === 'appointmentDate' ? value : formik.values.appointmentDate;
      const probationMonths = field === 'probationPeriodMonths' ? value : formik.values.probationPeriodMonths;
      
      const endDate = calculateEndOfProbation(appointmentDate, probationMonths);
      formik.setFieldValue('endOfProbationDate', endDate);
    }
  };

  // Handle address dropdown changes
  const handleCountryChange = (countryId) => {
    formik.setFieldValue('address.country', countryId);
    formik.setFieldValue('address.state', '');
    formik.setFieldValue('address.city', '');
    if (countryId) {
      fetchProvinces(countryId);
    }
  };

  const handleProvinceChange = (provinceId) => {
    formik.setFieldValue('address.state', provinceId);
    formik.setFieldValue('address.city', '');
    if (provinceId) {
      fetchCities(provinceId);
    }
  };

  // Handle marital status change
  const handleMaritalStatusChange = (status) => {
    formik.setFieldValue('maritalStatus', status);
    if (status !== 'Married') {
      formik.setFieldValue('spouseName', '');
    }
  };

  // Helper function to safely render text
  const safeRenderText = (value) => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (value && typeof value === 'object' && value.name) return value.name;
    if (value && typeof value === 'object' && value.title) return value.title;
    return 'Unknown';
  };

  // Helper function to safely get form value
  const safeFormValue = (value) => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (value && typeof value === 'object' && value._id !== undefined && value._id !== null) {
      return value._id.toString();
    }
    return '';
  };

  const renderStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ p: 3, backgroundColor: '#f8f9fa' }}>
                <Box sx={{ textAlign: 'center', mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                    <Box
                      component="img"
                      src={process.env.PUBLIC_URL + '/images/sgc_logo.png'}
                      alt="Sardar Group of Companies"
                      sx={{ maxHeight: 120, objectFit: 'contain' }}
                    />
                  </Box>
                  <Typography variant="h6" gutterBottom sx={{ color: 'primary.main', fontWeight: 600 }}>
                    JOINING REPORT
                  </Typography>
                  <Grid container spacing={2} sx={{ mt: 1, justifyContent: 'center' }}>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        size="small"
                        name="joiningReport.documentNumber"
                        label="Document No"
                        value={formik.values.joiningReport?.documentNumber || 'UD/HR/FRM-005'}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        name="joiningReport.revisionNumber"
                        label="Rev.#"
                        value={formik.values.joiningReport?.revisionNumber || '00'}
                        onChange={formik.handleChange}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        size="small"
                        name="joiningReport.issueDate"
                        label="Issue Date"
                        type="date"
                        value={formik.values.joiningReport?.issueDate || new Date().toISOString().split('T')[0]}
                        onChange={formik.handleChange}
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>
                  </Grid>
                  {formik.values.joiningReport?.documentNumber && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Document No: {formik.values.joiningReport.documentNumber} | Rev.#: {formik.values.joiningReport.revisionNumber || '00'} | Issue Date: {formik.values.joiningReport.issueDate ? new Date(formik.values.joiningReport.issueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set'}
                    </Typography>
                  )}
                </Box>
                
                <Divider sx={{ my: 3 }} />
                
                {/* Employee Section */}
                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>
                      Employee Section
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      Dear Sir,
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      With reference to your offer, For the employment as
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.employmentPosition"
                      label="Employment Position"
                      value={formik.values.joiningReport?.employmentPosition || ''}
                      onChange={formik.handleChange}
                      placeholder="e.g., Software Engineer"
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      With Sardar Group of Companies
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      I
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth>
                      <InputLabel>Title</InputLabel>
                      <Select
                        name="joiningReport.employeeTitle"
                        value={formik.values.joiningReport?.employeeTitle || 'Mr.'}
                        onChange={formik.handleChange}
                        label="Title"
                      >
                        <MenuItem value="Mr.">Mr.</MenuItem>
                        <MenuItem value="Mrs.">Mrs.</MenuItem>
                        <MenuItem value="Ms.">Ms.</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  
                  <Grid item xs={12} md={9}>
                    <TextField
                      fullWidth
                      name="joiningReport.employeeName"
                      label="Employee Name"
                      value={formik.values.joiningReport?.employeeName || ''}
                      onChange={formik.handleChange}
                      placeholder="Enter employee full name"
                      required
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={3}>
                    <FormControl fullWidth>
                      <InputLabel>Relation</InputLabel>
                      <Select
                        name="joiningReport.parentSpouseRelation"
                        value={formik.values.joiningReport?.parentSpouseRelation || 'S/o'}
                        onChange={formik.handleChange}
                        label="Relation"
                      >
                        <MenuItem value="S/o">S/o (Son of)</MenuItem>
                        <MenuItem value="D/o">D/o (Daughter of)</MenuItem>
                        <MenuItem value="W/o">W/o (Wife of)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.parentSpouseName"
                      label="Parent/Spouse Name"
                      value={formik.values.joiningReport?.parentSpouseName || ''}
                      onChange={formik.handleChange}
                      placeholder="Enter parent or spouse name"
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.cnic"
                      label="CNIC #"
                      value={formik.values.joiningReport?.cnic || ''}
                      onChange={formik.handleChange}
                      placeholder="12345-1234567-1"
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.contactNumber"
                      label="Contact No"
                      value={formik.values.joiningReport?.contactNumber || ''}
                      onChange={formik.handleChange}
                      placeholder="+92-300-1234567"
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Typography variant="body2" sx={{ mb: 2, mt: 2 }}>
                      Reported for duty, at
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.reportingLocation"
                      label="Reporting Location"
                      value={formik.values.joiningReport?.reportingLocation || ''}
                      onChange={formik.handleChange}
                      placeholder="e.g., Head Office, Lahore"
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.reportingDateTime"
                      label="On (Time & Date)"
                      type="datetime-local"
                      value={formik.values.joiningReport?.reportingDateTime || ''}
                      onChange={formik.handleChange}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.employeeSignature"
                      label="Employee Signature"
                      value={formik.values.joiningReport?.employeeSignature || ''}
                      onChange={formik.handleChange}
                      placeholder="Employee signature"
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.employeeSignatureDate"
                      label="Date (Employee)"
                      type="date"
                      value={formik.values.joiningReport?.employeeSignatureDate || ''}
                      onChange={formik.handleChange}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="h6" gutterBottom>
                      Verification (Concerned Department)
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.verificationDepartment"
                      label="Department"
                      value={formik.values.joiningReport?.verificationDepartment || ''}
                      onChange={formik.handleChange}
                      placeholder="Department name"
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.hodName"
                      label="HOD Name"
                      value={formik.values.joiningReport?.hodName || ''}
                      onChange={formik.handleChange}
                      placeholder="Head of Department name"
                    />
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="h6" gutterBottom>
                      For Official Use Only (Human Resources Department)
                      <Chip label="Optional" size="small" sx={{ ml: 1 }} color="info" variant="outlined" />
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      name="joiningReport.joiningRemarks"
                      label="Joining Remarks"
                      value={formik.values.joiningReport?.joiningRemarks || ''}
                      onChange={formik.handleChange}
                      multiline
                      rows={3}
                      placeholder="Enter any remarks or notes"
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.hrSignature"
                      label="HR Signature"
                      value={formik.values.joiningReport?.hrSignature || ''}
                      onChange={formik.handleChange}
                      placeholder="HR representative signature"
                    />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      name="joiningReport.hrSignatureDate"
                      label="Date (HR)"
                      type="date"
                      value={formik.values.joiningReport?.hrSignatureDate || ''}
                      onChange={formik.handleChange}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                </Grid>
              </Card>
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            {/* Status Indicator */}
            {id && id !== 'add' && (
              <Grid item xs={12}>
                <Box sx={{ 
                  p: 2, 
                  bgcolor: 'grey.50', 
                  borderRadius: 2, 
                  border: '1px solid', 
                  borderColor: 'grey.200',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2
                }}>
                  <Typography variant="subtitle2" color="primary.main" sx={{ fontWeight: 600 }}>
                    📋 Current Status:
                  </Typography>
                  <Chip 
                    label={formik.values.employmentStatus || 'Draft'} 
                    color={
                      formik.values.employmentStatus === 'Active' || formik.values.employmentStatus === 'Reinstated' ? 'success' : 
                      formik.values.employmentStatus === 'Draft' ? 'warning' : 'error'
                    }
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                  
                </Box>
              </Grid>
            )}
            
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Basic Information
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
                <Avatar
                  src={imagePreview || getImageUrl(formik.values.profileImage) || undefined}
                  sx={{ width: 120, height: 120, border: '2px solid #e0e0e0' }}
                  imgProps={{
                    onError: (e) => {
                      e.target.style.display = 'none';
                    }
                  }}
                >
                  {formik.values.firstName?.charAt(0)}{formik.values.lastName?.charAt(0)}
                </Avatar>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<UploadIcon />}
                    size="small"
                  >
                    Upload Image
                    <input
                      type="file"
                      hidden
                      accept="image/*"
                      onChange={handleFileChange}
                    />
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<PhotoCameraIcon />}
                    onClick={handleCameraCapture}
                    size="small"
                  >
                    Camera
                  </Button>
                </Box>
                {formik.values.profileImage && (
                  <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5 }}>
                    Image uploaded successfully
                  </Typography>
                )}
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="firstName"
                label="First Name"
                value={formik.values.firstName}
                onChange={formik.handleChange}
                error={formik.touched.firstName && Boolean(formik.errors.firstName)}
                helperText={formik.touched.firstName && formik.errors.firstName}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="lastName"
                label="Last Name"
                value={formik.values.lastName}
                onChange={formik.handleChange}
                error={formik.touched.lastName && Boolean(formik.errors.lastName)}
                helperText={formik.touched.lastName && formik.errors.lastName}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="email"
                label="Email"
                type="email"
                value={formik.values.email}
                onChange={formik.handleChange}
                error={formik.touched.email && Boolean(formik.errors.email)}
                helperText={formik.touched.email && formik.errors.email}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="phone"
                label="Phone"
                value={formik.values.phone}
                onChange={formik.handleChange}
                error={formik.touched.phone && Boolean(formik.errors.phone)}
                helperText={formik.touched.phone && formik.errors.phone}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="dateOfBirth"
                label="Date of Birth"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={formik.values.dateOfBirth}
                onChange={formik.handleChange}
                error={formik.touched.dateOfBirth && Boolean(formik.errors.dateOfBirth)}
                helperText={formik.touched.dateOfBirth && formik.errors.dateOfBirth}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Gender</InputLabel>
                <Select
                  name="gender"
                  value={formik.values.gender}
                  onChange={formik.handleChange}
                  error={formik.touched.gender && Boolean(formik.errors.gender)}
                  label="Gender"
                >
                  <MenuItem value="male">Male</MenuItem>
                  <MenuItem value="female">Female</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="idCard"
                label="ID Card Number"
                value={formik.values.idCard}
                onChange={formik.handleChange}
                error={formik.touched.idCard && Boolean(formik.errors.idCard)}
                helperText={formik.touched.idCard && formik.errors.idCard}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="nationality"
                label="Nationality"
                value={formik.values.nationality}
                onChange={formik.handleChange}
                error={formik.touched.nationality && Boolean(formik.errors.nationality)}
                helperText={formik.touched.nationality && formik.errors.nationality}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Religion</InputLabel>
                <Select
                  name="religion"
                  value={formik.values.religion}
                  onChange={formik.handleChange}
                  error={formik.touched.religion && Boolean(formik.errors.religion)}
                  label="Religion"
                >
                  <MenuItem value="Islam">Islam</MenuItem>
                  <MenuItem value="Christianity">Christianity</MenuItem>
                  <MenuItem value="Hinduism">Hinduism</MenuItem>
                  <MenuItem value="Sikhism">Sikhism</MenuItem>
                  <MenuItem value="Buddhism">Buddhism</MenuItem>
                  <MenuItem value="Judaism">Judaism</MenuItem>
                  <MenuItem value="Other">Other</MenuItem>
                  <MenuItem value="None">None</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Marital Status</InputLabel>
                <Select
                  name="maritalStatus"
                  value={formik.values.maritalStatus}
                  onChange={(e) => handleMaritalStatusChange(e.target.value)}
                  error={formik.touched.maritalStatus && Boolean(formik.errors.maritalStatus)}
                  label="Marital Status"
                >
                  <MenuItem value="Single">Single</MenuItem>
                  <MenuItem value="Married">Married</MenuItem>
                  <MenuItem value="Divorced">Divorced</MenuItem>
                  <MenuItem value="Widowed">Widowed</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {formik.values.maritalStatus === 'Married' && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="spouseName"
                  label="Spouse Name"
                  value={formik.values.spouseName}
                  onChange={formik.handleChange}
                  error={formik.touched.spouseName && Boolean(formik.errors.spouseName)}
                  helperText={formik.touched.spouseName && formik.errors.spouseName}
                />
              </Grid>
            )}
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="employeeId"
                label="Employee ID"
                value={formik.values.employeeId || ''}
                onChange={id && id !== 'add' ? undefined : formik.handleChange}
                onBlur={id && id !== 'add' ? undefined : formik.handleBlur}
                InputProps={{ readOnly: !!(id && id !== 'add') }}
                error={formik.touched.employeeId && Boolean(formik.errors.employeeId)}
                helperText={
                  formik.touched.employeeId && formik.errors.employeeId
                    ? formik.errors.employeeId
                    : id && id !== 'add'
                      ? "Employee ID cannot be changed after creation"
                      : "Enter Employee ID or leave blank for auto-generation"
                }
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Qualification</InputLabel>
                <Select
                  name="qualification"
                  value={formik.values.qualification}
                  onChange={(e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddQualificationDialog(true);
                    } else {
                      formik.handleChange(e);
                    }
                  }}
                  error={formik.touched.qualification && Boolean(formik.errors.qualification)}
                  label="Qualification"
                >
                  {qualifications.map((qual) => (
                    <MenuItem key={qual._id} value={qual.name}>
                      {qual.name}
                    </MenuItem>
                  ))}
                  <MenuItem value="add_new">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AddIcon fontSize="small" />
                      Add New Qualification
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="hireDate"
                label="Hire Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={formik.values.hireDate}
                onChange={formik.handleChange}
                error={formik.touched.hireDate && Boolean(formik.errors.hireDate)}
                helperText={formik.touched.hireDate && formik.errors.hireDate}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formik.values.isLateEntryForPayroll}
                    onChange={(e) => formik.setFieldValue('isLateEntryForPayroll', e.target.checked)}
                    color="primary"
                  />
                }
                label="Late Entry (Include in current month's New Hirings payroll report)"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                name="jobDescription"
                label="Job Description (JD)"
                multiline
                rows={4}
                value={formik.values.jobDescription || ''}
                onChange={formik.handleChange}
                error={formik.touched.jobDescription && Boolean(formik.errors.jobDescription)}
                helperText={formik.touched.jobDescription && formik.errors.jobDescription}
                placeholder="Enter detailed job description, responsibilities, and requirements..."
              />
            </Grid>

            {/* Academic Background Section - Show when any qualification is selected */}
            {formik.values.qualification && (
              <>
                <Grid item xs={12}>
                  <Divider sx={{ my: 2 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" gutterBottom>
                      Academic Background (Optional)
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() => {
                        const currentBackground = formik.values.academicBackground || [];
                        formik.setFieldValue('academicBackground', [
                          ...currentBackground,
                          {
                            degree: '',
                            institution: '',
                            fieldOfStudy: '',
                            graduationYear: '',
                            gpa: '',
                            percentage: '',
                            grade: '',
                            certificate: ''
                          }
                        ]);
                      }}
                    >
                      Add Academic Record
                    </Button>
                  </Box>
                </Grid>

                {formik.values.academicBackground?.map((record, index) => (
                  <React.Fragment key={index}>
                    <Grid item xs={12}>
                      <Paper sx={{ p: 2, backgroundColor: '#f8f9fa' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                          <Typography variant="subtitle1" fontWeight="bold">
                            Academic Record #{index + 1}
                          </Typography>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              const updated = formik.values.academicBackground.filter((_, i) => i !== index);
                              formik.setFieldValue('academicBackground', updated);
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.degree`}
                              label="Degree"
                              value={record.degree || ''}
                              onChange={formik.handleChange}
                              placeholder="e.g., BSc, MSc, PhD"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.institution`}
                              label="Institution"
                              value={record.institution || ''}
                              onChange={formik.handleChange}
                              placeholder="University/College name"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.fieldOfStudy`}
                              label="Field of Study"
                              value={record.fieldOfStudy || ''}
                              onChange={formik.handleChange}
                              placeholder="e.g., Computer Science"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.graduationYear`}
                              label="Graduation Year"
                              type="number"
                              value={record.graduationYear || ''}
                              onChange={formik.handleChange}
                              inputProps={{ min: 1900, max: 2100 }}
                            />
                          </Grid>
                          <Grid item xs={12} md={4}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.gpa`}
                              label="GPA"
                              type="number"
                              value={record.gpa || ''}
                              onChange={formik.handleChange}
                              inputProps={{ min: 0, max: 4, step: 0.01 }}
                              placeholder="0.00 - 4.00"
                            />
                          </Grid>
                          <Grid item xs={12} md={4}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.percentage`}
                              label="Percentage"
                              type="number"
                              value={record.percentage || ''}
                              onChange={formik.handleChange}
                              inputProps={{ min: 0, max: 100 }}
                              placeholder="0 - 100"
                            />
                          </Grid>
                          <Grid item xs={12} md={4}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.grade`}
                              label="Grade"
                              value={record.grade || ''}
                              onChange={formik.handleChange}
                              placeholder="e.g., A, B+, First Division"
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              name={`academicBackground.${index}.certificate`}
                              label="Certificate (URL or path)"
                              value={record.certificate || ''}
                              onChange={formik.handleChange}
                              placeholder="Certificate file path or URL"
                            />
                          </Grid>
                        </Grid>
                      </Paper>
                    </Grid>
                  </React.Fragment>
                ))}
              </>
            )}

            {/* Professional Education Section - Show when any qualification is selected */}
            {formik.values.qualification && (
              <>
                <Grid item xs={12}>
                  <Divider sx={{ my: 2 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" gutterBottom>
                      Professional Education (Optional)
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() => {
                        const currentEducation = formik.values.professionalEducation || [];
                        formik.setFieldValue('professionalEducation', [
                          ...currentEducation,
                          {
                            courseName: '',
                            institution: '',
                            certificationBody: '',
                            completionDate: '',
                            expiryDate: '',
                            certificateNumber: '',
                            certificate: '',
                            isActive: true
                          }
                        ]);
                      }}
                    >
                      Add Professional Course
                    </Button>
                  </Box>
                </Grid>

                {formik.values.professionalEducation?.map((course, index) => (
                  <React.Fragment key={index}>
                    <Grid item xs={12}>
                      <Paper sx={{ p: 2, backgroundColor: '#f8f9fa' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                          <Typography variant="subtitle1" fontWeight="bold">
                            Professional Course #{index + 1}
                          </Typography>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              const updated = formik.values.professionalEducation.filter((_, i) => i !== index);
                              formik.setFieldValue('professionalEducation', updated);
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`professionalEducation.${index}.courseName`}
                              label="Course Name"
                              value={course.courseName || ''}
                              onChange={formik.handleChange}
                              placeholder="e.g., PMP Certification, AWS Cloud"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`professionalEducation.${index}.institution`}
                              label="Institution"
                              value={course.institution || ''}
                              onChange={formik.handleChange}
                              placeholder="Training institute or organization"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`professionalEducation.${index}.certificationBody`}
                              label="Certification Body"
                              value={course.certificationBody || ''}
                              onChange={formik.handleChange}
                              placeholder="e.g., PMI, AWS, Microsoft"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`professionalEducation.${index}.certificateNumber`}
                              label="Certificate Number"
                              value={course.certificateNumber || ''}
                              onChange={formik.handleChange}
                              placeholder="Certificate ID or number"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`professionalEducation.${index}.completionDate`}
                              label="Completion Date"
                              type="date"
                              value={course.completionDate || ''}
                              onChange={formik.handleChange}
                              InputLabelProps={{ shrink: true }}
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`professionalEducation.${index}.expiryDate`}
                              label="Expiry Date (if applicable)"
                              type="date"
                              value={course.expiryDate || ''}
                              onChange={formik.handleChange}
                              InputLabelProps={{ shrink: true }}
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={course.isActive !== false}
                                  onChange={(e) => {
                                    formik.setFieldValue(`professionalEducation.${index}.isActive`, e.target.checked);
                                  }}
                                />
                              }
                              label="Active"
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              name={`professionalEducation.${index}.certificate`}
                              label="Certificate (URL or path)"
                              value={course.certificate || ''}
                              onChange={formik.handleChange}
                              placeholder="Certificate file path or URL"
                            />
                          </Grid>
                        </Grid>
                      </Paper>
                    </Grid>
                  </React.Fragment>
                ))}
              </>
            )}

            {/* Employment History Section */}
            {formik.values.qualification && (
              <>
                <Grid item xs={12}>
                  <Divider sx={{ my: 3 }} />
                  <Typography variant="h6" gutterBottom>
                    Employment History
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Add previous employment records (optional)
                  </Typography>
                </Grid>

                <Grid item xs={12}>
                  <Box sx={{ mb: 2 }}>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={() => {
                        const currentHistory = formik.values.employmentHistory || [];
                        formik.setFieldValue('employmentHistory', [
                          ...currentHistory,
                          {
                            companyName: '',
                            position: '',
                            startDate: '',
                            endDate: '',
                            isCurrentJob: false,
                            location: '',
                            responsibilities: '',
                            reasonForLeaving: '',
                            salary: '',
                            supervisorName: '',
                            supervisorContact: ''
                          }
                        ]);
                      }}
                    >
                      Add Employment Record
                    </Button>
                  </Box>
                </Grid>

                {formik.values.employmentHistory?.map((record, index) => (
                  <React.Fragment key={index}>
                    <Grid item xs={12}>
                      <Paper sx={{ p: 2, backgroundColor: '#f8f9fa' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                          <Typography variant="subtitle1" fontWeight="bold">
                            Employment Record #{index + 1}
                          </Typography>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              const updated = formik.values.employmentHistory.filter((_, i) => i !== index);
                              formik.setFieldValue('employmentHistory', updated);
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                        <Grid container spacing={2}>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.companyName`}
                              label="Company Name"
                              value={record.companyName || ''}
                              onChange={formik.handleChange}
                              placeholder="Previous employer company name"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.position`}
                              label="Position / Job Title"
                              value={record.position || ''}
                              onChange={formik.handleChange}
                              placeholder="Your position at this company"
                            />
                          </Grid>
                          <Grid item xs={12} md={4}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.startDate`}
                              label="Start Date"
                              type="date"
                              value={record.startDate || ''}
                              onChange={formik.handleChange}
                              InputLabelProps={{ shrink: true }}
                            />
                          </Grid>
                          <Grid item xs={12} md={4}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.endDate`}
                              label="End Date"
                              type="date"
                              value={record.endDate || ''}
                              onChange={formik.handleChange}
                              InputLabelProps={{ shrink: true }}
                              disabled={record.isCurrentJob}
                            />
                          </Grid>
                          <Grid item xs={12} md={4}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={record.isCurrentJob || false}
                                  onChange={(e) => {
                                    formik.setFieldValue(`employmentHistory.${index}.isCurrentJob`, e.target.checked);
                                    if (e.target.checked) {
                                      formik.setFieldValue(`employmentHistory.${index}.endDate`, '');
                                    }
                                  }}
                                />
                              }
                              label="Current Job"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.location`}
                              label="Location"
                              value={record.location || ''}
                              onChange={formik.handleChange}
                              placeholder="City, Country"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.salary`}
                              label="Salary (Optional)"
                              type="number"
                              value={record.salary || ''}
                              onChange={formik.handleChange}
                              placeholder="Monthly salary"
                              InputProps={{
                                startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                              }}
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.supervisorName`}
                              label="Supervisor Name (Optional)"
                              value={record.supervisorName || ''}
                              onChange={formik.handleChange}
                              placeholder="Direct supervisor or manager"
                            />
                          </Grid>
                          <Grid item xs={12} md={6}>
                            <TextField
                              fullWidth
                              name={`employmentHistory.${index}.supervisorContact`}
                              label="Supervisor Contact (Optional)"
                              value={record.supervisorContact || ''}
                              onChange={formik.handleChange}
                              placeholder="Phone or email"
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              multiline
                              rows={3}
                              name={`employmentHistory.${index}.responsibilities`}
                              label="Responsibilities & Achievements"
                              value={record.responsibilities || ''}
                              onChange={formik.handleChange}
                              placeholder="Describe your key responsibilities and achievements"
                            />
                          </Grid>
                          <Grid item xs={12}>
                            <TextField
                              fullWidth
                              multiline
                              rows={2}
                              name={`employmentHistory.${index}.reasonForLeaving`}
                              label="Reason for Leaving (Optional)"
                              value={record.reasonForLeaving || ''}
                              onChange={formik.handleChange}
                              placeholder="Reason for leaving this position"
                              disabled={record.isCurrentJob}
                            />
                          </Grid>
                        </Grid>
                      </Paper>
                    </Grid>
                  </React.Fragment>
                ))}
              </>
            )}
            {/* Current Placement Summary */}
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ p: 2, backgroundColor: '#e3f2fd' }}>
                <Typography variant="h6" gutterBottom>
                  Current Placement Summary
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color="text.secondary">
                                      <strong>Company:</strong> {safeRenderText(companies.find(c => c._id === formik.values.placementCompany)?.name) || 'Not Selected'}
              </Typography>
            </Grid>
            <Grid item xs={12} md={3}>
              <Typography variant="body2" color="text.secondary">
                <strong>Sector:</strong> {safeRenderText(sectors.find(s => s._id === formik.values.placementSector)?.name) || 'Not Selected'}
              </Typography>
            </Grid>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Department:</strong> {safeRenderText(departments.find(d => d._id === formik.values.placementDepartment)?.name) || 'Not Selected'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Designation:</strong> {safeRenderText(designations.find(d => d._id === formik.values.placementDesignation)?.title) || 'Not Selected'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Location:</strong> {safeRenderText(locations.find(l => l._id === formik.values.placementLocation)?.name) || 'Not Selected'}
                    </Typography>
                  </Grid>
                </Grid>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Project:</strong> {safeRenderText(projects.find(p => p._id === formik.values.placementProject)?.name) || 'Not Selected'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Section:</strong> {safeRenderText(sections.find(s => s._id === formik.values.placementSection)?.name) || 'Not Selected'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="body2" color="text.secondary">
                      <strong>Status:</strong> {formik.values.placementCompany && formik.values.placementSector && formik.values.placementDepartment && formik.values.placementDesignation ? 'Complete' : 'Incomplete'}
                    </Typography>
                  </Grid>
                </Grid>
              </Card>
            </Grid>

            {/* Placement Information */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ mt: 3, mb: 2 }}>
                Placement Information
              </Typography>
            </Grid>
            
            {/* Company */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Company</InputLabel>
                <Select
                  name="placementCompany"
                  value={safeFormValue(formik.values.placementCompany)}
                  onChange={(e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddCompanyDialog(true);
                      return;
                    }
                    formik.setFieldValue('placementCompany', e.target.value);
                  }}
                  error={formik.touched.placementCompany && Boolean(formik.errors.placementCompany)}
                  label="Company"
                >
                  {companies.map((company) => (
                    <MenuItem key={company._id} value={company._id}>
                      {safeRenderText(company.name)} ({safeRenderText(company.type)})
                    </MenuItem>
                  ))}
                  <MenuItem 
                    value="add_new" 
                    sx={{ 
                      borderTop: '1px solid #e0e0e0',
                      backgroundColor: '#f5f5f5',
                      '&:hover': {
                        backgroundColor: '#e3f2fd'
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AddIcon fontSize="small" />
                      Add New Company
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Sector */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Sector</InputLabel>
                <Select
                  name="placementSector"
                  value={safeFormValue(formik.values.placementSector)}
                  onChange={(e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddSectorDialog(true);
                      return;
                    }
                    formik.setFieldValue('placementSector', e.target.value);
                    formik.setFieldValue('placementProject', '');
                    formik.setFieldValue('placementDepartment', '');
                    formik.setFieldValue('placementSection', '');
                    formik.setFieldValue('placementDesignation', '');
                  }}
                  error={formik.touched.placementSector && Boolean(formik.errors.placementSector)}
                  label="Sector"
                >
                  {sectors.map((sector) => (
                    <MenuItem key={sector._id} value={sector._id}>
                      {safeRenderText(sector.name)}
                    </MenuItem>
                  ))}
                  <MenuItem 
                    value="add_new" 
                    sx={{ 
                      borderTop: '1px solid #e0e0e0',
                      backgroundColor: '#f5f5f5',
                      '&:hover': {
                        backgroundColor: '#e3f2fd'
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AddIcon fontSize="small" />
                      Add New Sector
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>



            {/* Project */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Project</InputLabel>
                <Select
                  name="placementProject"
                  value={safeFormValue(formik.values.placementProject)}
                  onChange={(e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddProjectDialog(true);
                      return;
                    }
                    formik.setFieldValue('placementProject', e.target.value);
                    formik.setFieldValue('placementDepartment', '');
                    formik.setFieldValue('placementSection', '');
                    formik.setFieldValue('placementDesignation', '');
                  }}
                  error={formik.touched.placementProject && Boolean(formik.errors.placementProject)}
                  label="Project"
                  disabled={!safeFormValue(formik.values.placementSector)}
                >
                  {projects.map((project) => (
                    <MenuItem key={project._id} value={project._id}>
                      {safeRenderText(project.name)} - {safeRenderText(project.company?.name)}
                    </MenuItem>
                  ))}
                  {safeFormValue(formik.values.placementSector) && (
                                      <MenuItem 
                    value="add_new" 
                    sx={{ 
                      borderTop: '1px solid #e0e0e0',
                      backgroundColor: '#f5f5f5',
                      '&:hover': {
                        backgroundColor: '#e3f2fd'
                      }
                    }}
                  >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AddIcon fontSize="small" />
                        Add New Project
                      </Box>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>

            {/* Department */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Department</InputLabel>
                <Select
                  name="placementDepartment"
                  value={safeFormValue(formik.values.placementDepartment)}
                  onChange={(e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddDepartmentDialog(true);
                      return;
                    }
                    formik.setFieldValue('placementDepartment', e.target.value);
                    
                    // Only clear section and designation if we're creating a new employee (no ID) or if the department actually changed
                    if (!id || id === 'add') {
                      formik.setFieldValue('placementSection', '');
                      formik.setFieldValue('placementDesignation', '');
                    }
                    
                    if (e.target.value) {
                      fetchSectionsByDepartment(e.target.value);
                    }
                  }}
                  error={formik.touched.placementDepartment && Boolean(formik.errors.placementDepartment)}
                  label="Department"
                  disabled={!safeFormValue(formik.values.placementSector)}
                >
                  {departments.map((dept) => (
                    <MenuItem key={dept._id} value={dept._id}>
                      {safeRenderText(dept.name)} ({safeRenderText(dept.code)})
                    </MenuItem>
                  ))}
                  {safeFormValue(formik.values.placementSector) && (
                                      <MenuItem 
                    value="add_new" 
                    sx={{ 
                      borderTop: '1px solid #e0e0e0',
                      backgroundColor: '#f5f5f5',
                      '&:hover': {
                        backgroundColor: '#e3f2fd'
                      }
                    }}
                  >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AddIcon fontSize="small" />
                        Add New Department
                      </Box>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>

            {/* Section */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Section</InputLabel>
                <Select
                  name="placementSection"
                  value={safeFormValue(formik.values.placementSection)}
                  onChange={(e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddSectionDialog(true);
                      return;
                    }
                    formik.setFieldValue('placementSection', e.target.value);
                    
                    // Only clear designation if we're creating a new employee (no ID) or if the section actually changed
                    if (!id || id === 'add') {
                      formik.setFieldValue('placementDesignation', '');
                    }
                    
                    // Always load all designations - don't filter by section
                    fetchDesignations();
                  }}
                  error={formik.touched.placementSection && Boolean(formik.errors.placementSection)}
                  label="Section"
                  disabled={!safeFormValue(formik.values.placementSector)}
                >
                  {sections.map((section) => (
                    <MenuItem key={section._id} value={section._id}>
                      {safeRenderText(section.name)}
                    </MenuItem>
                  ))}
                  {safeFormValue(formik.values.placementSector) && (
                                      <MenuItem 
                    value="add_new" 
                    sx={{ 
                      borderTop: '1px solid #e0e0e0',
                      backgroundColor: '#f5f5f5',
                      '&:hover': {
                        backgroundColor: '#e3f2fd'
                      }
                    }}
                  >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AddIcon fontSize="small" />
                        Add New Section
                      </Box>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>

            {/* Designation/Position */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Designation/Position</InputLabel>
                <Select
                  name="placementDesignation"
                  value={safeFormValue(formik.values.placementDesignation)}
                  onChange={async (e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddDesignationDialog(true);
                      return;
                    }
                    formik.handleChange(e);
                    // Auto-set category based on designation
                    if (e.target.value) {
                      const selectedDesignation = designations.find(d => d._id === e.target.value);
                      if (selectedDesignation) {
                        // Simple classification logic (matches backend)
                        const title = (selectedDesignation.title || '').toLowerCase();
                        const level = (selectedDesignation.level || '').toLowerCase();
                        let category = 'white_collar'; // default
                        
                        // Blue collar keywords
                        const blueKeywords = ['worker', 'technician', 'operator', 'labour', 'labor', 'helper', 'driver', 'mechanic', 'foreman', 'attendant'];
                        if (blueKeywords.some(keyword => title.includes(keyword)) || level === 'entry') {
                          category = 'blue_collar';
                        }
                        
                        formik.setFieldValue('employeeCategory', category);
                      }
                    } else {
                      formik.setFieldValue('employeeCategory', '');
                    }
                  }}
                  error={formik.touched.placementDesignation && Boolean(formik.errors.placementDesignation)}
                  label="Designation/Position"
                  disabled={!safeFormValue(formik.values.placementSector)}
                >
                  {designations.map((designation) => (
                    <MenuItem key={designation._id} value={designation._id}>
                      {safeRenderText(designation.title)} - {safeRenderText(designation.level)}
                    </MenuItem>
                  ))}
                  {safeFormValue(formik.values.placementSector) && (
                                      <MenuItem 
                    value="add_new" 
                    sx={{ 
                      borderTop: '1px solid #e0e0e0',
                      backgroundColor: '#f5f5f5',
                      '&:hover': {
                        backgroundColor: '#e3f2fd'
                      }
                    }}
                  >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AddIcon fontSize="small" />
                        Add New Designation
                      </Box>
                    </MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>

            {/* Employee Category */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Employee Category</InputLabel>
                <Select
                  name="employeeCategory"
                  value={formik.values.employeeCategory || ''}
                  onChange={formik.handleChange}
                  error={formik.touched.employeeCategory && Boolean(formik.errors.employeeCategory)}
                  label="Employee Category"
                >
                  <MenuItem value="white_collar">White Collar</MenuItem>
                  <MenuItem value="blue_collar">Blue Collar</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Reporting Line (KPI / hierarchy) */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Reporting Line</InputLabel>
                <Select
                  name="reportingLine"
                  value={formik.values.reportingLine || ''}
                  onChange={formik.handleChange}
                  label="Reporting Line"
                >
                  <MenuItem value="">— None —</MenuItem>
                  {(allEmployees || [])
                    .filter((e) => String(e._id) !== String(id))
                    .map((e) => (
                      <MenuItem key={e._id} value={e._id}>
                        {[e.firstName, e.lastName].filter(Boolean).join(' ') || e.employeeId}
                        {e.employeeId ? ` (${e.employeeId})` : ''}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Location */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Location</InputLabel>
                <Select
                  name="placementLocation"
                  value={safeFormValue(formik.values.placementLocation)}
                  onChange={(e) => {
                    if (e.target.value === 'add_new') {
                      setShowAddLocationDialog(true);
                      return;
                    }
                    formik.handleChange(e);
                  }}
                  error={formik.touched.placementLocation && Boolean(formik.errors.placementLocation)}
                  label="Location"
                >
                  {locations.map((location) => (
                    <MenuItem key={location._id} value={location._id}>
                      {safeRenderText(location.name)} ({safeRenderText(location.type)})
                    </MenuItem>
                  ))}
                  <MenuItem 
                    value="add_new" 
                    sx={{ 
                      borderTop: '1px solid #e0e0e0',
                      backgroundColor: '#f5f5f5',
                      '&:hover': {
                        backgroundColor: '#e3f2fd'
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AddIcon fontSize="small" />
                      Add New Location
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Old Designation (Optional) */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Old Designation (Optional)</InputLabel>
                <Select
                  name="oldDesignation"
                  value={safeFormValue(formik.values.oldDesignation)}
                  onChange={formik.handleChange}
                  error={formik.touched.oldDesignation && Boolean(formik.errors.oldDesignation)}
                  label="Old Designation (Optional)"
                >
                  {designations.map((designation) => (
                    <MenuItem key={designation._id} value={designation._id}>
                      {safeRenderText(designation.title)} - {safeRenderText(designation.level)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="appointmentDate"
                label="Appointment Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={formik.values.appointmentDate}
                onChange={(e) => handleProbationChange('appointmentDate', e.target.value)}
                error={formik.touched.appointmentDate && Boolean(formik.errors.appointmentDate)}
                helperText={formik.touched.appointmentDate && formik.errors.appointmentDate}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="probationPeriodMonths"
                label="Probation Period (Months)"
                type="number"
                value={formik.values.probationPeriodMonths}
                onChange={(e) => handleProbationChange('probationPeriodMonths', e.target.value)}
                error={formik.touched.probationPeriodMonths && Boolean(formik.errors.probationPeriodMonths)}
                helperText={formik.touched.probationPeriodMonths && formik.errors.probationPeriodMonths}
                inputProps={{ min: 0, max: 24 }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="endOfProbationDate"
                label="End of Probation Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={formik.values.endOfProbationDate || ''}
                InputProps={{
                  readOnly: true,
                }}
                helperText="Auto-calculated based on appointment date and probation period"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="confirmationDate"
                label="Confirmation Date (Optional)"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={formik.values.confirmationDate || ''}
                onChange={formik.handleChange}
                error={formik.touched.confirmationDate && Boolean(formik.errors.confirmationDate)}
                helperText={formik.touched.confirmationDate && formik.errors.confirmationDate}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Switch
                    name="isActive"
                    checked={formik.values.isActive}
                    onChange={formik.handleChange}
                  />
                }
                label="Active Employee"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Employment Status</InputLabel>
                <Select
                  name="employmentStatus"
                  value={formik.values.employmentStatus}
                  onChange={(e) => handleEmploymentStatusChange(e.target.value)}
                  error={formik.touched.employmentStatus && Boolean(formik.errors.employmentStatus)}
                  label="Employment Status"
                >
                  <MenuItem value="Draft">Draft (Completed Onboarding)</MenuItem>
                  <MenuItem value="Active">Active</MenuItem>
                  <MenuItem value="Inactive">Inactive</MenuItem>
                  <MenuItem value="Terminated">Terminated</MenuItem>
                  <MenuItem value="Resigned">Resigned</MenuItem>
                  <MenuItem value="Retired">Retired</MenuItem>
                  <MenuItem value="Reinstated">Reinstated</MenuItem>
                </Select>
                {formik.touched.employmentStatus && formik.errors.employmentStatus && (
                  <FormHelperText error>{formik.errors.employmentStatus}</FormHelperText>
                )}
              </FormControl>
            </Grid>
            {['Active', 'Reinstated'].includes(formik.values.employmentStatus) && (
              <Grid item xs={12} md={6}>
                {/* Leaving while still employed: payroll tax closes the tax year in this month (final-month true-up) */}
                <TextField
                  fullWidth
                  type="date"
                  name="terminationDate"
                  label="Leaving Date (last working day)"
                  InputLabelProps={{ shrink: true }}
                  value={formik.values.terminationDate}
                  onChange={formik.handleChange}
                  helperText="Only if the employee is leaving. Payroll tax settles their year in this month; set status to Resigned after their final payroll."
                />
              </Grid>
            )}
            {['Terminated', 'Resigned', 'Inactive', 'Retired'].includes(formik.values.employmentStatus) && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="date"
                    name="terminationDate"
                    label="Termination/Separation Date"
                    InputLabelProps={{ shrink: true }}
                    value={formik.values.terminationDate}
                    onChange={formik.handleChange}
                    error={formik.touched.terminationDate && Boolean(formik.errors.terminationDate)}
                    helperText={formik.touched.terminationDate && formik.errors.terminationDate}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    name="terminationReason"
                    label="Reason for Leaving"
                    value={formik.values.terminationReason}
                    onChange={formik.handleChange}
                    error={formik.touched.terminationReason && Boolean(formik.errors.terminationReason)}
                    helperText={formik.touched.terminationReason && formik.errors.terminationReason}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formik.values.isLateTerminationEntryForPayroll}
                        onChange={(e) => formik.setFieldValue('isLateTerminationEntryForPayroll', e.target.checked)}
                        name="isLateTerminationEntryForPayroll"
                        color="primary"
                      />
                    }
                    label="Late Entry (Include in current month's Terminations payroll report)"
                  />
                </Grid>
              </>
            )}
          </Grid>
        );

      case 3:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Address Information
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                name="address.street"
                label="Street Address"
                value={formik.values.address.street}
                onChange={formik.handleChange}
                error={formik.touched.address?.street && Boolean(formik.errors.address?.street)}
                helperText={formik.touched.address?.street && formik.errors.address?.street}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Country</InputLabel>
                <Select
                  name="address.country"
                  value={safeFormValue(formik.values.address.country)}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  error={formik.touched.address?.country && Boolean(formik.errors.address?.country)}
                  label="Country"
                >
                  {countries.map((country) => (
                    <MenuItem key={country._id} value={country._id}>
                      {safeRenderText(country.name)} ({safeRenderText(country.code)})
                    </MenuItem>
                  ))}
                </Select>
                {formik.touched.address?.country && formik.errors.address?.country && (
                  <FormHelperText error>{formik.errors.address?.country}</FormHelperText>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>State/Province</InputLabel>
                <Select
                  name="address.state"
                  value={safeFormValue(formik.values.address.state)}
                  onChange={(e) => handleProvinceChange(e.target.value)}
                  error={formik.touched.address?.state && Boolean(formik.errors.address?.state)}
                  label="State/Province"
                  disabled={!formik.values.address.country}
                >
                  {provinces.map((province) => (
                    <MenuItem key={province._id} value={province._id}>
                      {safeRenderText(province.name)}
                    </MenuItem>
                  ))}
                </Select>
                {formik.touched.address?.state && formik.errors.address?.state && (
                  <FormHelperText error>{formik.errors.address?.state}</FormHelperText>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>City</InputLabel>
                <Select
                  name="address.city"
                  value={safeFormValue(formik.values.address.city)}
                  onChange={formik.handleChange}
                  error={formik.touched.address?.city && Boolean(formik.errors.address?.city)}
                  label="City"
                  disabled={!formik.values.address.state}
                >
                  {cities.map((city) => (
                    <MenuItem key={city._id} value={city._id}>
                      {safeRenderText(city.name)}
                    </MenuItem>
                  ))}
                </Select>
                {formik.touched.address?.city && formik.errors.address?.city && (
                  <FormHelperText error>{formik.errors.address?.city}</FormHelperText>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                Emergency Contact
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                name="emergencyContact.name"
                label="Emergency Contact Name"
                value={formik.values.emergencyContact?.name || ''}
                onChange={formik.handleChange}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                name="emergencyContact.relationship"
                label="Relationship"
                value={formik.values.emergencyContact?.relationship || ''}
                onChange={formik.handleChange}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                name="emergencyContact.phone"
                label="Emergency Contact Phone"
                value={formik.values.emergencyContact?.phone || ''}
                onChange={formik.handleChange}
              />
            </Grid>
          </Grid>
        );

      case 4:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Salary & Benefits
              </Typography>
            </Grid>
            
            {/* Gross Salary */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="salary.gross"
                label="Gross Salary"
                type="number"
                value={formik.values.salary?.gross || ''}
                onChange={formik.handleChange}
                error={formik.touched.salary?.gross && Boolean(formik.errors.salary?.gross)}
                helperText={formik.touched.salary?.gross && formik.errors.salary?.gross}
                InputProps={{
                  startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                }}
                required
              />
            </Grid>

            {/* Cash Salary Toggle */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.cashSalary || false}
                      onChange={(e) => formik.setFieldValue('cashSalary', e.target.checked)}
                      name="cashSalary"
                      color="warning"
                    />
                  }
                  label="Pay Salary via Cash"
                />
                <FormHelperText>
                  When enabled, this employee's salary will be paid through cash and excluded from bank letter and BPV.
                </FormHelperText>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="h6" gutterBottom sx={{ mt: 1 }}>
                Partial monthly pay
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Pay a fixed number of calendar days each month for selected periods. Only salary (gross) is scaled by those days — allowances and other components stay full.
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.partialSalaryPay?.isActive || false}
                      onChange={(e) => formik.setFieldValue('partialSalaryPay.isActive', e.target.checked)}
                    />
                  }
                  label="Enable partial pay for selected months"
                />
              </FormControl>
            </Grid>
            {formik.values.partialSalaryPay?.isActive && (
              <>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Payable days per month"
                    type="number"
                    value={formik.values.partialSalaryPay?.payableDaysPerMonth || ''}
                    onChange={(e) => formik.setFieldValue('partialSalaryPay.payableDaysPerMonth', e.target.value)}
                    inputProps={{ min: 1, max: 31 }}
                    helperText="e.g. 8 days salary only; allowances remain full"
                    required
                  />
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Month</InputLabel>
                    <Select
                      label="Month"
                      value={partialPeriodDraft.month}
                      onChange={(e) => setPartialPeriodDraft((prev) => ({ ...prev, month: e.target.value }))}
                    >
                      {PAYROLL_MONTH_OPTIONS.map((m) => (
                        <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <TextField
                    fullWidth
                    label="Year"
                    type="number"
                    value={partialPeriodDraft.year}
                    onChange={(e) => setPartialPeriodDraft((prev) => ({ ...prev, year: e.target.value }))}
                    inputProps={{ min: 2020, max: 2100 }}
                  />
                </Grid>
                <Grid item xs={12} md={2} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      const month = Number(partialPeriodDraft.month);
                      const year = Number(partialPeriodDraft.year);
                      if (!month || !year) return;
                      const periods = formik.values.partialSalaryPay?.periods || [];
                      const exists = periods.some((p) => Number(p.month) === month && Number(p.year) === year);
                      if (exists) return;
                      formik.setFieldValue('partialSalaryPay.periods', [...periods, { month, year }]);
                    }}
                  >
                    Add
                  </Button>
                </Grid>
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {(formik.values.partialSalaryPay?.periods || []).map((period) => {
                      const label = PAYROLL_MONTH_OPTIONS.find((m) => m.value === Number(period.month))?.label
                        || `Month ${period.month}`;
                      const key = `${period.year}-${period.month}`;
                      return (
                        <Chip
                          key={key}
                          label={`${label} ${period.year}`}
                          onDelete={() => {
                            formik.setFieldValue(
                              'partialSalaryPay.periods',
                              (formik.values.partialSalaryPay?.periods || []).filter(
                                (p) => !(Number(p.month) === Number(period.month) && Number(p.year) === Number(period.year))
                              )
                            );
                          }}
                        />
                      );
                    })}
                    {!formik.values.partialSalaryPay?.periods?.length && (
                      <Typography variant="body2" color="text.secondary">
                        No months added yet.
                      </Typography>
                    )}
                  </Box>
                </Grid>
              </>
            )}
            
            {/* Flexible Allowances Section */}
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 1 }}>
                Allowances Management
              </Typography>
            </Grid>
            
            {/* Conveyance Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.conveyance?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.conveyance.isActive', e.target.checked)}
                      name="allowances.conveyance.isActive"
                    />
                  }
                  label="Conveyance Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.conveyance?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.conveyance.amount"
                  label="Conveyance Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.conveyance?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* Food Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.food?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.food.isActive', e.target.checked)}
                      name="allowances.food.isActive"
                    />
                  }
                  label="Food Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.food?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.food.amount"
                  label="Food Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.food?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* Mobile Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.mobile?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.mobile.isActive', e.target.checked)}
                      name="allowances.mobile.isActive"
                    />
                  }
                  label="Mobile Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.mobile?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.mobile.amount"
                  label="Mobile Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.mobile?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* Vehicle Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.vehicle?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.vehicle.isActive', e.target.checked)}
                      name="allowances.vehicle.isActive"
                    />
                  }
                  label="Vehicle Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.vehicle?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.vehicle.amount"
                  label="Vehicle Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.vehicle?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}

            {/* Fuel Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.fuel?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.fuel.isActive', e.target.checked)}
                      name="allowances.fuel.isActive"
                    />
                  }
                  label="Fuel Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.fuel?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.fuel.amount"
                  label="Fuel Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.fuel?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* Medical Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.medical?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.medical.isActive', e.target.checked)}
                      name="allowances.medical.isActive"
                    />
                  }
                  label="Medical Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.medical?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.medical.amount"
                  label="Medical Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.medical?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* House Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.houseRent?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.houseRent.isActive', e.target.checked)}
                      name="allowances.houseRent.isActive"
                    />
                  }
                  label="House Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.houseRent?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.houseRent.amount"
                  label="House Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.houseRent?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* Special Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.special?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.special.isActive', e.target.checked)}
                      name="allowances.special.isActive"
                    />
                  }
                  label="Special Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.special?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.special.amount"
                  label="Special Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.special?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* Other Allowance */}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.allowances?.other?.isActive || false}
                      onChange={(e) => formik.setFieldValue('allowances.other.isActive', e.target.checked)}
                      name="allowances.other.isActive"
                    />
                  }
                  label="Other Allowance"
                />
              </FormControl>
            </Grid>
            {formik.values.allowances?.other?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="allowances.other.amount"
                  label="Other Allowance Amount"
                  type="number"
                  value={formik.values.allowances?.other?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                />
              </Grid>
            )}
            
            {/* EOBI and Provident Fund */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom>
                Deductions
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.eobi?.isActive || false}
                      onChange={(e) => {
                        formik.setFieldValue('eobi.isActive', e.target.checked);
                        if (e.target.checked) formik.setFieldValue('eobi.amount', 407);
                        else formik.setFieldValue('eobi.amount', 0);
                      }}
                      name="eobi.isActive"
                    />
                  }
                  label="EOBI Active"
                />
                <FormHelperText>
                  Employees' Old-Age Benefits Institution
                </FormHelperText>
              </FormControl>
            </Grid>
            {formik.values.eobi?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="eobi.amount"
                  label="EOBI Amount"
                  type="number"
                  value={formik.values.eobi?.amount || ''}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                  helperText="Default is Rs 407 (1% of minimum wage)"
                />
              </Grid>
            )}
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.providentFund?.isActive || false}
                      onChange={(e) => formik.setFieldValue('providentFund.isActive', e.target.checked)}
                      name="providentFund.isActive"
                    />
                  }
                  label="Provident Fund Active"
                />
                <FormHelperText>
                  Provident Fund (8.34% of basic salary)
                </FormHelperText>
              </FormControl>
            </Grid>
            {formik.values.providentFund?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="providentFund.amount"
                  label="Provident Fund Amount"
                  type="number"
                  value={formik.values.providentFund?.amount || Math.round((formik.values.salary?.gross || 0) * 0.6 * 0.08)}
                  onChange={formik.handleChange}
                  InputProps={{
                    readOnly: true,
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                  helperText="Auto-calculated: 8.34% of basic salary"
                />
              </Grid>
            )}
            
            {/* Manual Tax Override */}
            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.manualTax?.isActive || false}
                      onChange={(e) => {
                        formik.setFieldValue('manualTax.isActive', e.target.checked);
                        if (!e.target.checked) formik.setFieldValue('manualTax.fixedAmount', 0);
                      }}
                      name="manualTax.isActive"
                      color="warning"
                    />
                  }
                  label="Manual Tax Override (Turn Off Auto Tax)"
                />
                <FormHelperText>
                  When enabled, auto income tax is skipped and the fixed amount below is deducted instead.
                </FormHelperText>
              </FormControl>
            </Grid>
            {formik.values.manualTax?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="manualTax.fixedAmount"
                  label="Fixed Monthly Tax Amount"
                  type="number"
                  value={formik.values.manualTax?.fixedAmount || 0}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                  inputProps={{ min: 0, step: 1 }}
                  helperText="This exact amount will be deducted as income tax every month."
                  error={Boolean(formik.errors.manualTax?.fixedAmount)}
                />
              </Grid>
            )}

            {/* Employee Security Deduction */}
            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formik.values.employeeSecurity?.isActive || false}
                      onChange={(e) => {
                        formik.setFieldValue('employeeSecurity.isActive', e.target.checked);
                        if (!e.target.checked) formik.setFieldValue('employeeSecurity.amount', 0);
                      }}
                      name="employeeSecurity.isActive"
                      color="primary"
                    />
                  }
                  label="Employee Security Deduction Active"
                />
                <FormHelperText>
                  Security deduction amount to be deducted monthly in payroll
                </FormHelperText>
              </FormControl>
            </Grid>
            {formik.values.employeeSecurity?.isActive && (
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  name="employeeSecurity.amount"
                  label="Employee Security Amount"
                  type="number"
                  value={formik.values.employeeSecurity?.amount || 0}
                  onChange={formik.handleChange}
                  InputProps={{
                    startAdornment: <span style={{ marginRight: 8 }}>PKR</span>
                  }}
                  inputProps={{ min: 0, step: 1 }}
                  helperText="This amount will be deducted from employee payroll every month."
                  error={Boolean(formik.errors.employeeSecurity?.amount)}
                />
              </Grid>
            )}

            {/* Auto-Calculated Salary Breakdown */}
            <Grid item xs={12}>
              <Card variant="outlined" sx={{ p: 2, backgroundColor: '#f8f9fa', mt: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Auto-Calculated Salary Breakdown
                </Typography>
                <AutoCalculatedSalaryBreakdown gross={formik.values.salary?.gross || 0} />
              </Card>
            </Grid>
            
            {/* Bank Information */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom>
                Bank Information
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Bank Name</InputLabel>
                <Select
                  name="bankName"
                  value={safeFormValue(formik.values.bankName)}
                  onChange={formik.handleChange}
                  error={formik.touched.bankName && Boolean(formik.errors.bankName)}
                  label="Bank Name"
                >
                  {banks.map((bank) => (
                    <MenuItem key={bank._id} value={bank._id}>
                      {safeRenderText(bank.name)} ({safeRenderText(bank.type)})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="bankAccountNumber"
                label="Bank Account Number"
                value={formik.values.bankAccountNumber}
                onChange={formik.handleChange}
                error={formik.touched.bankAccountNumber && Boolean(formik.errors.bankAccountNumber)}
                helperText={formik.touched.bankAccountNumber && formik.errors.bankAccountNumber}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                name="foreignBankAccount"
                label="Foreign Bank Account (Optional)"
                value={formik.values.foreignBankAccount}
                onChange={formik.handleChange}
                error={formik.touched.foreignBankAccount && Boolean(formik.errors.foreignBankAccount)}
                helperText={formik.touched.foreignBankAccount && formik.errors.foreignBankAccount}
              />
            </Grid>
            
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom>
                Salary & Benefits Summary
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    <SalaryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                    Salary Information
                  </Typography>
                  <Typography variant="body1">
                    <strong>Gross Salary:</strong> {formatPKR(formik.values.salary?.gross || 0)}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    <strong>Auto-Calculated Salary Breakdown</strong>
                  </Typography>
                  <AutoCalculatedSalaryBreakdown gross={formik.values.salary?.gross || 0} dense />

                  {vehicleAllowanceAmount(formik.values.allowances) > 0 && (
                    <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                      Vehicle Allowance: {formatPKR(vehicleAllowanceAmount(formik.values.allowances))}
                    </Typography>
                  )}
                  {fuelAllowanceAmount(formik.values.allowances) > 0 && (
                    <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                      Fuel Allowance: {formatPKR(fuelAllowanceAmount(formik.values.allowances))}
                    </Typography>
                  )}
                  {formik.values.allowances?.food?.isActive && (
                    <Typography variant="body2" color="success.main">
                      Food Allowance: {formatPKR(formik.values.allowances.food.amount || 0)}
                    </Typography>
                  )}
                  {formik.values.allowances?.mobile?.isActive && (
                    <Typography variant="body2" color="success.main">
                      Mobile Allowance: {formatPKR(formik.values.allowances.mobile.amount || 0)}
                    </Typography>
                  )}
                  {formik.values.allowances?.conveyance?.isActive && (
                    <Typography variant="body2" color="success.main">
                      Conveyance: {formatPKR(formik.values.allowances.conveyance.amount || 0)}
                    </Typography>
                  )}
                  {formik.values.allowances?.medical?.isActive && (
                    <Typography variant="body2" color="success.main">
                      Medical Allowance: {formatPKR(formik.values.allowances.medical.amount || 0)}
                    </Typography>
                  )}
                  {formik.values.allowances?.houseRent?.isActive && (
                    <Typography variant="body2" color="success.main">
                      House Allowance: {formatPKR(formik.values.allowances.houseRent.amount || 0)}
                    </Typography>
                  )}
                  {formik.values.allowances?.special?.isActive && (
                    <Typography variant="body2" color="success.main">
                      Special: {formatPKR(formik.values.allowances.special.amount || 0)}
                    </Typography>
                  )}
                  {formik.values.allowances?.other?.isActive && (
                    <Typography variant="body2" color="success.main">
                      Other: {formatPKR(formik.values.allowances.other.amount || 0)}
                    </Typography>
                  )}

                  <Divider sx={{ my: 1 }} />
                  <Typography variant="h6" color="primary">
                    <strong>Total Monthly Compensation:</strong> {formatPKR(formik.values.salary?.gross || 0)}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Monthly compensation (Gross Salary)
                  </Typography>
                  {formik.values.eobi?.isActive && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="body2" color="error">
                        <strong>EOBI Deduction:</strong> {formatPKR(formik.values.eobi?.amount || 407)}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Fixed amount: Rs 407 (1% of minimum wage)
                      </Typography>
                    </>
                  )}
                  {formik.values.providentFund?.isActive && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="body2" color="error">
                        <strong>Provident Fund Deduction:</strong> {formatPKR(formik.values.providentFund?.amount || Math.round(computeAutoSalaryBreakdown(formik.values.salary?.gross).basic * 0.0834))}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Auto-calculated: 8.34% of basic salary
                      </Typography>
                    </>
                  )}
                  {formik.values.employeeSecurity?.isActive && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="body2" color="error">
                        <strong>Employee Security Deduction:</strong> {formatPKR(formik.values.employeeSecurity?.amount || 0)}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Monthly security deduction
                      </Typography>
                    </>
                  )}
                  
                  {/* Net Salary Calculation */}
                  {(() => {
                    const grossSalary = formik.values.salary?.gross || 0;
                    const totalDeductions = (formik.values.eobi?.isActive ? (formik.values.eobi?.amount || 407) : 0) +
                      (formik.values.employeeSecurity?.isActive ? (Number(formik.values.employeeSecurity?.amount) || 0) : 0);
                    // Provident Fund excluded from total deductions (Coming Soon)
                    // + (formik.values.providentFund?.isActive ? Math.round(basicSalary * 0.0834) : 0);
                    
                    const netSalary = grossSalary - totalDeductions;
                    
                    return totalDeductions > 0 ? (
                      <>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="h6" color="success.main">
                          <strong>Net Monthly Salary:</strong> {formatPKR(netSalary)}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          Net = Gross Salary - Total Deductions
                        </Typography>
                      </>
                    ) : null;
                  })()}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    <WorkIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                    Employment Details
                  </Typography>
                  <Typography variant="body1">
                                    <strong>Company:</strong> {safeRenderText(companies.find(c => c._id === safeFormValue(formik.values.placementCompany))?.name) || 'Not selected'}
              </Typography>
              <Typography variant="body1">
                <strong>Sector:</strong> {safeRenderText(sectors.find(s => s._id === safeFormValue(formik.values.placementSector))?.name) || 'Not selected'}
              </Typography>
              <Typography variant="body1">
                    <strong>Department:</strong> {safeRenderText(departments.find(d => d._id === safeFormValue(formik.values.placementDepartment))?.name) || 'Not selected'}
                  </Typography>
                  <Typography variant="body1">
                    <strong>Designation:</strong> {safeRenderText(designations.find(d => d._id === safeFormValue(formik.values.placementDesignation))?.title) || 'Not selected'}
                  </Typography>
                  <Typography variant="body1">
                    <strong>Status:</strong> 
                    <Chip 
                      label={formik.values.isActive ? 'Active' : 'Inactive'} 
                      color={formik.values.isActive ? 'success' : 'error'} 
                      size="small" 
                      sx={{ ml: 1 }}
                    />
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info">
                Review all information before saving. You can go back to previous steps to make changes.
              </Alert>
            </Grid>
          </Grid>
        );

      default:
        return null;
    }
  };

  if (loading && id && id !== 'add') {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Loading employee details...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">
          {id ? 'Edit Employee' : 'Add New Employee'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<CancelIcon />}
            onClick={() => navigate('/hr/employees')}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={async (e) => {
              e.preventDefault();
              
              // Validate form first
              const errors = await formik.validateForm();
              
              if (Object.keys(errors).length > 0) {
                formik.setTouched(
                  Object.keys(errors).reduce((acc, key) => {
                    acc[key] = true;
                    return acc;
                  }, {})
                );
                setSnackbar({
                  open: true,
                  message: `Please fix validation errors: ${Object.keys(errors).join(', ')}`,
                  severity: 'error'
                });
                return;
              }
              
              // Submit the form
              await formik.submitForm();
            }}
            disabled={loading || formik.isSubmitting}
          >
            {loading || formik.isSubmitting ? 'Saving...' : 'Save Employee'}
          </Button>
        </Box>
      </Box>

      <Paper sx={{ p: 3 }}>
        {/* Stepper */}
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label, index) => (
            <Step key={label}>
              <StepLabel onClick={() => handleStepClick(index)} sx={{ cursor: 'pointer' }}>
                {label}
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* Step Content */}
        <Box sx={{ mb: 4 }}>
          {renderStepContent(activeStep)}
        </Box>

        {/* Navigation Buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            disabled={activeStep === 0}
            onClick={handleBack}
          >
            Back
          </Button>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={handlePrintStep}
          >
            Print {steps[activeStep]}
          </Button>
          <Box>
            {activeStep === steps.length - 1 ? (
              <Button
                variant="contained"
                onClick={async (e) => {
                  e.preventDefault();
                  
                  // Validate form first
                  const errors = await formik.validateForm();
                  
                  if (Object.keys(errors).length > 0) {
                    formik.setTouched(
                      Object.keys(errors).reduce((acc, key) => {
                        acc[key] = true;
                        return acc;
                      }, {})
                    );
                    setSnackbar({
                      open: true,
                      message: `Please fix validation errors: ${Object.keys(errors).join(', ')}`,
                      severity: 'error'
                    });
                    return;
                  }
                  
                  // Submit the form
                  await formik.submitForm();
                }}
                disabled={loading || formik.isSubmitting}
              >
                {loading || formik.isSubmitting ? 'Saving...' : 'Save Employee'}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
              >
                Next
              </Button>
            )}
          </Box>
        </Box>
      </Paper>

      {/* Add New Company Dialog */}
      <Dialog open={showAddCompanyDialog} onClose={() => setShowAddCompanyDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Company</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Company Name"
                  value={newCompanyData.name}
                  onChange={(e) => handleNewCompanyChange('name', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Company Type</InputLabel>
                  <Select
                    value={newCompanyData.type}
                    onChange={(e) => handleNewCompanyChange('type', e.target.value)}
                    label="Company Type"
                  >
                    <MenuItem value="Private Limited">Private Limited</MenuItem>
                    <MenuItem value="Public Limited">Public Limited</MenuItem>
                    <MenuItem value="Partnership">Partnership</MenuItem>
                    <MenuItem value="Sole Proprietorship">Sole Proprietorship</MenuItem>
                    <MenuItem value="Government">Government</MenuItem>
                    <MenuItem value="NGO">NGO</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description"
                  value={newCompanyData.description}
                  onChange={(e) => handleNewCompanyChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddCompanyDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewCompany} variant="contained">
            Add Company
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add New Sector Dialog */}
      <Dialog open={showAddSectorDialog} onClose={() => setShowAddSectorDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Sector</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Sector Name"
                  value={newSectorData.name}
                  onChange={(e) => handleNewSectorChange('name', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Industry</InputLabel>
                  <Select
                    value={newSectorData.industry}
                    onChange={(e) => handleNewSectorChange('industry', e.target.value)}
                    label="Industry"
                  >
                    <MenuItem value="Technology">Technology</MenuItem>
                    <MenuItem value="Healthcare">Healthcare</MenuItem>
                    <MenuItem value="Finance">Finance</MenuItem>
                    <MenuItem value="Manufacturing">Manufacturing</MenuItem>
                    <MenuItem value="Education">Education</MenuItem>
                    <MenuItem value="Government">Government</MenuItem>
                    <MenuItem value="Retail">Retail</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddSectorDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewSector} variant="contained">
            Add Sector
          </Button>
        </DialogActions>
      </Dialog>



      {/* Add New Project Dialog */}
      <Dialog open={showAddProjectDialog} onClose={() => setShowAddProjectDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Project</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Project Name"
                  value={newProjectData.name}
                  onChange={(e) => handleNewProjectChange('name', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description (Optional)"
                  value={newProjectData.description}
                  onChange={(e) => handleNewProjectChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddProjectDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewProject} variant="contained">
            Add Project
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add New Department Dialog */}
      <Dialog open={showAddDepartmentDialog} onClose={() => setShowAddDepartmentDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Department</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Department Name"
                  value={newDepartmentData.name}
                  onChange={(e) => handleNewDepartmentChange('name', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description"
                  value={newDepartmentData.description}
                  onChange={(e) => handleNewDepartmentChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddDepartmentDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewDepartment} variant="contained">
            Add Department
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add New Section Dialog */}
      <Dialog open={showAddSectionDialog} onClose={() => setShowAddSectionDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Section</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Section Name"
                  value={newSectionData.name}
                  onChange={(e) => handleNewSectionChange('name', e.target.value)}
                  required
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddSectionDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewSection} variant="contained">
            Add Section
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add New Designation Dialog */}
      <Dialog open={showAddDesignationDialog} onClose={() => setShowAddDesignationDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Designation</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Designation Title"
                  value={newDesignationData.title}
                  onChange={(e) => handleNewDesignationChange('title', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Level</InputLabel>
                  <Select
                    value={newDesignationData.level}
                    onChange={(e) => handleNewDesignationChange('level', e.target.value)}
                    label="Level"
                  >
                    <MenuItem value="Entry">Entry</MenuItem>
                    <MenuItem value="Junior">Junior</MenuItem>
                    <MenuItem value="Mid">Mid</MenuItem>
                    <MenuItem value="Senior">Senior</MenuItem>
                    <MenuItem value="Lead">Lead</MenuItem>
                    <MenuItem value="Manager">Manager</MenuItem>
                    <MenuItem value="Director">Director</MenuItem>
                    <MenuItem value="Executive">Executive</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description"
                  value={newDesignationData.description}
                  onChange={(e) => handleNewDesignationChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddDesignationDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewDesignation} variant="contained">
            Add Designation
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add New Location Dialog */}
      <Dialog open={showAddLocationDialog} onClose={() => setShowAddLocationDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Location</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Location Name"
                  value={newLocationData.name}
                  onChange={(e) => handleNewLocationChange('name', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Location Type</InputLabel>
                  <Select
                    value={newLocationData.type}
                    onChange={(e) => handleNewLocationChange('type', e.target.value)}
                    label="Location Type"
                  >
                    <MenuItem value="Office">Office</MenuItem>
                    <MenuItem value="Branch">Branch</MenuItem>
                    <MenuItem value="Site">Site</MenuItem>
                    <MenuItem value="Warehouse">Warehouse</MenuItem>
                    <MenuItem value="Factory">Factory</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddLocationDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewLocation} variant="contained">
            Add Location
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add New Qualification Dialog */}
      <Dialog open={showAddQualificationDialog} onClose={() => setShowAddQualificationDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Qualification</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Qualification Name"
                  value={newQualificationData.name}
                  onChange={(e) => handleNewQualificationChange('name', e.target.value)}
                  required
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description (Optional)"
                  value={newQualificationData.description}
                  onChange={(e) => handleNewQualificationChange('description', e.target.value)}
                  multiline
                  rows={3}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddQualificationDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveNewQualification} variant="contained">
            Add Qualification
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default EmployeeForm; 