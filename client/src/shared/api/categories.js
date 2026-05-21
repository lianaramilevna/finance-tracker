import { apiRequest } from "./http";

export const getCategories = async (type) => {
  const params = new URLSearchParams();
  params.set("type", type);
  return apiRequest(`/categories?${params.toString()}`);
};

export const createCategory = async (payload) =>
  apiRequest("/categories", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      type: payload.type,
    }),
  });
