const { Pool } = require("pg");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  host: process.env.DB_HOST || process.env.PGHOST || "localhost",
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  database: process.env.DB_NAME || process.env.PGDATABASE || "finance_tracker",
  user: process.env.DB_USER || process.env.PGUSER || "postgres",
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
});

module.exports = pool;
