const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../config');
const { SIZES: serverSizes } = require('../sizes');

const miniRoot = path.resolve(__dirname, '../../miniprogram');
const { SIZES: miniProgramSizes } = require(path.join(miniRoot, 'utils/sizes.js'));

test('mini program separates develop, trial, and release endpoints', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'config.js'), 'utf8');
  assert.match(source, /develop/);
  assert.match(source, /trial/);
  assert.match(source, /release/);
  assert.match(source, /getAccountInfoSync/);
});

test('mock payment bypass is restricted to develop builds', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'pages/result/result.js'), 'utf8');
  assert.match(source, /payParams\._mock/);
  assert.match(source, /currentEnv\(\) === 'develop'/);
});

test('result page restores persisted order state', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'pages/result/result.js'), 'utf8');
  assert.match(source, /getStorageSync/);
  assert.match(source, /\/api\/orders\//);
  assert.match(source, /recoverOrder/);
});

test('mini program size metadata stays aligned with the authoritative server dimensions', () => {
  const clientDimensions = Object.fromEntries(
    miniProgramSizes.map(({ id, widthPX, heightPX }) => [id, { widthPX, heightPX }])
  );
  const serverDimensions = Object.fromEntries(
    Object.entries(serverSizes).map(([id, { widthPX, heightPX }]) => [id, { widthPX, heightPX }])
  );

  assert.deepEqual(clientDimensions, serverDimensions);
});

test('displayed price stays aligned with the default server charge', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'pages/result/result.js'), 'utf8');
  const match = source.match(/const PRICE = (\d+(?:\.\d+)?);/);
  assert.ok(match, 'result page must define a numeric PRICE');
  assert.equal(Number(match[1]) * 100, loadConfig({ NODE_ENV: 'development' }).pay.priceFen);
});

test('entry page describes concrete processing without approval guarantees', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'pages/index/index.wxml'), 'utf8');
  const productRequirements = fs.readFileSync(path.resolve(miniRoot, '../PRD.md'), 'utf8');
  assert.match(source, /换底色、裁尺寸、自然精修/);
  assert.doesNotMatch(source, /保证过审|一定过审|符合审核规范/);
  assert.doesNotMatch(productRequirements, /保证过审|一定过审/);
});
