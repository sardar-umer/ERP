/** The President is the user whose position is exactly "President" (not Vice / Assistant Vice / Coordinator to President) */
export const isPresidentUser = (user) => String(user?.position || '').trim().toLowerCase() === 'president';

/** Who may open the President Dashboard: the President and the developer role */
export const canSeePresidentDashboard = (user) => isPresidentUser(user) || user?.role === 'developer';
