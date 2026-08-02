const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KINDS = new Set(['preview', 'protected']);
const FILE_PATTERN = /^[a-f0-9]{32}\.(jpg|png)$/;

function createFileStore(root) {
  const dirs = {
    preview: path.join(root, 'preview'),
    protected: path.join(root, 'protected')
  };
  Object.values(dirs).forEach(directory => fs.mkdirSync(directory, { recursive: true, mode: 0o700 }));

  function directory(kind) {
    if (!KINDS.has(kind)) throw new Error('非法存储类型');
    return dirs[kind];
  }

  function safeName(name) {
    if (!FILE_PATTERN.test(name)) throw new Error('非法文件名');
    return name;
  }

  function save(kind, buffer, ext) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('文件内容为空');
    if (!['jpg', 'png'].includes(ext)) throw new Error('非法文件扩展名');
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const destination = path.join(directory(kind), name);
    const temporary = `${destination}.tmp`;
    try {
      fs.writeFileSync(temporary, buffer, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, destination);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          throw new AggregateError(
            [error, cleanupError],
            '文件写入失败且临时文件清理失败',
            { cause: error }
          );
        }
      }
      throw error;
    }
    return name;
  }

  function resolve(kind, name) {
    return path.join(directory(kind), safeName(name));
  }

  function remove(kind, name) {
    const filename = resolve(kind, name);
    try {
      fs.unlinkSync(filename);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  function removeOrderFiles(order) {
    const files = [
      ['preview', order?.previewFile],
      ['protected', order?.hdFile],
      ['protected', order?.sheetFile]
    ];
    const errors = [];

    for (const [kind, name] of files) {
      if (!name) continue;
      try {
        remove(kind, name);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, '部分订单文件清理失败');
    }
  }

  function saveOrderFiles(output) {
    const storedFiles = {};
    try {
      storedFiles.previewFile = save('preview', output.previewBuffer, 'jpg');
      storedFiles.hdFile = save('protected', output.hdBuffer, 'jpg');
      storedFiles.sheetFile = save('protected', output.sheetBuffer, 'jpg');
      return storedFiles;
    } catch (error) {
      try {
        removeOrderFiles(storedFiles);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          '订单文件写入失败且未能完全回滚',
          { cause: error }
        );
      }
      throw error;
    }
  }

  function health() {
    return Object.values(dirs).every(directoryPath => {
      fs.accessSync(directoryPath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    });
  }

  return { dirs, save, saveOrderFiles, resolve, remove, removeOrderFiles, health };
}

module.exports = { createFileStore };
