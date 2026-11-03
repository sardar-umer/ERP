import React, { createContext, useContext, useReducer, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import toast from 'react-hot-toast';
import { isPresidentUser } from '../utils/presidentAccess';

// Constants
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 3000];
const ROLE_REDIRECTS = {
  super_admin: '/dashboard',
  admin: '/admin/users',
  hr_manager: '/hr',
  finance_manager: '/finance',
  procurement_manager: '/procurement',
  sales_manager: '/sales',
  crm_manager: '/crm',
  employee: '/profile'
};

// Utility functions
const getRedirectPath = (userRole) => ROLE_REDIRECTS[userRole] || '/profile';
const getInitialToken = () => {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
};

// Decode JWT token to check expiration (without verification)
const decodeToken = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    return null;
  }
};

// Check if token is expired or will expire soon (within 1 hour)
const isTokenExpiringSoon = (token) => {
  if (!token) return true;
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;
  
  const expirationTime = decoded.exp * 1000; // Convert to milliseconds
  const currentTime = Date.now();
  const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
  
  // Return true if token expires within 1 hour
  return (expirationTime - currentTime) < oneHour;
};

// Error detection utilities
const isAuthError = (error) => error.response?.status === 401 || error.response?.status === 403;
const isRateLimitError = (error) => error.response?.status === 429;
const isTransientGatewayError = (error) =>
  [502, 503, 504].includes(error.response?.status);
const isNetworkError = (error) => 
  !error.response || 
  ['ECONNABORTED', 'NETWORK_ERROR', 'ERR_NETWORK', 'ETIMEDOUT'].includes(error.code) ||
  error.message?.includes('timeout') ||
  error.message?.includes('Network Error');

const getErrorMessage = (error, defaultMsg) => {
  if (isRateLimitError(error)) {
    return error.response?.data?.message || 'Too many login attempts. Please wait a few minutes before trying again.';
  }
  return error.response?.data?.message || defaultMsg;
};

const AuthContext = createContext();

const initialState = {
  user: null,
  token: getInitialToken(),
  loading: true,
  error: null
};

