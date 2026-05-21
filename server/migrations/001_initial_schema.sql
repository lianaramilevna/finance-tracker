-- Базовая схема finance-tracker

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(30) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_username_unique UNIQUE (username),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_currency_check CHECK (currency IN ('RUB', 'EUR', 'USD'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  closed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT accounts_type_check CHECK (type IN ('card', 'cash', 'savings', 'investment'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT categories_type_check CHECK (type IN ('expense', 'income'))
);

CREATE INDEX IF NOT EXISTS idx_categories_user_type ON categories(user_id, type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_global_unique
  ON categories (type, (LOWER(TRIM(name))))
  WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL,
  type VARCHAR(10) NOT NULL,
  note TEXT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT transactions_type_check CHECK (type IN ('expense', 'income'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);

CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  limit_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT budgets_limit_check CHECK (limit_amount >= 0),
  CONSTRAINT budgets_user_category_month_unique UNIQUE (user_id, category_id, month)
);

CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  target_amount NUMERIC(14, 2) NOT NULL,
  current_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  target_date DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT goals_target_check CHECK (target_amount > 0),
  CONSTRAINT goals_current_check CHECK (current_amount >= 0),
  CONSTRAINT goals_status_check CHECK (status IN ('active', 'completed', 'paused'))
);

CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id);

CREATE TABLE IF NOT EXISTS goal_contributions (
  id SERIAL PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  account_id INTEGER NULL REFERENCES accounts(id) ON DELETE SET NULL,
  amount NUMERIC(14, 2) NOT NULL,
  note TEXT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT goal_contributions_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal_id ON goal_contributions(goal_id);
