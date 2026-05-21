const API = "http://localhost:5000/api/transactions";

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
      const data = await res.json().catch(() => ({}));
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

export const getTransactions = async (userId) => {
  const res = await fetch(`${API}?user_id=${userId}`);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Failed to load transactions: ${res.status}`);
  }

  return res.json();
};

export const createTransaction = async (data) => {
  return requestJson(API, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const updateTransaction = async (id, data) => {
  return requestJson(`${API}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
};

export const deleteTransaction = async (id) => {
  return requestJson(`${API}/${id}`, {
    method: "DELETE",
  });
};