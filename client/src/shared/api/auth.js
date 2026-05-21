const API = "http://localhost:5000/api";

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = res.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => "");
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && data.message) ||
      (typeof data === "string" && data.trim()) ||
      `Request failed (${res.status})`;

    throw new Error(message);
  }

  return data;
}

export const checkUsernameAvailable = async (username) => {
  const safeUsername = encodeURIComponent(String(username || "").trim());
  return request(`/check-username?username=${safeUsername}`);
};

export const registerUser = (payload) =>
  request("/register", {
    method: "POST",
    body: JSON.stringify({
      username: String(payload.username || "").trim(),
      email: String(payload.email || "").trim().toLowerCase(),
      password: String(payload.password || ""),
    }),
  });

export const loginUser = (payload) =>
  request("/login", {
    method: "POST",
    body: JSON.stringify({
      login: String(payload.login || payload.email || "").trim(),
      password: String(payload.password || ""),
    }),
  });