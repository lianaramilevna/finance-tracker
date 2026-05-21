function getMonthKeyFromDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return null;
  }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  return { start, end };
}

async function recalculateAccountBalance(client, accountId) {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN type = 'income' THEN amount
        ELSE -amount
      END
    ), 0) AS balance
    FROM transactions
    WHERE account_id = $1
    `,
    [accountId]
  );

  const balance = Number(result.rows[0]?.balance || 0);

  await client.query(
    `
    UPDATE accounts
    SET balance = $1
    WHERE id = $2
    `,
    [balance, accountId]
  );

  return balance;
}

module.exports = {
  getMonthKeyFromDate,
  getMonthRange,
  recalculateAccountBalance,
};