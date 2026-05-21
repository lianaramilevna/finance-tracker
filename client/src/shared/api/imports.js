import { apiRequest } from "./http";

export const previewImport = async ({ file, account_id }) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("account_id", account_id);

  return apiRequest("/imports/preview", {
    method: "POST",
    body: formData,
  });
};

export const commitImport = async (payload) =>
  apiRequest("/imports/commit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
