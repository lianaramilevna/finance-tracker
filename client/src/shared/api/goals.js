import { apiRequest } from "./http";

export const getGoals = async () => apiRequest("/goals");

export const createGoal = async (payload) =>
  apiRequest("/goals", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const contributeToGoal = async (id, payload) =>
  apiRequest(`/goals/${id}/contribute`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateGoal = async (id, payload) =>
  apiRequest(`/goals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const getGoalContributions = async (id) =>
  apiRequest(`/goals/${id}/contributions`);

export const deleteGoal = async (id) =>
  apiRequest(`/goals/${id}`, {
    method: "DELETE",
  });
