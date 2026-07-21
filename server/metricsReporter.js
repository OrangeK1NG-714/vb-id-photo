const crypto = require('node:crypto');

// Fire-and-forget reporter to the unified vb-metrics dashboard. Sends only an
// anonymous project + event + hashed anon id — never the user's openid, image,
// or any PII. No-op when METRICS_ENDPOINT is unset, and failures are swallowed
// so metrics never affect the photo flow.
function createMetricsReporter({ endpoint, logger = console, fetchImpl } = {}) {
  const target = typeof endpoint === 'string' ? endpoint.trim() : '';
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  // Hash any raw identifier (openid / order id) into a stable opaque id so the
  // dashboard can dedup people without the endpoint ever seeing the original.
  function anonize(seed) {
    const value = seed && typeof seed === 'string' ? seed : 'anon';
    return crypto.createHash('sha256').update(`id-photo:${value}`).digest('hex').slice(0, 32);
  }

  async function report(event, seed) {
    if (!target || !doFetch) return false;
    const body = JSON.stringify({ project: 'id-photo', event, anonId: anonize(seed) });
    try {
      const res = await doFetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5_000)
      });
      return res && res.ok !== false;
    } catch (error) {
      logger.debug?.('metrics report failed', error?.message);
      return false;
    }
  }

  return { report, anonize };
}

module.exports = { createMetricsReporter };
