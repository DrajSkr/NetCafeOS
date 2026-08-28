import axios from "axios";

/**
 * Centralized Axios instance for all API calls.
 * Uses the VITE_API_URL env var so the base URL is configurable
 * across dev, staging, and production without touching component code.
 */
const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
    headers: {
        "Content-Type": "application/json"
    }
});

/**
 * Request interceptor — automatically attaches the client JWT
 * from localStorage to every outgoing request (if present).
 */
api.interceptors.request.use((config) => {
    // If the request already has an Authorization header (e.g. set by getAdminHeaders()), respect it!
    if (config.headers.Authorization) {
        return config;
    }
    const token = localStorage.getItem("clientToken");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default api;
