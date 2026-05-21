export const getCurrentUser = () => {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveCurrentUser = (user) => {
  localStorage.setItem("user", JSON.stringify(user));
};