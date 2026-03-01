/**
 * api.service.js
 * Centralized Axios-based API client for the ISP CRM frontend.
 * Handles auth tokens, request/response interceptors, and error normalization.
 *
 * Usage:
 *   import api from './services/api.service';
 *   const leads = await api.leads.getAll({ status: 'new', page: 1 });
 */

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api/v1';

// ── Token management ──────────────────────────────────────────────────────────
const TokenStore = {
  getAccess:   () => localStorage.getItem('crm_access_token'),
  getRefresh:  () => localStorage.getItem('crm_refresh_token'),
  setAccess:   (t) => localStorage.setItem('crm_access_token', t),
  setTokens:   (access, refresh) => {
    localStorage.setItem('crm_access_token', access);
    localStorage.setItem('crm_refresh_token', refresh);
  },
  clear:       () => {
    localStorage.removeItem('crm_access_token');
    localStorage.removeItem('crm_refresh_token');
    localStorage.removeItem('crm_user');
  },
  getUser:     () => {
    try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch { return null; }
  },
  setUser:     (u) => localStorage.setItem('crm_user', JSON.stringify(u)),
};

// ── Raw fetch wrapper ─────────────────────────────────────────────────────────
let isRefreshing   = false;
let refreshQueue   = [];

const processRefreshQueue = (error, token = null) => {
  refreshQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  refreshQueue = [];
};

const request = async (method, path, data = null, params = null, isRetry = false) => {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v);
    });
  }

  const headers = { 'Content-Type': 'application/json' };
  const token = TokenStore.getAccess();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const config = { method: method.toUpperCase(), headers };
  if (data) config.body = JSON.stringify(data);

  const res = await fetch(url.toString(), config);

  // Handle 401 — try token refresh
  if (res.status === 401 && !isRetry) {
    if (isRefreshing) {
      // Queue the request until refresh completes
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          resolve: (newToken) => {
            headers['Authorization'] = `Bearer ${newToken}`;
            resolve(request(method, path, data, params, true));
          },
          reject,
        });
      });
    }

    isRefreshing = true;
    try {
      const refreshToken = TokenStore.getRefresh();
      if (!refreshToken) throw new Error('No refresh token');

      const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refreshToken }),
      });

      if (!refreshRes.ok) throw new Error('Refresh failed');

      const { data: { accessToken } } = await refreshRes.json();
      TokenStore.setAccess(accessToken);
      processRefreshQueue(null, accessToken);

      // Retry original request
      return request(method, path, data, params, true);
    } catch (err) {
      processRefreshQueue(err);
      TokenStore.clear();
      window.location.href = '/login';
      throw err;
    } finally {
      isRefreshing = false;
    }
  }

  const json = await res.json();
  if (!res.ok) {
    const error = new Error(json.message || `HTTP ${res.status}`);
    error.status = res.status;
    error.errors = json.errors;
    throw error;
  }

  return json;
};

const get    = (path, params) => request('GET',    path, null, params);
const post   = (path, data)   => request('POST',   path, data);
const patch  = (path, data)   => request('PATCH',  path, data);
const del    = (path)         => request('DELETE', path);

// ═════════════════════════════════════════════════════════════════════════════
// API modules
// ═════════════════════════════════════════════════════════════════════════════

const api = {

  // ── Auth ───────────────────────────────────────────────────────────────────
  auth: {
    login: async (email, password) => {
      const res = await post('/auth/login', { email, password });
      TokenStore.setTokens(res.data.accessToken, res.data.refreshToken);
      TokenStore.setUser(res.data.user);
      return res.data;
    },
    logout: async () => {
      try {
        const refreshToken = TokenStore.getRefresh();
        await post('/auth/logout', { refreshToken });
      } finally {
        TokenStore.clear();
      }
    },
    me:             () => get('/auth/me'),
    changePassword: (data) => patch('/auth/change-password', data),
    currentUser:    () => TokenStore.getUser(),
    isLoggedIn:     () => !!TokenStore.getAccess(),
  },

  // ── Leads ──────────────────────────────────────────────────────────────────
  leads: {
    getAll:     (params) => get('/leads', params),
    getById:    (id)     => get(`/leads/${id}`),
    create:     (data)   => post('/leads', data),

    // Workflow
    feasibility:  (id, data) => patch(`/leads/${id}/feasibility`,  data),
    installation: (id, data) => patch(`/leads/${id}/installation`, data),
    payment:      (id, data) => patch(`/leads/${id}/payment`,      data),
    setStatus:    (id, status) => patch(`/leads/${id}/status`, { status }),  // admin override

    // Comments & docs
    getComments:  (id)          => get(`/leads/${id}/comments`),
    addComment:   (id, comment, isInternal = true) => post(`/leads/${id}/comments`, { comment, is_internal: isInternal }),
    getDocuments: (id)          => get(`/leads/${id}/documents`),
    uploadDocument: async (id, file, docType = 'general') => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('doc_type', docType);
      const token = TokenStore.getAccess();
      const res = await fetch(`${BASE_URL}/leads/${id}/documents`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },

    // Dashboard & reports
    getDashboard: () => get('/leads/dashboard'),
    getReports:   (params) => get('/leads/reports', params),
  },

  // ── Users ──────────────────────────────────────────────────────────────────
  users: {
    getAll:   (params) => get('/users', params),
    getById:  (id)     => get(`/users/${id}`),
    create:   (data)   => post('/users', data),
    update:   (id, data) => patch(`/users/${id}`, data),
    delete:   (id)     => del(`/users/${id}`),
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  notifications: {
    getAll:      () => get('/notifications'),
    markAllRead: () => patch('/notifications/read-all'),
    markRead:    (id) => patch(`/notifications/${id}/read`),
  },

  // ── Master data ────────────────────────────────────────────────────────────
  master: {
    packages: () => get('/master/packages'),
    areas:    () => get('/master/areas'),
  },

  // ── Audit ──────────────────────────────────────────────────────────────────
  audit: {
    getLogs: (params) => get('/audit', params),
  },

  // ── Health ─────────────────────────────────────────────────────────────────
  health: () => get('/health'),
};

export default api;
export { TokenStore };
