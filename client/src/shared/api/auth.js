import { apiRequest } from "./http";

export const checkUsernameAvailable = async (username) => {
  const safeUsername = encodeURIComponent(String(username || "").trim());
  return apiRequest(`/check-username?username=${safeUsername}`);
};

export const registerUser = (payload) =>
  apiRequest("/register", {
    method: "POST",
    body: JSON.stringify({
      username: String(payload.username || "").trim(),
      email: String(payload.email || "").trim().toLowerCase(),
      password: String(payload.password || ""),
    }),
  });

export const loginUser = (payload) =>
  apiRequest("/login", {
    method: "POST",
    body: JSON.stringify({
      login: String(payload.login || payload.email || "").trim(),
      password: String(payload.password || ""),
    }),
  });

export const logoutUser = () =>
  apiRequest("/logout", {
    method: "POST",
  });
