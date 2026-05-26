import { apiRequest } from "./http";

export const getAssistantInsights = (period = "month", accountId = null) => {
  const params = new URLSearchParams({ period });
  if (accountId != null && accountId !== "" && accountId !== "all") {
    params.set("account_id", String(accountId));
  }
  return apiRequest(`/assistant/insights?${params.toString()}`);
};

export const getAssistantStatus = () => apiRequest("/assistant/status");

export const askAssistant = (question, period = "month", accountId = null) =>
  apiRequest("/assistant/chat", {
    method: "POST",
    body: JSON.stringify({
      question,
      period,
      account_id:
        accountId != null && accountId !== "" && accountId !== "all"
          ? Number(accountId)
          : null,
    }),
  });
