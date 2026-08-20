import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Optional: Add default interceptors for auth headers in future phases
api.interceptors.request.use(
  (config) => {
    // We will attach bearer tokens here in later phases
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);
