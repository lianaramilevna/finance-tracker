const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const categoriesRoutes = require("./routes/categories");
const transactionsRoutes = require("./routes/transactions");
const accountsRoutes = require("./routes/accounts");
const budgetsRoutes = require("./routes/budgets");
const goalsRoutes = require("./routes/goals");
const importsRoutes = require("./routes/imports");
const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    res.json({ ok: true });
  } catch (error) {
    console.error("GET /api/health error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.use("/api", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/transactions", transactionsRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/budgets", budgetsRoutes);
app.use("/api/goals", goalsRoutes);
app.use("/api/imports", importsRoutes);
module.exports = app;