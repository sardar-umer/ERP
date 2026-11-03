import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canSeePresidentDashboard } from '../../utils/presidentAccess';

/** Guards the President Dashboard URL: President and developer only */
export const PresidentOnly = ({ children }) => {
  const { user } = useAuth();
  return canSeePresidentDashboard(user) ? children : <Navigate to="/dashboard" replace />;
};
