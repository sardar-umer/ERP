import api from './api';

/**
 * Build multipart payload so per-row files travel with the batch.
 * Employees JSON keeps existing attachment metadata; new File objects go as
 * employeeAttachments_{rowIndex}.
 */
const buildRecordFormData = (payload = {}) => {
  const formData = new FormData();
  const { employees, rowFiles, ...rest } = payload;

  const employeePayload = Array.isArray(employees)
    ? employees.map((emp) => {
        const { newFiles, file, files, ...fields } = emp || {};
        return {
          ...fields,
          attachments: Array.isArray(fields.attachments) ? fields.attachments : []
        };
      })
    : employees;

  Object.entries(rest).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'object' && !(value instanceof File) && !(value instanceof Blob)) {
      formData.append(key, JSON.stringify(value));
    } else {
      formData.append(key, value);
    }
  });

  formData.append('employees', JSON.stringify(employeePayload || []));

  // Prefer explicit rowFiles map: { 0: File[], 1: File[] }; else files on each employee
  const appendRowFiles = (idx, list) => {
    (Array.isArray(list) ? list : []).forEach((file) => {
      if (file instanceof File || file instanceof Blob) {
        formData.append(`employeeAttachments_${idx}`, file, file.name || 'attachment');
      }
    });
  };

  if (rowFiles && typeof rowFiles === 'object') {
    Object.entries(rowFiles).forEach(([idx, list]) => appendRowFiles(idx, list));
  } else if (Array.isArray(employees)) {
    employees.forEach((emp, idx) => {
      appendRowFiles(idx, emp?.newFiles || emp?.files || (emp?.file ? [emp.file] : []));
    });
  }

  return formData;
};

const nonEmployeeService = {
  createRecord: async (payload) => {
    const formData = payload instanceof FormData ? payload : buildRecordFormData(payload);
    return api.post('/hr/non-employees', formData);
  },

  updateRecord: async (id, payload) => {
    const formData = payload instanceof FormData ? payload : buildRecordFormData(payload);
    return api.put(`/hr/non-employees/${id}`, formData);
  },

  deleteRecord: async (id) => {
    return api.delete(`/hr/non-employees/${id}`);
  },

  getRecords: async () => {
    return api.get('/hr/non-employees');
  },

  getRecordById: async (id) => {
    return api.get(`/hr/non-employees/${id}`);
  },

  approveByHOD: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/approve-hod`, payload);
  },

  rejectByHOD: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/reject-hod`, payload);
  },

  approveBySrDirector: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/approve-sr-director`, payload);
  },

  rejectBySrDirector: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/reject-sr-director`, payload);
  },

  approveByAVP: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/approve-avp`, payload);
  },

  rejectByAVP: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/reject-avp`, payload);
  },

  approveByChairman: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/approve-chairman`, payload);
  },

  rejectByChairman: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/reject-chairman`, payload);
  },

  getForCEO: async () => {
    return api.get('/hr/non-employees/ceo-dashboard');
  },

  approveByCEO: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/approve-ceo`, payload);
  },

  rejectByCEO: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/reject-ceo`, payload);
  },

  returnByCEO: async (id, payload = {}) => {
    return api.put(`/hr/non-employees/${id}/return-ceo`, payload);
  }
};

export default nonEmployeeService;
export { buildRecordFormData };
