import axios from "axios";

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const http = axios.create({ baseURL: BASE });

export const getToken = () => localStorage.getItem("jbx_token") || "";
export const setToken = (t) => (t ? localStorage.setItem("jbx_token", t) : localStorage.removeItem("jbx_token"));

http.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export const apiError = (e, fallback = "Something went wrong. Please try again.") => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg).filter(Boolean).join(" ") || fallback;
  if (!e?.response) return "You are offline — please check your internet connection.";
  return fallback;
};

export const DEVICE_ID = (() => {
  let d = localStorage.getItem("jbx_device_id");
  if (!d) {
    d = "DEV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    localStorage.setItem("jbx_device_id", d);
  }
  return d;
})();

export const api = {
  get: (path, params) => http.get(path, { params }).then((r) => r.data),
  post: (path, body) => http.post(path, body).then((r) => r.data),
  put: (path, body) => http.put(path, body).then((r) => r.data),
  patch: (path, body) => http.patch(path, body).then((r) => r.data),
  del: (path) => http.delete(path).then((r) => r.data),
};
