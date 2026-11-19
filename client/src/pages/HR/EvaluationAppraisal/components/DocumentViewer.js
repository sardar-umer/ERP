import React, { useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Grid,
  Divider,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  Close as CloseIcon,
  Print as PrintIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  History as HistoryIcon,
  CheckCircle as CheckCircleIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import dayjs from 'dayjs';
import MarksDescriptionSection from './MarksDescriptionSection';
import {
  evaluationCategories,
  whiteCollarProfessionalAttributes,
  whiteCollarPersonalAttributes,
  overallResultOptions
} from '../constants';
import { printTovusElement } from '../../../../utils/tovusPrintBrand';

// Read-only evaluation table component
const ReadOnlyEvaluationTable = ({ categories, scores, subTotalMarks = 50, showDescription = false }) => {
  const calculateSubTotal = () => {
    if (!scores) return 0;
    return Object.values(scores).reduce((sum, item) => {
      return sum + (parseInt(item?.score) || 0);
    }, 0);
  };

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow sx={{ bgcolor: 'primary.main' }}>
            <TableCell sx={{ color: 'white', fontWeight: 600, minWidth: showDescription ? 200 : 'auto' }}>
              Category
            </TableCell>
            <TableCell align="center" sx={{ color: 'white', fontWeight: 600 }}>
              Total {showDescription ? 'Score' : 'Marks'}
            </TableCell>
            <TableCell align="center" sx={{ color: 'white', fontWeight: 600 }}>1</TableCell>
            <TableCell align="center" sx={{ color: 'white', fontWeight: 600 }}>2</TableCell>
            <TableCell align="center" sx={{ color: 'white', fontWeight: 600 }}>3</TableCell>
            <TableCell align="center" sx={{ color: 'white', fontWeight: 600 }}>4</TableCell>
            <TableCell align="center" sx={{ color: 'white', fontWeight: 600 }}>5</TableCell>
            <TableCell sx={{ color: 'white', fontWeight: 600 }}>Comments</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {categories.map((category) => {
            const score = scores?.[category.name]?.score || '';
            return (
              <TableRow key={category.name} hover>
                <TableCell>
                  {showDescription && category.description ? (
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {category.name}:
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        {category.description}
                      </Typography>
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {category.name}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">{category.totalMarks}</TableCell>
                {[1, 2, 3, 4, 5].map((mark) => (
                  <TableCell align="center" key={mark}>
                    {score === mark.toString() ? '✓' : ''}
                  </TableCell>
                ))}
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {scores?.[category.name]?.comments || '-'}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow sx={{ bgcolor: 'grey.100', fontWeight: 700 }}>
            <TableCell sx={{ fontWeight: 700 }}>Total Score</TableCell>
            <TableCell align="center" sx={{ fontWeight: 700 }}>{subTotalMarks}</TableCell>
            <TableCell colSpan={6} align="right" sx={{ fontWeight: 700 }}>
              <Typography variant="body2">
                Obtained: <strong>{calculateSubTotal()}</strong> / {subTotalMarks}
              </Typography>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const DocumentViewer = ({ open, document, onClose, canEdit = false, onDocumentUpdate, assignedApprovalLevels = [] }) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Check if user can edit this document (all levels 0-4)
  // Must call hooks before any early returns
  const canEditDocument = useMemo(() => {
    // If no document, can't edit
    if (!document) return false;
    
    // If canEdit prop is explicitly set, use it
    if (canEdit) return true;
    
    // Check if document is at Level 0 and user is a Level 0 approver
    const isLevel0 = document.currentApprovalLevel === 0 || 
                     (document.level0ApprovalStatus === 'pending' && document.status === 'submitted');
    
    if (isLevel0 && user && document.level0Approvers && document.level0Approvers.length > 0) {
      // Check if current user is in the level0Approvers array
      const currentUserId = user._id?.toString() || user.id?.toString();
      
      const userInApprovers = document.level0Approvers.some(approver => {
        // Handle both populated User object and ObjectId
        let approverUserId = null;
        if (approver.assignedUser) {
          if (typeof approver.assignedUser === 'object') {
            // Could be populated User object or ObjectId wrapped in object
            if (approver.assignedUser._id) {
              approverUserId = approver.assignedUser._id.toString();
            } else if (approver.assignedUser.id) {
              approverUserId = approver.assignedUser.id.toString();
            } else if (approver.assignedUser.toString) {
              // ObjectId with toString method
              approverUserId = approver.assignedUser.toString();
            }
          } else {
            // String ObjectId
            approverUserId = approver.assignedUser.toString();
          }
        }
        
        return approverUserId && currentUserId && approverUserId === currentUserId;
      });
      
      return userInApprovers;
    }
    
    // Check if document is at Level 1-4 and user is assigned to that level
    if (document.currentApprovalLevel >= 1 && document.currentApprovalLevel <= 4) {
      if (assignedApprovalLevels.includes(document.currentApprovalLevel)) {
        return true;
      }
    }
    
    return false;
  }, [document, user, canEdit, assignedApprovalLevels]);
  
  if (!document) return null;

  const handleEdit = () => {
    // Navigate to edit form (same route used for Level 0 editing)
    navigate(`/hr/evaluation-appraisal/edit/${document._id}`);
    onClose();
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: 'default',
      sent: 'info',
      in_progress: 'warning',
      submitted: 'primary',
      completed: 'success',
      archived: 'secondary'
    };
    return colors[status] || 'default';
  };

  const getStatusLabel = (status) => {
    return status.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const isBlueCollar = document.formType === 'blue_collar';

  const handlePrint = () => {
    printTovusElement('.MuiDialog-root .MuiDialogContent-root', {
      title: 'Evaluation Document',
      docRef: [document.employee?.firstName, document.employee?.lastName].filter(Boolean).join(' ') || undefined
    });
  };

  const handleDownload = () => {
    // TODO: Implement download functionality
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { minHeight: '80vh' }
      }}
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">
            Evaluation Document - {document.employee?.firstName} {document.employee?.lastName}
          </Typography>
          <Box display="flex" gap={1}>
            <Chip
              label={getStatusLabel(document.status)}
              size="small"
              color={getStatusColor(document.status)}
            />
            {canEditDocument && (
              <Button
                startIcon={<EditIcon />}
                onClick={handleEdit}
                size="small"
                variant="contained"
                color="primary"
              >
                Edit
              </Button>
            )}
            <Button
              startIcon={<PrintIcon />}
              onClick={handlePrint}
              size="small"
            >
              Print
            </Button>
            <Button
              startIcon={<DownloadIcon />}
              onClick={handleDownload}
              size="small"
            >
              Download
            </Button>
            <Button
              onClick={onClose}
              size="small"
            >
              <CloseIcon />
            </Button>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Paper sx={{ p: 3 }}>
          {/* Employee Information */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
              Employee Information
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <Typography variant="body2" color="text.secondary">Code</Typography>
                <Typography variant="body1">{document.code || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} md={3}>
                <Typography variant="body2" color="text.secondary">Date</Typography>
                <Typography variant="body1">
                  {document.date ? dayjs(document.date).format('YYYY-MM-DD') : 'N/A'}
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Name</Typography>
                <Typography variant="body1">{document.name || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Review Period</Typography>
                <Typography variant="body1">
                  {document.reviewPeriodFrom && document.reviewPeriodTo
                    ? `${dayjs(document.reviewPeriodFrom).format('DD MMM YYYY')} to ${dayjs(document.reviewPeriodTo).format('DD MMM YYYY')}`
                    : 'N/A'}
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Designation</Typography>
                <Typography variant="body1">{document.designation || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Department/Section</Typography>
                <Typography variant="body1">{document.department?.name || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">Immediate Boss / Evaluator</Typography>
                <Typography variant="body1">{document.immediateBoss || 'N/A'}</Typography>
              </Grid>
              {document.appraisalHistory && (
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary">Appraisal History</Typography>
                  <Typography variant="body1">{document.appraisalHistory}</Typography>
                </Grid>
              )}
            </Grid>
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Marks Description */}
          <MarksDescriptionSection />

          <Divider sx={{ my: 3 }} />

          {/* Overall Result */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main' }}>
              OVERALL RESULT (Description)
            </Typography>
            <Box display="flex" gap={2} flexWrap="wrap">
              {overallResultOptions.map((option) => (
                <Chip
                  key={option.value}
                  label={`${option.label} (${option.percentage})`}
                  color={document.overallResult === option.value ? 'primary' : 'default'}
                  variant={document.overallResult === option.value ? 'filled' : 'outlined'}
                />
              ))}
            </Box>
            {document.totalScore !== undefined && document.percentage !== undefined && (
              <Box mt={2}>
                <Typography variant="body2" color="text.secondary">
                  Total Score: <strong>{document.totalScore}</strong> | Percentage: <strong>{document.percentage}%</strong>
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Evaluation Table */}
          {isBlueCollar ? (
            <ReadOnlyEvaluationTable
              categories={evaluationCategories}
              scores={document.evaluationScores || {}}
              subTotalMarks={50}
            />
          ) : (
            <>
              <Typography variant="h6" gutterBottom>
                Professional Attributes
              </Typography>
              <ReadOnlyEvaluationTable
                categories={whiteCollarProfessionalAttributes}
                scores={document.whiteCollarProfessionalScores || {}}
                subTotalMarks={50}
                showDescription
              />
              <Box mt={3}>
                <Typography variant="h6" gutterBottom>
                  Personal Attributes
                </Typography>
                <ReadOnlyEvaluationTable
                  categories={whiteCollarPersonalAttributes}
                  scores={document.whiteCollarPersonalScores || {}}
                  subTotalMarks={50}
                  showDescription
                />
              </Box>
            </>
          )}

          <Divider sx={{ my: 3 }} />

          {/* Comments Section */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" gutterBottom>
                Strength
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {document.strength || 'N/A'}
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" gutterBottom>
                Weakness
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {document.weakness || 'N/A'}
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" gutterBottom>
                Other Comments
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {document.otherComments || 'N/A'}
              </Typography>
            </Grid>
          </Grid>

          {/* White Collar Additional Fields */}
          {!isBlueCollar && (
            <>
              <Divider sx={{ my: 3 }} />
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" gutterBottom>
                    Reporting Officer Comments
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {document.reportingOfficerComments || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" gutterBottom>
                    Counter Signing Officer Comments
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {document.counterSigningOfficerComments || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" gutterBottom>
                    Development Plan
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {document.developmentPlan || 'N/A'}
                  </Typography>
                </Grid>
              </Grid>
            </>
          )}

          {/* Approval History */}
          {(document.evaluator || 
            (document.level0Approvers && document.level0Approvers.some(a => a.status === 'approved')) || 
            (document.approvalLevels && document.approvalLevels.some(l => l.status === 'approved'))) && (
            <>
              <Divider sx={{ my: 3 }} />
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'success.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckCircleIcon fontSize="small" />
                  Approval History
                </Typography>
                <Box sx={{ pl: 2 }}>
                  {/* Submitter (Evaluator) */}
                  {document.evaluator && document.submittedAt && (
                    <Box sx={{ mb: 2, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <CheckCircleIcon sx={{ fontSize: 16, color: 'info.main' }} />
                        <Typography variant="body2" fontWeight={600}>
                          Submitted by: {document.evaluator.firstName} {document.evaluator.lastName}
                          {document.evaluator.placementDesignation?.title && ` (${document.evaluator.placementDesignation.title})`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          - {dayjs(document.submittedAt).format('DD MMM YYYY, HH:mm')}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  
                  {/* Level 0 Approvals */}
                  {document.level0Approvers && document.level0Approvers
                    .filter(approver => approver.status === 'approved')
                    .map((approver, index) => (
                      <Box key={`level0-${index}`} sx={{ mb: 2, pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                          <Typography variant="body2" fontWeight={600}>
                            Level 0: {approver.approverName || 'Unknown'}
                          </Typography>
                          {approver.approvedAt && (
                            <Typography variant="caption" color="text.secondary">
                              - {dayjs(approver.approvedAt).format('DD MMM YYYY, HH:mm')}
                            </Typography>
                          )}
                        </Box>
                        {approver.comments && (
                          <Typography variant="body2" color="text.secondary" sx={{ ml: 3, fontStyle: 'italic' }}>
                            {approver.comments}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  
                  {/* Level 1-4 Approvals */}
                  {document.approvalLevels && document.approvalLevels
                    .filter(level => level.status === 'approved')
                    .map((level, index) => (
                      <Box key={`level-${level.level}`} sx={{ mb: 2, pb: 2, borderBottom: index < document.approvalLevels.filter(l => l.status === 'approved').length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                          <Typography variant="body2" fontWeight={600}>
                            Level {level.level}: {level.approverName || level.title || 'Unknown'}
                          </Typography>
                          {level.approvedAt && (
                            <Typography variant="caption" color="text.secondary">
                              - {dayjs(level.approvedAt).format('DD MMM YYYY, HH:mm')}
                            </Typography>
                          )}
                        </Box>
                        {level.comments && (
                          <Typography variant="body2" color="text.secondary" sx={{ ml: 3, fontStyle: 'italic' }}>
                            {level.comments}
                          </Typography>
                        )}
                      </Box>
                    ))}
                </Box>
              </Box>
            </>
          )}

          {/* Edit History */}
          {document.editHistory && document.editHistory.length > 0 && (
            <>
              <Divider sx={{ my: 3 }} />
              <Box sx={{ mb: 4 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'primary.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HistoryIcon fontSize="small" />
                  Edit History
                </Typography>
                <Box sx={{ pl: 2 }}>
                  {document.editHistory.map((edit, index) => (
                    <Box key={index} sx={{ mb: 2, pb: 2, borderBottom: index < document.editHistory.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        {edit.level !== null && edit.level !== undefined && (
                          <Chip label={`Level ${edit.level}`} size="small" color="warning" variant="outlined" />
                        )}
                        <Typography variant="caption" color="text.secondary">
                          {dayjs(edit.editedAt).format('DD MMM YYYY, HH:mm')}
                        </Typography>
                      </Box>
                      {edit.changes && (
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 2, mb: 1, fontStyle: 'italic' }}>
                          {edit.changes}
                        </Typography>
                      )}
                      {/* Show detailed mark changes if available */}
                      {edit.previousData && edit.newData && (
                        <Box sx={{ ml: 2, mt: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                            Detailed Changes:
                          </Typography>
                          {edit.previousData.totalScore !== edit.newData.totalScore && (
                            <Typography variant="caption" sx={{ display: 'block' }}>
                              <strong>Total Score:</strong> {edit.previousData.totalScore || 0} → {edit.newData.totalScore || 0}
                            </Typography>
                          )}
                          {edit.previousData.percentage !== edit.newData.percentage && (
                            <Typography variant="caption" sx={{ display: 'block' }}>
                              <strong>Percentage:</strong> {edit.previousData.percentage || 0}% → {edit.newData.percentage || 0}%
                            </Typography>
                          )}
                          {edit.previousData.overallResult !== edit.newData.overallResult && (
                            <Typography variant="caption" sx={{ display: 'block' }}>
                              <strong>Overall Result:</strong> {edit.previousData.overallResult || 'N/A'} → {edit.newData.overallResult || 'N/A'}
                            </Typography>
                          )}
                          {/* Show score changes for Blue Collar */}
                          {document.formType === 'blue_collar' && edit.previousData.evaluationScores && edit.newData.evaluationScores && (
                            <Box sx={{ mt: 1 }}>
                              <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                                Score Changes:
                              </Typography>
                              {Object.keys(edit.newData.evaluationScores).map(key => {
                                const oldScore = edit.previousData.evaluationScores[key]?.score || 0;
                                const newScore = edit.newData.evaluationScores[key]?.score || 0;
                                if (oldScore !== newScore) {
                                  return (
                                    <Typography key={key} variant="caption" sx={{ display: 'block', ml: 1 }}>
                                      • {key}: {oldScore} → {newScore}
                                    </Typography>
                                  );
                                }
                                return null;
                              })}
                            </Box>
                          )}
                          {/* Show score changes for White Collar */}
                          {document.formType === 'white_collar' && (
                            <>
                              {edit.previousData.whiteCollarProfessionalScores && edit.newData.whiteCollarProfessionalScores && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                                    Professional Score Changes:
                                  </Typography>
                                  {Object.keys(edit.newData.whiteCollarProfessionalScores).map(key => {
                                    const oldScore = edit.previousData.whiteCollarProfessionalScores[key]?.score || 0;
                                    const newScore = edit.newData.whiteCollarProfessionalScores[key]?.score || 0;
                                    if (oldScore !== newScore) {
                                      return (
                                        <Typography key={key} variant="caption" sx={{ display: 'block', ml: 1 }}>
                                          • {key}: {oldScore} → {newScore}
                                        </Typography>
                                      );
                                    }
                                    return null;
                                  })}
                                </Box>
                              )}
                              {edit.previousData.whiteCollarPersonalScores && edit.newData.whiteCollarPersonalScores && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                                    Personal Score Changes:
                                  </Typography>
                                  {Object.keys(edit.newData.whiteCollarPersonalScores).map(key => {
                                    const oldScore = edit.previousData.whiteCollarPersonalScores[key]?.score || 0;
                                    const newScore = edit.newData.whiteCollarPersonalScores[key]?.score || 0;
                                    if (oldScore !== newScore) {
                                      return (
                                        <Typography key={key} variant="caption" sx={{ display: 'block', ml: 1 }}>
                                          • {key}: {oldScore} → {newScore}
                                        </Typography>
                                      );
                                    }
                                    return null;
                                  })}
                                </Box>
                              )}
                            </>
                          )}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
            </>
          )}
        </Paper>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DocumentViewer;
