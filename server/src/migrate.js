const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    `SELECT filename FROM schema_migrations ORDER BY id ASC`
  );
  return new Set(result.rows.map((row) => row.filename));
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function runMigrations(pool, options = {}) {
  const { closePool = false } = options;
  const files = listMigrationFiles();

  if (files.length === 0) {
    console.warn("No migration files found in server/migrations");
    if (closePool) {
      await pool.end();
    }
    return { applied: [] };
  }

  const client = await pool.connect();
  const appliedNow = [];

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    for (const filename of files) {
      if (applied.has(filename)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [filename]
        );
        await client.query("COMMIT");
        appliedNow.push(filename);
        console.log(`Migration applied: ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    if (closePool) {
      await pool.end();
    }
  }

  if (appliedNow.length === 0) {
    console.log("Database is up to date");
  }

  return { applied: appliedNow };
}

module.exports = {
  runMigrations,
  listMigrationFiles,
};
