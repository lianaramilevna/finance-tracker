import { apiRequest } from "./http";

export const getBudgets = async (month) =>
  apiRequest(`/budgets?month=${encodeURIComponent(month)}`);

export const createBudget = async (data) =>
  apiRequest("/budgets", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateBudget = async (id, data) =>
  apiRequest(`/budgets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteBudget = async (id) =>
  apiRequest(`/budgets/${id}`, {
    method: "DELETE",
  });
