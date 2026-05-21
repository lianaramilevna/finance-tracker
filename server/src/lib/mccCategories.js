function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function extractMcc(text) {
  const raw = String(text || "");
  const match = raw.match(/\bMCC\b\s*[:\-]?\s*(\d{4})\b/i);
  return match ? match[1] : null;
}

function extractMccFromRow(row) {
  const values = Object.values(row || {});
  for (const value of values) {
    const mcc = extractMcc(value);
    if (mcc) return mcc;
  }
  return null;
}

function mccMatchesSpec(mcc, spec) {
  if (!mcc || spec == null) return false;

  const mccNum = Number.parseInt(String(mcc), 10);
  if (!Number.isFinite(mccNum)) return false;

  const normalizedSpec = String(spec).replace(/[–—]/g, "-").trim();

  if (normalizedSpec.includes("-")) {
    const [startRaw, endRaw] = normalizedSpec.split("-").map((part) => part.trim());
    const startNum = Number.parseInt(startRaw, 10);
    const endNum = Number.parseInt(endRaw, 10);

    if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) {
      return false;
    }

    return mccNum >= startNum && mccNum <= endNum;
  }

  const singleNum = Number.parseInt(normalizedSpec, 10);
  if (!Number.isFinite(singleNum)) return false;

  return mccNum === singleNum;
}

function ruleMatchesMcc(mcc, rule) {
  return (rule.mccSpecs || []).some((spec) => mccMatchesSpec(mcc, spec));
}

function scoreRule(rule, text) {
  const keywords = rule.keywords || [];
  let score = 0;

  for (const keyword of keywords) {
    if (keyword && text.includes(normalizeText(keyword))) {
      score += 1;
    }
  }

  return score;
}

function rule(type, category, mccSpecs = [], keywords = [], priority = 100) {
  return { type, category, mccSpecs, keywords, priority };
}

const CATEGORY_RULES = [
  rule(
    "expense",
    "Автоуслуги",
    [
      "4784",
      "5013",
      "5271",
      "5511",
      "5521",
      "5531-5533",
      "5551",
      "5561",
      "5571",
      "5592",
      "5598",
      "5599",
      "7511",
      "7523",
      "7531",
      "7534",
      "7535",
      "7538",
      "7542",
      "7549",
      "3990",
      "5172",
      "5541",
      "5542",
      "5552",
      "5983",
      "9752",
    ],
    [
      "авто",
      "auto",
      "car",
      "машина",
      "заправ",
      "азс",
      "fuel",
      "gas",
      "шина",
      "шиномонтаж",
      "мойка",
      "parking",
      "парковка",
      "service",
      "сервис",
      "сто",
      "oil",
      "запчаст",
    ],
    10
  ),
  rule(
    "expense",
    "Активный отдых",
    ["7032", "7932", "7933", "7941", "7992", "7996-7999"],
    ["отдых", "activity", "active", "trip", "tour", "sport club", "fitness"],
    20
  ),
  rule(
    "expense",
    "Здоровье",
    [
      "5122",
      "5912",
      "4119",
      "5047",
      "5975",
      "5976",
      "8011",
      "8021",
      "8031",
      "8041-8044",
      "8049",
      "8050",
      "8062",
      "8071",
      "8099",
    ],
    ["здоров", "health", "doctor", "clinic", "аптека", "pharmacy", "medicine", "медиц"],
    30
  ),
  rule(
    "expense",
    "Детские товары",
    ["5641", "5945"],
    ["детск", "children", "baby", "kids"],
    40
  ),
  rule(
    "expense",
    "Дом и ремонт",
    [
      "0780",
      "1520",
      "1711",
      "1731",
      "1740",
      "1750",
      "1761",
      "1771",
      "2842",
      "3990",
      "5021",
      "5039",
      "5046",
      "5051",
      "5072",
      "5074",
      "5085",
      "5198",
      "5200",
      "5211",
      "5231",
      "5251",
      "5261",
      "5712-5714",
      "5718",
      "5719",
      "5950",
      "5996",
      "7217",
      "7641",
      "7692",
      "7699",
    ],
    ["дом", "home", "repair", "ремонт", "строит", "construction", "materials", "ikea", "obi", "leroy", "мебель", "furniture"],
    50
  ),
  rule(
    "expense",
    "Кафе и рестораны",
    ["3990", "5811-5813"],
    ["кафе", "ресторан", "restaurant", "coffee", "cafe", "starbucks", "dodo", "pizza", "burger", "sushi"],
    60
  ),
  rule(
    "expense",
    "Книги",
    ["2741", "5111", "5192", "5942", "5943", "5994"],
    ["книг", "book", "books", "literature", "publisher", "издатель"],
    70
  ),
  rule(
    "expense",
    "Красота",
    ["5977", "7230", "7297", "7298"],
    ["красот", "beauty", "salon", "nails", "барбершоп", "парикмах"],
    80
  ),
  rule(
    "expense",
    "Маркетплейсы",
    ["3990", "3991", "5262", "5300", "5399", "5964"],
    ["marketplace", "маркетплейс", "wildberries", "wb", "ozon", "lamoda", "aliexpress", "sbermarket"],
    90
  ),
  rule(
    "expense",
    "Образование",
    ["3990", "8211", "8220", "8241", "8244", "8249", "8299", "8351"],
    ["образован", "education", "school", "course", "курс", "университет", "academy"],
    100
  ),
  rule(
    "expense",
    "Одежда и обувь",
    [
      "5137",
      "5139",
      "5611",
      "5621",
      "5631",
      "5651",
      "5661",
      "5681",
      "5691",
      "5697-5699",
      "5931",
      "5948",
      "7251",
      "7296",
      "7631",
    ],
    ["одежд", "обув", "clothes", "shoes", "fashion", "zara", "hm", "uniqlo", "nike", "adidas"],
    110
  ),
  rule(
    "expense",
    "Продукты",
    ["3990", "3991", "5262", "5300", "5310", "5311", "5331", "5399", "5411", "5422", "5441", "5451", "5462", "5499", "5964", "7278", "9751"],
    ["продукт", "grocery", "supermarket", "market", "auchan", "ашан", "magnit", "магнит", "lenta", "лента", "perekrestok", "перекрест", "pyaterochka", "пятерочка"],
    120
  ),
  rule(
    "expense",
    "Развлечения",
    ["5733", "5735", "5946", "5947", "5949", "5970-5972", "5998", "7221", "7395", "7829", "7832", "7841", "7911", "7922", "7929", "7991", "7993", "7994"],
    ["развлеч", "entertainment", "cinema", "movie", "театр", "концерт", "игра", "game", "ticket"],
    130
  ),
  rule(
    "expense",
    "Связь, интернет и ТВ",
    ["4813-4816", "4821", "4899", "7372", "7375"],
    ["связ", "интернет", "internet", "tv", "mobile", "telecom", "provider"],
    140
  ),
  rule(
    "expense",
    "Спортивные товары",
    ["5655", "5940", "5941"],
    ["спорт", "sport", "fitness", "gym", "decathlon", "sports"],
    150
  ),
  rule(
    "expense",
    "Такси",
    ["3990", "4121"],
    ["такси", "taxi", "yandex go", "яндекс go", "uber", "bolt", "cab"],
    160
  ),
  rule(
    "expense",
    "Техника",
    ["3990", "5044", "5045", "5065", "5722", "5732", "5978", "5997", "7379", "7622", "7623", "7629"],
    ["техник", "tech", "electronics", "electro", "computer", "laptop", "phone", "dns", "mvideo", "eldorado"],
    170
  ),
  rule(
    "expense",
    "Транспорт",
    ["3990", "4011-4112", "4131", "4729", "4789"],
    ["транспорт", "transport", "metro", "метро", "bus", "автобус", "train", "поезд", "ticket", "билет", "flight", "авиа"],
    180
  ),
  rule(
    "expense",
    "Фастфуд",
    ["3990", "5814"],
    ["fastfood", "fast food", "фастфуд", "burger", "kfc", "mcdonald", "subway", "pizza"],
    190
  ),
  rule(
    "expense",
    "Хобби",
    ["5946", "5947", "5949", "5998", "7221", "7395", "7993", "7994"],
    ["хобби", "hobby", "game", "игра", "book", "books", "music"],
    200
  ),
  rule(
    "expense",
    "Цветы",
    ["5193", "5992"],
    ["цветы", "flowers", "букет", "florist"],
    210
  ),
  rule(
    "expense",
    "Цифровые товары",
    ["5734", "5735", "5815-5818"],
    ["digital", "цифров", "app store", "google play", "itunes", "software", "subscription"],
    220
  ),
  rule(
    "expense",
    "Ювелирные изделия",
    ["5094", "5944"],
    ["jewelry", "ювелир", "gold", "silver", "ring", "bracelet"],
    230
  ),

  rule("income", "Зарплата", [], ["salary", "зарплата", "payroll", "аванс"], 300),
  rule("income", "Фриланс", [], ["freelance", "фриланс", "upwork", "fiverr"], 310),
  rule("income", "Подарки", [], ["gift", "подарок", "present"], 320),
  rule("income", "Инвестиции", [], ["dividend", "дивиденд", "investment", "interest", "процент"], 330),
];

