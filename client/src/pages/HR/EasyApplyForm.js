import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Alert,
  Snackbar,
  CircularProgress,
  Container,
  useTheme,
  Stepper,
  Step,
  StepLabel,
  Divider,
  Chip,
  Stack,
  Paper,
  Avatar,
  IconButton,
  InputAdornment
} from '@mui/material';
import {
  Person,
  Email,
  Phone,
  Work,
  School,
  AttachFile,
  CloudUpload,
  Save,
  ArrowBack,
  CheckCircle,
  Description,
  LocationOn,
  Business
} from '@mui/icons-material';
import { useNavigate, useParams } from 'react-router-dom';
import { Formik, Form, Field } from 'formik';
import * as Yup from 'yup';
import { printTovusElement } from '../../utils/tovusPrintBrand';

// Validation schema for Easy Apply
const easyApplyValidationSchema = Yup.object({
  // Personal Information
  firstName: Yup.string().required('First name is required'),
  lastName: Yup.string().required('Last name is required'),
  email: Yup.string().email('Invalid email format').required('Email is required'),
  phone: Yup.string().required('Phone number is required'),
  
  // Professional Information
  currentPosition: Yup.string().required('Current position is required'),
  yearsOfExperience: Yup.string().required('Years of experience is required'),
  expectedSalary: Yup.string().required('Expected salary is required'),
  
  // CV Upload
  cvFile: Yup.mixed().required('CV file is required'),
  
  // Additional Information
  noticePeriod: Yup.string().required('Notice period is required'),
  availability: Yup.string().required('Availability is required'),
  howDidYouHear: Yup.string().required('Please let us know how you heard about this position')
});

