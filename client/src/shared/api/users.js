const API = "http://localhost:5000/api/users";

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

export const getUserSettings = async (userId) => {
  const res = await fetch(`${API}/${userId}/settings`);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Failed to load settings");
  }

  return res.json();
};

export const updateUserSettings = async (userId, payload) => {
  return requestJson(`${API}/${userId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

export const changeUserPassword = async (userId, payload) => {
  return requestJson(`${API}/${userId}/password`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};