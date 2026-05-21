import { apiRequest } from "./http";

export const getAccounts = async ({ archived = "active" } = {}) => {
  const params = new URLSearchParams();
  if (archived && archived !== "active") {
    params.set("archived", archived);
  }
  const query = params.toString();
  return apiRequest(query ? `/accounts?${query}` : "/accounts");
};

export const createAccount = async (payload) =>
  apiRequest("/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateAccount = async (id, payload) =>
  apiRequest(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const closeAccount = async (id) =>
  apiRequest(`/accounts/${id}/close`, {
    method: "PATCH",
  });

export const restoreAccount = async (id) =>
  apiRequest(`/accounts/${id}/restore`, {
    method: "PATCH",
  });
