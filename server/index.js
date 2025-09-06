import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import morgan from "morgan";
import { buildIpRateLimiter } from "./rateLimit.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// CORS allowlist
const allowList = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowList.length === 0 || allowList.includes(origin)) cb(null, true);
    else cb(new Error("Not allowed by CORS"));
  }
}));

app.get("/health", (_, res) => res.json({ ok: true }));

app.use(buildIpRateLimiter({
  points: Number(process.env.RATE_LIMIT_POINTS || 60),
  duration: Number(process.env.RATE_LIMIT_DURATION || 60),
}));

app.post("/chat", async (req, res) => {
  const { messages, stream = true, model = "gpt-4o-mini" } = req.body || {};
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: "OPENAI_API_KEY missing" } });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages required" } });
  }
  const payload = {
    model,
    messages,
    stream,
    max_tokens: 512,
    temperature: 0.7
  };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
    });

    if (!stream) {
      const data = await r.json();
      return res.status(r.ok ? 200 : r.status).json(data);
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });

    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.status(500).json({ error: { message: String(e) } });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AI proxy listening on :${port}`));
