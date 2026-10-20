const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('sandbox safety contract uses synthetic records and tenant scoping', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /syntheticDataOnly: true/);
  assert.match(server, /LAVI_DEMO_MODE/);
  assert.match(server, /owner_user_id = \?/);
  assert.doesNotMatch(server, /Hoàng Tuệ An|Tô Nguyễn Tâm An/);
});

test('UI warns against real student data and offers separate demo accounts', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /Chỉ sử dụng dữ liệu giả lập/);
  assert.match(html, /teacher1/);
  assert.match(html, /teacher2/);
});
