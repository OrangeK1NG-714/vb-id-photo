function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 20_000,
  clock = () => Date.now(),
  keyGenerator = request => request.ip || request.socket?.remoteAddress || 'unknown'
}) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('rate limit must be a positive integer');
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error('rate limit window must be positive');
  if (!Number.isSafeInteger(maxKeys) || maxKeys <= 0) throw new Error('rate limit maxKeys must be positive');
  const entries = new Map();
  let nextSweepAt = 0;

  function sweep(now) {
    if (now < nextSweepAt && entries.size < maxKeys) return;
    entries.forEach((entry, key) => {
      if (entry.resetAt <= now) entries.delete(key);
    });
    nextSweepAt = now + Math.min(windowMs, 60_000);
  }

  function check(rawKey) {
    const now = clock();
    const key = String(rawKey || 'unknown').slice(0, 160);
    sweep(now);
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && entries.size >= maxKeys) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    if (entry.count >= limit) return { allowed: false, remaining: 0, retryAfterSeconds };
    entry.count += 1;
    return { allowed: true, remaining: limit - entry.count, retryAfterSeconds };
  }

  function middleware(request, response, next) {
    const decision = check(keyGenerator(request));
    response.set('X-RateLimit-Limit', String(limit));
    response.set('X-RateLimit-Remaining', String(decision.remaining));
    if (decision.allowed) return next();
    response.set('Retry-After', String(decision.retryAfterSeconds));
    return response.status(429).json({ code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' });
  }

  middleware.check = check;
  middleware.size = () => entries.size;
  return middleware;
}

function createConcurrencyGate(maxConcurrent) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) {
    throw new Error('maxConcurrent must be a positive integer');
  }
  let active = 0;

  function middleware(_request, response, next) {
    if (active >= maxConcurrent) {
      response.set('Retry-After', '2');
      return response.status(503).json({
        code: 'PROCESSING_BUSY',
        message: '当前处理任务较多，请稍后重试'
      });
    }

    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      response.off('finish', release);
      response.off('close', release);
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  }

  middleware.active = () => active;
  return middleware;
}

module.exports = { createRateLimiter, createConcurrencyGate };
