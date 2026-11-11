import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { AccountTree as ProjectIcon } from '@mui/icons-material';

/**
 * "Charged to: Project › Sub-Project" line for an Indent / PO / GRN raised for a construction project,
 * with the budget categories its lines are charged to. Renders nothing for department-only documents.
 */
export const ChargedToPanel = ({ chargeTo, items, sx }) => {
  if (!chargeTo?.project) return null;
  const projectName = chargeTo.projectName || chargeTo.project?.name || 'Project';
  const subName = chargeTo.subProjectName || chargeTo.subProject?.name || '';
  const categories = [...new Set((items || []).map((i) => i?.budgetCategory).filter(Boolean))];

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        mb: 2,
        border: '1px solid',
        borderColor: 'primary.light',
        borderRadius: 1,
        bgcolor: 'action.hover',
        ...sx
      }}
    >
      <ProjectIcon fontSize="small" color="primary" />
      <Typography variant="body2" fontWeight={600}>Charged to:</Typography>
      <Typography variant="body2">
        {projectName}
        {subName ? ` › ${subName}` : ''}
      </Typography>
      {categories.map((c) => (
        <Chip key={c} label={c} size="small" variant="outlined" color="primary" />
      ))}
    </Box>
  );
};

export default ChargedToPanel;
