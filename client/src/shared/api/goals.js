const API = "http://localhost:5000/api/goals";

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    if (contentType.includes("application/json")) {
      const data = await res.json();
      throw new Error(data.message || "Request failed");
    }

    const text = await res.text();
    throw new Error(text || "Request failed");
  }

  if (contentType.includes("application/json")) {
    return res.json();
  }

  return null;
}

export const getGoals = async (userId) => {
  return requestJson(`${API}?user_id=${encodeURIComponent(userId)}`);
};

export const createGoal = async (payload) => {
  return requestJson(API, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const contributeToGoal = async (id, payload) => {
  return requestJson(`${API}/${id}/contribute`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const updateGoal = async (id, payload) => {
  return requestJson(`${API}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

export const getGoalContributions = async (id) => {
  return requestJson(`${API}/${id}/contributions`);
};

export const deleteGoal = async (id) => {
  return requestJson(`${API}/${id}`, {
    method: "DELETE",
  });
};
