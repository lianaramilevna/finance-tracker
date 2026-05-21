import { apiRequest } from "./http";

export const getTransactions = async () => apiRequest("/transactions");

export const createTransaction = async (data) =>
  apiRequest("/transactions", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateTransaction = async (id, data) =>
  apiRequest(`/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteTransaction = async (id) =>
  apiRequest(`/transactions/${id}`, {
    method: "DELETE",
  });
