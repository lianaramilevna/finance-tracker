const USER_KEY = "user";
const TOKEN_KEY = "token";

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

export const getCurrentUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveSession = ({ user, token }) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(TOKEN_KEY, token);
};

export const updateCurrentUser = (user) => {
  const token = getAuthToken();
  if (token) {
    saveSession({ user, token });
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
};

export const isAuthenticated = () => Boolean(getAuthToken() && getCurrentUser());
