const pool = require("./db");
const { runMigrations } = require("./migrate");

async function initDb() {
  return runMigrations(pool);
}

module.exports = { initDb };
