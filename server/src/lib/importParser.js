const XLSX = require("xlsx");
const { resolveCategory, extractMccFromRow, normalizeText } = require("./mccCategories");

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function findMatchingKey(row, aliases = []) {
  const keys = Object.keys(row || {});
  if (keys.length === 0) return null;

  const normalizedKeys = keys.map((key) => ({
    key,
    norm: normalizeHeader(key),
  }));

  for (const alias of aliases) {
    const normAlias = normalizeHeader(alias);

    const exact = normalizedKeys.find(
      (item) =>
        item.norm === normAlias ||
        item.norm.includes(normAlias) ||
        normAlias.includes(item.norm)
    );

    if (exact) return exact.key;
  }

  return null;
}

function parseAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }

  if (value instanceof Date) return NaN;

  const raw = String(value || "")
    .replace(/\u00A0/g, " ")
    .trim();

  if (!raw) return NaN;

  const cleaned = raw
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function formatDateYMD(year, month, day) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateYMD(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 1000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return formatDateYMD(parsed.y, parsed.m, parsed.d);
    }
  }

  const raw = String(value)
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ");

  if (!raw) return null;

  const datePartOnly = raw.split(" ")[0];

  let match = raw.match(/^(\d{4})[-./](\d{2})[-./](\d{2})(?:[ T].*)?$/);
  if (match) {
    const [, y, m, d] = match;
    return formatDateYMD(y, m, d);
  }

  match = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})(?:[ T].*)?$/);
  if (match) {
    const [, d, m, y] = match;
    return formatDateYMD(y, m, d);
  }

  match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T].*)?$/);
  if (match) {
    const [, d, m, y] = match;
    return formatDateYMD(y, m, d);
  }

  const isoLike = raw.replace(" ", "T");
  const parsed = new Date(isoLike);

  if (!Number.isNaN(parsed.getTime())) {
    return formatDateYMD(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate()
    );
  }

  const parsedDateOnly = new Date(datePartOnly);
  if (!Number.isNaN(parsedDateOnly.getTime())) {
    return formatDateYMD(
      parsedDateOnly.getFullYear(),
      parsedDateOnly.getMonth() + 1,
      parsedDateOnly.getDate()
    );
  }

  return null;
}

function inferType(typeValue, amountValue) {
  const type = normalizeText(typeValue);

  if (
    type.includes("расход") ||
    type.includes("expense") ||
    type.includes("debit") ||
    type.includes("withdraw") ||
    type.includes("out")
  ) {
    return "expense";
  }

  if (
    type.includes("доход") ||
    type.includes("income") ||
    type.includes("credit") ||
    type.includes("deposit") ||
    type.includes("in")
  ) {
    return "income";
  }

  if (amountValue < 0) return "expense";
  return "income";
}

function extractColumnValue(row, keys) {
  const key = findMatchingKey(row, keys);
  return key ? row[key] : "";
}

function readSheetRows(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
}

function parseRows(rawRows) {
  const rows = [];
  const errors = [];
  const seenInFile = new Set();

  rawRows.forEach((row, index) => {
    const rawDate = extractColumnValue(row, [
      "date",
      "дата",
      "дата операции",
      "дата проводки",
      "operation date",
      "transaction date",
      "date/time",
      "datetime",
      "время",
      "дата и время",
    ]);

    const rawDescription = extractColumnValue(row, [
      "description",
      "описание",
      "операция",
      "merchant",
      "memo",
      "comment",
      "details",
      "назначение платежа",
    ]);

    const rawAmount = extractColumnValue(row, [
      "amount",
      "сумма",
      "value",
      "sum",
      "total",
      "сумма операции",
      "сумма в валюте счета",
      "сумма в валюте счета ",
    ]);

    const rawType = extractColumnValue(row, [
      "type",
      "тип",
      "direction",
      "вид операции",
      "debit/credit",
      "статус",
    ]);

    const rawCategory = extractColumnValue(row, ["category", "категория"]);

    const date = parseDate(rawDate);
    const parsedAmount = parseAmount(rawAmount);

    if (!date) {
      errors.push({
        rowNumber: index + 2,
        reason: `Не удалось распознать дату: ${String(rawDate)}`,
      });
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      errors.push({
        rowNumber: index + 2,
        reason: "Не удалось распознать сумму",
      });
      return;
    }

    const type = inferType(rawType, parsedAmount);
    const amount = Math.abs(parsedAmount);
    const note = String(rawDescription || "").trim() || null;
    const category = resolveCategory({
      type,
      description: rawDescription,
      rawCategory,
      row,
    });

    const signature = `${date}|${type}|${amount.toFixed(2)}|${normalizeText(note)}`;

    const duplicateInFile = seenInFile.has(signature);
    seenInFile.add(signature);

    rows.push({
      rowNumber: index + 2,
      date,
      amount,
      type,
      note,
      category,
      duplicateInFile,
      signature,
      mcc: extractMccFromRow(row),
    });
  });

  const incomeTotal = rows
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const expenseTotal = rows
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    rows,
    errors,
    summary: {
      totalRows: rows.length,
      incomeTotal,
      expenseTotal,
      netEffect: incomeTotal - expenseTotal,
      invalidRows: errors.length,
      duplicateInFileRows: rows.filter((item) => item.duplicateInFile).length,
      categorizedRows: rows.filter((item) => item.category).length,
      mccMatchedRows: rows.filter((item) => item.mcc).length,
    },
  };
}

function buildSignature({ date, type, amount, note }) {
  return `${String(date || "").trim()}|${String(type || "").trim()}|${Number(
    amount || 0
  ).toFixed(2)}|${normalizeText(note)}`;
}

module.exports = {
  readSheetRows,
  parseRows,
  buildSignature,
  normalizeText,
};