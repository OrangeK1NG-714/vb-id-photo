const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const TRANSITIONS = Object.freeze({
  created: new Set(['paying', 'paid', 'expired', 'failed']),
  paying: new Set(['paid', 'expired', 'failed']),
  paid: new Set(['expired']),
  failed: new Set(['paying', 'paid', 'expired']),
  expired: new Set()
});

function mapRow(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    status: row.status,
    openid: row.openid,
    sizeId: row.size_id,
    colorId: row.color_id,
    level: row.level,
    previewFile: row.preview_file,
    hdFile: row.hd_file,
    sheetFile: row.sheet_file,
    downloadToken: row.download_token,
    transactionId: row.transaction_id,
    faceAdjusted: Boolean(row.face_adjusted),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createOrderStore(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (filename !== ':memory:') database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('created','paying','paid','expired','failed')),
      openid TEXT NOT NULL DEFAULT '',
      size_id TEXT NOT NULL,
      color_id TEXT NOT NULL,
      level TEXT NOT NULL,
      preview_file TEXT NOT NULL,
      hd_file TEXT NOT NULL,
      sheet_file TEXT NOT NULL,
      download_token TEXT NOT NULL,
      transaction_id TEXT NOT NULL DEFAULT '',
      face_adjusted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_created_status_idx ON orders (created_at, status);
  `);

  const select = database.prepare('SELECT * FROM orders WHERE order_id = ?');
  const insert = database.prepare(`
    INSERT INTO orders (
      order_id, status, size_id, color_id, level, preview_file, hd_file,
      sheet_file, download_token, face_adjusted, created_at, updated_at
    ) VALUES (?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = database.prepare(`
    UPDATE orders
    SET status = ?, openid = ?, transaction_id = ?, updated_at = ?
    WHERE order_id = ?
  `);
  const expired = database.prepare(`
    SELECT * FROM orders WHERE created_at < ? AND status != 'expired' ORDER BY created_at ASC
  `);

  function get(orderId) {
    return mapRow(select.get(orderId));
  }

  function create(order) {
    insert.run(
      order.orderId,
      order.sizeId,
      order.colorId,
      order.level,
      order.previewFile,
      order.hdFile,
      order.sheetFile,
      order.downloadToken,
      order.faceAdjusted ? 1 : 0,
      order.createdAt,
      order.createdAt
    );
    return get(order.orderId);
  }

  function transition(orderId, status, fields = {}) {
    if (!Object.hasOwn(TRANSITIONS, status)) throw new Error(`未知订单状态: ${status}`);
    const current = get(orderId);
    if (!current) return null;
    if (current.status !== status && !TRANSITIONS[current.status].has(status)) {
      throw new Error(`非法订单状态转换: ${current.status} -> ${status}`);
    }
    update.run(
      status,
      fields.openid ?? current.openid,
      fields.transactionId ?? current.transactionId,
      fields.updatedAt ?? Date.now(),
      orderId
    );
    return get(orderId);
  }

  function listExpired(cutoff) {
    return expired.all(cutoff).map(mapRow);
  }

  function health() {
    return database.prepare('SELECT 1 AS ok').get().ok === 1;
  }

  function close() {
    database.close();
  }

  return { create, get, transition, listExpired, health, close };
}

module.exports = { createOrderStore, TRANSITIONS };