const EasyApplyForm = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { affiliateCode } = useParams();
  
  const [loading, setLoading] = useState(false);
  const [jobPosting, setJobPosting] = useState(null);
  const [cvFileName, setCvFileName] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [activeStep, setActiveStep] = useState(0);
  
  const steps = [
    'Job Details',
    'Personal Information',
    'Professional Details',
    'CV Upload',
    'Review & Submit'
  ];

  // Load job posting details
  useEffect(() => {
    const loadJobPosting = async () => {
      try {
        const response = await fetch(`/api/job-postings/apply/${affiliateCode}`);
        if (response.ok) {
          const data = await response.json();
          setJobPosting(data.data);
        } else {
          setSnackbar({
            open: true,
            message: 'Job posting not found or not available',
            severity: 'error'
          });
          navigate('/');
        }
      } catch (error) {
        console.error('Error loading job posting:', error);
        setSnackbar({
          open: true,
          message: 'Error loading job posting',
          severity: 'error'
        });
      }
    };

    if (affiliateCode) {
      loadJobPosting();
    }
  }, [affiliateCode, navigate]);

  const handleFileChange = (event, setFieldValue) => {
    const file = event.target.files[0];
    if (file) {
      setFieldValue('cvFile', file);
      setCvFileName(file.name);
    }
  };

  const handleSubmit = async (values, { setSubmitting }) => {
    setLoading(true);
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('affiliateCode', affiliateCode);
      formData.append('cvFile', values.cvFile);
      
      // Add other form data
      const applicationData = {
        personalInfo: {
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          phone: values.phone
        },
        professionalInfo: {
          currentPosition: values.currentPosition,
          yearsOfExperience: values.yearsOfExperience,
          expectedSalary: values.expectedSalary,
          noticePeriod: values.noticePeriod,
          availability: values.availability
        },
        additionalInfo: {
          howDidYouHear: values.howDidYouHear
        }
      };
      
      formData.append('applicationData', JSON.stringify(applicationData));

      const response = await fetch('/api/applications/easy-apply', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        setSnackbar({
          open: true,
          message: 'Application submitted successfully! We will review your CV and get back to you soon.',
          severity: 'success'
        });
        
        // Show success step
        setActiveStep(4);
      } else {
        const error = await response.json();
        setSnackbar({
          open: true,
          message: error.message || 'Error submitting application',
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Error submitting application:', error);
      setSnackbar({
        open: true,
        message: 'Error submitting application. Please try again.',
        severity: 'error'
      });
    } finally {
      setLoading(false);
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const renderStepContent = (step, values, setFieldValue, errors, touched) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Job Details
            </Typography>
            {jobPosting && (
              <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="h5" color="primary" gutterBottom>
                      {jobPosting.title}
                    </Typography>
                    <Typography variant="body1" color="textSecondary" gutterBottom>
                      {jobPosting.department?.name} • {jobPosting.position?.title}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      📍 {jobPosting.location?.name || 'Location not specified'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Stack spacing={2}>
                      <Chip 
                        label={`${jobPosting.employmentType?.replace('_', ' ').toUpperCase()}`} 
                        color="primary" 
                        variant="outlined" 
                      />
                      <Chip 
                        label={`${jobPosting.experienceLevel?.toUpperCase()} Level`} 
                        color="secondary" 
                        variant="outlined" 
                      />
                      <Chip 
                        label={`${jobPosting.educationLevel?.replace('_', ' ').toUpperCase()}`} 
                        color="info" 
                        variant="outlined" 
                      />
                    </Stack>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body1" gutterBottom>
                      {jobPosting.description}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            )}
            <Typography variant="body2" color="textSecondary" align="center">
              This is a quick application process. You'll only need to provide essential information and upload your CV.
            </Typography>
          </Box>
        );

      case 1:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Personal Information
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Field name="firstName">
                  {({ field, meta }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="First Name"
                      error={meta.touched && meta.error}
                      helperText={meta.touched && meta.error}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Person color="action" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="lastName">
                  {({ field, meta }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Last Name"
                      error={meta.touched && meta.error}
                      helperText={meta.touched && meta.error}
                    />
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="email">
                  {({ field, meta }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Email"
                      type="email"
                      error={meta.touched && meta.error}
                      helperText={meta.touched && meta.error}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Email color="action" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="phone">
                  {({ field, meta }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Phone Number"
                      error={meta.touched && meta.error}
                      helperText={meta.touched && meta.error}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Phone color="action" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                </Field>
              </Grid>
            </Grid>
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Professional Details
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Field name="currentPosition">
                  {({ field, meta }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Current Position"
                      error={meta.touched && meta.error}
                      helperText={meta.touched && meta.error}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Work color="action" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="yearsOfExperience">
                  {({ field, meta }) => (
                    <FormControl fullWidth error={meta.touched && meta.error}>
                      <InputLabel>Years of Experience</InputLabel>
                      <Select {...field} label="Years of Experience">
                        <MenuItem value="0-1">0-1 years</MenuItem>
                        <MenuItem value="1-3">1-3 years</MenuItem>
                        <MenuItem value="3-5">3-5 years</MenuItem>
                        <MenuItem value="5-8">5-8 years</MenuItem>
                        <MenuItem value="8-10">8-10 years</MenuItem>
                        <MenuItem value="10+">10+ years</MenuItem>
                      </Select>
                      {meta.touched && meta.error && (
                        <FormHelperText>{meta.error}</FormHelperText>
                      )}
                    </FormControl>
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="expectedSalary">
                  {({ field, meta }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="Expected Salary (PKR)"
                      error={meta.touched && meta.error}
                      helperText={meta.touched && meta.error}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <AttachMoney color="action" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="noticePeriod">
                  {({ field, meta }) => (
                    <FormControl fullWidth error={meta.touched && meta.error}>
                      <InputLabel>Notice Period</InputLabel>
                      <Select {...field} label="Notice Period">
                        <MenuItem value="immediate">Immediate</MenuItem>
                        <MenuItem value="1_week">1 week</MenuItem>
                        <MenuItem value="2_weeks">2 weeks</MenuItem>
                        <MenuItem value="1_month">1 month</MenuItem>
                        <MenuItem value="2_months">2 months</MenuItem>
                        <MenuItem value="3_months">3 months</MenuItem>
                      </Select>
                      {meta.touched && meta.error && (
                        <FormHelperText>{meta.error}</FormHelperText>
                      )}
                    </FormControl>
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="availability">
                  {({ field, meta }) => (
                    <FormControl fullWidth error={meta.touched && meta.error}>
                      <InputLabel>Availability</InputLabel>
                      <Select {...field} label="Availability">
                        <MenuItem value="immediate">Immediate</MenuItem>
                        <MenuItem value="2_weeks">2 weeks</MenuItem>
                        <MenuItem value="1_month">1 month</MenuItem>
                        <MenuItem value="2_months">2 months</MenuItem>
                        <MenuItem value="3_months">3 months</MenuItem>
                        <MenuItem value="negotiable">Negotiable</MenuItem>
                      </Select>
                      {meta.touched && meta.error && (
                        <FormHelperText>{meta.error}</FormHelperText>
                      )}
                    </FormControl>
                  )}
                </Field>
              </Grid>
              <Grid item xs={12} md={6}>
                <Field name="howDidYouHear">
                  {({ field, meta }) => (
                    <FormControl fullWidth error={meta.touched && meta.error}>
                      <InputLabel>How did you hear about us?</InputLabel>
                      <Select {...field} label="How did you hear about us?">
                        <MenuItem value="linkedin">LinkedIn</MenuItem>
                        <MenuItem value="indeed">Indeed</MenuItem>
                        <MenuItem value="glassdoor">Glassdoor</MenuItem>
                        <MenuItem value="company_website">Company Website</MenuItem>
                        <MenuItem value="referral">Referral</MenuItem>
                        <MenuItem value="other">Other</MenuItem>
                      </Select>
                      {meta.touched && meta.error && (
                        <FormHelperText>{meta.error}</FormHelperText>
                      )}
                    </FormControl>
                  )}
                </Field>
              </Grid>
            </Grid>
          </Box>
        );

      case 3:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              CV Upload
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper
                  elevation={2}
                  sx={{
                    p: 3,
                    border: '2px dashed',
                    borderColor: 'primary.main',
                    backgroundColor: 'background.default',
                    textAlign: 'center'
                  }}
                >
                  <input
                    accept=".pdf,.doc,.docx"
                    style={{ display: 'none' }}
                    id="cv-file-input"
                    type="file"
                    onChange={(e) => handleFileChange(e, setFieldValue)}
                  />
                  <label htmlFor="cv-file-input">
                    <Button
                      component="span"
                      variant="outlined"
                      startIcon={<CloudUpload />}
                      size="large"
                      sx={{ mb: 2 }}
                    >
                      Upload CV
                    </Button>
                  </label>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Supported formats: PDF, DOC, DOCX
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Maximum file size: 5MB
                  </Typography>
                  {cvFileName && (
                    <Box sx={{ mt: 2 }}>
                      <Chip
                        icon={<AttachFile />}
                        label={cvFileName}
                        color="primary"
                        variant="outlined"
                      />
                    </Box>
                  )}
                </Paper>
                {errors.cvFile && touched.cvFile && (
                  <Typography color="error" variant="body2" sx={{ mt: 1 }}>
                    {errors.cvFile}
                  </Typography>
                )}
              </Grid>
            </Grid>
          </Box>
        );

      case 4:
        return (
          <Box className="tv-application-confirmation" sx={{ textAlign: 'center' }}>
            <CheckCircle color="success" sx={{ fontSize: 80, mb: 2 }} />
            <Typography variant="h4" color="success.main" gutterBottom>
              Application Submitted Successfully!
            </Typography>
            <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
              Thank you for your interest in this position. We have received your application and will review your CV.
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
              Our HR team will contact you within 3-5 business days if your profile matches our requirements.
            </Typography>
            <Button
              variant="contained"
              onClick={() => navigate('/')}
              sx={{ mr: 2 }}
            >
              Go to Home
            </Button>
            <Button
              variant="outlined"
              onClick={() => printTovusElement('.tv-application-confirmation', { title: 'Application Confirmation' })}
            >
              Print Confirmation
            </Button>
          </Box>
        );

      default:
        return null;
    }
  };

  if (!jobPosting) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress />
          <Typography variant="h6" sx={{ mt: 2 }}>
            Loading job details...
          </Typography>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Card elevation={3}>
        <CardContent>
          {/* Header */}
          <Box sx={{ mb: 4, textAlign: 'center' }}>
            <Typography variant="h4" color="primary" gutterBottom>
              Easy Apply
            </Typography>
            <Typography variant="body1" color="textSecondary">
              Quick application process for {jobPosting.title}
            </Typography>
          </Box>

          {/* Stepper */}
          <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {/* Step Content */}
          <Box sx={{ mb: 4 }}>
            <Formik
              initialValues={{
                firstName: '',
                lastName: '',
                email: '',
                phone: '',
                currentPosition: '',
                yearsOfExperience: '',
                expectedSalary: '',
                noticePeriod: '',
                availability: '',
                howDidYouHear: '',
                cvFile: null
              }}
              validationSchema={easyApplyValidationSchema}
              onSubmit={handleSubmit}
            >
              {({ values, setFieldValue, errors, touched, isSubmitting }) => (
                <Form>
                  {renderStepContent(activeStep, values, setFieldValue, errors, touched)}
                  
                  {/* Navigation Buttons */}
                  {activeStep < 4 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
                      <Button
                        disabled={activeStep === 0}
                        onClick={handleBack}
                        startIcon={<ArrowBack />}
                      >
                        Back
                      </Button>
                      
                      {activeStep === steps.length - 2 ? (
                        <Button
                          type="submit"
                          variant="contained"
                          disabled={loading || isSubmitting}
                          startIcon={loading ? <CircularProgress size={20} /> : <Save />}
                        >
                          {loading ? 'Submitting...' : 'Submit Application'}
                        </Button>
                      ) : (
                        <Button
                          variant="contained"
                          onClick={handleNext}
                          disabled={activeStep === steps.length - 1}
                        >
                          Next
                        </Button>
                      )}
                    </Box>
                  )}
                </Form>
              )}
            </Formik>
          </Box>
        </CardContent>
      </Card>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default EasyApplyForm;
