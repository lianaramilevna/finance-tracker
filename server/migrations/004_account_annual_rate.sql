-- Годовая ставка / ожидаемая доходность для вкладов и инвестиционных счетов

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS annual_rate_percent NUMERIC(5, 2) NULL;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_annual_rate_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_annual_rate_check
  CHECK (
    annual_rate_percent IS NULL
    OR (annual_rate_percent >= 0 AND annual_rate_percent <= 100)
  );

COMMENT ON COLUMN accounts.annual_rate_percent IS
  'Годовая ставка % для savings (вклад) или ожидаемая доходность для investment';
