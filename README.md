# Balance — учёт личных финансов

Веб-приложение для ведения личного бюджета.

Идея: пользователь заводит счета, записывает доходы и расходы, ставит лимиты по категориям, копит на цели и смотрит аналитику. Отдельно есть импорт банковской выписки (CSV/XLSX) и умный помощник — он подсказывает по перерасходу, целям и тратам (часть логики на правилах, часть через LLM).

Валюта в приложении — **только RUB** (рубли).

---

## Что умеет приложение

| Раздел | Кратко |
|--------|--------|
| **Дашборд** | Сводка: баланс, доходы/расходы за месяц, последние операции |
| **Операции** | Добавление, редактирование, удаление; фильтры по счёту, категории, дате; массовые действия |
| **Счета** | Карта, наличные, сбережения, инвестиции; переводы между счетами; оценка доходности по ставке |
| **Бюджеты** | Лимиты расходов по категориям на месяц, прогресс и перерасход |
| **Цели** | Накопления с дедлайном, взносы, история, рекомендуемый платёж в месяц |
| **Аналитика** | Графики и разбивка трат по категориям |
| **Импорт** | Загрузка CSV/XLSX, авто-категоризация по MCC, проверка дубликатов |
| **Помощник** | Подсказки по бюджету и целям; чат с ИИ (если настроен Hugging Face) |
| **Настройки** | Профиль, смена пароля, очистка данных, удаление аккаунта |

На многих страницах есть **раскрывающиеся справки** — чтобы было понятнее.
---

## Стек технологий

**Frontend**
- React 19 + Vite
- React Router — маршрутизация
- Recharts — графики
- CSS без UI-фреймворка (свои стили)

**Backend**
- Node.js + Express 5
- PostgreSQL + `pg`
- JWT (Bearer + httpOnly cookie)
- bcrypt — хеш паролей
- multer + xlsx — импорт файлов

**ИИ (опционально)**
- Hugging Face Inference API (Router)
- Модель по умолчанию: `meta-llama/Llama-3.2-1B-Instruct`

Архитектура классическая: SPA на React, REST API на Express, данные в PostgreSQL.

---

## Требования

