CREATE SEQUENCE IF NOT EXISTS transfer_group_seq;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_group_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group_id
  ON transactions(transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;

ALTER TABLE goal_contributions
  ADD COLUMN IF NOT EXISTS transaction_id INTEGER NULL
    REFERENCES transactions(id) ON DELETE SET NULL;
