const API = "http://localhost:5000/api/imports";

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
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

export const previewImport = async ({ file, user_id, account_id }) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("user_id", user_id);
  formData.append("account_id", account_id);

  return requestJson(`${API}/preview`, {
    method: "POST",
    body: formData,
  });
};

export const commitImport = async (payload) => {
  return requestJson(`${API}/commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
};