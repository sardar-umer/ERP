import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Divider,
  Alert,
  Tabs,
  Tab
} from '@mui/material';
import {
  Save as SaveIcon,
  Print as PrintIcon,
  Download as DownloadIcon
} from '@mui/icons-material';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import dayjs from 'dayjs';
import EmployeeInfoSection from './components/EmployeeInfoSection';
import MarksDescriptionSection from './components/MarksDescriptionSection';
import OverallResultSection from './components/OverallResultSection';
import EvaluationTable from './components/EvaluationTable';
import {
  evaluationCategories,
  whiteCollarProfessionalAttributes,
  whiteCollarPersonalAttributes,
  initializeScores
} from './constants';
import { printTovusElement } from '../../../utils/tovusPrintBrand';


const validationSchema = Yup.object({
  code: Yup.string().required('Code is required'),
  date: Yup.date().required('Date is required'),
  name: Yup.string().required('Name is required'),
  reviewPeriodFrom: Yup.date().required('Review period start date is required'),
  reviewPeriodTo: Yup.date().required('Review period end date is required'),
  designation: Yup.string().required('Designation is required'),
  department: Yup.string().required('Department/Section is required'),
  immediateBoss: Yup.string().required('Immediate Boss/Evaluator is required'),
  appraisalHistory: Yup.string(),
  overallResult: Yup.string().required('Overall result is required'),
  strength: Yup.string(),
  weakness: Yup.string(),
  otherComments: Yup.string(),
  evaluationScores: Yup.object()
});

