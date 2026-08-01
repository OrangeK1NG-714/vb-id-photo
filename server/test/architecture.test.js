const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('order application layer stays independent from Express, Sharp, files and SQLite', () => {
  const architecture = fs.readFileSync(
    path.join(__dirname, '..', '..', 'ARCHITECTURE.md'),
    'utf8'
  );
  for (const heading of [
    '## 产品与边界',
    '## 目录职责',
    '## 依赖方向',
    '## 禁止事项',
    '## 当前迁移热点',
    '## 验证',
  ]) {
    assert.match(architecture, new RegExp(heading));
  }

  for (const entry of fs.readdirSync(path.join(__dirname, '..', 'application'))) {
    if (!entry.endsWith('.js')) continue;
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'application', entry),
      'utf8'
    );
    assert.doesNotMatch(
      source,
      /require\(\s*['"](?:express|sharp|better-sqlite3|node:fs|node:path)/u,
      entry
    );
  }
});
