import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Grid, CircularProgress, MenuItem, Typography, Divider
} from '@mui/material';
import api from '../../services/api';
import manualSalaryService from '../../services/manualSalaryService';
import { useAuth } from '../../contexts/AuthContext';

const months = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' }
];

const emptyForm = () => ({
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  empId: '',
  name: '',
  designation: '',
  project: '',
  companyId: '',
  doj: '',
  basicSalary: 0,
  houseRentAllowance: 0,
  medicalAllowance: 0,
  conveyanceAllowance: 0,
  vehicleAllowance: 0,
  fuelAllowance: 0,
  foodAllowance: 0,
  specialAllowance: 0,
  otherAllowance: 0,
  grossSalary: 0,
  incomeTax: 0,
  netPayable: 0,
  remarks: '',
  assignedHod: '',
  assignedAvp: ''
});

const userLabel = (u) => {
  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
  return name || u.email || u._id;
};

const ManualSalaryForm = ({ open, onClose, onRefresh, editData }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [formData, setFormData] = useState(emptyForm());

  useEffect(() => {
    if (!open) return;
    if (editData) {
      setFormData({
        ...emptyForm(),
        ...editData,
        assignedHod: editData.assignedHod?._id || editData.assignedHod || '',
        assignedAvp: editData.assignedAvp?._id || editData.assignedAvp || '',
        companyId: editData.companyId?._id || editData.companyId || ''
      });
    } else {
      setFormData(emptyForm());
    }
  }, [editData, open]);

  useEffect(() => {
    if (!open) return;
    api.get('/hr/companies')
      .then((res) => setCompanies(res.data?.data || []))
      .catch(() => setCompanies([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const fetchUsers = async () => {
      try {
        const res = await api.get('/auth/users', { params: { limit: 1000, active: true, dropdown: true } });
        const fetchedUsers = res.data.data?.users || (Array.isArray(res.data.data) ? res.data.data : []);
        setUsers(fetchedUsers);

        if (!editData) {
          const hod = fetchedUsers.find((u) =>
            String(u.department || '').toLowerCase() === 'human resource'
            && String(u.position || '').toLowerCase() === 'general manager'
          );
          const avp = fetchedUsers.find((u) => {
            const full = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
            return String(u.position || '').toLowerCase() === 'assistant vice president'
              || (full.includes('fahad') && full.includes('farid'));
          });
          setFormData((prev) => ({
            ...prev,
            assignedHod: prev.assignedHod || (hod ? hod.id || hod._id : ''),
            assignedAvp: prev.assignedAvp || (avp ? avp.id || avp._id : '')
          }));
        }
      } catch (err) {
        console.error('Failed to fetch users', err);
      }
    };
    fetchUsers();
  }, [open, editData]);

  useEffect(() => {
    const basic = Number(formData.basicSalary) || 0;
    const hr = Number(formData.houseRentAllowance) || 0;
    const med = Number(formData.medicalAllowance) || 0;
    const conv = Number(formData.conveyanceAllowance) || 0;
    const veh = Number(formData.vehicleAllowance) || 0;
    const fuel = Number(formData.fuelAllowance) || 0;
    const food = Number(formData.foodAllowance) || 0;
    const spec = Number(formData.specialAllowance) || 0;
    const oth = Number(formData.otherAllowance) || 0;
    const tax = Number(formData.incomeTax) || 0;
    const gross = basic + hr + med + conv + veh + fuel + food + spec + oth;

    setFormData((prev) => ({
      ...prev,
      grossSalary: gross,
      netPayable: gross - tax
    }));
  }, [
    formData.basicSalary, formData.houseRentAllowance, formData.medicalAllowance,
    formData.conveyanceAllowance, formData.vehicleAllowance, formData.fuelAllowance,
    formData.foodAllowance, formData.specialAllowance, formData.otherAllowance,
    formData.incomeTax
  ]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.companyId) {
      alert('Please select the company.');
      return;
    }
    if (!formData.assignedHod || !formData.assignedAvp) {
      alert('Please select GM HR and AVP Taj Fahad Farid.');
      return;
    }
    try {
      setLoading(true);
      const requesterSignature = user?.digitalSignature
        || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.email || '');
      const payload = {
        ...formData,
        assignedHod: formData.assignedHod,
        assignedAvp: formData.assignedAvp,
        requesterSignature
      };
      if (editData) {
        await manualSalaryService.update(editData._id, payload);
      } else {
        await manualSalaryService.create(payload);
      }
      onRefresh();
      onClose();
    } catch (error) {
      console.error('Error saving manual salary:', error);
      alert(error.response?.data?.message || error.response?.data?.errors?.[0]?.msg || 'Failed to save record.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{editData ? 'Edit' : 'Create'} Manual Salary Entry</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Month"
                name="month"
                value={formData.month}
                onChange={handleChange}
                SelectProps={{ native: true }}
                required
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                type="number"
                fullWidth
                label="Year"
                name="year"
                value={formData.year}
                onChange={handleChange}
                required
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Emp ID" name="empId" value={formData.empId} onChange={handleChange} />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField fullWidth label="Name" name="name" value={formData.name} onChange={handleChange} required />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Designation" name="designation" value={formData.designation} onChange={handleChange} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Project" name="project" value={formData.project} onChange={handleChange} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                required
                label="Company (Finance)"
                name="companyId"
                value={formData.companyId}
                onChange={handleChange}
                helperText="Printed on the salary sheet; Finance pays from this company"
              >
                {companies.map((c) => (
                  <MenuItem key={c._id} value={c._id}>{c.name}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Date of Joining"
                name="doj"
                placeholder="e.g. 01-Nov-23"
                value={formData.doj}
                onChange={handleChange}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Remarks / Bank Acct" name="remarks" value={formData.remarks} onChange={handleChange} />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Approval authorities</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Flow: GM HR → AVP Taj Fahad Farid → Audit (Pre-Audit → Audit Director) → Finance
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                required
                label="GM HR"
                name="assignedHod"
                value={formData.assignedHod}
                onChange={handleChange}
              >
                <MenuItem value=""><em>Select GM HR</em></MenuItem>
                {users.map((u) => (
                  <MenuItem key={u._id || u.id} value={u._id || u.id}>{userLabel(u)}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                required
                label="AVP Taj Fahad Farid"
                name="assignedAvp"
                value={formData.assignedAvp}
                onChange={handleChange}
              >
                <MenuItem value=""><em>Select AVP</em></MenuItem>
                {users.map((u) => (
                  <MenuItem key={u._id || u.id} value={u._id || u.id}>{userLabel(u)}</MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2">Financials</Typography>
            </Grid>
            {[
              ['basicSalary', 'Basic Salary'],
              ['houseRentAllowance', 'House Rent'],
              ['medicalAllowance', 'Medical Allow.'],
              ['conveyanceAllowance', 'Conveyance Allow.'],
              ['vehicleAllowance', 'Vehicle Allow.'],
              ['fuelAllowance', 'Fuel Allow.'],
              ['foodAllowance', 'Food Allow.'],
              ['specialAllowance', 'Special Allow.'],
              ['otherAllowance', 'Other Allow.']
            ].map(([name, label]) => (
              <Grid item xs={12} sm={3} key={name}>
                <TextField type="number" fullWidth label={label} name={name} value={formData[name]} onChange={handleChange} />
              </Grid>
            ))}
            <Grid item xs={12} sm={3}>
              <TextField type="number" fullWidth label="Gross Salary (Auto)" name="grossSalary" value={formData.grossSalary} disabled />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField type="number" fullWidth label="Income Tax" name="incomeTax" value={formData.incomeTax} onChange={handleChange} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField type="number" fullWidth label="Net Payable (Auto)" name="netPayable" value={formData.netPayable} disabled />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? <CircularProgress size={24} /> : (editData ? 'Save / Resubmit' : 'Submit for Approval')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default ManualSalaryForm;
