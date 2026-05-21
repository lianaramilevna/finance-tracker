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

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (type, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(12, 2) NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
      date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM categories`);
  const count = countResult.rows[0].count;

  if (count === 0) {
    for (const name of DEFAULT_CATEGORIES.expense) {
      await pool.query(
        `INSERT INTO categories (type, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        ["expense", name]
      );
    }

    for (const name of DEFAULT_CATEGORIES.income) {
      await pool.query(
        `INSERT INTO categories (type, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        ["income", name]
      );
    }
  }
}

module.exports = { initDb };