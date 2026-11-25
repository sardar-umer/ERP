import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  IconButton,
  InputBase,
  Badge,
  Avatar,
  Menu,
  MenuItem,
  Popover,
  Divider,
  useTheme
} from '@mui/material';
import {
  Search,
  Notifications as NotificationsIcon,
  Settings,
  Logout,
  Person,
  Menu as MenuIcon,
  MenuOpen as MenuOpenIcon
} from '@mui/icons-material';
import { styled, alpha } from '@mui/material/styles';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../contexts/NotificationContext';
import { useSidebar } from '../../contexts/SidebarContext';
import Notifications from '../Notifications/Notifications';
import AnnouncementBar from '../common/AnnouncementBar';

const SearchWrapper = styled('div')(({ theme }) => ({
  position: 'relative',
  borderRadius: theme.shape.borderRadius,
  backgroundColor: alpha(theme.palette.common.white, 0.15),
  '&:hover': {
    backgroundColor: alpha(theme.palette.common.white, 0.25),
  },
  marginRight: theme.spacing(2),
  marginLeft: 0,
  width: '100%',
  [theme.breakpoints.up('sm')]: {
    marginLeft: theme.spacing(3),
    width: 'auto',
  },
}));

const SearchIconWrapper = styled('div')(({ theme }) => ({
  padding: theme.spacing(0, 2),
  height: '100%',
  position: 'absolute',
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: 'inherit',
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 1, 1, 0),
    paddingLeft: `calc(1em + ${theme.spacing(4)})`,
    transition: theme.transitions.create('width'),
    width: '100%',
    [theme.breakpoints.up('md')]: {
      width: '20ch',
    },
  },
}));

const Header = () => {
  const theme = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);
  const [notificationsAnchor, setNotificationsAnchor] = useState(null);
  const { getUnreadCount } = useNotifications();
  const { sidebarOpen, toggleSidebar } = useSidebar();

  const unreadCount = getUnreadCount();

  const handleProfileMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleNotificationsOpen = (event) => {
    setNotificationsAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setNotificationsAnchor(null);
  };

  const handleLogout = () => {
    handleMenuClose();
    logout();
  };

  const handleProfile = () => {
    handleMenuClose();
    navigate('/profile');
  };

  const handleSettings = () => {
    handleMenuClose();
    navigate('/settings');
  };

  const isMenuOpen = Boolean(anchorEl);
  const isNotificationsOpen = Boolean(notificationsAnchor);

  return (
    <AppBar
      position="sticky"
      className="app-print-hide"
      sx={{
        zIndex: theme.zIndex.drawer + 1,
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
      }}
    >
      <AnnouncementBar />
      <Toolbar>
        {/* Toggle Sidebar Button */}
        <IconButton
          edge="start"
          color="inherit"
          aria-label="toggle sidebar"
          onClick={toggleSidebar}
          sx={{ mr: 1.5 }}
        >
          {sidebarOpen ? <MenuOpenIcon /> : <MenuIcon />}
        </IconButton>

        {/* Search Bar */}
        <SearchWrapper>
          <SearchIconWrapper>
            <Search />
          </SearchIconWrapper>
          <StyledInputBase
            placeholder="Search..."
            inputProps={{ 'aria-label': 'search' }}
          />
        </SearchWrapper>

        <Box sx={{ flexGrow: 1 }} />

        {/* Notifications */}
        <IconButton
          size="large"
          color="inherit"
          onClick={handleNotificationsOpen}
        >
          <Badge badgeContent={unreadCount} color="error" max={99}>
            <NotificationsIcon />
          </Badge>
        </IconButton>

        {/* User Menu */}
        <IconButton
          size="large"
          edge="end"
          onClick={handleProfileMenuOpen}
          color="inherit"
        >
          <Avatar 
            src={user?.profileImage}
            sx={{ 
              width: 32, 
              height: 32, 
              bgcolor: 'primary.main',
              border: '2px solid',
              borderColor: 'primary.dark'
            }}
          >
            <Person />
          </Avatar>
        </IconButton>

                {/* Notifications Menu */}
        <Popover
          anchorEl={notificationsAnchor}
          open={isNotificationsOpen}
          onClose={handleMenuClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{
            sx: {
              width: { xs: 'calc(100vw - 32px)', sm: 420 },
              maxHeight: 'min(640px, calc(100vh - 80px))',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: 2,
              mt: 1,
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)'
            }
          }}
        >
          <Notifications onClose={handleMenuClose} />
        </Popover>

        {/* User Profile Menu */}
        <Menu
          anchorEl={anchorEl}
          open={isMenuOpen}
          onClose={handleMenuClose}
          PaperProps={{
            sx: { width: 200 }
          }}
        >
          <MenuItem onClick={handleProfile}>
            <Person sx={{ mr: 2 }} />
            Profile
          </MenuItem>
          <MenuItem onClick={handleSettings}>
            <Settings sx={{ mr: 2 }} />
            Settings
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout}>
            <Logout sx={{ mr: 2 }} />
            Logout
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
};

export default Header; 