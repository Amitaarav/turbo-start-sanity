interface RateLimitRecord {
  timestamps: number[];
}

export interface RateLimitOptions {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds when the oldest token expires
}

/**
 * In-memory sliding-window rate limiter keyed by client identifier (e.g. IP).
 * Prunes expired timestamps automatically on each check.
 */
export class RateLimiter {
  private readonly store = new Map<string, RateLimitRecord>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private lastCleanup: number = Date.now();

  constructor(options: RateLimitOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  public check(identifier: string): RateLimitResult {
    const now = Date.now();

    // Occasional global cleanup every 5 minutes to release stale memory
    if (now - this.lastCleanup > 5 * 60 * 1000) {
      this.cleanup(now);
    }

    const record = this.store.get(identifier) ?? { timestamps: [] };
    const windowStart = now - this.windowMs;

    // Filter out timestamps outside the active sliding window
    const activeTimestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (activeTimestamps.length >= this.maxRequests) {
      const oldest = activeTimestamps[0] ?? now;
      const resetTime = Math.ceil((oldest + this.windowMs) / 1000);

      return {
        success: false,
        limit: this.maxRequests,
        remaining: 0,
        reset: resetTime,
      };
    }

    activeTimestamps.push(now);
    this.store.set(identifier, { timestamps: activeTimestamps });

    const oldest = activeTimestamps[0] ?? now;
    const resetTime = Math.ceil((oldest + this.windowMs) / 1000);

    return {
      success: true,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - activeTimestamps.length),
      reset: resetTime,
    };
  }

  private cleanup(now: number) {
    this.lastCleanup = now;
    const windowStart = now - this.windowMs;

    for (const [key, record] of this.store.entries()) {
      const valid = record.timestamps.filter((ts) => ts > windowStart);
      if (valid.length === 0) {
        this.store.delete(key);
      } else {
        record.timestamps = valid;
      }
    }
  }
}

/**
 * Resolves the client IP address from standard proxy headers.
 */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // The client IP is the first entry in X-Forwarded-For
    const clientIp = forwardedFor.split(",")[0]?.trim();
    if (clientIp) {
      return clientIp;
    }
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "127.0.0.1";
}

