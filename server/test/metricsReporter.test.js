const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMetricsReporter } = require('../metricsReporter');

describe('metricsReporter', () => {
  it('is a no-op when endpoint is unset', async () => {
    let calls = 0;
    const reporter = createMetricsReporter({ endpoint: '', fetchImpl: async () => { calls += 1; return { ok: true }; } });
    assert.equal(await reporter.report('open', 'order-1'), false);
    assert.equal(calls, 0);
  });

  it('posts project/event/anonId to the endpoint', async () => {
    const sent = [];
    const reporter = createMetricsReporter({
      endpoint: 'http://localhost:9999/api/collect',
      fetchImpl: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; }
    });
    assert.equal(await reporter.report('open', 'order-1'), true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.project, 'id-photo');
    assert.equal(sent[0].body.event, 'open');
    assert.equal(typeof sent[0].body.anonId, 'string');
  });

  it('never leaks the raw seed — anonId is a stable hash', () => {
    const reporter = createMetricsReporter({ endpoint: 'x' });
    const openid = 'oABC-real-openid';
    const hashed = reporter.anonize(openid);
    assert.notEqual(hashed, openid);
    assert.equal(hashed.includes(openid), false);
    assert.equal(hashed, reporter.anonize(openid), '同一 seed 得到同一 anonId');
    assert.notEqual(hashed, reporter.anonize('other'));
  });

  it('swallows fetch errors and returns false', async () => {
    const reporter = createMetricsReporter({
      endpoint: 'http://localhost:9999/api/collect',
      logger: { debug() {} },
      fetchImpl: async () => { throw new Error('network down'); }
    });
    assert.equal(await reporter.report('open', 'order-1'), false);
  });
});
