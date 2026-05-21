const express = require("express");
const pool = require("../db");
const {
  getOrCreateCategory,
  listUniqueCategories,
  normalizeCategoryName,
} = require("../lib/categoryUtils");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { type } = req.query;

    if (!type || !["expense", "income"].includes(type)) {
      return res.status(400).json({ message: "Type is required" });
    }

    const categories = await listUniqueCategories(pool, {
      userId: req.userId,
      type,
    });

    res.json(categories);
  } catch (error) {
    console.error("GET /api/categories error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, type } = req.body;

    if (!name || !type || !["expense", "income"].includes(type)) {
      return res.status(400).json({ message: "Invalid data" });
    }

    const cleanedName = normalizeCategoryName(name);
    if (!cleanedName) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const category = await getOrCreateCategory(pool, {
      userId: req.userId,
      type,
      name: cleanedName,
    });

    if (!category) {
      return res.status(500).json({ message: "Failed to create category" });
    }

    res.status(201).json(category);
  } catch (error) {
    console.error("POST /api/categories error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;