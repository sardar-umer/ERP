import api from './api';

const base = '/items';

export const fetchItemCategories = () => api.get(`${base}/categories`);

export const fetchItems = (params = {}) => api.get(base, { params });

export const fetchItemMasterManageList = () => api.get(`${base}/manage-list`);

export const createItemCategory = (category, categoryPath, inventoryCategory) =>
  api.post(`${base}/categories`, { category, ...(categoryPath ? { categoryPath } : {}), ...(inventoryCategory ? { inventoryCategory } : {}) });

/** Catalog category → Finance Category mapping (the Finance Category decides inventory / GRNI / COGS accounts) */
export const fetchCategoryFinance = () => api.get(`${base}/category-finance`);

export const setCategoryFinance = (categoryPath, inventoryCategory) =>
  api.put(`${base}/category-finance`, { categoryPath, inventoryCategory: inventoryCategory || null });

export const createItemMaster = (payload) => api.post(base, payload);

export const updateItemMaster = (id, payload) => api.put(`${base}/${id}`, payload);

export const deactivateItemMaster = (id) => api.delete(`${base}/${id}`);
