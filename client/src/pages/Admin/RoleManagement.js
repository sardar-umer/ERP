import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Tooltip,
  Alert,
  Snackbar,
  FormControlLabel,
  Switch,
  Divider,
  TablePagination
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  People as PeopleIcon
} from '@mui/icons-material';
import RolePermissionMatrix from '../../components/Admin/RolePermissionMatrix';
import RoleTemplates from '../../components/Admin/RoleTemplates';
import api from '../../services/api';
import { MODULES, getCatalogSubmodules } from '../../utils/permissions';

const HIGHER_MANAGEMENT = 'higher_management';
const ALL_ACTIONS = ['read', 'create', 'update', 'delete', 'approve'];

/** Every module and page ticked — what higher_management has until its role is first saved. */
const buildFullPermissions = () => Object.keys(MODULES)
  .filter((key) => MODULES[key] && typeof MODULES[key] === 'object' && key !== 'dashboard')
  .map((module) => ({
    module,
    actions: [...ALL_ACTIONS],
    submodules: getCatalogSubmodules(module).map((submodule) => ({ submodule, actions: [...ALL_ACTIONS] }))
  }));

const RoleManagement = () => {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [viewingRole, setViewingRole] = useState(null);
  const [roleUsers, setRoleUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [showTemplates, setShowTemplates] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalRoles, setTotalRoles] = useState(0);

  const [formData, setFormData] = useState({
    name: '',
    permissions: [],
    isActive: true
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRoles();
    }, 300);
    return () => clearTimeout(timer);
  }, [page, rowsPerPage, searchTerm, filterActive]);

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const params = {
        page: page + 1,
        limit: rowsPerPage
      };
      if (searchTerm.trim()) {
        params.search = searchTerm.trim();
      }
      if (filterActive !== 'all') {
        params.isActive = filterActive === 'active';
      }
      const response = await api.get('/roles', { params });
      const rolesData = response.data.data?.roles || [];
      const pagination = response.data.data?.pagination || {};
      setRoles(rolesData);
      setTotalRoles(pagination.total || 0);
    } catch (err) {
      setError('Failed to fetch roles');
    } finally {
      setLoading(false);
    }
  };


  const fetchRoleUsers = async (roleId) => {
    try {
      const response = await api.get(`/roles/${roleId}/users`);
      setRoleUsers(response.data.data?.users || []);
    } catch (err) {
      setError('Failed to fetch role users');
    }
  };

  const handleCreateRole = () => {
    setEditingRole(null);
    setFormData({
      name: '',
      permissions: [],
      isActive: true
    });
    setShowTemplates(true);
    setDialogOpen(true);
  };

  const handleSelectTemplate = (template) => {
    setFormData({
      name: template.name || template.displayName,
      permissions: template.permissions,
      isActive: true
    });
    setShowTemplates(false);
  };

  const handleEditRole = (role) => {
    setEditingRole(role);
    // higher_management not yet restricted has full access: start with everything ticked
    const startFull = role.name === HIGHER_MANAGEMENT && !role.enforcePermissions;
    setFormData({
      name: role.name,
      permissions: startFull ? buildFullPermissions() : (role.permissions || []),
      isActive: role.isActive
    });
    setDialogOpen(true);
  };

  const handleViewRole = (role) => {
    setViewingRole(role);
    setViewDialogOpen(true);
  };

  const handleViewUsers = async (role) => {
    setViewingRole(role);
    await fetchRoleUsers(role._id);
    setUsersDialogOpen(true);
  };

  const handleSaveRole = async () => {
    try {
      const payload = {
        ...formData,
        displayName: editingRole?.name === HIGHER_MANAGEMENT ? (editingRole.displayName || formData.name) : formData.name,
        description: ''
      };
      console.log('[RoleManagement] Saving role payload (types):', {
        name: payload.name,
        permissionsType: typeof payload.permissions,
        firstPermissionSubmodulesType: typeof payload.permissions?.[0]?.submodules,
        firstPermissionFirstSubmoduleType: typeof payload.permissions?.[0]?.submodules?.[0]
      });
      if (editingRole) {
        await api.put(`/roles/${editingRole._id}`, payload);
      } else {
        await api.post('/roles', payload);
      }
      setSuccess(editingRole ? 'Role updated successfully' : 'Role created successfully');
      setDialogOpen(false);
      setShowTemplates(false);
      resetForm();
      fetchRoles();
    } catch (err) {
      console.error('[RoleManagement] Save role error:', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
        fullError: err
      });
      setError(err.response?.data?.message || err.message || 'Failed to save role');
    }
  };

  const handleDeleteRole = async (role) => {
    if (!window.confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
      return;
    }
    
    try {
      await api.delete(`/roles/${role._id}`);
      setSuccess('Role deleted successfully');
      fetchRoles();
    } catch (err) {
      console.error('[RoleManagement] Delete role error:', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data
      });
      setError(err.response?.data?.message || err.message || 'Failed to delete role');
    }
  };

  const handleChangePage = (_, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      permissions: [],
      isActive: true
    });
    setShowTemplates(false);
  };

  const formatSubmodulesForView = (submodules = []) => {
    if (!Array.isArray(submodules) || submodules.length === 0) return 'None';
    return submodules.map((sm) => {
      if (typeof sm === 'string') return sm;
      if (sm && typeof sm === 'object') return sm.submodule || 'Unknown';
      return 'Unknown';
    }).join(', ');
  };

  const formatActionsForView = (permission = {}) => {
    const moduleActions = Array.isArray(permission.actions) ? permission.actions : [];
    if (moduleActions.length > 0) return moduleActions.join(', ');
    const submodules = Array.isArray(permission.submodules) ? permission.submodules : [];
    const uniqueSubmoduleActions = [...new Set(
      submodules.flatMap((sm) => (Array.isArray(sm?.actions) ? sm.actions : []))
    )];
    return uniqueSubmoduleActions.length > 0 ? uniqueSubmoduleActions.join(', ') : 'None';
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          Role Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateRole}
        >
          Create Role
        </Button>
      </Box>

      {/* Search and Filter */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField
          label="Search roles"
          variant="outlined"
          size="small"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 300 }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={filterActive}
            label="Status"
            onChange={(e) => {
              setFilterActive(e.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Roles Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Permissions</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Users</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role._id}>
                <TableCell>
                  <Typography variant="body1" fontWeight="medium">
                    {role.name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {role.permissions?.map((permission, index) => (
                      <Chip
                        key={index}
                        label={`${permission.module} (${permission.submodules?.length || 0})`}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                    {(!role.permissions || role.permissions.length === 0) && (
                      <Typography variant="caption" color="text.secondary">
                        No permissions
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    label={role.isActive ? 'Active' : 'Inactive'}
                    color={role.isActive ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    startIcon={<PeopleIcon />}
                    onClick={() => handleViewUsers(role)}
                  >
                    {role.userCount || 0}
                  </Button>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="View Details">
                      <IconButton size="small" onClick={() => handleViewRole(role)}>
                        <VisibilityIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit Role">
                      <span>
                        <IconButton 
                          size="small" 
                          onClick={() => handleEditRole(role)}
                          disabled={role.isSystemRole && role.name !== HIGHER_MANAGEMENT}
                        >
                          <EditIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete Role">
                      <span>
                        <IconButton 
                          size="small" 
                          color="error"
                          onClick={() => handleDeleteRole(role)}
                          disabled={role.isSystemRole}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {!loading && roles.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  No roles found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={totalRoles}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </TableContainer>

      {/* Create/Edit Role Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingRole ? 'Edit Role' : 'Create New Role'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Role Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={editingRole}
              fullWidth
              required
              helperText="This name will be shown in the sidebar and profile"
            />
            {editingRole?.name === HIGHER_MANAGEMENT ? (
              <Alert severity="info">
                {editingRole.enforcePermissions
                  ? 'Higher Management users get only what is ticked here (plus any other roles they have).'
                  : 'Higher Management users have full access today. Once you save, they get only what is ticked here (plus any other roles they have).'}
              </Alert>
            ) : (
            <FormControlLabel
              control={
                <Switch
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                />
              }
              label="Active"
            />
            )}
            
            <Divider />
            
            {showTemplates && !editingRole ? (
              <>
                <RoleTemplates onSelectTemplate={handleSelectTemplate} />
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => setShowTemplates(false)}
                  >
                    Create Custom Role Instead
                  </Button>
                </Box>
              </>
            ) : (
              <RolePermissionMatrix
                permissions={formData.permissions}
                onChange={(permissions) => setFormData({ ...formData, permissions })}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setDialogOpen(false);
            setShowTemplates(false);
            resetForm();
          }}>Cancel</Button>
          <Button 
            onClick={handleSaveRole} 
            variant="contained"
            disabled={
              !formData.name || 
              (formData.permissions && formData.permissions.length > 0 && 
                formData.permissions.every(p => {
                  // Check if permission has module-level actions
                  const hasModuleActions = p.actions && Array.isArray(p.actions) && p.actions.length > 0;
                  // Check if permission has submodules with actions
                  const hasSubmoduleActions = p.submodules && Array.isArray(p.submodules) && 
                    p.submodules.some(sm => {
                      if (typeof sm === 'object' && sm.actions) {
                        return Array.isArray(sm.actions) && sm.actions.length > 0;
                      }
                      return false;
                    });
                  // Permission is valid if it has either module-level actions or submodules with actions
                  return !hasModuleActions && !hasSubmoduleActions;
                }))
            }
          >
            {editingRole ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Role Dialog */}
      <Dialog open={viewDialogOpen} onClose={() => setViewDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Role Details</DialogTitle>
        <DialogContent>
          {viewingRole && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Role Name</Typography>
                <Typography variant="body1">{viewingRole.name}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Status</Typography>
                <Chip
                  label={viewingRole.isActive ? 'Active' : 'Inactive'}
                  color={viewingRole.isActive ? 'success' : 'default'}
                  size="small"
                />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Permissions</Typography>
                {viewingRole.permissions?.map((permission, index) => (
                  <Box key={index} sx={{ mt: 1 }}>
                    <Typography variant="body2" fontWeight="medium">
                      {permission.module}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Submodules: {formatSubmodulesForView(permission.submodules)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Actions: {formatActionsForView(permission)}
                    </Typography>
                  </Box>
                ))}
                {(!viewingRole.permissions || viewingRole.permissions.length === 0) && (
                  <Typography variant="body2" color="text.secondary">
                    No permissions assigned
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Users Dialog */}
      <Dialog open={usersDialogOpen} onClose={() => setUsersDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Users with Role: {viewingRole?.name}</DialogTitle>
        <DialogContent>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roleUsers.map((user) => (
                  <TableRow key={user._id}>
                    <TableCell>{user.firstName} {user.lastName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Chip
                        label={user.isActive ? 'Active' : 'Inactive'}
                        color={user.isActive ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {roleUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      No users assigned to this role
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUsersDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Snackbars */}
      <Snackbar
        open={!!success}
        autoHideDuration={6000}
        onClose={() => setSuccess('')}
      >
        <Alert onClose={() => setSuccess('')} severity="success">
          {success}
        </Alert>
      </Snackbar>
      
      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError('')}
      >
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RoleManagement;
