import React, { useRef, useState } from 'react';
import {
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  MenuItem,
  IconButton,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Stack,
  Chip
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  AttachFile as AttachFileIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import nonEmployeeService from '../../../services/nonEmployeeService';
import api from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { getImageUrl } from '../../../utils/imageService';
import toast from 'react-hot-toast';
import ResubmissionHistory from './ResubmissionHistory';

const emptyCandidate = () => ({
  name: '',
  cnic: '',
  designation: '',
  departmentSubject: '',
  project: '',
  location: '',
  currentPackageMonthly: '',
  tentativeDoj: '',
  remark: '',
  attachments: [],
  newFiles: []
});

/** Keep free-text DOJ; only ISO/Date values get a short calendar form for editing. */
const toDojInput = (value) => {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return '';
  // Pure ISO date from legacy Date fields → show YYYY-MM-DD; otherwise keep as typed
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return raw.slice(0, 10);
  }
  return raw;
};

const normalizeFromEdit = (emp = {}) => ({
  name: emp.name || [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim() || '',
  cnic: emp.cnic || '',
  designation: emp.designation || emp.role || '',
  departmentSubject: emp.departmentSubject || emp.department || '',
  project: emp.project || '',
  location: emp.location || '',
  currentPackageMonthly: emp.currentPackageMonthly ?? emp.expectedWages ?? '',
  tentativeDoj: toDojInput(emp.tentativeDoj),
  remark: emp.remark || emp.justification || '',
  attachments: Array.isArray(emp.attachments) ? emp.attachments : [],
  newFiles: []
});

const attachmentHref = (att) => getImageUrl(att?.url || att?.filename || '') || '#';

const NonEmployeeForm = ({
  open,
  onClose,
  onSuccess,
  editData = null,
  initialResubmitComment = '',
  initialObservationResponses = {}
}) => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState([emptyCandidate()]);
  const [approvers, setApprovers] = useState({
    assignedHod: '',
    assignedSrDirector: '',
    assignedAvp: '',
    assignedChairman: ''
  });
  const isResubmit = Boolean(
    editData && ['Returned', 'Rejected by CEO', 'Draft'].includes(editData.workflowStatus)
  );
  // Returned/rejected records need the initiator's reply on the observations
  const needsResubmitComment = Boolean(
    editData && ['Returned', 'Rejected by CEO'].includes(editData.workflowStatus)
  );
  const [resubmitComment, setResubmitComment] = useState('');
  const [observationResponses, setObservationResponses] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const returnRemarks = String(
    editData?.returnComments || editData?.rejectionComments || ''
  ).trim();
  const returnObservations = Array.isArray(editData?.returnObservations)
    ? editData.returnObservations.filter((o) => String(o?.observation || '').trim())
    : [];
  const inferredResubmitStatus =
    editData?.returnedFromStatus
    || (editData?.workflowStatus === 'Rejected by CEO' ? 'Forwarded to CEO' : '')
    || (editData?.srDirectorApprovedBy ? 'Forwarded to CEO' : '')
    || (editData?.chairmanApprovedBy ? 'Pending Sr Director' : '')
    || (editData?.avpApprovedBy ? 'Pending Chairman' : '')
    || (editData?.hodApprovedBy ? 'Pending AVP' : '')
    || '';
  const resubmitTargetLabel = {
    'Pending HOD HR': 'HOD HR',
    'Pending AVP': 'AVP',
    'Pending Chairman': 'Chairman Steering Committee',
    'Pending Sr Director': 'Sr Director',
    'Forwarded to CEO': 'CEO Secretariat'
  }[inferredResubmitStatus] || 'the authority who returned/rejected it';

  const observationKey = (obs, idx) => (obs?._id ? String(obs._id) : `idx-${idx}`);

  React.useEffect(() => {
    if (!open) return;
    setResubmitComment(String(initialResubmitComment || '').trim());
    setObservationResponses(
      initialObservationResponses && typeof initialObservationResponses === 'object'
        ? { ...initialObservationResponses }
        : {}
    );
  }, [editData, open, initialResubmitComment, initialObservationResponses]);

  React.useEffect(() => {
    if (editData) {
      const lines = editData.employees?.length
        ? editData.employees.map(normalizeFromEdit)
        : [normalizeFromEdit(editData)];
      setRecords(lines);
      setApprovers({
        assignedHod: editData.assignedHod?._id || editData.assignedHod || '',
        assignedSrDirector: editData.assignedSrDirector?._id || editData.assignedSrDirector || '',
        assignedAvp: editData.assignedAvp?._id || editData.assignedAvp || '',
        assignedChairman: editData.assignedChairman?._id || editData.assignedChairman || ''
      });
    } else {
      setRecords([emptyCandidate()]);
    }
  }, [editData, open, user]);

  React.useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await api.get('/auth/users', { params: { limit: 1000, active: true, dropdown: true } });
        const fetchedUsers = res.data.data?.users || (Array.isArray(res.data.data) ? res.data.data : []);
        setUsers(fetchedUsers);

        if (!editData) {
          const hod = fetchedUsers.find(u =>
            u.department?.toLowerCase() === 'human resource' &&
            u.position?.toLowerCase() === 'general manager'
          );
          const srDirector = fetchedUsers.find(u => {
            const full = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
            return full === 'hamza tanveer'
              || (full.includes('hamza') && full.includes('tanveer'));
          });
          const avp = fetchedUsers.find(u =>
            u.position?.toLowerCase() === 'assistant vice president'
          );
          const chairman = fetchedUsers.find(u =>
            u.position?.toLowerCase() === 'chairman steering committee'
          );

          setApprovers(prev => ({
            ...prev,
            assignedHod: prev.assignedHod || (hod ? hod.id || hod._id : ''),
            assignedSrDirector: prev.assignedSrDirector || (srDirector ? srDirector.id || srDirector._id : ''),
            assignedAvp: prev.assignedAvp || (avp ? avp.id || avp._id : ''),
            assignedChairman: prev.assignedChairman || (chairman ? chairman.id || chairman._id : '')
          }));
        }
      } catch (err) {
        console.error('Failed to fetch users', err);
      }
    };
    if (open) fetchUsers();
  }, [open, editData]);

  const fileInputRefs = useRef({});

  const handleRecordChange = (index, field, value) => {
    const next = [...records];
    next[index] = { ...next[index], [field]: value };
    setRecords(next);
  };

  const addRecord = () => setRecords([...records, emptyCandidate()]);

  const removeRecord = (index) => {
    if (records.length > 1) {
      setRecords(records.filter((_, i) => i !== index));
    }
  };

  const handleRowFilesSelected = (index, fileList) => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    setRecords((prev) => {
      const next = [...prev];
      const existing = Array.isArray(next[index]?.newFiles) ? next[index].newFiles : [];
      next[index] = { ...next[index], newFiles: [...existing, ...picked] };
      return next;
    });
  };

  const removeNewFile = (rowIndex, fileIndex) => {
    setRecords((prev) => {
      const next = [...prev];
      const files = [...(next[rowIndex]?.newFiles || [])];
      files.splice(fileIndex, 1);
      next[rowIndex] = { ...next[rowIndex], newFiles: files };
      return next;
    });
  };

  const removeExistingAttachment = (rowIndex, attIndex) => {
    setRecords((prev) => {
      const next = [...prev];
      const attachments = [...(next[rowIndex]?.attachments || [])];
      attachments.splice(attIndex, 1);
      next[rowIndex] = { ...next[rowIndex], attachments };
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (needsResubmitComment && !resubmitComment.trim()) {
      toast.error('Please add your comment on the observations before resubmitting');
      return;
    }

    setSubmitting(true);
    try {
      const requesterSignature = user?.digitalSignature
        || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.email || '');

      const employees = records.map((r) => ({
        name: String(r.name || '').trim(),
        cnic: String(r.cnic || '').trim(),
        designation: String(r.designation || '').trim(),
        departmentSubject: String(r.departmentSubject || '').trim(),
        project: String(r.project || '').trim(),
        location: String(r.location || '').trim(),
        currentPackageMonthly: String(r.currentPackageMonthly ?? '').trim(),
        tentativeDoj: String(r.tentativeDoj ?? '').trim(),
        remark: String(r.remark || '').trim(),
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        newFiles: Array.isArray(r.newFiles) ? r.newFiles : []
      }));

      const payload = {
        employees,
        ...approvers,
        requesterSignature,
        // Hint for server when returnedFromStatus was not persisted on older returns
        ...(isResubmit && inferredResubmitStatus
          ? {
              resubmitToStatus: inferredResubmitStatus,
              returnedFromStatus: inferredResubmitStatus
            }
          : {}),
        ...(needsResubmitComment
          ? {
              resubmitComment: resubmitComment.trim(),
              observationResponses: JSON.stringify(
                returnObservations.map((obs, idx) => ({
                  observationId: obs?._id ? String(obs._id) : '',
                  index: idx,
                  response: String(observationResponses[observationKey(obs, idx)] || '').trim()
                }))
              )
            }
          : {})
      };
      if (editData) {
        await nonEmployeeService.updateRecord(editData._id, payload);
        toast.success(
          isResubmit
            ? `Resubmitted to ${resubmitTargetLabel} (${employees.length} candidate(s))`
            : 'Record updated successfully'
        );
      } else {
        await nonEmployeeService.createRecord(payload);
        toast.success(`Batch submitted with ${employees.length} candidate(s) to HOD HR`);
      }
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.error || (editData ? 'Failed to update record' : 'Failed to create records'));
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  const cellSx = { py: 0.75, px: 0.75, verticalAlign: 'top' };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        {isResubmit ? 'Edit & Resubmit New-Hiring Approval' : editData ? 'Edit New-Hiring Approval' : 'New-Hiring Approval'}
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers>
          {isResubmit && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This record was returned/rejected
              {editData?.workflowStatus ? ` (${editData.workflowStatus})` : ''}.
              Update the details below and resubmit — it will go directly back to{' '}
              <strong>{resubmitTargetLabel}</strong> (earlier approvals stay intact).
              {returnRemarks ? (
                <Box component="div" mt={1.5}>
                  <Typography variant="subtitle2" fontWeight={700}>Comments</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{returnRemarks}</Typography>
                </Box>
              ) : null}
              {returnObservations.length > 0 ? (
                <Box component="div" mt={1.5}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                    Observations ({returnObservations.length})
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {returnObservations.map((obs, idx) => (
                      <Box component="li" key={obs._id || idx} sx={{ mb: 1.25 }}>
                        <Typography variant="body2" component="span">
                          <strong style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                            [{obs.severity || 'medium'}]
                          </strong>{' '}
                          {obs.observation}
                        </Typography>
                        {needsResubmitComment && (
                          <TextField
                            size="small"
                            fullWidth
                            multiline
                            minRows={1}
                            placeholder="Your response to this observation (optional)"
                            value={observationResponses[observationKey(obs, idx)] || ''}
                            onChange={(e) => {
                              const key = observationKey(obs, idx);
                              setObservationResponses((prev) => ({ ...prev, [key]: e.target.value }));
                            }}
                            sx={{ mt: 0.75, bgcolor: 'background.paper' }}
                          />
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              ) : null}
            </Alert>
          )}
          {needsResubmitComment && (
            <TextField
              label="Your comment on the observations (required to resubmit)"
              placeholder="Explain what you changed or clarify the observations raised"
              fullWidth
              required
              multiline
              minRows={3}
              value={resubmitComment}
              onChange={(e) => setResubmitComment(e.target.value)}
              error={!resubmitComment.trim()}
              helperText={
                resubmitComment.trim()
                  ? `This comment will be shown to ${resubmitTargetLabel} with the resubmitted record.`
                  : 'A comment is required before you can resubmit.'
              }
              sx={{ mb: 3 }}
            />
          )}
          {editData && <ResubmissionHistory record={editData} sx={{ mb: 3 }} />}
          <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle1" fontWeight={700}>
              Candidates recommended for hiring
            </Typography>
            <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={addRecord}>
              Add Row
            </Button>
          </Box>

          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3, overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1280 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell sx={{ ...cellSx, width: 56 }} align="center"><b>Sr No</b></TableCell>
                  <TableCell sx={cellSx}><b>Name</b></TableCell>
                  <TableCell sx={cellSx}><b>CNIC/Passport No.</b></TableCell>
                  <TableCell sx={cellSx}><b>Designation</b></TableCell>
                  <TableCell sx={cellSx}><b>Department/Subject</b></TableCell>
                  <TableCell sx={cellSx}><b>Project</b></TableCell>
                  <TableCell sx={cellSx}><b>Location</b></TableCell>
                  <TableCell sx={cellSx} align="right"><b>Current Package Monthly</b></TableCell>
                  <TableCell sx={cellSx}><b>Tentative DOJ</b></TableCell>
                  <TableCell sx={cellSx}><b>Remark</b></TableCell>
                  <TableCell sx={{ ...cellSx, minWidth: 180 }}><b>Attachment</b></TableCell>
                  <TableCell sx={cellSx} width={48} />
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((record, index) => (
                  <TableRow key={index}>
                    <TableCell sx={cellSx} align="center">
                      {index + 1}
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Name"
                        value={record.name}
                        onChange={(e) => handleRecordChange(index, 'name', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="CNIC / Passport"
                        value={record.cnic}
                        onChange={(e) => handleRecordChange(index, 'cnic', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Designation"
                        value={record.designation}
                        onChange={(e) => handleRecordChange(index, 'designation', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Department / Subject"
                        value={record.departmentSubject}
                        onChange={(e) => handleRecordChange(index, 'departmentSubject', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Project"
                        value={record.project}
                        onChange={(e) => handleRecordChange(index, 'project', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Location"
                        value={record.location}
                        onChange={(e) => handleRecordChange(index, 'location', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="e.g. 80000 or As per negotiation"
                        value={record.currentPackageMonthly}
                        onChange={(e) => handleRecordChange(index, 'currentPackageMonthly', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="e.g. 15 Mar 2026 or Immediate"
                        value={record.tentativeDoj}
                        onChange={(e) => handleRecordChange(index, 'tentativeDoj', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Remark"
                        value={record.remark}
                        onChange={(e) => handleRecordChange(index, 'remark', e.target.value)}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <Stack spacing={0.5} alignItems="flex-start">
                        <input
                          ref={(el) => { fileInputRefs.current[index] = el; }}
                          type="file"
                          multiple
                          hidden
                          onChange={(e) => {
                            handleRowFilesSelected(index, e.target.files);
                            e.target.value = '';
                          }}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AttachFileIcon />}
                          onClick={() => fileInputRefs.current[index]?.click()}
                          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                        >
                          Attach
                        </Button>
                        {(record.attachments || []).map((att, attIdx) => (
                          <Chip
                            key={`saved-${attIdx}-${att.filename || att.originalName}`}
                            size="small"
                            label={att.originalName || att.filename || 'File'}
                            component="a"
                            href={attachmentHref(att)}
                            target="_blank"
                            rel="noopener noreferrer"
                            clickable
                            onDelete={() => removeExistingAttachment(index, attIdx)}
                            deleteIcon={<CloseIcon />}
                            sx={{ maxWidth: 160 }}
                          />
                        ))}
                        {(record.newFiles || []).map((file, fileIdx) => (
                          <Chip
                            key={`new-${fileIdx}-${file.name}`}
                            size="small"
                            color="primary"
                            variant="outlined"
                            label={file.name}
                            onDelete={() => removeNewFile(index, fileIdx)}
                            sx={{ maxWidth: 160 }}
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell sx={cellSx}>
                      {records.length > 1 && (
                        <IconButton color="error" size="small" onClick={() => removeRecord(index)} title="Remove row">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box mt={2}>
            <Typography variant="h6" gutterBottom>Approval Authorities</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="HOD HR"
                  fullWidth
                  select
                  value={approvers.assignedHod}
                  onChange={(e) => setApprovers({ ...approvers, assignedHod: e.target.value })}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {users.map(u => (
                    <MenuItem key={u.id || u._id} value={u.id || u._id}>
                      {u.firstName} {u.lastName} ({u.email})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="AVP Taj Fahad Farid"
                  fullWidth
                  select
                  value={approvers.assignedAvp}
                  onChange={(e) => setApprovers({ ...approvers, assignedAvp: e.target.value })}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {users.map(u => (
                    <MenuItem key={u.id || u._id} value={u.id || u._id}>
                      {u.firstName} {u.lastName} ({u.email})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Chairman Steering Committee"
                  fullWidth
                  select
                  value={approvers.assignedChairman}
                  onChange={(e) => setApprovers({ ...approvers, assignedChairman: e.target.value })}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {users.map(u => (
                    <MenuItem key={u.id || u._id} value={u.id || u._id}>
                      {u.firstName} {u.lastName} ({u.email})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Sr Director Hamza Tanveer"
                  fullWidth
                  select
                  value={approvers.assignedSrDirector}
                  onChange={(e) => setApprovers({ ...approvers, assignedSrDirector: e.target.value })}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {users.map(u => (
                    <MenuItem key={u.id || u._id} value={u.id || u._id}>
                      {u.firstName} {u.lastName} ({u.email})
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={submitting || (needsResubmitComment && !resubmitComment.trim())}
          >
            {submitting
              ? 'Saving...'
              : isResubmit ? 'Save & Resubmit' : editData ? 'Save Changes' : 'Submit'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default NonEmployeeForm;
