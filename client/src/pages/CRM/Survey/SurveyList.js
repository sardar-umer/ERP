import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  Analytics as AnalyticsIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PlayArrow as RespondIcon,
  Refresh as RefreshIcon,
  Send as SendIcon,
  HowToVote as PollIcon,
  Groups as ResponsesIcon,
  Summarize as ReportIcon
} from '@mui/icons-material';
import surveyService from '../../../services/surveyService';
import SurveyAnalysisReportDialog from './SurveyAnalysisReportDialog';
import useClientPagination from '../../../hooks/useClientPagination';

const statusColor = {
  draft: 'default',
  active: 'success',
  closed: 'warning'
};

const userLabel = (user) => {
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return name ? `${name} (${user.email})` : user?.email || 'User';
};

const SurveyList = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMineView = location.pathname.endsWith('/mine');

  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [managed, setManaged] = useState([]);
  const [mine, setMine] = useState([]);

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendSurvey, setSendSurvey] = useState(null);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [analysisSurvey, setAnalysisSurvey] = useState(null);

  const pageTitle = useMemo(
    () => (isMineView ? 'My Surveys' : 'Manage Surveys'),
    [isMineView]
  );

  const loadManaged = useCallback(async () => {
    if (isMineView) return;
    setLoading(true);
    try {
      const res = await surveyService.getSurveys({ search, limit: 100 });
      setManaged(res.data?.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load surveys');
    } finally {
      setLoading(false);
    }
  }, [search, isMineView]);

  const loadMine = useCallback(async () => {
    if (!isMineView) return;
    setLoading(true);
    try {
      const res = await surveyService.getMySurveys();
      setMine(res.data?.data || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load your surveys');
    } finally {
      setLoading(false);
    }
  }, [isMineView]);

  useEffect(() => {
    if (location.state?.message) {
      setSuccess(location.state.message);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  useEffect(() => {
    if (isMineView) {
      loadMine();
    } else {
      loadManaged();
    }
  }, [isMineView, loadManaged, loadMine]);

  const handleRefresh = () => {
    if (isMineView) loadMine();
    else loadManaged();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this survey and all responses?')) return;
    try {
      await surveyService.deleteSurvey(id);
      loadManaged();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete survey');
    }
  };

  const openSendDialog = async (survey) => {
    setSendSurvey(survey);
    setSendError('');
    setSelectedUsers(survey.targetUsers || []);
    setSendDialogOpen(true);

    try {
      const res = await surveyService.getAssignableUsers();
      setAssignableUsers(res.data?.data || []);
    } catch {
      setAssignableUsers([]);
      setSendError('Failed to load users');
    }
  };

  const closeSendDialog = () => {
    if (sending) return;
    setSendDialogOpen(false);
    setSendSurvey(null);
    setSelectedUsers([]);
    setSendError('');
  };

  const handleSendSurvey = async () => {
    if (!sendSurvey) return;
    if (!selectedUsers.length) {
      setSendError('Select at least one user');
      return;
    }

    setSending(true);
    setSendError('');
    try {
      await surveyService.publishSurvey(sendSurvey._id, {
        targetUsers: selectedUsers.map((u) => u._id || u)
      });
      setSuccess(
        `Complete survey sent to ${selectedUsers.length} user(s) — all ${sendSurvey.questions?.length || 0} questions`
      );
      closeSendDialog();
      loadManaged();
    } catch (err) {
      setSendError(err.response?.data?.message || 'Failed to send survey');
    } finally {
      setSending(false);
    }
  };

  const openAnalysisDialog = (survey) => {
    setAnalysisSurvey(survey);
    setAnalysisDialogOpen(true);
  };

  const closeAnalysisDialog = () => {
    setAnalysisDialogOpen(false);
    setAnalysisSurvey(null);
  };

  const handleAnalysisSaved = (isSent) => {
    if (isSent) {
      setSuccess('Survey Analysis Report sent to higher management.');
    } else {
      setSuccess('Survey Analysis Report saved.');
    }
    loadManaged();
  };

  const pg = useClientPagination(managed);
  const pg2 = useClientPagination(mine);
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>{pageTitle}</Typography>
          <Typography variant="body2" color="text.secondary">
            {isMineView
              ? 'Surveys assigned to you — respond and track completion'
              : 'Save surveys first, then send the complete survey to users from Actions'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshIcon />} onClick={handleRefresh}>
            Refresh
          </Button>
          {!isMineView && (
            <>
              <Button variant="outlined" startIcon={<PollIcon />} onClick={() => navigate('/crm/survey/poll/new')}>
                New poll
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/crm/survey/new')}>
                New survey
              </Button>
            </>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {!isMineView && (
        <>
          <TextField
            size="small"
            placeholder="Search surveys…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mb: 2, minWidth: 280 }}
          />
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Assigned</TableCell>
                  <TableCell align="right">Responses</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((survey) => (
                  <TableRow key={survey._id} hover>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap">
                        <Typography fontWeight={600}>{survey.title}</Typography>
                        {survey.kind === 'poll' && (
                          <Chip size="small" label="Poll" color="secondary" sx={{ fontWeight: 700, height: 20 }} />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {survey.kind === 'poll'
                          ? 'Quick poll · 1 question'
                          : `${survey.questions?.length || 0} questions · whole survey`}
                      </Typography>
                      {survey.targetUsers?.length > 0 && (
                        <Typography variant="caption" color="primary.main" display="block">
                          Assigned to {survey.targetUsers.length} user(s)
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={survey.status} color={statusColor[survey.status] || 'default'} />
                    </TableCell>
                    <TableCell align="right">{survey.assignedCount || 0}</TableCell>
                    <TableCell align="right">{survey.responseCount || 0}</TableCell>
                    <TableCell>{new Date(survey.updatedAt).toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={survey.kind === 'poll' ? 'Send poll to users' : 'Send complete survey to users'}>
                        <IconButton size="small" color="primary" onClick={() => openSendDialog(survey)}>
                          <SendIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Analytics">
                        <IconButton size="small" onClick={() => navigate(`/crm/survey/${survey._id}/analytics`)}>
                          <AnalyticsIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="View Responses">
                        <IconButton size="small" onClick={() => navigate(`/crm/survey/${survey._id}/analytics#responses`)}>
                          <ResponsesIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={survey.analysisReport?.isSentToManagement ? "View Analysis Report" : "Analysis Report"}>
                        <IconButton 
                          size="small" 
                          color={survey.analysisReport?.isSentToManagement ? "success" : "default"}
                          onClick={() => openAnalysisDialog(survey)}
                        >
                          <ReportIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => navigate(
                            survey.kind === 'poll'
                              ? `/crm/survey/poll/${survey._id}/edit`
                              : `/crm/survey/${survey._id}/edit`
                          )}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => handleDelete(survey._id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && managed.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      No surveys yet. Create your first survey.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>{pg.bar}
          </TableContainer>
        </>
      )}

      {isMineView && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Survey</TableCell>
                <TableCell>From</TableCell>
                <TableCell>Questions</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pg2.rows.map((survey) => (
                <TableRow key={survey._id} hover>
                  <TableCell>
                    <Typography fontWeight={600}>{survey.title}</Typography>
                    {survey.kind === 'poll' && (
                      <Chip size="small" label="Poll" color="secondary" sx={{ mt: 0.5, fontWeight: 700, height: 20 }} />
                    )}
                    {survey.description && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {survey.description}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" display="block">
                      {survey.kind === 'poll' ? 'Quick poll' : `Full survey · ${survey.questionCount || survey.questions?.length || 0} questions`}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {survey.createdBy
                      ? `${survey.createdBy.firstName || ''} ${survey.createdBy.lastName || ''}`.trim()
                      : '—'}
                  </TableCell>
                  <TableCell>{survey.questionCount || survey.questions?.length || 0}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={survey.hasResponded ? 'Completed' : 'Pending'}
                      color={survey.hasResponded ? 'success' : 'warning'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant={survey.hasResponded ? 'outlined' : 'contained'}
                      startIcon={survey.kind === 'poll' ? <PollIcon /> : <RespondIcon />}
                      onClick={() => navigate(`/crm/survey/${survey._id}/respond`)}
                    >
                      {survey.kind === 'poll'
                        ? (survey.hasResponded ? 'View results' : 'Vote')
                        : (survey.hasResponded ? 'View / resubmit' : 'Respond')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && mine.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    No surveys assigned to you yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>{pg2.bar}
        </TableContainer>
      )}

      <Dialog open={sendDialogOpen} onClose={closeSendDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{sendSurvey?.kind === 'poll' ? 'Send poll' : 'Send complete survey'}</DialogTitle>
        <DialogContent dividers>
          {sendSurvey && (
            <Stack spacing={2}>
              <Box>
                <Typography fontWeight={600}>{sendSurvey.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {sendSurvey.kind === 'poll'
                    ? 'Poll question will be sent to selected users in My Surveys.'
                    : `All ${sendSurvey.questions?.length || 0} questions will be sent to selected users in My Surveys.`}
                </Typography>
              </Box>

              {sendError && <Alert severity="error">{sendError}</Alert>}

              <Autocomplete
                multiple
                options={assignableUsers}
                isOptionEqualToValue={(option, value) => option._id === value._id}
                getOptionLabel={userLabel}
                value={selectedUsers}
                onChange={(_, value) => setSelectedUsers(value)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={option._id}
                      label={`${option.firstName || ''} ${option.lastName || ''}`.trim() || option.email}
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select users"
                    placeholder="Search users to assign whole survey"
                  />
                )}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeSendDialog} disabled={sending}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<SendIcon />}
            onClick={handleSendSurvey}
            disabled={sending || !selectedUsers.length}
          >
            Send to {selectedUsers.length || 0} user(s)
          </Button>
        </DialogActions>
      </Dialog>

      <SurveyAnalysisReportDialog
        open={analysisDialogOpen}
        survey={analysisSurvey}
        onClose={closeAnalysisDialog}
        onSaved={handleAnalysisSaved}
      />
    </Box>
  );
};

export default SurveyList;
