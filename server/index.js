// index.js - production-minded minimal proxy
import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import morgan from "morgan";
import { RateLimiterMemory } from "rate-limiter-flexible";

const app = express();

// Parse JSON and text/plain (to avoid browser preflight if needed)
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "text/plain", limit: "1mb" }));

// Logging
app.use(morgan("tiny"));

// CORS
const corsList = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: corsList.length ? corsList : "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-app-token"],
}));
app.options("*", cors());

// Simple auth (optional): front-end passes x-app-token that must match APP_TOKEN
const APP_TOKEN = process.env.APP_TOKEN || "";
function authMiddleware(req, res, next) {
  if (!APP_TOKEN) return next(); // disabled
  const token = req.headers["x-app-token"];
  if (token === APP_TOKEN) return next();
  return res.status(401).json({ error: { message: "Unauthorized" } });
}

// Rate limit per IP
const limiter = new RateLimiterMemory({
  points: Number(process.env.RATE_LIMIT_POINTS || 120),
  duration: Number(process.env.RATE_LIMIT_DURATION || 60),
});
async function rateLimit(req, res, next) {
  const ip = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "unknown";
  try {
    await limiter.consume(Array.isArray(ip) ? ip[0] : ip);
    next();
  } catch {
    res.status(429).json({ error: { message: "Too many requests" } });
  }
}

// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// Chat endpoint
app.post("/chat", authMiddleware, rateLimit, async (req, res) => {
  // Accept text/plain body
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const {
    messages,
    stream = false,
    model = process.env.DEFAULT_MODEL || "gpt-4o-mini",
    max_tokens = Number(process.env.MAX_TOKENS || 512),
    temperature = Number(process.env.TEMPERATURE || 0.7),
  } = body || {};

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: "OPENAI_API_KEY missing" } });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages required" } });
  }

  const payload = { model, messages, stream, max_tokens, temperature };

  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
  const url = base + "/v1/chat/completions";

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
    });

    if (!stream) {
      const data = await upstream.json().catch(() => ({}));
      return res.status(upstream.ok ? 200 : upstream.status).json(data);
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return res.status(upstream.status).send(errText || "Upstream error");
    }

    // Stream proxy (SSE). Client should auto-fallback if network blocks SSE.
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.status(502).json({ error: { message: `Upstream request failed: ${String(e)}` } });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("AI proxy listening on :" + port));