function resolveCategory({ type, description, rawCategory, row }) {
  const cleanedRawCategory = String(rawCategory || "").trim();

  if (
    cleanedRawCategory &&
    ![
      "прочие операции",
      "прочее",
      "другое",
      "other",
      "misc",
      "miscellaneous",
    ].includes(normalizeText(cleanedRawCategory))
  ) {
    return cleanedRawCategory;
  }

  const sourceText = normalizeText([description, cleanedRawCategory].filter(Boolean).join(" "));
  const mcc = extractMcc(description) || extractMccFromRow(row);
  const typedRules = CATEGORY_RULES.filter((ruleItem) => ruleItem.type === type);

  if (mcc) {
    const mccCandidates = typedRules.filter((ruleItem) => ruleMatchesMcc(mcc, ruleItem));

    if (mccCandidates.length === 1) {
      return mccCandidates[0].category;
    }

    if (mccCandidates.length > 1) {
      const scored = mccCandidates
        .map((ruleItem) => ({
          ruleItem,
          score: scoreRule(ruleItem, sourceText),
        }))
        .sort((a, b) => b.score - a.score || a.ruleItem.priority - b.ruleItem.priority);

      if (scored[0] && scored[0].score > 0) {
        return scored[0].ruleItem.category;
      }

      return type === "income" ? "Прочее" : "Без категории";
    }
  }

  const keywordScored = typedRules
    .map((ruleItem) => ({
      ruleItem,
      score: scoreRule(ruleItem, sourceText),
    }))
    .sort((a, b) => b.score - a.score || a.ruleItem.priority - b.ruleItem.priority);

  if (keywordScored[0] && keywordScored[0].score > 0) {
    return keywordScored[0].ruleItem.category;
  }

  return type === "income" ? "Прочее" : "Без категории";
}

module.exports = {
  normalizeText,
  extractMcc,
  extractMccFromRow,
  resolveCategory,
};