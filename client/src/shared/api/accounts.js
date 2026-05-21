const API = "http://localhost:5000/api/accounts";

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

export const getAccounts = async (userId) => {
  const res = await fetch(`${API}?user_id=${userId}`);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Failed to load accounts");
  }

  return res.json();
};

export const createAccount = async (payload) => {
  return requestJson(API, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const updateAccount = async (id, payload) => {
  return requestJson(`${API}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

export const closeAccount = async (id) => {
  return requestJson(`${API}/${id}/close`, {
    method: "PATCH",
  });
};