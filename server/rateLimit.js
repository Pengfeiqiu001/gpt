import { RateLimiterMemory } from "rate-limiter-flexible";

export function buildIpRateLimiter({ points = 60, duration = 60 } = {}) {
  const limiter = new RateLimiterMemory({ points, duration });
  return async function ipLimiter(req, res, next) {
    const ipHeader = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"];
    const ip = Array.isArray(ipHeader) ? ipHeader[0] : ipHeader || req.ip || "unknown";
    try {
      await limiter.consume(ip);
      next();
    } catch {
      res.status(429).json({ error: { message: "Too many requests" } });
    }
  };
}
