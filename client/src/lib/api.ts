import axios from "axios";

const defaultApiBaseUrl =
  typeof window === "undefined" ? "http://localhost:4000" : `${window.location.protocol}//${window.location.hostname}:4000`;

export const API_BASE_URL = import.meta.env.VITE_API_URL || defaultApiBaseUrl;

export const api = axios.create({
  baseURL: API_BASE_URL
});

export function setAuthToken(token: string | null) {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
}