const EvaluationDocuments = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');

  const formik = useFormik({
    initialValues: {
      code: '',
      date: dayjs().format('YYYY-MM-DD'),
      name: '',
      reviewPeriodFrom: '2023-01-01',
      reviewPeriodTo: '2023-12-31',
      designation: '',
      department: '',
      immediateBoss: '',
      appraisalHistory: '',
      overallResult: '',
      strength: '',
      weakness: '',
      otherComments: '',
      evaluationScores: initializeScores(evaluationCategories),
      // White Collar specific fields
      whiteCollarProfessionalScores: initializeScores(whiteCollarProfessionalAttributes),
      whiteCollarPersonalScores: initializeScores(whiteCollarPersonalAttributes),
      reportingOfficerComments: '',
      reportingOfficerName: '',
      reportingOfficerDate: '',
      counterSigningOfficerComments: '',
      counterSigningOfficerName: '',
      counterSigningOfficerDate: '',
      developmentPlan: '',
      recommendedByHOD: '',
      recommendedByHR: '',
      developmentPlanObjectives: [{ objective: '', who: '', when: '', where: '' }],
      developmentPlanResult: '',
      employeeSignature: '',
      employeeSignatureDate: '',
      headOfHRSignature: '',
      headOfHRDate: ''
    },
    validationSchema,
    onSubmit: async (values) => {
      try {
        let totalObtainedScore, totalScore, percentage;
        
        if (activeTab === 0) {
          // Blue Collar: 50 total marks
          totalObtainedScore = Object.values(values.evaluationScores).reduce((sum, item) => {
            return sum + (parseInt(item.score) || 0);
          }, 0);
          totalScore = 50;
          percentage = (totalObtainedScore / totalScore) * 100;
        } else {
          // White Collar: 100 total marks (50 professional + 50 personal)
          const professionalScore = Object.values(values.whiteCollarProfessionalScores).reduce((sum, item) => {
            return sum + (parseInt(item.score) || 0);
          }, 0);
          const personalScore = Object.values(values.whiteCollarPersonalScores).reduce((sum, item) => {
            return sum + (parseInt(item.score) || 0);
          }, 0);
          totalObtainedScore = professionalScore + personalScore;
          totalScore = 100;
          percentage = (totalObtainedScore / totalScore) * 100;
        }

        const formData = {
          ...values,
          totalObtainedScore,
          totalScore,
          percentage,
          formType: activeTab === 0 ? 'blue_collar' : 'white_collar'
        };

        setSuccessMessage('Evaluation form saved successfully!');
        
        // TODO: Save to backend
        setTimeout(() => setSuccessMessage(''), 3000);
      } catch (error) {
        console.error('Error saving form:', error);
      }
    }
  });

  const calculateTotalScore = useCallback(() => {
    if (activeTab === 0) {
      const scores = formik.values.evaluationScores || {};
      return Object.values(scores).reduce((sum, item) => sum + (parseInt(item?.score) || 0), 0);
    } else {
      const professionalScores = formik.values.whiteCollarProfessionalScores || {};
      const personalScores = formik.values.whiteCollarPersonalScores || {};
      const professionalScore = Object.values(professionalScores).reduce((sum, item) => sum + (parseInt(item?.score) || 0), 0);
      const personalScore = Object.values(personalScores).reduce((sum, item) => sum + (parseInt(item?.score) || 0), 0);
      return professionalScore + personalScore;
    }
  }, [activeTab, formik.values.evaluationScores, formik.values.whiteCollarProfessionalScores, formik.values.whiteCollarPersonalScores]);

  const totalScore = useMemo(() => calculateTotalScore(), [calculateTotalScore]);
  const totalPossibleScore = activeTab === 0 ? 50 : 100;
  const percentage = useMemo(() => totalScore > 0 ? ((totalScore / totalPossibleScore) * 100).toFixed(2) : 0, [totalScore, totalPossibleScore]);

  const handlePrint = useCallback(() => {
    // Tovus-branded print of the evaluation form (screen title row + buttons are left out)
    printTovusElement('.tv-evaluation-doc', {
      title: 'Evaluation & Appraisal',
      strip: [':scope > .MuiBox-root:first-child']
    });
  }, []);

  const handleDownload = useCallback(() => {
    // TODO: Implement PDF download
  }, []);

  // Handlers for evaluation table
  const handleScoreChange = useCallback((fieldPath, categoryName, value) => {
    if (!formik.values[fieldPath]) {
      formik.setFieldValue(fieldPath, {});
    }
    formik.setFieldValue(`${fieldPath}.${categoryName}.score`, value);
  }, [formik]);

  const handleCommentChange = useCallback((fieldPath, categoryName, value) => {
    if (!formik.values[fieldPath]) {
      formik.setFieldValue(fieldPath, {});
    }
    formik.setFieldValue(`${fieldPath}.${categoryName}.comments`, value);
  }, [formik]);

  const handleObjectiveChange = useCallback((index, field, value) => {
    const newObjectives = [...formik.values.developmentPlanObjectives];
    newObjectives[index][field] = value;
    formik.setFieldValue('developmentPlanObjectives', newObjectives);
  }, [formik]);

  const handleAddObjective = useCallback(() => {
    formik.setFieldValue('developmentPlanObjectives', [
      ...formik.values.developmentPlanObjectives,
      { objective: '', who: '', when: '', where: '' }
    ]);
  }, [formik]);

  return (
    <Box className="tv-evaluation-doc" sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Evaluation & Appraisal - Documents
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={handlePrint}
            sx={{ mr: 1 }}
          >
            Print
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
            sx={{ mr: 1 }}
          >
            Download
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={formik.handleSubmit}
          >
            Save
          </Button>
        </Box>
      </Box>

      {successMessage && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMessage('')}>
          {successMessage}
        </Alert>
      )}

      <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)} sx={{ mb: 3 }}>
        <Tab label="Blue Collar" />
        <Tab label="White Collar" />
      </Tabs>

      {activeTab === 0 && (
        <Card sx={{ boxShadow: 3 }}>
          <CardContent sx={{ p: 4 }}>
            <form onSubmit={formik.handleSubmit}>
              {/* Header */}
              <Box sx={{ textAlign: 'center', mb: 4 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
                  BLUE COLLAR EMPLOYEE EVALUATION FORM
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Employee Performance Appraisal
                </Typography>
              </Box>

              <Divider sx={{ mb: 3 }} />

              <EmployeeInfoSection formik={formik} />
              <Divider sx={{ my: 3 }} />
              <MarksDescriptionSection />
              <Divider sx={{ my: 3 }} />
              <OverallResultSection formik={formik} />
              <Divider sx={{ my: 3 }} />
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
                  Measurement of Evaluation Standards
                </Typography>
                <EvaluationTable
                  categories={evaluationCategories}
                  scores={formik.values.evaluationScores}
                  onScoreChange={(cat, val) => handleScoreChange('evaluationScores', cat, val)}
                  onCommentChange={(cat, val) => handleCommentChange('evaluationScores', cat, val)}
                  subTotalLabel="Total Score"
                  subTotalMarks={50}
                />
                <Box sx={{ mt: 2, textAlign: 'right' }}>
                  <Typography variant="body2">
                    Obtained Score: <strong>{totalScore}</strong> | Percentage: <strong>{percentage}%</strong>
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    Formula: ({totalScore} / 50) × 100 = {percentage}%
                  </Typography>
                </Box>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Strength, Weakness, Other Comments */}
              <Grid container spacing={2} sx={{ mb: 4 }}>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Strength"
                    name="strength"
                    value={formik.values.strength}
                    onChange={formik.handleChange}
                    multiline
                    rows={4}
                    placeholder="List employee strengths..."
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Weakness"
                    name="weakness"
                    value={formik.values.weakness}
                    onChange={formik.handleChange}
                    multiline
                    rows={4}
                    placeholder="List areas for improvement..."
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Other Comments"
                    name="otherComments"
                    value={formik.values.otherComments}
                    onChange={formik.handleChange}
                    multiline
                    rows={4}
                    placeholder="Additional comments..."
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 3 }} />

              {/* Signature Section */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 3, fontWeight: 600, color: 'primary.main' }}>
                  Signatures
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}>
                      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                        Employee Name & Signature
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="Employee Name"
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        fullWidth
                        type="date"
                        label="Date"
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}>
                      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                        HOD
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="HOD Name"
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        fullWidth
                        type="date"
                        label="Date"
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}>
                      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                        HOD HR
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="HOD HR Name"
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        fullWidth
                        type="date"
                        label="Date"
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                </Grid>
              </Box>
            </form>
          </CardContent>
        </Card>
      )}

      {activeTab === 1 && (
        <Card sx={{ boxShadow: 3 }}>
          <CardContent sx={{ p: 4 }}>
            <form onSubmit={formik.handleSubmit}>
              {/* Header */}
              <Box sx={{ textAlign: 'center', mb: 4 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1, color: 'primary.main' }}>
                  WHITE COLLAR EMPLOYEE EVALUATION FORM
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  Employee Performance Appraisal
                </Typography>
              </Box>

              <Divider sx={{ mb: 3 }} />

              {/* Employee Information Section */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
                  Employee Information
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={3}>
                    <TextField
                      fullWidth
                      label="Code"
                      name="code"
                      value={formik.values.code}
                      onChange={formik.handleChange}
                      error={formik.touched.code && Boolean(formik.errors.code)}
                      helperText={formik.touched.code && formik.errors.code}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <TextField
                      fullWidth
                      label="Date"
                      name="date"
                      type="date"
                      value={formik.values.date}
                      onChange={formik.handleChange}
                      error={formik.touched.date && Boolean(formik.errors.date)}
                      helperText={formik.touched.date && formik.errors.date}
                      InputLabelProps={{ shrink: true }}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Name"
                      name="name"
                      value={formik.values.name}
                      onChange={formik.handleChange}
                      error={formik.touched.name && Boolean(formik.errors.name)}
                      helperText={formik.touched.name && formik.errors.name}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField
                        fullWidth
                        label="Review Period From"
                        name="reviewPeriodFrom"
                        type="date"
                        value={formik.values.reviewPeriodFrom}
                        onChange={formik.handleChange}
                        error={formik.touched.reviewPeriodFrom && Boolean(formik.errors.reviewPeriodFrom)}
                        helperText={formik.touched.reviewPeriodFrom && formik.errors.reviewPeriodFrom}
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                      <Typography variant="body2" sx={{ mt: 1 }}>to</Typography>
                      <TextField
                        fullWidth
                        label="Review Period To"
                        name="reviewPeriodTo"
                        type="date"
                        value={formik.values.reviewPeriodTo}
                        onChange={formik.handleChange}
                        error={formik.touched.reviewPeriodTo && Boolean(formik.errors.reviewPeriodTo)}
                        helperText={formik.touched.reviewPeriodTo && formik.errors.reviewPeriodTo}
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Designation"
                      name="designation"
                      value={formik.values.designation}
                      onChange={formik.handleChange}
                      error={formik.touched.designation && Boolean(formik.errors.designation)}
                      helperText={formik.touched.designation && formik.errors.designation}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Department/Section"
                      name="department"
                      value={formik.values.department}
                      onChange={formik.handleChange}
                      error={formik.touched.department && Boolean(formik.errors.department)}
                      helperText={formik.touched.department && formik.errors.department}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Immediate Boss / Evaluator"
                      name="immediateBoss"
                      value={formik.values.immediateBoss}
                      onChange={formik.handleChange}
                      error={formik.touched.immediateBoss && Boolean(formik.errors.immediateBoss)}
                      helperText={formik.touched.immediateBoss && formik.errors.immediateBoss}
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Appraisal History"
                      name="appraisalHistory"
                      value={formik.values.appraisalHistory}
                      onChange={formik.handleChange}
                      multiline
                      rows={2}
                      size="small"
                    />
                  </Grid>
                </Grid>
              </Box>

              <Divider sx={{ my: 3 }} />

              <MarksDescriptionSection />
              <Divider sx={{ my: 3 }} />
              <OverallResultSection formik={formik} />
              <Divider sx={{ my: 3 }} />
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
                  Professional Attributes
                </Typography>
                <EvaluationTable
                  categories={whiteCollarProfessionalAttributes}
                  scores={formik.values.whiteCollarProfessionalScores}
                  onScoreChange={(cat, val) => handleScoreChange('whiteCollarProfessionalScores', cat, val)}
                  onCommentChange={(cat, val) => handleCommentChange('whiteCollarProfessionalScores', cat, val)}
                  subTotalLabel="Sub Total"
                  subTotalMarks={50}
                />
              </Box>
              <Divider sx={{ my: 3 }} />
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
                  Personal Attributes
                </Typography>
                <EvaluationTable
                  categories={whiteCollarPersonalAttributes}
                  scores={formik.values.whiteCollarPersonalScores}
                  onScoreChange={(cat, val) => handleScoreChange('whiteCollarPersonalScores', cat, val)}
                  onCommentChange={(cat, val) => handleCommentChange('whiteCollarPersonalScores', cat, val)}
                  showDescription={true}
                  subTotalLabel="Sub Total"
                  subTotalMarks={50}
                />
                <Box sx={{ mt: 2, bgcolor: 'primary.main', p: 2, borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'white' }}>
                      TOTAL: <strong>{totalScore}</strong> / 100
                    </Typography>
                    <Typography variant="body2" sx={{ mx: 1, color: 'white' }}>
                      |
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'white' }}>
                      Percentage: <strong>{percentage}%</strong>
                    </Typography>
                    <Typography variant="body2" sx={{ ml: 2, color: 'white' }}>
                      Formula: ({totalScore} / 100) × 100 = {percentage}%
                    </Typography>
                  </Box>
                </Box>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Comments Sections */}
              <Box sx={{ mb: 4 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Comments Of Reporting Officer/Manager"
                      name="reportingOfficerComments"
                      value={formik.values.reportingOfficerComments}
                      onChange={formik.handleChange}
                      multiline
                      rows={3}
                      sx={{ mb: 2 }}
                    />
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <TextField
                        label="Name & Signature"
                        name="reportingOfficerName"
                        value={formik.values.reportingOfficerName}
                        onChange={formik.handleChange}
                        size="small"
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        type="date"
                        label="Date"
                        name="reportingOfficerDate"
                        value={formik.values.reportingOfficerDate}
                        onChange={formik.handleChange}
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Comments Of Counter signing Officer/Manager"
                      name="counterSigningOfficerComments"
                      value={formik.values.counterSigningOfficerComments}
                      onChange={formik.handleChange}
                      multiline
                      rows={3}
                      sx={{ mb: 2 }}
                    />
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <TextField
                        label="Name & Signature"
                        name="counterSigningOfficerName"
                        value={formik.values.counterSigningOfficerName}
                        onChange={formik.handleChange}
                        size="small"
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        type="date"
                        label="Date"
                        name="counterSigningOfficerDate"
                        value={formik.values.counterSigningOfficerDate}
                        onChange={formik.handleChange}
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                </Grid>
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Development Plan Section */}
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
                  DEVELOPMENT PLAN (If needed)
                </Typography>
                <TextField
                  fullWidth
                  label="Development Plan"
                  name="developmentPlan"
                  value={formik.values.developmentPlan}
                  onChange={formik.handleChange}
                  multiline
                  rows={3}
                  sx={{ mb: 3 }}
                />
                <Grid container spacing={2} sx={{ mb: 3 }}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Recommended BY HOD/Department Authority"
                      name="recommendedByHOD"
                      value={formik.values.recommendedByHOD}
                      onChange={formik.handleChange}
                      multiline
                      rows={2}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Recommended by HR"
                      name="recommendedByHR"
                      value={formik.values.recommendedByHR}
                      onChange={formik.handleChange}
                      multiline
                      rows={2}
                    />
                  </Grid>
                </Grid>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  APPROVED DEVELOPMENT PLAN
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table>
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'primary.main' }}>
                        <TableCell sx={{ color: 'white', fontWeight: 600 }}>OBJECTIVES</TableCell>
                        <TableCell sx={{ color: 'white', fontWeight: 600 }}>WHO</TableCell>
                        <TableCell sx={{ color: 'white', fontWeight: 600 }}>WHEN</TableCell>
                        <TableCell sx={{ color: 'white', fontWeight: 600 }}>WHERE</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {formik.values.developmentPlanObjectives.map((obj, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <TextField
                              fullWidth
                              size="small"
                              value={obj.objective}
                              onChange={(e) => handleObjectiveChange(index, 'objective', e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              fullWidth
                              size="small"
                              value={obj.who}
                              onChange={(e) => handleObjectiveChange(index, 'who', e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              fullWidth
                              size="small"
                              value={obj.when}
                              onChange={(e) => handleObjectiveChange(index, 'when', e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              fullWidth
                              size="small"
                              value={obj.where}
                              onChange={(e) => handleObjectiveChange(index, 'where', e.target.value)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleAddObjective}
                  sx={{ mt: 1 }}
                >
                  Add Objective
                </Button>
                <TextField
                  fullWidth
                  label="Result/OUTPUT of Development Plan (HR Coordination with HOD & EMPLOYEE)"
                  name="developmentPlanResult"
                  value={formik.values.developmentPlanResult}
                  onChange={formik.handleChange}
                  multiline
                  rows={3}
                  sx={{ mt: 3 }}
                />
              </Box>

              <Divider sx={{ my: 3 }} />

              {/* Final Signatures */}
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 3, fontWeight: 600, color: 'primary.main' }}>
                  Signatures
                </Typography>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}>
                      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                        Employee Name & Signature
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="Employee Name"
                        name="employeeSignature"
                        value={formik.values.employeeSignature}
                        onChange={formik.handleChange}
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        fullWidth
                        type="date"
                        label="Date"
                        name="employeeSignatureDate"
                        value={formik.values.employeeSignatureDate}
                        onChange={formik.handleChange}
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}>
                      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                        Head of HR
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="Head of HR Name"
                        name="headOfHRSignature"
                        value={formik.values.headOfHRSignature}
                        onChange={formik.handleChange}
                        sx={{ mb: 1 }}
                      />
                      <TextField
                        fullWidth
                        type="date"
                        label="Date"
                        name="headOfHRDate"
                        value={formik.values.headOfHRDate}
                        onChange={formik.handleChange}
                        InputLabelProps={{ shrink: true }}
                        size="small"
                      />
                    </Box>
                  </Grid>
                </Grid>
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    By signing this form, Employee confirms that he/she has discussed his/her yearly performance evaluation in detail with his/her immediate boss.
                  </Typography>
                </Alert>
              </Box>
            </form>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default EvaluationDocuments;

