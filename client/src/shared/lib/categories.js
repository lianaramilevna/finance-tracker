const DEFAULT_CATEGORIES = {
    expense: [
  "Продукты",
  "Кафе и рестораны",
  "Транспорт",
  "Дом",
  "Подписки",
  "Развлечения",
  "Здоровье",
  "Красота",
  "Образование",
  "Одежда и обувь",
  "Техника",
],
  income: [
    "Зарплата",
    "Фриланс",
    "Инвестиции",
    "Подарки",
    "Проценты",
  ],
};
const STORAGE_KEY = "categories";

const normalizeCategories = (data) => {
  if (!data || typeof data !== "object") {
    return structuredClone(DEFAULT_CATEGORIES);
  }

  return {
    expense: Array.isArray(data.expense) ? data.expense : [...DEFAULT_CATEGORIES.expense],
    income: Array.isArray(data.income) ? data.income : [...DEFAULT_CATEGORIES.income],
  };
};

export const getAllCategories = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_CATEGORIES));
      return structuredClone(DEFAULT_CATEGORIES);
    }

    const parsed = JSON.parse(saved);
    const normalized = normalizeCategories(parsed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_CATEGORIES));
    return structuredClone(DEFAULT_CATEGORIES);
  }
};

export const getCategories = (type) => {
  const all = getAllCategories();
  return Array.isArray(all[type]) ? all[type] : [];
};

export const addCategory = (type, newCategory) => {
  const trimmed = newCategory.trim();
  if (!trimmed) return getAllCategories();

  const all = getAllCategories();

  if (!Array.isArray(all[type])) {
    all[type] = [];
  }

  const exists = all[type].some(
    (cat) => cat.toLowerCase() === trimmed.toLowerCase()
  );

  if (exists) return all;

  const updated = {
    ...all,
    [type]: [...all[type], trimmed],
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
};