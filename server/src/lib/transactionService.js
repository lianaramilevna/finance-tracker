const { getOrCreateCategory } = require("./categoryUtils");
const { recalculateAccountBalance } = require("./financeUtils");

async function insertTransaction(client, {
  userId,
  accountId,
  type,
  amount,
  date,
  note = null,
  categoryName,
  transferGroupId = null,
}) {
  const category = await getOrCreateCategory(client, {
    userId,
    type,
    name: categoryName,
  });

  if (!category) {
    throw new Error("Failed to resolve category");
  }

  const inserted = await client.query(
    `
    INSERT INTO transactions (
      user_id,
      account_id,
      category_id,
      amount,
      type,
      note,
      date,
      transfer_group_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [userId, accountId, category.id, amount, type, note, date, transferGroupId]
  );

  await recalculateAccountBalance(client, accountId);

  return inserted.rows[0].id;
}

async function getNextTransferGroupId(client) {
  const result = await client.query(`SELECT nextval('transfer_group_seq') AS id`);
  return Number(result.rows[0].id);
}

module.exports = {
  insertTransaction,
  getNextTransferGroupId,
};
