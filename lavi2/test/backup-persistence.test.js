const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('scheduled local snapshots use SQLite VACUUM INTO and retain a bounded history', () => {
  assert.match(server, /function createLocalSnapshot\(\)/);
  assert.match(server, /VACUUM INTO/);
  assert.match(server, /backupIntervalMs = 24 \* 60 \* 60 \* 1000/);
  assert.match(server, /files\.slice\(14\)/);
  assert.match(server, /lastAutoBackupError/);
});

test('backup status endpoint is restricted to authenticated teachers and warns about same-disk limits', () => {
  assert.match(server, /app\.get\('\/api\/backup\/status', authenticate, requireTeacher/);
  assert.match(server, /persistentDiskConfigured/);
  assert.match(server, /Snapshot trên cùng ổ đĩa không thay thế bản sao lưu ngoài hệ thống/);
});
