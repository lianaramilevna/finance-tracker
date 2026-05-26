import { apiRequest } from "./http";

export const previewImport = async ({ file, account_id }) => {
  const formData = new FormData();
  const fileName = file?.name || "import.xlsx";
  formData.append("file", file, fileName);
  formData.append("account_id", String(account_id));

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
