const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createConcurrencyGate, createRateLimiter } = require('../security');

function mockResponse() {
  const response = new EventEmitter();
  response.headers = {};
  response.set = (name, value) => { response.headers[name] = value; return response; };
  response.status = value => { response.statusCode = value; return response; };
  response.json = value => { response.body = value; return response; };
  return response;
}

test('rate limiter blocks excess requests and bounds unique keys', () => {
  let now = 1_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, maxKeys: 2, clock: () => now });
  assert.equal(limiter.check('one').allowed, true);
  assert.equal(limiter.check('one').allowed, true);
  assert.equal(limiter.check('one').allowed, false);
  assert.equal(limiter.check('two').allowed, true);
  assert.equal(limiter.check('three').allowed, false);
  assert.equal(limiter.size(), 2);
  now += 10_001;
  assert.equal(limiter.check('three').allowed, true);
});

test('rate limiter rejects invalid capacity configuration', () => {
  assert.throws(
    () => createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 0 }),
    /maxKeys/
  );
});

test('concurrency gate releases capacity on response finish', () => {
  const gate = createConcurrencyGate(1);
  const first = mockResponse();
  let firstPassed = false;
  gate({}, first, () => { firstPassed = true; });
  assert.equal(firstPassed, true);
  assert.equal(gate.active(), 1);

  const blocked = mockResponse();
  gate({}, blocked, () => assert.fail('blocked request must not enter'));
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.body.code, 'PROCESSING_BUSY');

  first.emit('finish');
  assert.equal(gate.active(), 0);
  const next = mockResponse();
  let nextPassed = false;
  gate({}, next, () => { nextPassed = true; });
  assert.equal(nextPassed, true);
});
