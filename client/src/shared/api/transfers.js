import { apiRequest } from "./http";

export const createTransfer = async (payload) =>
  apiRequest("/transfers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
