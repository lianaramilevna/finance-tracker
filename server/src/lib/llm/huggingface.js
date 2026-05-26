// Default to a model that is commonly available on HF Router.
const DEFAULT_MODEL = "meta-llama/Llama-3.2-1B-Instruct";
const DEFAULT_ROUTER_URL = "https://router.huggingface.co/v1";
const DEFAULT_TIMEOUT_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_FALLBACK_MODELS = [
  "meta-llama/Llama-3.1-8B-Instruct",
  "Qwen/Qwen2.5-7B-Instruct",
  "meta-llama/Llama-3.2-1B-Instruct",
];

function getFallbackModels() {
  const raw = String(process.env.HF_FALLBACK_MODELS || "").trim();
  if (!raw) return DEFAULT_FALLBACK_MODELS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getToken() {
  return (
    process.env.HF_API_TOKEN ||
    process.env.HUGGINGFACE_API_KEY ||
    process.env.HF_TOKEN ||
    ""
  ).trim();
}

function getModel() {
  return (process.env.HF_MODEL || DEFAULT_MODEL).trim();
}

function getRouterBaseUrl() {
  const raw = process.env.HF_ROUTER_URL || DEFAULT_ROUTER_URL;
  return raw.replace(/\/$/, "");
}

function getChatCompletionsUrl() {
  const base = getRouterBaseUrl();
  if (base.endsWith("/chat/completions")) {
    return base;
  }
  return `${base}/chat/completions`;
}

function isLlmEnabled() {
  const flag = String(process.env.LLM_ENABLED || "true").toLowerCase();
  return flag !== "false" && flag !== "0";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await res.text().catch(() => "");
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!res.ok) {
      const message =
        data?.error?.message ||
        data?.error ||
        (typeof data?.raw === "string" ? data.raw : null) ||
        `Hugging Face HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkHfHealth() {
  if (!isLlmEnabled()) {
    return { available: false, reason: "disabled", provider: "huggingface" };
  }

  const token = getToken();
  if (!token) {
    return {
      available: false,
      reason: "HF_API_TOKEN не задан",
      provider: "huggingface",
      model: getModel(),
    };
  }

  try {
    const res = await fetchWithTimeout("https://huggingface.co/api/whoami-v2", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res?.name && !res?.fullname) {
      throw new Error("Неверный токен Hugging Face");
    }

    return {
      available: true,
      provider: "huggingface",
      model: getModel(),
      routerUrl: getRouterBaseUrl(),
    };
  } catch (error) {
    return {
      available: false,
      reason: error.name === "AbortError" ? "timeout" : error.message,
      provider: "huggingface",
      model: getModel(),
    };
  }
}

async function chat(messages, options = {}) {
  const token = getToken();
  if (!token) {
    throw new Error("HF_API_TOKEN не задан");
  }

  const url = getChatCompletionsUrl();
  const baseReq = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  };

  const requestedModel = options.model || getModel();
  const candidates = [requestedModel, ...getFallbackModels()].filter(
    (m, idx, arr) => m && arr.indexOf(m) === idx
  );

  let lastError = null;
  for (const model of candidates) {
    const payload = {
      model,
      messages,
      stream: false,
      max_tokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.4,
    };
    const req = { ...baseReq, body: JSON.stringify(payload) };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const data = await fetchWithTimeout(url, req);
        const content = data?.choices?.[0]?.message?.content;
        if (!content || !String(content).trim()) {
          throw new Error("Пустой ответ от Hugging Face");
        }
        return String(content).trim();
      } catch (error) {
        lastError = error;
        const msg = String(error?.message || "");
        const status = error?.status;

        const isModelUnsupported =
          status === 400 && /not supported by any provider/i.test(msg);
        if (isModelUnsupported) {
          break; // try next model candidate
        }

        const isOverloaded =
          status === 429 ||
          status === 503 ||
          /high memory usage/i.test(msg) ||
          /temporarily unavailable/i.test(msg) ||
          /rate limit/i.test(msg);
        if (!isOverloaded || attempt === 2) break;
        await sleep(400 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError || new Error("Hugging Face недоступен");
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object in LLM response");
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

module.exports = {
  isLlmEnabled,
  checkHfHealth,
  chat,
  extractJsonObject,
  getModel,
  getToken,
};
