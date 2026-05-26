const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const { authenticate } = require("./middleware/authenticate");
const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const categoriesRoutes = require("./routes/categories");
const transactionsRoutes = require("./routes/transactions");
const accountsRoutes = require("./routes/accounts");
const budgetsRoutes = require("./routes/budgets");
const goalsRoutes = require("./routes/goals");
const importsRoutes = require("./routes/imports");
const transfersRoutes = require("./routes/transfers");
const assistantRoutes = require("./routes/assistant");

const app = express();

const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  })
);
app.use(cookieParser());
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
app.use("/api/users", authenticate, usersRoutes);
app.use("/api/categories", authenticate, categoriesRoutes);
app.use("/api/transactions", authenticate, transactionsRoutes);
app.use("/api/accounts", authenticate, accountsRoutes);
app.use("/api/budgets", authenticate, budgetsRoutes);
app.use("/api/goals", authenticate, goalsRoutes);
app.use("/api/imports", authenticate, importsRoutes);
app.use("/api/transfers", authenticate, transfersRoutes);
app.use("/api/assistant", authenticate, assistantRoutes);

module.exports = app;
