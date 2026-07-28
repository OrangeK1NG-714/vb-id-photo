const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '../../miniprogram');

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

test('entry page describes concrete processing without approval guarantees', () => {
  const source = fs.readFileSync(path.join(miniRoot, 'pages/index/index.wxml'), 'utf8');
  const productRequirements = fs.readFileSync(path.resolve(miniRoot, '../PRD.md'), 'utf8');
  assert.match(source, /换底色、裁尺寸、自然精修/);
  assert.doesNotMatch(source, /保证过审|一定过审|符合审核规范/);
  assert.doesNotMatch(productRequirements, /保证过审|一定过审/);
});
