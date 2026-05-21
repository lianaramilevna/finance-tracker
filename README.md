# Balance

Веб-приложение для учёта личных финансов: операции, счета, бюджеты, цели, аналитика и импорт выписок.

**Стек:** React (Vite) + Node.js (Express) + PostgreSQL.

## Требования

- [Node.js](https://nodejs.org/) (для `npm run dev` на сервере нужен флаг `--watch`)
- [PostgreSQL](https://www.postgresql.org/) 

## Быстрый старт

### 1. База данных

Создайте базу и пользователя (в `psql` или pgAdmin):

```sql
CREATE DATABASE finance_tracker;
```

### 2. Backend

```bash
cd server
cp .env.example .env
```

Отредактируйте `server/.env`: укажите пароль PostgreSQL и **уникальный** `JWT_SECRET`.

```bash
npm install
npm run db:migrate
npm run dev
```

API будет доступен на `http://localhost:5000` (проверка: `GET http://localhost:5000/api/health`).

### 3. Frontend

В отдельном терминале:

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Приложение откроется на `http://localhost:5173`.

### 4. Первый вход

Зарегистрируйте пользователя на странице входа. После регистрации создайте счёт и добавьте операции.

## Скрипты

| Команда | Где | Описание |
|---------|-----|----------|
| `npm run dev` | `server/` | API с автоперезагрузкой (`node --watch`) |
| `npm start` | `server/` | API в production-режиме |
| `npm run db:migrate` | `server/` | Применить SQL-миграции |
| `npm run db:init` | `server/` | То же, что `db:migrate` |
| `npm run dev` | `client/` | Vite dev-сервер |
| `npm run build` | `client/` | Сборка фронтенда |

## Миграции БД

SQL-файлы лежат в `server/migrations/`:

- `001_initial_schema.sql` — таблицы: users, accounts, categories, transactions, budgets, goals, goal_contributions
- `002_seed_default_categories.sql` — глобальные категории по умолчанию
- `003_transfers_and_goal_links.sql` — связь переводов (`transfer_group_id`) и взносов в цели с операциями

Применённые миграции записываются в таблицу `schema_migrations`. Повторный запуск `npm run db:migrate` безопасен: уже применённые файлы пропускаются.

Программный запуск (из кода):

```js
const { initDb } = require("./src/initDb");
await initDb();
```

## Переменные окружения

### `server/.env`

| Переменная | Описание |
|------------|----------|
| `PORT` | Порт API (по умолчанию 5000) |
| `CLIENT_ORIGIN` | URL фронтенда для CORS (например `http://localhost:5173`) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Подключение к PostgreSQL |
| `JWT_SECRET` | Секрет для подписи токенов (обязательно сменить!) |
| `JWT_EXPIRES_IN` | Срок жизни токена (например `7d`) |

### `client/.env`

| Переменная | Описание |
|------------|----------|
| `VITE_API_URL` | Базовый URL API. В dev можно не задавать: запросы идут на `/api`, Vite проксирует их на `http://localhost:5000`. Для production-сборки укажите полный URL бэкенда. |

## Структура проекта

```
finance-tracker/
├── client/          # React SPA (Vite)
├── server/
│   ├── migrations/  # SQL-миграции
│   ├── scripts/     # migrate.js CLI
│   └── src/         # Express API
└── README.md
```

## Типичные проблемы

- **401 Unauthorized** — войдите заново (нужен JWT после обновления безопасности).
- **Ошибка подключения к БД** — проверьте `server/.env` и что PostgreSQL запущен.
- **CORS** — `CLIENT_ORIGIN` должен совпадать с URL, на котором открыт фронтенд.
