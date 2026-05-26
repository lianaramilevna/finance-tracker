import { apiRequest } from "./http";

export const getUserSettings = async (userId) =>
  apiRequest(`/users/${userId}/settings`);

export const updateUserSettings = async (userId, payload) =>
  apiRequest(`/users/${userId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const changeUserPassword = async (userId, payload) =>
  apiRequest(`/users/${userId}/password`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const clearUserData = async (userId) =>
  apiRequest(`/users/${userId}/clear-data`, {
    method: "POST",
  });

export const deleteUserAccount = async (userId) =>
  apiRequest(`/users/${userId}`, {
    method: "DELETE",
  });
