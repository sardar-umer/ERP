import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  Divider,
  Stack,
  Alert,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Print as PrintIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchResidentById, fetchResidentTransactions } from '../../../services/tajResidentsService';
import { brandPrintHtml } from '../../../utils/tovusPrintBrand';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const TajResidentDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [resident, setResident] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchResident();
    fetchTransactions();
  }, [id]);

  const fetchResident = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetchResidentById(id);
      setResident(response.data?.data || response.data);
    } catch (err) {
      console.error('Error fetching resident:', err);
      setError(err.response?.data?.message || 'Failed to fetch resident details');
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      setTransactionsLoading(true);
      const response = await fetchResidentTransactions(id, { limit: 100 });
      setTransactions(response.data?.data?.transactions || []);
    } catch (err) {
      console.error('Error fetching transactions:', err);
    } finally {
      setTransactionsLoading(false);
    }
  };

  const handlePrint = () => {
    if (!resident) return;
    
    const printWindow = window.open('', '_blank');
    const printDate = new Date().toLocaleString();
    
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Resident Details - ${resident?.name || 'N/A'}</title>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              margin: 15px;
              color: #000;
              line-height: 1.5;
              font-size: 14px;
            }
            .header {
              text-align: center;
              border: 3px solid #000;
              padding: 20px;
              margin-bottom: 25px;
              background-color: #f9f9f9;
            }
            .header h1 {
              margin: 0 0 10px 0;
              color: #000;
            }
            .section {
              margin-bottom: 20px;
              border: 1px solid #ddd;
              padding: 15px;
            }
            .section-title {
              font-weight: bold;
              font-size: 16px;
              margin-bottom: 10px;
              border-bottom: 2px solid #000;
              padding-bottom: 5px;
            }
            .field-row {
              display: flex;
              margin-bottom: 8px;
            }
            .field-label {
              font-weight: bold;
              width: 200px;
            }
            .field-value {
              flex: 1;
            }
            .footer {
              margin-top: 30px;
              text-align: center;
              font-size: 12px;
              color: #666;
              border-top: 1px solid #ddd;
              padding-top: 10px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            th, td {
              border: 1px solid #ddd;
              padding: 8px;
              text-align: left;
            }
            th {
              background-color: #f2f2f2;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Resident Details</h1>
            <p><strong>Name:</strong> ${resident?.name || 'N/A'}</p>
            <p><strong>Account Type:</strong> ${resident?.accountType || 'N/A'}</p>
          </div>

          <div class="section">
            <div class="section-title">Personal Information</div>
            <div class="field-row">
              <div class="field-label">Name:</div>
              <div class="field-value">${resident?.name || 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Account Type:</div>
              <div class="field-value">${resident?.accountType || 'N/A'}</div>
            </div>
            ${resident?.cnic ? `
            <div class="field-row">
              <div class="field-label">CNIC:</div>
              <div class="field-value">${resident.cnic}</div>
            </div>
            ` : ''}
            ${resident?.contactNumber ? `
            <div class="field-row">
              <div class="field-label">Contact Number:</div>
              <div class="field-value">${resident.contactNumber}</div>
            </div>
            ` : ''}
            ${resident?.email ? `
            <div class="field-row">
              <div class="field-label">Email:</div>
              <div class="field-value">${resident.email}</div>
            </div>
            ` : ''}
            ${resident?.address ? `
            <div class="field-row">
              <div class="field-label">Address:</div>
              <div class="field-value">${resident.address}</div>
            </div>
            ` : ''}
            <div class="field-row">
              <div class="field-label">Status:</div>
              <div class="field-value">${resident?.isActive ? 'Active' : 'Inactive'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Financial Information</div>
            <div class="field-row">
              <div class="field-label">Current Balance:</div>
              <div class="field-value">${formatCurrency(resident?.balance || 0)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Properties Count:</div>
              <div class="field-value">${resident?.propertyCount || resident?.properties?.length || 0}</div>
            </div>
          </div>

          ${resident?.properties && resident.properties.length > 0 ? `
          <div class="section">
            <div class="section-title">Assigned Properties (${resident.properties.length})</div>
            <table>
              <thead>
                <tr>
                  <th>Property Name</th>
                  <th>Plot Number</th>
                  <th>Sector</th>
                  <th>Block</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                ${resident.properties.map(prop => `
                  <tr>
                    <td>${prop.propertyName || 'N/A'}</td>
                    <td>${prop.plotNumber || 'N/A'}</td>
                    <td>${prop.sector || 'N/A'}</td>
                    <td>${prop.block || 'N/A'}</td>
                    <td>${prop.fullAddress || prop.address || 'N/A'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${resident?.notes ? `
          <div class="section">
            <div class="section-title">Notes</div>
            <div class="field-value">${resident.notes}</div>
          </div>
          ` : ''}

          <div class="section">
            <div class="section-title">System Information</div>
            <div class="field-row">
              <div class="field-label">Created Date:</div>
              <div class="field-value">${resident?.createdAt ? new Date(resident.createdAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Last Updated:</div>
              <div class="field-value">${resident?.updatedAt ? new Date(resident.updatedAt).toLocaleString() : 'N/A'}</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Generated from SGC ERP System - Taj Utilities Residents</strong></p>
            <p>Resident ID: ${resident?._id || 'N/A'} | Printed: ${printDate}</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(brandPrintHtml(printContent, { title: 'Resident Details' })); // Tovus ERP branded print
    printWindow.document.close();

    printWindow.onload = function() {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <Skeleton variant="rectangular" width={100} height={36} borderRadius={1} />
          <Skeleton variant="text" width="35%" height={40} />
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Grid container spacing={3}>
                  {[1, 2, 3, 4, 5, 6].map((item) => (
                    <Grid item xs={12} sm={6} key={item}>
                      <Skeleton variant="text" height={16} width="40%" sx={{ mb: 1 }} />
                      <Skeleton variant="text" height={20} width="70%" />
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Skeleton variant="text" width="50%" height={28} sx={{ mb: 2 }} />
                <Box sx={{ textAlign: 'center' }}>
                  <Skeleton variant="rectangular" width={120} height={80} sx={{ mb: 2, mx: 'auto' }} />
                  <Skeleton variant="rectangular" height={24} width={80} sx={{ mx: 'auto' }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/taj-residents')}>
          Go Back
        </Button>
      </Box>
    );
  }

  if (!resident) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>Resident not found</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/taj-residents')}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" mb={3}>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/finance/taj-utilities-charges/taj-residents')}>
          Back
        </Button>
        <Typography variant="h4" component="h1" fontWeight={700}>
          Resident Details
        </Typography>
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={() => navigate(`/finance/taj-utilities-charges/taj-residents?edit=${id}`)}
          sx={{ ml: 'auto' }}
        >
          Edit
        </Button>
        <Button
          variant="outlined"
          startIcon={<PrintIcon />}
          onClick={handlePrint}
        >
          Print
        </Button>
      </Stack>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight={600}>
                  Personal Information
                </Typography>
                <Chip
                  label={resident.isActive ? 'Active' : 'Inactive'}
                  color={resident.isActive ? 'success' : 'default'}
                  size="small"
                />
              </Stack>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Name
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {resident.name || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Account Type
                  </Typography>
                  <Box sx={{ mb: 2 }}>
                    <Chip
                      label={resident.accountType || 'Resident'}
                      color={resident.accountType === 'Resident' ? 'primary' : 'default'}
                      size="small"
                    />
                  </Box>
                </Grid>
                {resident.cnic && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      CNIC
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {resident.cnic}
                    </Typography>
                  </Grid>
                )}
                {resident.contactNumber && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Contact Number
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {resident.contactNumber}
                    </Typography>
                  </Grid>
                )}
                {resident.email && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Email
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {resident.email}
                    </Typography>
                  </Grid>
                )}
                {resident.address && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Address
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {resident.address}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Financial Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Current Balance
                  </Typography>
                  <Typography variant="h5" fontWeight={600} color="primary.main" sx={{ mb: 2 }}>
                    {formatCurrency(resident.balance || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Properties Count
                  </Typography>
                  <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
                    {resident.propertyCount || resident.properties?.length || 0}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {resident.properties && resident.properties.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Assigned Properties ({resident.properties.length})
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>Property Name</strong></TableCell>
                        <TableCell><strong>Plot Number</strong></TableCell>
                        <TableCell><strong>Sector</strong></TableCell>
                        <TableCell><strong>Block</strong></TableCell>
                        <TableCell><strong>Address</strong></TableCell>
                        <TableCell align="right"><strong>Actions</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {resident.properties.map((property) => (
                        <TableRow key={property._id} hover>
                          <TableCell>{property.propertyName || '—'}</TableCell>
                          <TableCell>{property.plotNumber || '—'}</TableCell>
                          <TableCell>{property.sector || '—'}</TableCell>
                          <TableCell>{property.block || '—'}</TableCell>
                          <TableCell>{property.fullAddress || property.address || '—'}</TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              startIcon={<VisibilityIcon />}
                              onClick={() => navigate(`/finance/taj-utilities-charges/taj-properties/${property._id}`)}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          )}

          {transactions.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Recent Transactions
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                {transactionsLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                    <CircularProgress />
                  </Box>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>Date</strong></TableCell>
                          <TableCell><strong>Type</strong></TableCell>
                          <TableCell align="right"><strong>Amount</strong></TableCell>
                          <TableCell align="right"><strong>Balance Before</strong></TableCell>
                          <TableCell align="right"><strong>Balance After</strong></TableCell>
                          <TableCell><strong>Description</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {transactions.slice(0, 10).map((txn) => (
                          <TableRow key={txn._id}>
                            <TableCell>{dayjs(txn.createdAt).format('DD MMM YYYY HH:mm')}</TableCell>
                            <TableCell>
                              <Chip
                                label={txn.transactionType}
                                size="small"
                                color={txn.transactionType === 'deposit' ? 'success' : 'default'}
                              />
                            </TableCell>
                            <TableCell align="right">{formatCurrency(txn.amount)}</TableCell>
                            <TableCell align="right">{formatCurrency(txn.balanceBefore)}</TableCell>
                            <TableCell align="right">{formatCurrency(txn.balanceAfter)}</TableCell>
                            <TableCell>{txn.description || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          )}

          {resident.notes && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Notes
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1">{resident.notes}</Typography>
              </CardContent>
            </Card>
          )}
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ position: 'sticky', top: 20 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Quick Actions
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Stack spacing={2}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={() => navigate(`/finance/taj-utilities-charges/taj-residents?deposit=${id}`)}
                >
                  Make Deposit
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => navigate(`/finance/taj-utilities-charges/taj-residents?pay=${id}`)}
                >
                  Pay Bill
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => navigate(`/finance/taj-utilities-charges/taj-residents?properties=${id}`)}
                >
                  Manage Properties
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => navigate(`/finance/taj-utilities-charges/taj-residents?transactions=${id}`)}
                >
                  View All Transactions
                </Button>
              </Stack>

              <Divider sx={{ my: 3 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                System Information
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Created:</strong>{' '}
                {resident.createdAt
                  ? dayjs(resident.createdAt).format('DD/MM/YYYY HH:mm')
                  : 'N/A'}
              </Typography>
              <Typography variant="body2">
                <strong>Last Updated:</strong>{' '}
                {resident.updatedAt
                  ? dayjs(resident.updatedAt).format('DD/MM/YYYY HH:mm')
                  : 'N/A'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TajResidentDetail;

