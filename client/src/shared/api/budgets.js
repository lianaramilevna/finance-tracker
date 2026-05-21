const API = "http://localhost:5000/api/budgets";

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

export const getBudgets = async (userId, month) => {
  return requestJson(
    `${API}?user_id=${encodeURIComponent(userId)}&month=${encodeURIComponent(month)}`
  );
};

export const createBudget = async (data) => {
  return requestJson(API, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const updateBudget = async (id, data) => {
  return requestJson(`${API}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
};

export const deleteBudget = async (id) => {
  return requestJson(`${API}/${id}`, {
    method: "DELETE",
  });
};
