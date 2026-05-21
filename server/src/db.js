const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  port: 5432,
  host: "localhost",
  database: "finance_tracker",
  user: "postgres",
  password: "Homescapes14l", // ← поставь свой пароль
  
});

module.exports = pool;