require("dotenv").config();

const app = require("./app");
const { initDb } = require("./initDb");

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await initDb();
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exitCode = 1;
    return;
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();