const authReducer = (state, action) => {
  switch (action.type) {
    case 'LOGIN_START':
      return {
        ...state,
        loading: true,
        error: null
      };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        loading: false,
        error: null
      };
    case 'LOGIN_FAILURE':
      return {
        ...state,
        user: null,
        token: null,
        loading: false,
        error: action.payload
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        loading: false,
        error: null
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: action.payload
      };
    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload
      };
    case 'NETWORK_ERROR':
      // Preserve token and user state on network errors - don't clear them
      return {
        ...state,
        loading: false,
        error: action.payload || 'Network error. Please check your connection.'
      };
    default:
      return state;
  }
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const navigate = useNavigate();

  // Shared auth verification logic
  const verifyAuth = useCallback(async (token, onSuccess, onError) => {
    try {
      const response = await authService.getProfile();
      const userData = response?.data?.data?.user;
      
      if (userData) {
        onSuccess(userData, token);
      } else {
        throw new Error('Invalid user data received');
      }
    } catch (error) {
      onError(error);
    }
  }, []);

  // Check if user is authenticated on app load with retry mechanism
  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;

    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      
      if (!token) {
        if (isMounted) dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }

      if (isMounted) dispatch({ type: 'SET_LOADING', payload: true });
      
      try {
        await verifyAuth(
          token,
          (userData, token) => {
            if (isMounted) {
          dispatch({
            type: 'LOGIN_SUCCESS',
                payload: { user: userData, token }
          });
            }
          },
          (error) => {
            if (!isMounted) return;

            if (isAuthError(error)) {
              localStorage.removeItem('token');
              dispatch({ type: 'LOGIN_FAILURE', payload: 'Session expired' });
            } else if (
              (isNetworkError(error) || isTransientGatewayError(error)) &&
              retryCount < MAX_RETRIES
            ) {
              const delay = RETRY_DELAYS[retryCount] || 3000;
              retryCount++;
              setTimeout(() => isMounted && checkAuth(), delay);
            } else {
              dispatch({ 
                type: 'NETWORK_ERROR', 
                payload: 'Connection issue. Please check your network and try again.' 
              });
          }
          }
        );
        } catch (error) {
        if (isMounted && !isAuthError(error) && !isNetworkError(error)) {
            localStorage.removeItem('token');
            dispatch({ type: 'LOGIN_FAILURE', payload: 'Authentication check failed' });
        }
      }
    };

    checkAuth();
    return () => { isMounted = false; };
  }, [verifyAuth]);

  // Automatic token refresh - refresh token before it expires
  useEffect(() => {
    if (!state.token || !state.user) return;

    const refreshTokenIfNeeded = async () => {
      try {
        // Check if token is expiring soon (within 1 hour)
        if (isTokenExpiringSoon(state.token)) {
          // Silently refresh token
          const response = await authService.refreshToken();
          const { token: newToken, user: updatedUser } = response.data.data;
          
          if (newToken) {
            localStorage.setItem('token', newToken);
            dispatch({ 
              type: 'LOGIN_SUCCESS', 
              payload: { user: updatedUser, token: newToken } 
            });
            
            if (process.env.NODE_ENV !== 'production') {
              console.log('🔄 Token refreshed automatically');
            }
          }
        }
      } catch (error) {
        // If refresh fails, don't log out immediately - let the next API call handle it
        if (process.env.NODE_ENV !== 'production') {
          console.warn('⚠️ Token refresh failed:', error.message);
        }
      }
    };

    // Check token expiration every 5 minutes
    const refreshInterval = setInterval(refreshTokenIfNeeded, 5 * 60 * 1000);
    
    // Also check immediately
    refreshTokenIfNeeded();

    return () => clearInterval(refreshInterval);
  }, [state.token, state.user]);

  // Shared auth flow for login/register
  const handleAuthFlow = useCallback(async (authFn, successMsg, errorMsg, redirectTo = null) => {
    try {
      dispatch({ type: 'LOGIN_START' });
      const response = await authFn();
      const { user, token } = response.data.data;
      
      localStorage.setItem('token', token);
      dispatch({ type: 'LOGIN_SUCCESS', payload: { user, token } });

      toast.success(successMsg);
      // The President opens on his own dashboard
      navigate(redirectTo || (isPresidentUser(user) ? '/general/president-dashboard' : getRedirectPath(user.role)));
      return { success: true };
    } catch (error) {
      const message = getErrorMessage(error, errorMsg);
      dispatch({ type: 'LOGIN_FAILURE', payload: message });
      
      // For rate limit errors, show a longer toast with more context
      if (isRateLimitError(error)) {
        toast.error(message, {
          duration: 5000, // Show for 5 seconds
          icon: '⏱️'
        });
      } else {
        toast.error(message);
      }
      
      return { success: false, error: message };
    }
  }, [navigate]);

  const login = useCallback(
    (credentials, options = {}) => handleAuthFlow(
      () => authService.login(credentials),
      'Login successful!',
      'Login failed',
      options.redirectTo || null
    ),
    [handleAuthFlow]
  );

  const register = useCallback(
    (userData) => handleAuthFlow(
      () => authService.register(userData),
      'Registration successful!',
      'Registration failed'
    ),
    [handleAuthFlow]
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
      console.error('Logout error:', error);
      }
    } finally {
      localStorage.removeItem('token');
      dispatch({ type: 'LOGOUT' });
      toast.success('Logged out successfully');
      navigate('/login');
    }
  }, [navigate]);

  // Shared error handler for profile operations
  const handleProfileOperation = useCallback(async (operation, successMsg, errorMsg) => {
    try {
      const response = await operation();
      if (response?.data?.data?.user) {
        dispatch({ type: 'UPDATE_USER', payload: response.data.data.user });
      }
      toast.success(successMsg);
      return { success: true };
    } catch (error) {
      const message = getErrorMessage(error, errorMsg);
      toast.error(message);
      return { success: false, error: message };
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const response = await authService.getProfile();
      const userData = response?.data?.data?.user;
      if (userData) {
        dispatch({ type: 'UPDATE_USER', payload: userData });
        return { success: true, user: userData };
      }
      return { success: false, error: 'Invalid user data received' };
    } catch (error) {
      console.error('Failed to refresh user:', error);
      return { success: false, error: error.message };
    }
  }, []);

  const updateProfile = useCallback(
    async (profileData) => {
      const result = await handleProfileOperation(
        () => authService.updateProfile(profileData),
        'Profile updated successfully',
        'Profile update failed'
      );
      if (result.success) {
        await refreshUser();
      }
      return result;
    },
    [handleProfileOperation, refreshUser]
  );

  const changePassword = useCallback(
    (passwordData) => handleProfileOperation(
      () => authService.changePassword(passwordData),
      'Password changed successfully',
      'Password change failed'
    ),
    [handleProfileOperation]
  );

  // Manual retry function for network errors
  const retryAuth = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      dispatch({ type: 'SET_LOADING', payload: false });
      return { success: false, error: 'No token found' };
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    
    return new Promise((resolve) => {
      verifyAuth(
        token,
        (userData, token) => {
          dispatch({ type: 'LOGIN_SUCCESS', payload: { user: userData, token } });
          resolve({ success: true });
        },
        (error) => {
          if (isAuthError(error)) {
            localStorage.removeItem('token');
            dispatch({ type: 'LOGIN_FAILURE', payload: 'Session expired' });
            resolve({ success: false, error: 'Session expired' });
          } else if (isNetworkError(error)) {
            dispatch({ 
              type: 'NETWORK_ERROR', 
              payload: 'Connection issue. Please check your network and try again.' 
            });
            resolve({ success: false, error: 'Network error' });
          } else {
            localStorage.removeItem('token');
            dispatch({ type: 'LOGIN_FAILURE', payload: 'Authentication check failed' });
            resolve({ success: false, error: 'Authentication failed' });
    }
        }
      );
    });
  }, [verifyAuth]);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    user: state.user,
    token: state.token,
    loading: state.loading,
    error: state.error,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    retryAuth,
    refreshUser,
    isAuthenticated: !!state.user && !!state.token
  }), [state.user, state.token, state.loading, state.error, login, register, logout, updateProfile, changePassword, retryAuth, refreshUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 