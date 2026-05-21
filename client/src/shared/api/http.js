import { getAuthToken } from "../lib/session";

export const API_BASE = import.meta.env.VITE_API_URL || "/api";

export async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const contentType = res.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => "");
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && data.message) ||
      (typeof data === "string" && data.trim()) ||
      `Request failed (${res.status})`;

    throw new Error(message);
  }

  return data;
}
