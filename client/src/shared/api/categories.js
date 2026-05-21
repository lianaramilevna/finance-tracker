const API = "http://localhost:5000/api/categories";

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

export const getCategories = async (type, userId) => {
  const params = new URLSearchParams();
  params.set("type", type);
  if (userId) params.set("user_id", userId);

  const res = await fetch(`${API}?${params.toString()}`);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Failed to load categories: ${res.status}`);
  }

  return res.json();
};

export const createCategory = async (payload) => {
  return requestJson(API, {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      type: payload.type,
      user_id: payload.user_id ?? null,
    }),
  });
};