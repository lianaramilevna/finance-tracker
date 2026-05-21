function normalizeCategoryName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCategoryKey(name) {
  return normalizeCategoryName(name).toLowerCase();
}

async function findExistingCategory(client, { userId, type, name }) {
  const cleanedName = normalizeCategoryName(name);

  if (!cleanedName) {
    return null;
  }

  const result = await client.query(
    `
    SELECT id, name, type, user_id
    FROM categories
    WHERE type = $1
      AND LOWER(TRIM(name)) = LOWER(TRIM($2))
      AND (user_id = $3 OR user_id IS NULL)
    ORDER BY
      CASE
        WHEN user_id = $3 THEN 0
        WHEN user_id IS NULL THEN 1
        ELSE 2
      END,
      id ASC
    LIMIT 1
    `,
    [type, cleanedName, userId]
  );

  return result.rows[0] || null;
}

async function getOrCreateCategory(client, { userId, type, name }) {
  const cleanedName = normalizeCategoryName(name);

  if (!cleanedName || !type) {
    return null;
  }

  const existing = await findExistingCategory(client, {
    userId,
    type,
    name: cleanedName,
  });

  if (existing) {
    return existing;
  }

  const created = await client.query(
    `
    INSERT INTO categories (user_id, type, name)
    VALUES ($1, $2, $3)
    RETURNING id, name, type, user_id
    `,
    [userId, type, cleanedName]
  );

  return created.rows[0] || null;
}

async function listUniqueCategories(client, { userId, type }) {
  const result = await client.query(
    `
    WITH ranked AS (
      SELECT
        id,
        name,
        type,
        user_id,
        LOWER(TRIM(name)) AS norm_name,
        ROW_NUMBER() OVER (
          PARTITION BY LOWER(TRIM(name))
          ORDER BY
            CASE
              WHEN user_id = $2 THEN 0
              WHEN user_id IS NULL THEN 1
              ELSE 2
            END,
            id ASC
        ) AS rn
      FROM categories
      WHERE type = $1
        AND (user_id = $2 OR user_id IS NULL)
    )
    SELECT id, name, type, user_id
    FROM ranked
    WHERE rn = 1
    ORDER BY name ASC
    `,
    [type, userId]
  );

  return result.rows;
}

module.exports = {
  normalizeCategoryName,
  normalizeCategoryKey,
  findExistingCategory,
  getOrCreateCategory,
  listUniqueCategories,
};