- [Node.js](https://nodejs.org/) 18+ (для сервера используется `node --watch`)
- [PostgreSQL](https://www.postgresql.org/) 14+
- npm

---

## Как запустить локально

### 1. База данных

Создайте БД в PostgreSQL:

```sql
CREATE DATABASE finance_tracker;
```

### 2. Backend

```bash
cd server
cp .env.example .env
```

Откройте `server/.env` и укажите:
- параметры подключения к PostgreSQL (`DB_*`);
- **свой** `JWT_SECRET` (не оставляйте `change_me...`).

```bash
npm install
npm run db:migrate
npm run dev
```

API поднимется на `http://localhost:5000`.  
Проверка: `GET http://localhost:5000/api/health`

### 3. Frontend

В **другом** терминале:

```bash
cd client
npm install
npm run dev
```

Приложение откроется на `http://localhost:5173`.

В dev-режиме Vite проксирует `/api` на бэкенд — отдельный `.env` на клиенте обычно не нужен.

### 4. Первый вход

1. Зарегистрируйтесь на странице входа.
2. Создайте счёт (например, «Карта»).
3. Добавьте пару операций или импортируйте выписку.

---

## Умный помощник (Hugging Face)

Помощник работает и **без ИИ** — на заранее написанных правилах (перерасход бюджета, прогресс целей и т.д.).  
Для **чата с моделью** нужен токен Hugging Face.

1. Токен: [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (право **Inference**).
2. В `server/.env`:

```env
LLM_ENABLED=true
HF_API_TOKEN=hf_ваш_токен
HF_MODEL=meta-llama/Llama-3.2-1B-Instruct
```

3. Перезапустите сервер.
4. В приложении: **Умный помощник** → статус «ИИ подключён».

Если токен не задан или API недоступен — правила и подсказки всё равно работают, просто без генерации текста моделью.

---

## Скрипты

| Команда | Папка | Что делает |
|---------|-------|------------|
| `npm run dev` | `server/` | API с автоперезагрузкой |
| `npm start` | `server/` | API без watch (prod) |
| `npm run db:migrate` | `server/` | Применить SQL-миграции |
| `npm run dev` | `client/` | Vite dev-сервер |
| `npm run build` | `client/` | Production-сборка |
| `npm run preview` | `client/` | Просмотр собранного фронта |

---

## Миграции БД

Файлы в `server/migrations/`:

| Файл | Содержание |
|------|------------|
| `001_initial_schema.sql` | users, accounts, categories, transactions, budgets, goals |
| `002_seed_default_categories.sql` | категории по умолчанию |
| `003_transfers_and_goal_links.sql` | переводы (`transfer_group_id`), связь взносов с операциями |
| `004_account_annual_rate.sql` | ставка % для сбережений/инвестиций |
| `005_force_rub.sql` | валюта пользователя — RUB |

Повторный `npm run db:migrate` безопасен: уже применённые миграции пропускаются (таблица `schema_migrations`).

---

## Переменные окружения

### `server/.env`

| Переменная | Описание |
|------------|----------|
| `PORT` | Порт API (по умолчанию 5000) |
| `CLIENT_ORIGIN` | URL фронта для CORS (`http://localhost:5173`) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL |
| `JWT_SECRET` | Секрет для JWT (**обязательно сменить!**) |
| `JWT_EXPIRES_IN` | Срок токена, например `7d` |
| `LLM_ENABLED` | `true` / `false` |
| `HF_API_TOKEN` | Токен Hugging Face |
| `HF_MODEL` | Имя модели на Router |
| `HF_FALLBACK_MODELS` | Запасные модели через запятую (опционально) |
| `HF_ROUTER_URL` | URL Router (по умолчанию `https://router.huggingface.co/v1`) |

### `client/.env` (обычно не нужен в dev)

| Переменная | Описание |
|------------|----------|
| `VITE_API_URL` | Полный URL API. Для production-сборки, если фронт и бэк на разных доменах |

---

## Структура проекта

```
finance-tracker/
├── client/                 # React SPA
│   └── src/
│       ├── app/            # роутер
│       ├── pages/          # страницы (Dashboard, Transactions, …)
│       ├── features/       # формы и модалки
│       ├── widgets/        # layout, графики
│       └── shared/         # api, утилиты, UI-компоненты
├── server/
│   ├── migrations/         # SQL-миграции
│   ├── scripts/            # migrate.js
│   └── src/
│       ├── routes/         # REST-эндпоинты
│       ├── lib/            # парсер импорта, помощник, LLM
│       └── middleware/     # authenticate
└── README.md
```

---

## API (основное)

Все защищённые маршруты требуют JWT (`Authorization: Bearer …` или cookie `token`).

- `POST /api/register`, `POST /api/login` — регистрация и вход
- `GET/POST/PATCH/DELETE /api/transactions` — операции
- `GET/POST/PATCH/DELETE /api/accounts` — счета
- `GET/POST/PATCH/DELETE /api/budgets` — бюджеты
- `GET/POST/PATCH/DELETE /api/goals` — цели
- `POST /api/goals/:id/contribute` — пополнение цели
- `POST /api/imports` — импорт выписки
- `POST /api/assistant/chat` — чат с помощником
- `GET /api/assistant/insights` — подсказки
- `DELETE /api/users/:id`, `POST /api/users/:id/clear-data` — управление аккаунтом

Полный список — в файлах `server/src/routes/`.

---

## Частые проблемы

**401 Unauthorized**  
Сессия истекла или неверный токен. Выйдите и войдите снова.

**Не подключается к БД**  
Проверьте, что PostgreSQL запущен, и что `DB_*` в `.env` совпадают с вашей установкой.

**CORS**  
`CLIENT_ORIGIN` должен совпадать с адресом, на котором открыт фронт (обычно `http://localhost:5173`).

**ИИ «офлайн»**  
Проверьте `HF_API_TOKEN`, `LLM_ENABLED=true` и имя модели. Без токена приложение всё равно работает — просто без LLM-чата.

**Импорт не находит колонки**  
Поддерживаются типичные форматы CSV/XLSX банков. Если структура нестандартная — возможно, придётся подправить маппинг в `server/src/lib/importParser.js`.

---

## Заметки по разработке

- Переводы между счетами **не считаются расходом** в аналитике и бюджете.
- Ставка % на счёте «Сбережения» / «Инвестиции» — это **ориентир в UI**, реальные проценты нужно вносить операцией «Доход».
- Цель — это план и прогресс; деньги физически лежат на счетах (часто «Сбережения»).
- Секреты хранятся только в `server/.env` — **не коммитьте** этот файл в git.

---
Если что-то не запускается — сначала `npm run db:migrate`, потом проверить `.env` и логи сервера в терминале.
