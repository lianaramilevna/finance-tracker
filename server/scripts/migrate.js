const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = require("../src/db");
const { runMigrations } = require("../src/migrate");

runMigrations(pool, { closePool: true })
  .then(({ applied }) => {
    if (applied.length > 0) {
      console.log(`Done. Applied ${applied.length} migration(s).`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
